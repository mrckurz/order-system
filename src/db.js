import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS stations (
    id     TEXT PRIMARY KEY,
    label  TEXT NOT NULL,
    print  INTEGER NOT NULL DEFAULT 0,
    sort   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS categories (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    station TEXT NOT NULL DEFAULT 'drinks',
    sort    INTEGER NOT NULL DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',  -- 'admin' or 'station'
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS waiters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    claim_token   TEXT NOT NULL UNIQUE,   -- the single-use login link
    session_token TEXT UNIQUE,            -- issued once the link is claimed on a device
    claimed_at    INTEGER,                -- when the link was first opened/claimed
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
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

  CREATE INDEX IF NOT EXISTS idx_items_order   ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_items_station ON order_items(station, status);
  CREATE INDEX IF NOT EXISTS idx_orders_waiter ON orders(waiter_id);
`);

export default db;
