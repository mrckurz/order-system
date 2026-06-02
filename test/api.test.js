import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Configure a throwaway database and known secrets BEFORE importing the app.
const tmpDb = path.join(os.tmpdir(), `orderflow-test-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
process.env.ADMIN_PASSWORD = 'admin-pw';
process.env.STATION_PASSWORD = 'station-pw';
process.env.SESSION_SECRET = 'test-secret';
process.env.PRINTER_TYPE = 'none';
process.env.PUBLIC_URL = 'http://test.local';

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

test('config and seeded menu are available', async () => {
  const { status, json } = await jf('/api/config');
  assert.equal(status, 200);
  assert.equal(json.currency, 'EUR');
  assert.ok(json.stations.find((s) => s.id === 'food'));
});

test('admin login rejects wrong password, accepts correct one', async () => {
  assert.equal((await jf('/api/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  const ok = await jf('/api/login', { method: 'POST', body: { password: 'admin-pw' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.role, 'admin');
});

test('station password gets station role and cannot see admin overview', async () => {
  const login = await jf('/api/login', { method: 'POST', body: { password: 'station-pw' } });
  assert.equal(login.json.role, 'station');
  const blocked = await jf('/api/admin/orders', { token: login.json.token });
  assert.equal(blocked.status, 401, 'station role must NOT access admin overview');
});

test('full order lifecycle: create waiter, single-use claim, order, station queue', async () => {
  const admin = (await jf('/api/login', { method: 'POST', body: { password: 'admin-pw' } })).json.token;

  // create waiter
  const w = await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Berta' } });
  assert.equal(w.status, 200);
  assert.equal(w.json.status, 'pending');
  const claimToken = new URL(w.json.link).searchParams.get('c');

  // first claim succeeds, second fails (single-use)
  const claim1 = await jf('/api/waiters/claim', { method: 'POST', body: { claimToken } });
  assert.equal(claim1.status, 200);
  const waiterToken = claim1.json.sessionToken;
  const claim2 = await jf('/api/waiters/claim', { method: 'POST', body: { claimToken } });
  assert.equal(claim2.status, 409, 'link must be single-use');

  // waiter places an order with a food + a drink item
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

  // items routed to the right station queues
  const foodQ = (await jf('/api/stations/food/queue', { token: admin })).json;
  assert.equal(foodQ[0].items.length, 1);
  assert.equal(foodQ[0].items[0].station, 'food');
  const drinkQ = (await jf('/api/stations/drinks/queue', { token: admin })).json;
  assert.equal(drinkQ[0].items[0].station, 'drinks');

  // admin sees the order
  const all = (await jf('/api/admin/orders', { token: admin })).json;
  assert.ok(all.some((o) => o.id === order.json.id));

  // mark the food order done -> leaves the food queue
  await jf(`/api/orders/${order.json.id}/done`, { method: 'POST', token: admin, body: { station: 'food' } });
  const foodQ2 = (await jf('/api/stations/food/queue', { token: admin })).json;
  assert.equal(foodQ2.length, 0);
});

test('revoked waiter token is rejected', async () => {
  const admin = (await jf('/api/login', { method: 'POST', body: { password: 'admin-pw' } })).json.token;
  const w = (await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Cilli' } })).json;
  const claimToken = new URL(w.link).searchParams.get('c');
  const sess = (await jf('/api/waiters/claim', { method: 'POST', body: { claimToken } })).json.sessionToken;
  assert.equal((await jf('/api/me', { token: sess })).status, 200);
  await jf(`/api/admin/waiters/${w.id}/revoke`, { method: 'POST', token: admin });
  assert.equal((await jf('/api/me', { token: sess })).status, 401, 'revoked waiter must be locked out');
});

test('unauthenticated requests are rejected', async () => {
  assert.equal((await jf('/api/me')).status, 401);
  assert.equal((await jf('/api/admin/orders')).status, 401);
  assert.equal((await jf('/api/orders', { method: 'POST', body: { items: [] } })).status, 401);
});

test('security headers are present', async () => {
  const { res } = await jf('/healthz');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('waiter link uses the static ?c= form (works on GitHub Pages)', async () => {
  const admin = (await jf('/api/login', { method: 'POST', body: { password: 'admin-pw' } })).json.token;
  const w = (await jf('/api/admin/waiters', { method: 'POST', token: admin, body: { name: 'Dora' } })).json;
  const url = new URL(w.link);
  assert.equal(url.pathname.endsWith('/waiter.html'), true);
  assert.ok(url.searchParams.get('c'), 'link must carry the claim token as ?c=');
});

test('CORS allows cross-origin browser requests with Authorization', async () => {
  // default CORS_ORIGIN is "*" in this test process -> any origin echoed back
  const res = await fetch(base + '/api/config', { headers: { Origin: 'https://example.github.io' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.github.io');
  // preflight
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

test('backend /w/:token redirects to the static claim URL', async () => {
  const res = await fetch(base + '/w/sometoken', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/waiter\.html\?c=sometoken/);
});
