import express from 'express';
import db from './db.js';
import config from './config.js';
import {
  requireAdmin,
  requireStaff,
  requireWaiter,
  verifyAccount,
  createAccount,
  getAccountById,
  countActiveAdmins,
  hashPassword,
  createSessionToken,
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
import { emitReset } from './realtime.js';
import {
  getActiveEventId,
  getActiveEvent,
  getEvent,
  listEvents,
  createEvent,
  renameEvent,
  setEventStatus,
  deleteEvent,
  setActiveEvent,
} from './events.js';
import { eventStats, eventCsv } from './stats.js';
import { seedEventMenu } from './seed.js';

const router = express.Router();
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- helpers ----------
function getStations() {
  return db.prepare('SELECT id, label, print, sort FROM stations ORDER BY sort, id').all();
}

function getMenu(eventId, { includeInactive = false } = {}) {
  const cats = db.prepare('SELECT * FROM categories WHERE event_id = ? ORDER BY sort, id').all(eventId);
  const artStmt = includeInactive
    ? db.prepare('SELECT * FROM articles WHERE category_id = ? ORDER BY sort, id')
    : db.prepare('SELECT * FROM articles WHERE category_id = ? AND active = 1 ORDER BY sort, id');
  return cats.map((c) => ({ ...c, items: artStmt.all(c.id) }));
}

function waiterLink(claimToken) {
  const base = config.frontendUrl || config.publicUrl;
  return `${base}/waiter.html?c=${claimToken}`;
}

// ---------- public config ----------
router.get('/config', (req, res) => {
  const ev = getActiveEvent();
  res.json({
    appName: 'OrderFlow',
    lang: config.defaultLang,
    currency: config.currency,
    stations: getStations(),
    activeEvent: ev ? { id: ev.id, name: ev.name } : null,
  });
});

// ---------- staff login ----------
router.post('/login', rateLimit({ bucket: 'login', max: 10, windowMs: 60_000 }), (req, res) => {
  const acc = verifyAccount(req.body?.username, req.body?.password);
  if (!acc) return res.status(401).json({ error: 'wrong_credentials' });
  res.json({ token: createSessionToken(acc), role: acc.role, username: acc.username });
});

router.get('/whoami', requireStaff, (req, res) =>
  res.json({ role: req.staff.role, username: req.staff.username, uid: req.staff.id })
);

// ---------- waiter: claim a single-use link ----------
router.post('/waiters/claim', rateLimit({ bucket: 'claim', max: 20, windowMs: 60_000 }), (req, res) => {
  const result = claimWaiterLink(req.body?.claimToken);
  if (result.error) {
    return res.status(result.error === 'already_claimed' ? 409 : 401).json({ error: result.error });
  }
  res.json(result);
});

// ---------- menu ----------
router.get('/menu', requireWaiter, (req, res) =>
  res.json({ categories: getMenu(req.waiter.event_id), stations: getStations() })
);
router.get('/admin/menu', requireAdmin, (req, res) =>
  res.json({ categories: getMenu(getActiveEventId(), { includeInactive: true }), stations: getStations() })
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

// ---------- admin: categories (scoped to the active event) ----------
router.post('/admin/categories', requireAdmin, (req, res) => {
  const { name, station = 'drinks', sort = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO categories (event_id, name, station, sort) VALUES (?, ?, ?, ?)')
    .run(getActiveEventId(), name, station, sort);
  res.json({ id: lastInsertRowid });
});

router.patch('/admin/categories/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  const { name = cur.name, station = cur.station, sort = cur.sort } = req.body || {};
  db.prepare('UPDATE categories SET name = ?, station = ?, sort = ? WHERE id = ?').run(name, station, sort, req.params.id);
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
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND event_id = ?').get(categoryId, getActiveEventId());
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

// ---------- admin: accounts ----------
function publicAccount(a) {
  return { id: a.id, username: a.username, role: a.role, active: !!a.active, created_at: a.created_at };
}

router.get('/admin/accounts', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM accounts ORDER BY role, username').all().map(publicAccount));
});

router.post('/admin/accounts', requireAdmin, (req, res) => {
  const { username, password, role = 'admin' } = req.body || {};
  const id = createAccount({ username, password, role });
  res.status(201).json(publicAccount(getAccountById(id)));
});

router.patch('/admin/accounts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const acc = getAccountById(id);
  if (!acc) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const willBeInactiveAdmin =
    acc.role === 'admin' && (b.active === 0 || b.active === false || (b.role && b.role !== 'admin'));
  if (willBeInactiveAdmin && countActiveAdmins(id) === 0) return res.status(400).json({ error: 'last_admin' });
  if (b.role && !['admin', 'station'].includes(b.role)) return res.status(400).json({ error: 'invalid_role' });

  const username = b.username !== undefined ? String(b.username).trim() || acc.username : acc.username;
  const role = b.role ?? acc.role;
  const active = b.active === undefined ? acc.active : b.active ? 1 : 0;
  try {
    db.prepare('UPDATE accounts SET username = ?, role = ?, active = ? WHERE id = ?').run(username, role, active, id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
  if (b.password) {
    if (String(b.password).length < 4) return res.status(400).json({ error: 'password_too_short' });
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), id);
  }
  res.json(publicAccount(getAccountById(id)));
});

router.delete('/admin/accounts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const acc = getAccountById(id);
  if (!acc) return res.status(404).json({ error: 'not_found' });
  if (id === req.staff.id) return res.status(400).json({ error: 'cannot_delete_self' });
  if (acc.role === 'admin' && countActiveAdmins(id) === 0) return res.status(400).json({ error: 'last_admin' });
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- admin: events ----------
router.get('/admin/events', requireAdmin, (req, res) => res.json(listEvents()));

router.post('/admin/events', requireAdmin, (req, res) => {
  const { name, copyMenuFrom, seedMenu, activate = true } = req.body || {};
  const ev = createEvent({ name, copyFromEventId: copyMenuFrom || null, activate });
  // If not copying from another event and the new event has no menu, seed defaults.
  if (!copyMenuFrom && seedMenu !== false) seedEventMenu(ev.id);
  res.status(201).json(ev);
});

router.post('/admin/events/:id/activate', requireAdmin, (req, res) => {
  const ev = getEvent(Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'not_found' });
  setActiveEvent(ev.id);
  res.json({ ok: true });
});

router.patch('/admin/events/:id', requireAdmin, (req, res) => {
  const ev = getEvent(Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'not_found' });
  let out = ev;
  if (req.body?.name !== undefined) out = renameEvent(ev.id, req.body.name);
  if (req.body?.status) out = setEventStatus(ev.id, req.body.status);
  res.json(out);
});

router.delete('/admin/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const ev = getEvent(id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  if (id === getActiveEventId()) return res.status(400).json({ error: 'cannot_delete_active' });
  deleteEvent(id);
  res.json({ ok: true });
});

// ---------- admin: statistics + CSV export ----------
router.get('/admin/stats', requireAdmin, (req, res) => {
  const eventId = Number(req.query.eventId) || getActiveEventId();
  const ev = getEvent(eventId);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  res.json({ event: { id: ev.id, name: ev.name }, ...eventStats(eventId) });
});

router.get('/admin/events/:id/export.csv', requireAdmin, (req, res) => {
  const ev = getEvent(Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const safe = ev.name.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orderflow-${safe}-${ev.id}.csv"`);
  res.send(eventCsv(ev.id));
});

// ---------- admin: orders overview (active event) ----------
router.get('/admin/orders', requireAdmin, (req, res) => {
  res.json(listOrders({ eventId: getActiveEventId(), limit: Number(req.query.limit) || 200 }));
});

// Reset the active event's order data (for testing before going live).
router.post('/admin/reset', requireAdmin, (req, res) => {
  const eventId = getActiveEventId();
  const alsoWaiters = !!req.body?.waiters;
  db.transaction(() => {
    const ids = db.prepare('SELECT id FROM orders WHERE event_id = ?').all(eventId).map((r) => r.id);
    const del = db.prepare('DELETE FROM orders WHERE id = ?');
    for (const id of ids) del.run(id); // order_items cascade
    if (alsoWaiters) db.prepare('DELETE FROM waiters WHERE event_id = ?').run(eventId);
  })();
  emitReset();
  res.json({ ok: true, waiters: alsoWaiters });
});

// ---------- stations (bar / kitchen) — active event ----------
router.get('/stations/:station/queue', requireStaff, (req, res) => {
  res.json(getStationQueue(req.params.station, getActiveEventId()));
});

router.post('/order-items/:id/done', requireStaff, (req, res) => res.json(setItemStatus(Number(req.params.id), 'done')));
router.post('/orders/:id/done', requireStaff, (req, res) =>
  res.json(setOrderStatus(Number(req.params.id), 'done', req.body?.station || null))
);
router.post('/orders/:id/reprint', requireStaff, asyncH((req, res) => res.json(reprintOrder(Number(req.params.id)))));

// ---------- admin: waiters (scoped to the active event) ----------
function waiterStatus(w) {
  if (!w.active) return 'revoked';
  if (Date.now() > w.expires_at) return 'expired';
  if (!w.session_token) return 'pending';
  return 'active';
}
function publicWaiter(w) {
  return {
    id: w.id,
    name: w.name,
    status: waiterStatus(w),
    claimed: !!w.session_token,
    claimed_at: w.claimed_at,
    created_at: w.created_at,
    expires_at: w.expires_at,
    link: w.session_token ? null : waiterLink(w.claim_token),
  };
}

router.get('/admin/waiters', requireAdmin, (req, res) => {
  res.json(
    db.prepare('SELECT * FROM waiters WHERE event_id = ? ORDER BY created_at DESC').all(getActiveEventId()).map(publicWaiter)
  );
});

router.post('/admin/waiters', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const ttlHours = Number(req.body?.ttlHours) || config.waiterTokenTtlHours;
  const now = Date.now();
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO waiters (event_id, name, claim_token, active, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?)'
    )
    .run(getActiveEventId(), name, newToken(), now, now + ttlHours * 3600_000);
  res.json(publicWaiter(db.prepare('SELECT * FROM waiters WHERE id = ?').get(lastInsertRowid)));
});

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

// ---------- waiter ----------
router.get('/me', requireWaiter, (req, res) =>
  res.json({ id: req.waiter.id, name: req.waiter.name, expires_at: req.waiter.expires_at })
);

router.post('/orders', requireWaiter, (req, res) => {
  const order = createOrder({
    waiterId: req.waiter.id,
    eventId: req.waiter.event_id,
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
