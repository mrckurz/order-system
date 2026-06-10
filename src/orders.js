import db from './db.js';
import { printTicket } from './printer.js';
import { emitNewOrder, emitOrderUpdate } from './realtime.js';

// Assemble a full order object (with items + waiter name) for API/realtime.
export function hydrateOrder(orderId) {
  const order = db
    .prepare(
      `SELECT o.*, w.name AS waiter_name
         FROM orders o LEFT JOIN waiters w ON w.id = o.waiter_id
        WHERE o.id = ?`
    )
    .get(orderId);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
  order.total = order.items.reduce((s, it) => s + it.price * it.qty, 0);
  return order;
}

// Create an order from a waiter. `items` = [{ articleId, qty, note }].
// The order is recorded under `eventId` and only articles belonging to that
// event's menu are accepted.
export function createOrder({ waiterId, eventId, table, note, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('order has no items'), { status: 400 });
  }

  const getArticle = db.prepare(
    `SELECT a.* FROM articles a JOIN categories c ON c.id = a.category_id
      WHERE a.id = ? AND a.active = 1 AND c.event_id = ?`
  );
  const insOrder = db.prepare(
    'INSERT INTO orders (event_id, order_no, waiter_id, table_no, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, article_id, name, price, qty, station, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    // Sequential per-event order number (1, 2, 3, …).
    const orderNo = db.prepare('SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM orders WHERE event_id = ?').get(eventId ?? null).n;
    const { lastInsertRowid: orderId } = insOrder.run(
      eventId ?? null,
      orderNo,
      waiterId ?? null,
      table ? String(table) : null,
      note ? String(note) : null,
      Date.now()
    );
    for (const line of items) {
      const art = getArticle.get(line.articleId, eventId ?? null);
      if (!art) throw Object.assign(new Error(`unknown article ${line.articleId}`), { status: 400 });
      const qty = Math.max(1, parseInt(line.qty, 10) || 1);
      insItem.run(orderId, art.id, art.name, art.price, qty, art.station, line.note || null);
    }
    return orderId;
  });

  const orderId = tx();
  const order = hydrateOrder(orderId);

  emitNewOrder(order);
  triggerPrints(order);
  return order;
}

// Print one ticket per station that is flagged print=1.
function triggerPrints(order) {
  const printStations = new Set(
    db.prepare('SELECT id, label FROM stations WHERE print = 1').all().map((s) => s.id)
  );
  const labels = Object.fromEntries(
    db.prepare('SELECT id, label FROM stations').all().map((s) => [s.id, s.label])
  );
  const byStation = new Map();
  for (const it of order.items) {
    if (!printStations.has(it.station)) continue;
    if (!byStation.has(it.station)) byStation.set(it.station, []);
    byStation.get(it.station).push(it);
  }
  for (const [station, items] of byStation) {
    printTicket({
      orderId: order.order_no ?? order.id,
      stationLabel: labels[station] || station,
      waiter: order.waiter_name,
      table: order.table_no,
      note: order.note,
      createdAt: order.created_at,
      items,
    });
  }
}

// Open items for a station, grouped by order, newest-arriving last
// (so the display naturally reflects arrival order).
// Open + recently-done orders for a station. Open orders first (newest on top),
// done orders below (kept on screen, capped to the most recent `doneLimit`).
export function getStationQueue(station, eventId, { doneLimit = 25 } = {}) {
  const rows = db
    .prepare(
      `SELECT o.id, o.order_no, o.table_no, o.note, o.created_at, w.name AS waiter_name,
              MIN(CASE WHEN i.status = 'open' THEN 0 ELSE 1 END) AS all_done
         FROM orders o
         JOIN order_items i ON i.order_id = o.id
         LEFT JOIN waiters w ON w.id = o.waiter_id
        WHERE i.station = ? AND o.event_id = ?
        GROUP BY o.id
        ORDER BY all_done ASC, o.created_at DESC`
    )
    .all(station, eventId);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND station = ? ORDER BY id");
  const open = [];
  const done = [];
  for (const o of rows) {
    o.done = !!o.all_done;
    o.items = itemsStmt.all(o.id, station);
    (o.done ? done : open).push(o);
  }
  return [...open, ...done.slice(0, doneLimit)];
}

export function setItemStatus(itemId, status) {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(itemId);
  if (!item) throw Object.assign(new Error('item not found'), { status: 404 });
  db.prepare('UPDATE order_items SET status = ? WHERE id = ?').run(status, itemId);
  emitOrderUpdate({ orderId: item.order_id, itemId, status });
  return hydrateOrder(item.order_id);
}

// Mark every item of an order (optionally only one station) as served.
export function setOrderStatus(orderId, status, station = null) {
  if (station) {
    db.prepare('UPDATE order_items SET status = ? WHERE order_id = ? AND station = ?').run(
      status,
      orderId,
      station
    );
  } else {
    db.prepare('UPDATE order_items SET status = ? WHERE order_id = ?').run(status, orderId);
  }
  emitOrderUpdate({ orderId, status, station });
  return hydrateOrder(orderId);
}

export function reprintOrder(orderId) {
  const order = hydrateOrder(orderId);
  if (!order) throw Object.assign(new Error('order not found'), { status: 404 });
  triggerPrints(order);
  return order;
}

// Backfill sequential per-event order numbers for any orders missing one.
export function backfillOrderNumbers() {
  const evs = db.prepare('SELECT DISTINCT event_id FROM orders WHERE order_no IS NULL AND event_id IS NOT NULL').all();
  if (!evs.length) return;
  db.transaction(() => {
    const upd = db.prepare('UPDATE orders SET order_no = ? WHERE id = ?');
    for (const { event_id } of evs) {
      // continue after any numbers that already exist in this event
      let n = db.prepare('SELECT COALESCE(MAX(order_no), 0) AS n FROM orders WHERE event_id = ?').get(event_id).n;
      for (const r of db.prepare('SELECT id FROM orders WHERE event_id = ? AND order_no IS NULL ORDER BY id').all(event_id)) {
        upd.run(++n, r.id);
      }
    }
  })();
}

// All orders of an event for the admin overview (most recent first).
export function listOrders({ eventId, limit = 200 } = {}) {
  const orders = db
    .prepare(
      `SELECT o.*, w.name AS waiter_name
         FROM orders o LEFT JOIN waiters w ON w.id = o.waiter_id
        WHERE o.event_id = ?
        ORDER BY o.created_at DESC LIMIT ?`
    )
    .all(eventId, limit);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
  for (const o of orders) {
    o.items = itemsStmt.all(o.id);
    o.total = o.items.reduce((s, it) => s + it.price * it.qty, 0);
  }
  return orders;
}
