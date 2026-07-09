import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Configure a throwaway database and known secrets BEFORE importing the app.
const tmpDb = path.join(os.tmpdir(), `orderflow-test-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin-pw';
process.env.STATION_USERNAME = 'station';
process.env.STATION_PASSWORD = 'station-pw';
process.env.SESSION_SECRET = 'test-secret';
process.env.PRINTER_TYPE = 'none';
process.env.PUBLIC_URL = 'http://test.local';
process.env.DISABLE_RATE_LIMIT = '1'; // the suite makes many logins

const { createApp } = await import('../src/app.js');

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  for (const f of [tmpDb, `${tmpDb}-shm`, `${tmpDb}-wal`]) {
    try { fs.unlinkSync(f); } catch {}
  }
});

async function jf(pathName, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + pathName, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, res };
}

const login = (username, password) =>
  jf('/api/login', { method: 'POST', body: { username, password } });
// The bootstrap account is the (oversight-only) super-admin.
const asAdmin = async () => (await login('admin', 'admin-pw')).json.token;
const asSuper = asAdmin;

// A fest-admin that owns an activated event with the default menu — used for
// all operational tests (the super-admin can't create/operate events).
let _festTok = null;
async function asFest() {
  if (_festTok) return _festTok;
  const su = await asSuper();
  await jf('/api/admin/festadmins', { method: 'POST', token: su, body: { username: 'fester', password: 'fest-pw' } });
  _festTok = (await login('fester', 'fest-pw')).json.token;
  await jf('/api/admin/events', { method: 'POST', token: _festTok, body: { name: 'Fester Fest', seedMenu: true } });
  return _festTok;
}

test('config and seeded menu are available', async () => {
  const { status, json } = await jf('/api/config');
  assert.equal(status, 200);
  assert.equal(json.currency, 'EUR');
  assert.ok(json.stations.find((s) => s.id === 'food'));
});

test('login: wrong credentials rejected, bootstrap super-admin accepted', async () => {
  assert.equal((await login('admin', 'nope')).status, 401);
  assert.equal((await login('nobody', 'admin-pw')).status, 401);
  const ok = await login('admin', 'admin-pw');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.role, 'superadmin');
  assert.equal(ok.json.username, 'admin');
});

test('bootstrap station account has station role and cannot see admin overview', async () => {
  const s = await login('station', 'station-pw');
  assert.equal(s.json.role, 'station');
  const blocked = await jf('/api/admin/orders', { token: s.json.token });
  assert.equal(blocked.status, 401, 'station role must NOT access admin overview');
  const blocked2 = await jf('/api/admin/accounts', { token: s.json.token });
  assert.equal(blocked2.status, 401, 'station role must NOT manage accounts');
});

test('admin can create, use and delete a station account', async () => {
  const admin = await asAdmin();
  const created = await jf('/api/admin/accounts', { method: 'POST', token: admin, body: { username: 'eva', password: 'eva-pass' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.role, 'station'); // Team creates station accounts only

  const eva = await login('eva', 'eva-pass');
  assert.equal(eva.json.role, 'station');

  const dup = await jf('/api/admin/accounts', { method: 'POST', token: admin, body: { username: 'EVA', password: 'x123' } });
  assert.equal(dup.status, 409);

  assert.equal((await jf(`/api/admin/accounts/${created.json.id}`, { method: 'DELETE', token: admin })).status, 200);
  assert.equal((await login('eva', 'eva-pass')).status, 401);
});

test('multi-tenant: super-admin manages fest-admins; tenants are isolated', async () => {
  const su = await asAdmin(); // bootstrap account is the super-admin
  const a = await jf('/api/admin/festadmins', { method: 'POST', token: su, body: { username: 'verein-a', password: 'aaaa' } });
  assert.equal(a.status, 201);
  assert.equal(a.json.role, 'admin');
  await jf('/api/admin/festadmins', { method: 'POST', token: su, body: { username: 'verein-b', password: 'bbbb' } });

  const aTok = (await login('verein-a', 'aaaa')).json.token;
  const bTok = (await login('verein-b', 'bbbb')).json.token;

  // festadmin management is super-admin only
  assert.equal((await jf('/api/admin/festadmins', { token: aTok })).status, 403);

  // fest-admin A creates its own event with its own seeded menu
  const evA = (await jf('/api/admin/events', { method: 'POST', token: aTok, body: { name: 'Fest A', seedMenu: true } })).json;
  assert.ok((await jf('/api/admin/menu', { token: aTok })).json.categories.length > 0);

  // A sees only its own event; super-admin sees it too (with owner)
  const aEvents = (await jf('/api/admin/events', { token: aTok })).json;
  assert.equal(aEvents.length, 1);
  assert.equal(aEvents[0].id, evA.id);
  const suEvents = (await jf('/api/admin/events', { token: su })).json;
  assert.ok(suEvents.some((e) => e.id === evA.id && e.owner_name === 'verein-a'));

  // B cannot read or activate A's event; super-admin can read A's stats
  assert.equal((await jf(`/api/admin/stats?eventId=${evA.id}`, { token: bTok })).status, 403);
  assert.equal((await jf(`/api/admin/events/${evA.id}/activate`, { method: 'POST', token: bTok })).status, 403);
  assert.equal((await jf(`/api/admin/stats?eventId=${evA.id}`, { token: su })).status, 200);
});

test('cannot delete the last super-admin or yourself', async () => {
  const adminLogin = await login('admin', 'admin-pw');
  const admin = adminLogin.json.token;
  const me = (await jf('/api/whoami', { token: admin })).json;
  const selfDelete = await jf(`/api/admin/accounts/${me.uid}`, { method: 'DELETE', token: admin });
  assert.equal(selfDelete.status, 400, 'must not delete the account in use');
});

test('deactivating an account blocks it immediately', async () => {
  const admin = await asAdmin();
  const acc = (await jf('/api/admin/accounts', {
    method: 'POST', token: admin, body: { username: 'temp', password: 'temp-pass', role: 'station' },
  })).json;
  const tempToken = (await login('temp', 'temp-pass')).json.token;
  assert.equal((await jf('/api/whoami', { token: tempToken })).status, 200);
  await jf(`/api/admin/accounts/${acc.id}`, { method: 'PATCH', token: admin, body: { active: false } });
  assert.equal((await jf('/api/whoami', { token: tempToken })).status, 401, 'deactivated session must stop working');
});

test('full order lifecycle: create waiter, single-use claim, order, station queue', async () => {
  const admin = await asFest();

  const w = await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Berta' } });
  assert.equal(w.status, 200);
  assert.equal(w.json.status, 'pending');
  const claimToken = new URL(w.json.link).searchParams.get('c');

  const claim1 = await jf('/api/waiters/claim', { method: 'POST', body: { claimToken } });
  assert.equal(claim1.status, 200);
  const waiterToken = claim1.json.sessionToken;
  const claim2 = await jf('/api/waiters/claim', { method: 'POST', body: { claimToken } });
  assert.equal(claim2.status, 409, 'link must be single-use');

  const menu = (await jf('/api/menu', { token: waiterToken })).json;
  const foodItem = menu.categories.flatMap((c) => c.items).find((i) => i.station === 'food');
  const drinkItem = menu.categories.flatMap((c) => c.items).find((i) => i.station === 'drinks');
  const order = await jf('/api/orders', {
    method: 'POST',
    token: waiterToken,
    body: { table: '5', items: [{ articleId: foodItem.id, qty: 2 }, { articleId: drinkItem.id, qty: 1 }] },
  });
  assert.equal(order.status, 201);
  assert.equal(order.json.total, foodItem.price * 2 + drinkItem.price);
  assert.equal(order.json.waiter_name, 'Berta');
  assert.equal(order.json.order_no, 1, 'first order of the event is #1');

  const foodQ = (await jf('/api/stations/food/queue', { token: admin })).json;
  assert.equal(foodQ[0].items[0].station, 'food');
  const drinkQ = (await jf('/api/stations/drinks/queue', { token: admin })).json;
  assert.equal(drinkQ[0].items[0].station, 'drinks');

  // marking done keeps the order on the station screen, flagged done
  await jf(`/api/orders/${order.json.id}/done`, { method: 'POST', token: admin, body: { station: 'food' } });
  const foodQ2 = (await jf('/api/stations/food/queue', { token: admin })).json;
  const fo = foodQ2.find((o) => o.id === order.json.id);
  assert.ok(fo && fo.done === true, 'done order stays, marked done');

  // and can be reopened
  await jf(`/api/orders/${order.json.id}/reopen`, { method: 'POST', token: admin, body: { station: 'food' } });
  assert.equal((await jf('/api/stations/food/queue', { token: admin })).json.find((o) => o.id === order.json.id).done, false);
});

test('reset clears orders but keeps menu and accounts', async () => {
  const admin = await asFest();
  const before = (await jf('/api/admin/orders', { token: admin })).json;
  assert.ok(before.length > 0, 'precondition: there are orders from the lifecycle test');
  const r = await jf('/api/admin/reset', { method: 'POST', token: admin, body: {} });
  assert.equal(r.status, 200);
  assert.equal((await jf('/api/admin/orders', { token: admin })).json.length, 0);
  // menu still there
  assert.ok((await jf('/api/admin/menu', { token: admin })).json.categories.length > 0);
});

test('revoked waiter token is rejected', async () => {
  const admin = await asFest();
  const w = (await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Cilli' } })).json;
  const claimToken = new URL(w.link).searchParams.get('c');
  const sess = (await jf('/api/waiters/claim', { method: 'POST', body: { claimToken } })).json.sessionToken;
  assert.equal((await jf('/api/me', { token: sess })).status, 200);
  await jf(`/api/admin/waiters/${w.id}/revoke`, { method: 'POST', token: admin });
  assert.equal((await jf('/api/me', { token: sess })).status, 401);
});

test('unauthenticated requests are rejected', async () => {
  assert.equal((await jf('/api/me')).status, 401);
  assert.equal((await jf('/api/admin/orders')).status, 401);
  assert.equal((await jf('/api/admin/accounts')).status, 401);
  assert.equal((await jf('/api/orders', { method: 'POST', body: { items: [] } })).status, 401);
});

test('security headers are present', async () => {
  const { res } = await jf('/healthz');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('waiter link uses the static ?c= form and /w redirects', async () => {
  const admin = await asFest();
  const w = (await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Dora' } })).json;
  const url = new URL(w.link);
  assert.ok(url.pathname.endsWith('/waiter.html'));
  assert.ok(url.searchParams.get('c'));
  const red = await fetch(base + '/w/sometoken', { redirect: 'manual' });
  assert.equal(red.status, 302);
  assert.match(red.headers.get('location'), /\/waiter\.html\?c=sometoken/);
});

test('fest-admin: can create & activate events; super-admin cannot create', async () => {
  assert.equal((await jf('/api/admin/events', { method: 'POST', token: await asSuper(), body: { name: 'X' } })).status, 403);
  const admin = await asFest();
  const evs = (await jf('/api/admin/events', { token: admin })).json;
  assert.ok(evs.length >= 1, 'a default event exists');
  assert.ok(evs.some((e) => e.active), 'one event is active');

  const created = await jf('/api/admin/events', { method: 'POST', token: admin, body: { name: 'Fest B', seedMenu: true } });
  assert.equal(created.status, 201);
  assert.equal(created.json.name, 'Fest B');

  await jf(`/api/admin/events/${created.json.id}/activate`, { method: 'POST', token: admin });
  const menu = (await jf('/api/admin/menu', { token: admin })).json;
  assert.ok(menu.categories.length > 0, 'the new event has its own seeded menu');

  // the active event cannot be deleted
  assert.equal((await jf(`/api/admin/events/${created.json.id}`, { method: 'DELETE', token: admin })).status, 400);
});

test('per-event statistics and CSV export', async () => {
  const admin = await asFest();
  const ev = (await jf('/api/admin/events', { method: 'POST', token: admin, body: { name: 'Stats Fest', seedMenu: true } })).json;
  await jf(`/api/admin/events/${ev.id}/activate`, { method: 'POST', token: admin });

  const w = (await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'S1' } })).json;
  const claimToken = new URL(w.link).searchParams.get('c');
  const sess = (await jf('/api/waiters/claim', { method: 'POST', body: { claimToken } })).json.sessionToken;
  const item = (await jf('/api/menu', { token: sess })).json.categories.flatMap((c) => c.items)[0];
  await jf('/api/orders', { method: 'POST', token: sess, body: { table: '1', items: [{ articleId: item.id, qty: 4 }] } });

  const stats = (await jf(`/api/admin/stats?eventId=${ev.id}`, { token: admin })).json;
  assert.equal(stats.totals.orders, 1);
  assert.equal(stats.totals.revenue, item.price * 4);
  assert.equal(stats.perWaiter[0].waiter, 'S1');
  assert.equal(stats.perProduct[0].qty, 4);

  // a brand-new empty event reports zero revenue (isolation)
  const empty = (await jf('/api/admin/events', { method: 'POST', token: admin, body: { name: 'Leer', seedMenu: true } })).json;
  assert.equal((await jf(`/api/admin/stats?eventId=${empty.id}`, { token: admin })).json.totals.revenue, 0);

  const res = await fetch(base + `/api/admin/events/${ev.id}/export.csv`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const csv = await res.text();
  assert.match(csv, /order_id,datetime,waiter/);
});

test('new events start empty; fest-admin can import/export a menu (CSV)', async () => {
  const su = await asSuper();
  await jf('/api/admin/festadmins', { method: 'POST', token: su, body: { username: 'importer', password: 'imp-pw' } });
  const tok = (await login('importer', 'imp-pw')).json.token;
  await jf('/api/admin/events', { method: 'POST', token: tok, body: { name: 'Import Fest' } }); // no seedMenu -> empty
  assert.equal((await jf('/api/admin/menu', { token: tok })).json.categories.length, 0);

  const csv = 'Kategorie;Artikel;Preis;Station;Aktiv\nGetränke;0,5l Bier;4,50;drinks;1\nSpeisen;Bratwurst;3.50;food;1';
  const imp = await jf('/api/admin/menu/import', { method: 'POST', token: tok, body: { csv } });
  assert.equal(imp.status, 200);
  assert.equal(imp.json.imported, 2);

  const cats = (await jf('/api/admin/menu', { token: tok })).json.categories;
  assert.equal(cats.length, 2);
  const bier = cats.flatMap((c) => c.items).find((i) => i.name === '0,5l Bier');
  assert.equal(bier.price, 4.5);
  assert.equal(bier.station, 'drinks');

  const res = await fetch(base + '/api/admin/menu/export.csv', { headers: { Authorization: `Bearer ${tok}` } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /0,5l Bier/);

  // reorder categories -> waiter/admin menu reflects the new order
  const reversed = cats.map((c) => c.id).reverse();
  assert.equal((await jf('/api/admin/categories/reorder', { method: 'POST', token: tok, body: { ids: reversed } })).status, 200);
  assert.equal((await jf('/api/admin/menu', { token: tok })).json.categories[0].id, reversed[0]);
});

test('idempotent order creation: same clientKey creates only one order', async () => {
  const admin = await asFest();
  const w = (await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Idem' } })).json;
  const sess = (await jf('/api/waiters/claim', { method: 'POST', body: { claimToken: new URL(w.link).searchParams.get('c') } })).json.sessionToken;
  const item = (await jf('/api/menu', { token: sess })).json.categories.flatMap((c) => c.items)[0];
  const before = (await jf('/api/admin/orders', { token: admin })).json.length;

  const body = { clientKey: 'fixed-key-123', table: '7', items: [{ articleId: item.id, qty: 1 }] };
  const r1 = await jf('/api/orders', { method: 'POST', token: sess, body });
  const r2 = await jf('/api/orders', { method: 'POST', token: sess, body });
  assert.equal(r1.json.id, r2.json.id, 'same clientKey returns the same order');

  const after = (await jf('/api/admin/orders', { token: admin })).json.length;
  assert.equal(after, before + 1, 'exactly one order was created');
});

test('table number is required (empty/missing is rejected, "0" is accepted)', async () => {
  const admin = await asFest();
  const w = (await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Tbl' } })).json;
  const sess = (await jf('/api/waiters/claim', { method: 'POST', body: { claimToken: new URL(w.link).searchParams.get('c') } })).json.sessionToken;
  const item = (await jf('/api/menu', { token: sess })).json.categories.flatMap((c) => c.items)[0];

  const missing = await jf('/api/orders', { method: 'POST', token: sess, body: { items: [{ articleId: item.id, qty: 1 }] } });
  assert.equal(missing.status, 400, 'order without a table is rejected');

  const blank = await jf('/api/orders', { method: 'POST', token: sess, body: { table: '   ', items: [{ articleId: item.id, qty: 1 }] } });
  assert.equal(blank.status, 400, 'order with a blank table is rejected');

  const zero = await jf('/api/orders', { method: 'POST', token: sess, body: { table: '0', items: [{ articleId: item.id, qty: 1 }] } });
  assert.equal(zero.status, 201, '"0" is a valid table (means no table)');
  assert.equal(zero.json.table_no, '0', '"0" is stored, not dropped to null');
});

test('CORS allows cross-origin browser requests with Authorization', async () => {
  const res = await fetch(base + '/api/config', { headers: { Origin: 'https://example.github.io' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.github.io');
  const pre = await fetch(base + '/api/orders', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization',
    },
  });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/i);
});
