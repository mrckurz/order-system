import db from './db.js';

// The "active" event (the festival currently being run) is stored in meta.
export function getActiveEventId() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'active_event_id'").get();
  return row ? Number(row.value) : null;
}

export function setActiveEvent(id) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('active_event_id', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(String(id));
}

export function getEvent(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

export function getActiveEvent() {
  const id = getActiveEventId();
  return id ? getEvent(id) : null;
}

export function listEvents() {
  const activeId = getActiveEventId();
  const ordCount = db.prepare('SELECT COUNT(*) n FROM orders WHERE event_id = ?');
  return db
    .prepare('SELECT * FROM events ORDER BY created_at DESC')
    .all()
    .map((e) => ({ ...e, active: e.id === activeId, orders: ordCount.get(e.id).n }));
}

function copyMenu(fromId, toId) {
  const cats = db.prepare('SELECT * FROM categories WHERE event_id = ? ORDER BY sort, id').all(fromId);
  const insCat = db.prepare('INSERT INTO categories (event_id, name, station, sort) VALUES (?, ?, ?, ?)');
  const artStmt = db.prepare('SELECT * FROM articles WHERE category_id = ? ORDER BY sort, id');
  const insArt = db.prepare(
    'INSERT INTO articles (category_id, name, price, station, active, sort) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const c of cats) {
    const { lastInsertRowid: cid } = insCat.run(toId, c.name, c.station, c.sort);
    for (const a of artStmt.all(c.id)) insArt.run(cid, a.name, a.price, a.station, a.active, a.sort);
  }
}

// Create an event. Optionally copy the menu from another event as a starting
// point. Activates it by default.
export function createEvent({ name, copyFromEventId = null, activate = true }) {
  const nm = String(name || '').trim();
  if (!nm) throw Object.assign(new Error('name_required'), { status: 400 });
  const tx = db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare("INSERT INTO events (name, status, created_at) VALUES (?, 'active', ?)")
      .run(nm, Date.now());
    if (copyFromEventId) copyMenu(copyFromEventId, id);
    return id;
  });
  const id = tx();
  if (activate) setActiveEvent(id);
  return getEvent(id);
}

export function renameEvent(id, name) {
  const nm = String(name || '').trim();
  if (!nm) throw Object.assign(new Error('name_required'), { status: 400 });
  db.prepare('UPDATE events SET name = ? WHERE id = ?').run(nm, id);
  return getEvent(id);
}

export function setEventStatus(id, status) {
  if (status === 'archived') {
    db.prepare("UPDATE events SET status = 'archived', closed_at = ? WHERE id = ?").run(Date.now(), id);
  } else {
    db.prepare("UPDATE events SET status = 'active', closed_at = NULL WHERE id = ?").run(id);
  }
  return getEvent(id);
}

// Delete an event and all its data (orders, menu, waiters). Manual cascade so it
// works regardless of how the event_id columns were created (fresh vs migrated).
export function deleteEvent(id) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM orders WHERE event_id = ?').run(id); // order_items cascade via FK
    db.prepare('DELETE FROM categories WHERE event_id = ?').run(id); // articles cascade via FK
    db.prepare('DELETE FROM waiters WHERE event_id = ?').run(id);
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
  });
  tx();
}

export function countEvents() {
  return db.prepare('SELECT COUNT(*) n FROM events').get().n;
}

// First-run + migration: make sure at least one event exists and is active.
// Any rows from a pre-events database (event_id IS NULL) are attached to it,
// so the existing menu/orders are preserved as the first event.
export function ensureFirstEvent(defaultName = 'Mein Fest') {
  if (countEvents() === 0) {
    const { lastInsertRowid: id } = db
      .prepare("INSERT INTO events (name, status, created_at) VALUES (?, 'active', ?)")
      .run(defaultName, Date.now());
    db.prepare('UPDATE categories SET event_id = ? WHERE event_id IS NULL').run(id);
    db.prepare('UPDATE waiters SET event_id = ? WHERE event_id IS NULL').run(id);
    db.prepare('UPDATE orders SET event_id = ? WHERE event_id IS NULL').run(id);
    setActiveEvent(id);
    return id;
  }
  if (getActiveEventId() == null) {
    const e = db
      .prepare("SELECT id FROM events ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1")
      .get();
    if (e) setActiveEvent(e.id);
  }
  return getActiveEventId();
}
