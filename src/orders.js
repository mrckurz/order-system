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
    'INSERT INTO orders (event_id, waiter_id, table_no, note, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, article_id, name, price, qty, station, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const { lastInsertRowid: orderId } = insOrder.run(
      eventId ?? null,
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
      orderId: order.id,
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
export function getStationQueue(station, eventId) {
  const orders = db
    .prepare(
      `SELECT DISTINCT o.id, o.table_no, o.note, o.created_at, w.name AS waiter_name
         FROM orders o
         JOIN order_items i ON i.order_id = o.id
         LEFT JOIN waiters w ON w.id = o.waiter_id
        WHERE i.station = ? AND i.status = 'open' AND o.event_id = ?
        ORDER BY o.created_at ASC`
    )
    .all(station, eventId);
  const itemsStmt = db.prepare(
    "SELECT * FROM order_items WHERE order_id = ? AND station = ? ORDER BY id"
  );
  for (const o of orders) o.items = itemsStmt.all(o.id, station);
  return orders;
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
