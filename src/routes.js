import express from 'express';
import db from './db.js';
import config from './config.js';
import {
  requireAdmin,
  requireSuperadmin,
  requireStaff,
  requireWaiter,
  verifyAccount,
  createAccount,
  getAccountById,
  countActiveSuperadmins,
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
  ownerIdFor,
  getActiveEventIdFor,
  setActiveEventForAccount,
  getActiveEventFor,
  getEvent,
  listEventsFor,
  createEvent,
  renameEvent,
  setEventStatus,
  deleteEvent,
  canAccessEvent,
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

// Throw 403 unless the requesting staff may access this event.
function assertEvent(req, eventId) {
  const ev = getEvent(eventId);
  if (!ev || !canAccessEvent(req.staff, ev)) throw Object.assign(new Error('forbidden'), { status: 403 });
  return ev;
}
const eventOfCategory = (id) => db.prepare('SELECT event_id FROM categories WHERE id = ?').get(id)?.event_id;
const eventOfArticle = (id) =>
  db.prepare('SELECT c.event_id e FROM articles a JOIN categories c ON c.id = a.category_id WHERE a.id = ?').get(id)?.e;
const eventOfWaiter = (id) => db.prepare('SELECT event_id FROM waiters WHERE id = ?').get(id)?.event_id;
const eventOfOrder = (id) => db.prepare('SELECT event_id FROM orders WHERE id = ?').get(id)?.event_id;
const eventOfItem = (id) =>
  db.prepare('SELECT o.event_id e FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ?').get(id)?.e;

// ---------- public config ----------
router.get('/config', (req, res) => {
  res.json({ appName: 'OrderFlow', lang: config.defaultLang, currency: config.currency, stations: getStations() });
});

// ---------- staff login ----------
router.post('/login', rateLimit({ bucket: 'login', max: 20, windowMs: 60_000 }), (req, res) => {
  const acc = verifyAccount(req.body?.username, req.body?.password);
  if (!acc) return res.status(401).json({ error: 'wrong_credentials' });
  res.json({ token: createSessionToken(acc), role: acc.role, username: acc.username });
});

router.get('/whoami', requireStaff, (req, res) => {
  const ev = getActiveEventFor(req.staff);
  res.json({
    role: req.staff.role,
    username: req.staff.username,
    uid: req.staff.id,
    activeEvent: ev ? { id: ev.id, name: ev.name } : null,
  });
});

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
router.get('/admin/menu', requireAdmin, (req, res) => {
  const eventId = getActiveEventIdFor(req.staff);
  res.json({ categories: getMenu(eventId, { includeInactive: true }), stations: getStations() });
});

// ---------- menu CSV export / import (own active event) ----------
function splitCsv(line, d) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseMenuCsv(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const c = splitCsv(raw, ';').map((s) => s.trim());
    if (!c[0]) continue;
    if (rows.length === 0 && /^(kategorie|category)$/i.test(c[0])) continue; // header
    const name = (c[1] || '').trim();
    if (!name) continue;
    const active = !['0', 'false', 'nein', 'no'].includes((c[4] || '').toLowerCase());
    rows.push({ category: c[0], name, price: parseFloat(String(c[2] || '0').replace(',', '.')) || 0, station: (c[3] || '').trim(), active });
  }
  return rows;
}

router.get('/admin/menu/export.csv', requireAdmin, (req, res) => {
  const eventId = getActiveEventIdFor(req.staff);
  if (!eventId) return res.status(400).json({ error: 'no_active_event' });
  assertEvent(req, eventId);
  const esc = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = ['Kategorie;Artikel;Preis;Station;Aktiv'];
  for (const cat of getMenu(eventId, { includeInactive: true })) {
    for (const a of cat.items) rows.push([cat.name, a.name, a.price.toFixed(2), a.station, a.active ? 1 : 0].map(esc).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="speisekarte.csv"');
  res.send(rows.join('\n') + '\n');
});

router.post('/admin/menu/import', requireAdmin, (req, res) => {
  const eventId = getActiveEventIdFor(req.staff);
  if (!eventId) return res.status(400).json({ error: 'no_active_event' });
  assertEvent(req, eventId);
  const rows = parseMenuCsv(req.body?.csv || '');
  if (!rows.length) return res.status(400).json({ error: 'empty_or_invalid' });
  const validStations = new Set(getStations().map((s) => s.id));
  const tx = db.transaction(() => {
    if (req.body?.replace) db.prepare('DELETE FROM categories WHERE event_id = ?').run(eventId);
    const catMap = new Map(
      db.prepare('SELECT id, name FROM categories WHERE event_id = ?').all(eventId).map((c) => [c.name.toLowerCase(), c.id])
    );
    const insCat = db.prepare('INSERT INTO categories (event_id, name, station, sort) VALUES (?, ?, ?, ?)');
    const insArt = db.prepare('INSERT INTO articles (category_id, name, price, station, active, sort) VALUES (?, ?, ?, ?, ?, ?)');
    let sort = 0;
    for (const r of rows) {
      const station = validStations.has(r.station) ? r.station : 'drinks';
      let cid = catMap.get(r.category.toLowerCase());
      if (!cid) { cid = insCat.run(eventId, r.category, station, catMap.size).lastInsertRowid; catMap.set(r.category.toLowerCase(), cid); }
      insArt.run(cid, r.name, r.price, station, r.active ? 1 : 0, sort++);
    }
  });
  tx();
  res.json({ ok: true, imported: rows.length });
});

// ---------- stations definition (global infrastructure — superadmin) ----------
router.put('/admin/stations/:id', requireSuperadmin, (req, res) => {
  const { label, print, sort } = req.body || {};
  db.prepare(
    `INSERT INTO stations (id, label, print, sort) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, print = excluded.print, sort = excluded.sort`
  ).run(req.params.id, label ?? req.params.id, print ? 1 : 0, sort ?? 0);
  res.json({ ok: true, stations: getStations() });
});

// ---------- categories (within the requester's active event) ----------
router.post('/admin/categories', requireAdmin, (req, res) => {
  const { name, station = 'drinks' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const eventId = getActiveEventIdFor(req.staff);
  assertEvent(req, eventId);
  const sort = req.body?.sort ?? db.prepare('SELECT COALESCE(MAX(sort),-1)+1 n FROM categories WHERE event_id = ?').get(eventId).n;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO categories (event_id, name, station, sort) VALUES (?, ?, ?, ?)')
    .run(eventId, name, station, sort);
  res.json({ id: lastInsertRowid });
});

// Reorder categories within the active event: body { ids: [orderedIds] }
router.post('/admin/categories/reorder', requireAdmin, (req, res) => {
  const eventId = getActiveEventIdFor(req.staff);
  assertEvent(req, eventId);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const upd = db.prepare('UPDATE categories SET sort = ? WHERE id = ? AND event_id = ?');
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id, eventId)))();
  res.json({ ok: true });
});

router.patch('/admin/categories/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  assertEvent(req, cur.event_id);
  const { name = cur.name, station = cur.station, sort = cur.sort } = req.body || {};
  db.prepare('UPDATE categories SET name = ?, station = ?, sort = ? WHERE id = ?').run(name, station, sort, req.params.id);
  res.json({ ok: true });
});

router.delete('/admin/categories/:id', requireAdmin, (req, res) => {
  assertEvent(req, eventOfCategory(req.params.id));
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- articles ----------
router.post('/admin/articles', requireAdmin, (req, res) => {
  const { categoryId, name, price = 0, station } = req.body || {};
  if (!categoryId || !name) return res.status(400).json({ error: 'category_and_name_required' });
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!cat) return res.status(400).json({ error: 'unknown_category' });
  assertEvent(req, cat.event_id);
  const sort = req.body?.sort ?? db.prepare('SELECT COALESCE(MAX(sort),-1)+1 n FROM articles WHERE category_id = ?').get(categoryId).n;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO articles (category_id, name, price, station, active, sort) VALUES (?, ?, ?, ?, 1, ?)')
    .run(categoryId, name, Number(price) || 0, station || cat.station, sort);
  res.json({ id: lastInsertRowid });
});

// Reorder articles within a category: body { ids: [orderedIds] }
router.post('/admin/articles/reorder', requireAdmin, (req, res) => {
  const eventId = getActiveEventIdFor(req.staff);
  assertEvent(req, eventId);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const upd = db.prepare(
    'UPDATE articles SET sort = ? WHERE id = ? AND category_id IN (SELECT id FROM categories WHERE event_id = ?)'
  );
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id, eventId)))();
  res.json({ ok: true });
});

router.patch('/admin/articles/:id', requireAdmin, (req, res) => {
  const cur = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  assertEvent(req, eventOfArticle(req.params.id));
  const b = req.body || {};
  db.prepare(
    'UPDATE articles SET name = ?, price = ?, station = ?, active = ?, sort = ?, category_id = ? WHERE id = ?'
  ).run(
    b.name ?? cur.name, b.price ?? cur.price, b.station ?? cur.station,
    b.active ?? cur.active, b.sort ?? cur.sort, b.categoryId ?? cur.category_id, req.params.id
  );
  res.json({ ok: true });
});

router.delete('/admin/articles/:id', requireAdmin, (req, res) => {
  assertEvent(req, eventOfArticle(req.params.id));
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Team: station accounts within the requester's tenant ----------
function publicAccount(a) {
  return { id: a.id, username: a.username, role: a.role, active: !!a.active, created_at: a.created_at };
}
function ownsAccount(req, target) {
  return target.id === req.staff.id || (target.role === 'station' && target.owner_id === ownerIdFor(req.staff));
}

router.get('/admin/accounts', requireAdmin, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM accounts WHERE id = ? OR (role = 'station' AND owner_id = ?) ORDER BY role, username")
    .all(req.staff.id, ownerIdFor(req.staff));
  res.json(rows.map(publicAccount));
});

router.post('/admin/accounts', requireAdmin, (req, res) => {
  const { username, password } = req.body || {};
  const id = createAccount({ username, password, role: 'station', ownerId: ownerIdFor(req.staff) });
  res.status(201).json(publicAccount(getAccountById(id)));
});

router.patch('/admin/accounts/:id', requireAdmin, (req, res) => {
  const acc = getAccountById(Number(req.params.id));
  if (!acc) return res.status(404).json({ error: 'not_found' });
  if (!ownsAccount(req, acc)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const username = b.username !== undefined ? String(b.username).trim() || acc.username : acc.username;
  const active = b.active === undefined ? acc.active : b.active ? 1 : 0;
  try {
    db.prepare('UPDATE accounts SET username = ?, active = ? WHERE id = ?').run(username, active, acc.id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
  if (b.password) {
    if (String(b.password).length < 4) return res.status(400).json({ error: 'password_too_short' });
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), acc.id);
  }
  res.json(publicAccount(getAccountById(acc.id)));
});

router.delete('/admin/accounts/:id', requireAdmin, (req, res) => {
  const acc = getAccountById(Number(req.params.id));
  if (!acc) return res.status(404).json({ error: 'not_found' });
  if (acc.id === req.staff.id) return res.status(400).json({ error: 'cannot_delete_self' });
  if (!ownsAccount(req, acc)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
  res.json({ ok: true });
});

// ---------- Super-admin: fest-admin (customer) management ----------
function publicFestAdmin(a) {
  const events = db.prepare('SELECT COUNT(*) n FROM events WHERE owner_id = ?').get(a.id).n;
  return { id: a.id, username: a.username, role: a.role, active: !!a.active, created_at: a.created_at, events };
}

router.get('/admin/festadmins', requireSuperadmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM accounts WHERE role IN ('admin','superadmin') ORDER BY role DESC, username").all();
  res.json(rows.map(publicFestAdmin));
});

router.post('/admin/festadmins', requireSuperadmin, (req, res) => {
  const { username, password, role = 'admin' } = req.body || {};
  if (!['admin', 'superadmin'].includes(role)) return res.status(400).json({ error: 'invalid_role' });
  const id = createAccount({ username, password, role, ownerId: null });
  res.status(201).json(publicFestAdmin(getAccountById(id)));
});

router.patch('/admin/festadmins/:id', requireSuperadmin, (req, res) => {
  const acc = getAccountById(Number(req.params.id));
  if (!acc || !['admin', 'superadmin'].includes(acc.role)) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const becomesNonSuper = acc.role === 'superadmin' && ((b.role && b.role !== 'superadmin') || b.active === false);
  if (becomesNonSuper && countActiveSuperadmins(acc.id) === 0) return res.status(400).json({ error: 'last_superadmin' });
  if (b.role && !['admin', 'superadmin'].includes(b.role)) return res.status(400).json({ error: 'invalid_role' });

  const username = b.username !== undefined ? String(b.username).trim() || acc.username : acc.username;
  const role = b.role ?? acc.role;
  const active = b.active === undefined ? acc.active : b.active ? 1 : 0;
  try {
    db.prepare('UPDATE accounts SET username = ?, role = ?, active = ? WHERE id = ?').run(username, role, active, acc.id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
  if (b.password) {
    if (String(b.password).length < 4) return res.status(400).json({ error: 'password_too_short' });
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), acc.id);
  }
  res.json(publicFestAdmin(getAccountById(acc.id)));
});

router.delete('/admin/festadmins/:id', requireSuperadmin, (req, res) => {
  const acc = getAccountById(Number(req.params.id));
  if (!acc || !['admin', 'superadmin'].includes(acc.role)) return res.status(404).json({ error: 'not_found' });
  if (acc.id === req.staff.id) return res.status(400).json({ error: 'cannot_delete_self' });
  if (acc.role === 'superadmin' && countActiveSuperadmins(acc.id) === 0) return res.status(400).json({ error: 'last_superadmin' });
  db.transaction(() => {
    for (const ev of db.prepare('SELECT id FROM events WHERE owner_id = ?').all(acc.id)) deleteEvent(ev.id);
    db.prepare('DELETE FROM accounts WHERE owner_id = ?').run(acc.id); // their station accounts
    db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
  })();
  res.json({ ok: true });
});

// ---------- events ----------
router.get('/admin/events', requireAdmin, (req, res) => res.json(listEventsFor(req.staff)));

router.post('/admin/events', requireAdmin, (req, res) => {
  // The super-admin is oversight-only; festivals are created & run by fest-admins.
  if (req.staff.role === 'superadmin') return res.status(403).json({ error: 'superadmin_oversight_only' });
  const { name, copyMenuFrom, seedMenu, activate = true } = req.body || {};
  if (copyMenuFrom) assertEvent(req, copyMenuFrom);
  const ev = createEvent({ name, owner: req.staff, copyFromEventId: copyMenuFrom || null, activate });
  // New events start with an EMPTY menu; the example menu is only seeded on
  // explicit opt-in (seedMenu === true). Fest-admins build or import their own.
  if (!copyMenuFrom && seedMenu === true) seedEventMenu(ev.id);
  res.status(201).json(ev);
});

// Super-admin: hand an event to a fest-admin (transfer ownership).
router.patch('/admin/events/:id/owner', requireSuperadmin, (req, res) => {
  const ev = getEvent(Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const owner = getAccountById(Number(req.body?.ownerId));
  if (!owner || !['admin', 'superadmin'].includes(owner.role)) return res.status(400).json({ error: 'invalid_owner' });
  db.prepare('UPDATE events SET owner_id = ? WHERE id = ?').run(owner.id, ev.id);
  res.json(getEvent(ev.id));
});

router.post('/admin/events/:id/activate', requireAdmin, (req, res) => {
  assertEvent(req, Number(req.params.id));
  setActiveEventForAccount(req.staff.id, Number(req.params.id));
  res.json({ ok: true });
});

router.patch('/admin/events/:id', requireAdmin, (req, res) => {
  const ev = assertEvent(req, Number(req.params.id));
  let out = ev;
  if (req.body?.name !== undefined) out = renameEvent(ev.id, req.body.name);
  if (req.body?.status) out = setEventStatus(ev.id, req.body.status);
  res.json(out);
});

router.delete('/admin/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  assertEvent(req, id);
  if (id === getActiveEventIdFor(req.staff)) return res.status(400).json({ error: 'cannot_delete_active' });
  deleteEvent(id);
  res.json({ ok: true });
});

// ---------- statistics + CSV export ----------
router.get('/admin/stats', requireAdmin, (req, res) => {
  const eventId = Number(req.query.eventId) || getActiveEventIdFor(req.staff);
  const ev = assertEvent(req, eventId);
  res.json({ event: { id: ev.id, name: ev.name }, ...eventStats(eventId) });
});

router.get('/admin/events/:id/export.csv', requireAdmin, (req, res) => {
  const ev = assertEvent(req, Number(req.params.id));
  const safe = ev.name.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orderflow-${safe}-${ev.id}.csv"`);
  res.send(eventCsv(ev.id));
});

// ---------- orders overview (active event, or any accessible event) ----------
router.get('/admin/orders', requireAdmin, (req, res) => {
  const eventId = Number(req.query.eventId) || getActiveEventIdFor(req.staff);
  assertEvent(req, eventId);
  res.json(listOrders({ eventId, limit: Number(req.query.limit) || 200 }));
});

router.post('/admin/reset', requireAdmin, (req, res) => {
  const eventId = getActiveEventIdFor(req.staff);
  assertEvent(req, eventId);
  const alsoWaiters = !!req.body?.waiters;
  db.transaction(() => {
    for (const o of db.prepare('SELECT id FROM orders WHERE event_id = ?').all(eventId))
      db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
    if (alsoWaiters) db.prepare('DELETE FROM waiters WHERE event_id = ?').run(eventId);
  })();
  emitReset();
  res.json({ ok: true, waiters: alsoWaiters });
});

// ---------- stations (bar / kitchen) — staff, scoped to their active event ----------
router.get('/stations/:station/queue', requireStaff, (req, res) => {
  res.json(getStationQueue(req.params.station, getActiveEventIdFor(req.staff)));
});

router.post('/order-items/:id/done', requireStaff, (req, res) => {
  assertEvent(req, eventOfItem(req.params.id));
  res.json(setItemStatus(Number(req.params.id), 'done'));
});
router.post('/orders/:id/done', requireStaff, (req, res) => {
  assertEvent(req, eventOfOrder(req.params.id));
  res.json(setOrderStatus(Number(req.params.id), 'done', req.body?.station || null));
});
router.post('/orders/:id/reprint', requireStaff, asyncH((req, res) => {
  assertEvent(req, eventOfOrder(req.params.id));
  res.json(reprintOrder(Number(req.params.id)));
}));
// Re-open a previously completed order at a station (undo "done").
router.post('/orders/:id/reopen', requireStaff, (req, res) => {
  assertEvent(req, eventOfOrder(req.params.id));
  res.json(setOrderStatus(Number(req.params.id), 'open', req.body?.station || null));
});

// ---------- waiters (within the requester's active event) ----------
function waiterStatus(w) {
  if (!w.active) return 'revoked';
  if (Date.now() > w.expires_at) return 'expired';
  if (!w.session_token) return 'pending';
  return 'active';
}
function publicWaiter(w) {
  return {
    id: w.id, name: w.name, status: waiterStatus(w), claimed: !!w.session_token,
    claimed_at: w.claimed_at, created_at: w.created_at, expires_at: w.expires_at,
    link: w.session_token ? null : waiterLink(w.claim_token),
  };
}

router.get('/admin/waiters', requireAdmin, (req, res) => {
  const eventId = getActiveEventIdFor(req.staff);
  res.json(db.prepare('SELECT * FROM waiters WHERE event_id = ? ORDER BY created_at DESC').all(eventId).map(publicWaiter));
});

router.post('/admin/waiters', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const eventId = getActiveEventIdFor(req.staff);
  assertEvent(req, eventId);
  const ttlHours = Number(req.body?.ttlHours) || config.waiterTokenTtlHours;
  const now = Date.now();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO waiters (event_id, name, claim_token, active, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?)')
    .run(eventId, name, newToken(), now, now + ttlHours * 3600_000);
  res.json(publicWaiter(db.prepare('SELECT * FROM waiters WHERE id = ?').get(lastInsertRowid)));
});

router.post('/admin/waiters/:id/relink', requireAdmin, (req, res) => {
  const w = db.prepare('SELECT * FROM waiters WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'not_found' });
  assertEvent(req, w.event_id);
  const hours = Number(req.body?.hours) || config.waiterTokenTtlHours;
  db.prepare(
    'UPDATE waiters SET claim_token = ?, session_token = NULL, claimed_at = NULL, active = 1, expires_at = ? WHERE id = ?'
  ).run(newToken(), Date.now() + hours * 3600_000, req.params.id);
  res.json(publicWaiter(db.prepare('SELECT * FROM waiters WHERE id = ?').get(req.params.id)));
});

router.post('/admin/waiters/:id/revoke', requireAdmin, (req, res) => {
  assertEvent(req, eventOfWaiter(req.params.id));
  db.prepare('UPDATE waiters SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/admin/waiters/:id', requireAdmin, (req, res) => {
  assertEvent(req, eventOfWaiter(req.params.id));
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
    clientKey: req.body?.clientKey,
  });
  res.status(201).json(order);
});

router.get('/orders/mine', requireWaiter, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE waiter_id = ? ORDER BY created_at DESC LIMIT 50').all(req.waiter.id);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
  for (const o of orders) {
    o.items = itemsStmt.all(o.id);
    o.total = o.items.reduce((s, it) => s + it.price * it.qty, 0);
  }
  res.json(orders);
});

export default router;
