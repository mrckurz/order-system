import db from './db.js';

// ---------------------------------------------------------------------------
// Tenancy model:
//   superadmin  – platform operator; sees & manages everything
//   admin       – "fest-admin"; owns and manages only their own events
//   station     – belongs to a fest-admin (owner_id); works on that admin's event
// Each admin has their own "active event" (accounts.active_event_id).
// ---------------------------------------------------------------------------

// The tenant an account belongs to (fest-admin id). For admins it's themselves.
export function ownerIdFor(account) {
  return account.role === 'station' ? account.owner_id : account.id;
}

export function getAccount(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

// The event an account is currently working on.
export function getActiveEventIdFor(account) {
  if (account.role === 'station') {
    const owner = getAccount(account.owner_id);
    return owner ? owner.active_event_id : null;
  }
  return account.active_event_id;
}

export function setActiveEventForAccount(accountId, eventId) {
  db.prepare('UPDATE accounts SET active_event_id = ? WHERE id = ?').run(eventId, accountId);
}

export function getEvent(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

export function getActiveEventFor(account) {
  const id = getActiveEventIdFor(account);
  return id ? getEvent(id) : null;
}

// Can this account see/act on this event?
export function canAccessEvent(account, event) {
  if (!event) return false;
  if (account.role === 'superadmin') return true;
  return event.owner_id === ownerIdFor(account);
}

// Events visible to an account. Superadmin sees all (with owner username).
export function listEventsFor(account) {
  const ordCount = db.prepare('SELECT COUNT(*) n FROM orders WHERE event_id = ?');
  const rows =
    account.role === 'superadmin'
      ? db
          .prepare(
            `SELECT e.*, a.username AS owner_name FROM events e
               LEFT JOIN accounts a ON a.id = e.owner_id ORDER BY e.created_at DESC`
          )
          .all()
      : db.prepare('SELECT * FROM events WHERE owner_id = ? ORDER BY created_at DESC').all(ownerIdFor(account));
  const activeId = getActiveEventIdFor(account);
  return rows.map((e) => ({ ...e, active: e.id === activeId, orders: ordCount.get(e.id).n }));
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

// Create an event owned by `owner` (the requesting account). Optionally copy a
// menu from one of the owner's events. Activates it for the owner by default.
export function createEvent({ name, owner, copyFromEventId = null, activate = true }) {
  const nm = String(name || '').trim();
  if (!nm) throw Object.assign(new Error('name_required'), { status: 400 });
  const ownerId = ownerIdFor(owner);
  const tx = db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare("INSERT INTO events (owner_id, name, status, created_at) VALUES (?, ?, 'active', ?)")
      .run(ownerId, nm, Date.now());
    if (copyFromEventId) {
      const src = getEvent(copyFromEventId);
      if (src && src.owner_id === ownerId) copyMenu(copyFromEventId, id);
    }
    return id;
  });
  const id = tx();
  if (activate) setActiveEventForAccount(ownerId, id);
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

export function deleteEvent(id) {
  db.transaction(() => {
    db.prepare('DELETE FROM orders WHERE event_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE event_id = ?').run(id);
    db.prepare('DELETE FROM waiters WHERE event_id = ?').run(id);
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
  })();
}

export function countEvents() {
  return db.prepare('SELECT COUNT(*) n FROM events').get().n;
}

// ---- global "first event" used at bootstrap (pre-tenancy) ----
function getGlobalActiveId() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'active_event_id'").get();
  return row ? Number(row.value) : null;
}
function setGlobalActive(id) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('active_event_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(id));
}

// First-run + legacy migration: ensure an event exists; attach orphan rows.
export function ensureFirstEvent(defaultName = 'Mein Fest') {
  if (countEvents() === 0) {
    const { lastInsertRowid: id } = db
      .prepare("INSERT INTO events (name, status, created_at) VALUES (?, 'active', ?)")
      .run(defaultName, Date.now());
    db.prepare('UPDATE categories SET event_id = ? WHERE event_id IS NULL').run(id);
    db.prepare('UPDATE waiters SET event_id = ? WHERE event_id IS NULL').run(id);
    db.prepare('UPDATE orders SET event_id = ? WHERE event_id IS NULL').run(id);
    setGlobalActive(id);
    return id;
  }
  if (getGlobalActiveId() == null) {
    const e = db.prepare("SELECT id FROM events ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1").get();
    if (e) setGlobalActive(e.id);
  }
  return getGlobalActiveId();
}

// Tenancy migration: ensure a superadmin exists, give every event an owner,
// and set the superadmin's active event from the old global setting.
export function migrateTenancy() {
  let sa = db.prepare("SELECT * FROM accounts WHERE role = 'superadmin' ORDER BY id LIMIT 1").get();
  if (!sa) {
    const oldest = db.prepare("SELECT * FROM accounts WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    if (oldest) {
      db.prepare("UPDATE accounts SET role = 'superadmin' WHERE id = ?").run(oldest.id);
      sa = getAccount(oldest.id);
      console.log(`Promoted account "${sa.username}" to super-admin.`);
    }
  }
  if (!sa) return; // no accounts yet (fresh DB handled elsewhere)

  db.prepare('UPDATE events SET owner_id = ? WHERE owner_id IS NULL').run(sa.id);
  db.prepare("UPDATE accounts SET owner_id = ? WHERE role = 'station' AND owner_id IS NULL").run(sa.id);
  if (sa.active_event_id == null) {
    const globalActive = getGlobalActiveId();
    if (globalActive) setActiveEventForAccount(sa.id, globalActive);
  }
}
