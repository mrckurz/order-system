import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER,                          -- the fest-admin account that owns this event
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',  -- 'active' or 'archived'
    created_at INTEGER NOT NULL,
    closed_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS stations (
    id     TEXT PRIMARY KEY,
    label  TEXT NOT NULL,
    print  INTEGER NOT NULL DEFAULT 0,
    sort   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'admin',  -- 'superadmin' | 'admin' (fest-admin) | 'station'
    owner_id        INTEGER,                        -- station accounts: the fest-admin they belong to
    active_event_id INTEGER,                         -- the event this admin is currently working on
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    name     TEXT NOT NULL,
    station  TEXT NOT NULL DEFAULT 'drinks',
    sort     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    price       REAL NOT NULL DEFAULT 0,
    station     TEXT NOT NULL DEFAULT 'drinks',
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS waiters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      INTEGER,
    name          TEXT NOT NULL,
    claim_token   TEXT NOT NULL UNIQUE,
    session_token TEXT UNIQUE,
    claimed_at    INTEGER,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER,
    waiter_id  INTEGER REFERENCES waiters(id) ON DELETE SET NULL,
    table_no   TEXT,
    note       TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    price      REAL NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 1,
    station    TEXT NOT NULL DEFAULT 'drinks',
    status     TEXT NOT NULL DEFAULT 'open',
    note       TEXT
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_items_order    ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_items_station  ON order_items(station, status);
  CREATE INDEX IF NOT EXISTS idx_orders_waiter  ON orders(waiter_id);
`);

// --- Migration: add event_id to tables created before the events feature ---
// Must run BEFORE creating indexes on event_id (a legacy table won't have the
// column yet).
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('categories', 'event_id', 'event_id INTEGER');
ensureColumn('waiters', 'event_id', 'event_id INTEGER');
ensureColumn('orders', 'event_id', 'event_id INTEGER');
ensureColumn('orders', 'order_no', 'order_no INTEGER');
ensureColumn('orders', 'client_key', 'client_key TEXT');
ensureColumn('events', 'owner_id', 'owner_id INTEGER');
ensureColumn('accounts', 'owner_id', 'owner_id INTEGER');
ensureColumn('accounts', 'active_event_id', 'active_event_id INTEGER');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_event   ON orders(event_id);
  CREATE INDEX IF NOT EXISTS idx_cats_event     ON categories(event_id);
  CREATE INDEX IF NOT EXISTS idx_waiters_event  ON waiters(event_id);
  CREATE INDEX IF NOT EXISTS idx_events_owner   ON events(owner_id);
  CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_clientkey ON orders(client_key) WHERE client_key IS NOT NULL;
`);

export default db;
