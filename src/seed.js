import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';
import config from './config.js';
import { ensureFirstEvent } from './events.js';

function loadMenu() {
  return JSON.parse(fs.readFileSync(path.join(config.configDir, 'default-menu.json'), 'utf8'));
}

function labelFor(obj, key, fallback) {
  return obj[`${key}_${config.defaultLang}`] ?? obj[`${key}_de`] ?? obj[`${key}_en`] ?? fallback;
}

// Seed the global stations (drinks/food) once — infrastructure, not menu data.
export function seedStations() {
  if (db.prepare('SELECT COUNT(*) n FROM stations').get().n > 0) return;
  const menu = loadMenu();
  const ins = db.prepare('INSERT OR REPLACE INTO stations (id, label, print, sort) VALUES (?, ?, ?, ?)');
  for (const s of menu.stations) ins.run(s.id, labelFor(s, 'label', s.id), s.print ? 1 : 0, s.sort ?? 0);
}

// Seed the example menu into an event (only used when explicitly requested).
export function seedEventMenu(eventId, { force = false } = {}) {
  const menu = loadMenu();
  const tx = db.transaction(() => {
    seedStations();
    const has = db.prepare('SELECT COUNT(*) n FROM categories WHERE event_id = ?').get(eventId).n;
    if (has > 0) {
      if (!force) return { skipped: true };
      db.prepare('DELETE FROM categories WHERE event_id = ?').run(eventId); // articles cascade
    }
    const insCat = db.prepare('INSERT INTO categories (event_id, name, station, sort) VALUES (?, ?, ?, ?)');
    const insArt = db.prepare(
      'INSERT INTO articles (category_id, name, price, station, active, sort) VALUES (?, ?, ?, ?, 1, ?)'
    );
    menu.categories.forEach((cat, ci) => {
      const name = labelFor(cat, 'name', `Category ${ci + 1}`);
      const { lastInsertRowid: catId } = insCat.run(eventId, name, cat.station, ci);
      cat.items.forEach((item, ii) => insArt.run(catId, item.name, item.price, item.station ?? cat.station, ii));
    });
    return { skipped: false };
  });
  return tx();
}

// Called on startup: seed the global stations and rescue any legacy orphan rows.
// No menu is seeded — fest-admins build/import their own menus.
export function bootstrapData() {
  seedStations();
  ensureFirstEvent(); // legacy orphan rescue only; does not create empty events
}

// CLI: node src/seed.js  (seeds the example menu into the newest event, for dev)
if (import.meta.url === `file://${process.argv[1]}`) {
  seedStations();
  const ev = db.prepare('SELECT id FROM events ORDER BY id DESC LIMIT 1').get();
  if (!ev) {
    console.log('No event exists yet — create one as a fest-admin first.');
  } else {
    const res = seedEventMenu(ev.id, { force: process.argv.includes('--reset') });
    console.log(res.skipped ? 'Newest event already has a menu.' : 'Seeded example menu into the newest event.');
  }
  process.exit(0);
}
