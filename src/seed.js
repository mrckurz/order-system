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

function seedStationsIfEmpty(menu) {
  if (db.prepare('SELECT COUNT(*) n FROM stations').get().n > 0) return;
  const ins = db.prepare('INSERT OR REPLACE INTO stations (id, label, print, sort) VALUES (?, ?, ?, ?)');
  for (const s of menu.stations) ins.run(s.id, labelFor(s, 'label', s.id), s.print ? 1 : 0, s.sort ?? 0);
}

// Seed the default menu into an event, but only if that event has no menu yet.
export function seedEventMenu(eventId, { force = false } = {}) {
  const menu = loadMenu();
  const tx = db.transaction(() => {
    seedStationsIfEmpty(menu);
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

// Called on startup: ensure an event exists and its menu is seeded on first run.
export function bootstrapData() {
  const eventId = ensureFirstEvent();
  return seedEventMenu(eventId);
}

// CLI: node src/seed.js [--reset]
if (import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes('--reset');
  const eventId = ensureFirstEvent();
  const res = seedEventMenu(eventId, { force: reset });
  if (res.skipped) {
    console.log('Active event already has a menu — nothing to do. Use "npm run seed:reset" to overwrite it.');
  } else {
    console.log(reset ? 'Active event menu reset to defaults.' : 'Seeded default menu into the active event.');
  }
  process.exit(0);
}
