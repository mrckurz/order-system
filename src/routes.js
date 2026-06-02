import express from 'express';
import db from './db.js';
import config from './config.js';
import {
  requireAdmin,
  requireStaff,
  requireWaiter,
  roleForPassword,
  createStaffToken,
  claimWaiterLink,
  newToken,
  rateLimit,
} from './auth.js';
import {
  createOrder,
  getStationQueue,
  setItemStatus,
  setOrderStatus,
  reprintOrder,
  listOrders,
} from './orders.js';

const router = express.Router();

// ---------- helpers ----------
function getStations() {
  return db.prepare('SELECT id, label, print, sort FROM stations ORDER BY sort, id').all();
}

function getMenu({ includeInactive = false } = {}) {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort, id').all();
  const artStmt = includeInactive
    ? db.prepare('SELECT * FROM articles WHERE category_id = ? ORDER BY sort, id')
    : db.prepare('SELECT * FROM articles WHERE category_id = ? AND active = 1 ORDER BY sort, id');
  return cats.map((c) => ({ ...c, items: artStmt.all(c.id) }));
}

function waiterLink(claimToken) {
  // Point at the frontend (GitHub Pages in hybrid mode), else the backend which
  // serves the PWA itself. Query-param form works on static hosting (no rewrites).
  const base = config.frontendUrl || config.publicUrl;
  return `${base}/waiter.html?c=${claimToken}`;
}

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- public config ----------
router.get('/config', (req, res) => {
  res.json({
    appName: 'OrderFlow',
    lang: config.defaultLang,
    currency: config.currency,
    stations: getStations(),
    stationLoginSeparate: !!config.stationPassword,
  });
});

// ---------- staff login (admin or station) ----------
router.post('/login', rateLimit({ bucket: 'login', max: 10, windowMs: 60_000 }), (req, res) => {
  const role = roleForPassword(req.body?.password);
  if (!role) return res.status(401).json({ error: 'wrong_password' });
  res.json({ token: createStaffToken(role), role });
});

router.get('/whoami', requireStaff, (req, res) => res.json({ role: req.staff.role }));

// ---------- waiter: claim a single-use link ----------
router.post(
  '/waiters/claim',
  rateLimit({ bucket: 'claim', max: 20, windowMs: 60_000 }),
  (req, res) => {
    const result = claimWaiterLink(req.body?.claimToken);
    if (result.error) {
      const code = result.error === 'already_claimed' ? 409 : 401;
      return res.status(code).json({ error: result.error });
    }
    res.json(result);
  }
);

// ---------- menu ----------
router.get('/menu', requireWaiter, (req, res) =>
  res.json({ categories: getMenu(), stations: getStations() })
);
router.get('/admin/menu', requireAdmin, (req, res) =>
  res.json({ categories: getMenu({ includeInactive: true }), stations: getStations() })
);

// ---------- admin: stations ----------
router.put('/admin/stations/:id', requireAdmin, (req, res) => {
  const { label, print, sort } = req.body || {};
  db.prepare(
    `INSERT INTO stations (id, label, print, sort) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, print = excluded.print, sort = excluded.sort`
  ).run(req.params.id, label ?? req.params.id, print ? 1 : 0, sort ?? 0);
  res.json({ ok: true, stations: getStations() });
});

// ---------- admin: categories ----------
router.post('/admin/categories', requireAdmin, (req, res) => {
  const { name, station = 'drinks', sort = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO categories (name, station, sort) VALUES (?, ?, ?)')
    .run(name, station, sort);
  res.json({ id: lastInsertRowid });
});

router.patch('/admin/categories/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  const { name = cur.name, station = cur.station, sort = cur.sort } = req.body || {};
  db.prepare('UPDATE categories SET name = ?, station = ?, sort = ? WHERE id = ?').run(
    name, station, sort, req.params.id
  );
  res.json({ ok: true });
});

router.delete('/admin/categories/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: articles ----------
router.post('/admin/articles', requireAdmin, (req, res) => {
  const { categoryId, name, price = 0, station, sort = 0 } = req.body || {};
  if (!categoryId || !name) return res.status(400).json({ error: 'category_and_name_required' });
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!cat) return res.status(400).json({ error: 'unknown_category' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO articles (category_id, name, price, station, active, sort) VALUES (?, ?, ?, ?, 1, ?)')
    .run(categoryId, name, Number(price) || 0, station || cat.station, sort);
  res.json({ id: lastInsertRowid });
});

router.patch('/admin/articles/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  db.prepare(
    'UPDATE articles SET name = ?, price = ?, station = ?, active = ?, sort = ?, category_id = ? WHERE id = ?'
  ).run(
    b.name ?? cur.name,
    b.price ?? cur.price,
    b.station ?? cur.station,
    b.active ?? cur.active,
    b.sort ?? cur.sort,
    b.categoryId ?? cur.category_id,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/admin/articles/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: waiters ----------
function waiterStatus(w) {
  if (!w.active) return 'revoked';
  if (Date.now() > w.expires_at) return 'expired';
  if (!w.session_token) return 'pending'; // link created but not yet claimed
  return 'active';
}

function publicWaiter(w) {
  const status = waiterStatus(w);
  return {
    id: w.id,
    name: w.name,
    status,
    claimed: !!w.session_token,
    claimed_at: w.claimed_at,
    created_at: w.created_at,
    expires_at: w.expires_at,
    // The link is only useful before it is claimed; hide it afterwards.
    link: w.session_token ? null : waiterLink(w.claim_token),
  };
}

router.get('/admin/waiters', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM waiters ORDER BY created_at DESC').all();
  res.json(rows.map(publicWaiter));
});

router.post('/admin/waiters', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const ttlHours = Number(req.body?.ttlHours) || config.waiterTokenTtlHours;
  const now = Date.now();
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO waiters (name, claim_token, active, created_at, expires_at) VALUES (?, ?, 1, ?, ?)'
    )
    .run(name, newToken(), now, now + ttlHours * 3600_000);
  res.json(publicWaiter(db.prepare('SELECT * FROM waiters WHERE id = ?').get(lastInsertRowid)));
});

// Generate a fresh single-use link (e.g. waiter lost their phone). This
// invalidates the old link and the current device session.
router.post('/admin/waiters/:id/relink', requireAdmin, (req, res) => {
  const w = db.prepare('SELECT * FROM waiters WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'not_found' });
  const hours = Number(req.body?.hours) || config.waiterTokenTtlHours;
  db.prepare(
    'UPDATE waiters SET claim_token = ?, session_token = NULL, claimed_at = NULL, active = 1, expires_at = ? WHERE id = ?'
  ).run(newToken(), Date.now() + hours * 3600_000, req.params.id);
  res.json(publicWaiter(db.prepare('SELECT * FROM waiters WHERE id = ?').get(req.params.id)));
});

router.post('/admin/waiters/:id/revoke', requireAdmin, (req, res) => {
  db.prepare('UPDATE waiters SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/admin/waiters/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM waiters WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: orders overview (admin only) ----------
router.get('/admin/orders', requireAdmin, (req, res) => {
  res.json(listOrders({ limit: Number(req.query.limit) || 200 }));
});

// ---------- stations (bar / kitchen) — admin or station ----------
router.get('/stations/:station/queue', requireStaff, (req, res) => {
  res.json(getStationQueue(req.params.station));
});

router.post('/order-items/:id/done', requireStaff, (req, res) => {
  res.json(setItemStatus(Number(req.params.id), 'done'));
});

router.post('/orders/:id/done', requireStaff, (req, res) => {
  res.json(setOrderStatus(Number(req.params.id), 'done', req.body?.station || null));
});

router.post('/orders/:id/reprint', requireStaff, asyncH((req, res) => {
  res.json(reprintOrder(Number(req.params.id)));
}));

// ---------- waiter ----------
router.get('/me', requireWaiter, (req, res) => {
  res.json({ id: req.waiter.id, name: req.waiter.name, expires_at: req.waiter.expires_at });
});

router.post('/orders', requireWaiter, (req, res) => {
  const order = createOrder({
    waiterId: req.waiter.id,
    table: req.body?.table,
    note: req.body?.note,
    items: req.body?.items,
  });
  res.status(201).json(order);
});

router.get('/orders/mine', requireWaiter, (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE waiter_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.waiter.id);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
  for (const o of orders) {
    o.items = itemsStmt.all(o.id);
    o.total = o.items.reduce((s, it) => s + it.price * it.qty, 0);
  }
  res.json(orders);
});

export default router;
