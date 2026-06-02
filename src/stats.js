import db from './db.js';

// Aggregated sales statistics for one event.
export function eventStats(eventId) {
  const totals = db
    .prepare(
      `SELECT COUNT(DISTINCT o.id) AS orders,
              COALESCE(SUM(i.price * i.qty), 0) AS revenue,
              COALESCE(SUM(i.qty), 0) AS items
         FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.event_id = ?`
    )
    .get(eventId);
  totals.avgOrder = totals.orders ? totals.revenue / totals.orders : 0;

  const perWaiter = db
    .prepare(
      `SELECT COALESCE(w.name, '—') AS waiter,
              COUNT(DISTINCT o.id) AS orders,
              COALESCE(SUM(i.price * i.qty), 0) AS revenue
         FROM orders o
         JOIN order_items i ON i.order_id = o.id
         LEFT JOIN waiters w ON w.id = o.waiter_id
        WHERE o.event_id = ?
        GROUP BY o.waiter_id
        ORDER BY revenue DESC`
    )
    .all(eventId);

  const perProduct = db
    .prepare(
      `SELECT i.name AS name,
              SUM(i.qty) AS qty,
              SUM(i.price * i.qty) AS revenue
         FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.event_id = ?
        GROUP BY i.name
        ORDER BY qty DESC`
    )
    .all(eventId);

  const perStation = db
    .prepare(
      `SELECT i.station AS station,
              SUM(i.qty) AS qty,
              SUM(i.price * i.qty) AS revenue
         FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.event_id = ?
        GROUP BY i.station
        ORDER BY revenue DESC`
    )
    .all(eventId);

  return { totals, perWaiter, perProduct, perStation };
}

// One CSV row per ordered line item — easy to open in Excel.
export function eventCsv(eventId) {
  const rows = db
    .prepare(
      `SELECT o.id AS order_id, o.created_at, COALESCE(w.name, '') AS waiter,
              COALESCE(o.table_no, '') AS tbl, i.name AS item, i.station, i.qty, i.price,
              (i.qty * i.price) AS line_total
         FROM orders o
         JOIN order_items i ON i.order_id = o.id
         LEFT JOIN waiters w ON w.id = o.waiter_id
        WHERE o.event_id = ?
        ORDER BY o.id, i.id`
    )
    .all(eventId);

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['order_id', 'datetime', 'waiter', 'table', 'item', 'station', 'qty', 'price', 'line_total'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.order_id,
        new Date(r.created_at).toISOString(),
        r.waiter,
        r.tbl,
        r.item,
        r.station,
        r.qty,
        r.price.toFixed(2),
        r.line_total.toFixed(2),
      ]
        .map(esc)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}
