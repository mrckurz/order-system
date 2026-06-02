import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';
import config from './config.js';

const reset = process.argv.includes('--reset');

function loadMenu() {
  const file = path.join(config.configDir, 'default-menu.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function labelFor(obj, langKey, fallback) {
  return obj[`${langKey}_${config.defaultLang}`] ?? obj[`${langKey}_de`] ?? obj[`${langKey}_en`] ?? fallback;
}

export function seed({ force = false } = {}) {
  const menu = loadMenu();

  const seeded = db.prepare('SELECT value FROM meta WHERE key = ?').get('seeded');
  if (seeded && !force) {
    return { skipped: true };
  }

  const tx = db.transaction(() => {
    if (force) {
      db.exec('DELETE FROM articles; DELETE FROM categories; DELETE FROM stations;');
    }

    const insStation = db.prepare(
      'INSERT OR REPLACE INTO stations (id, label, print, sort) VALUES (?, ?, ?, ?)'
    );
    for (const s of menu.stations) {
      insStation.run(s.id, labelFor(s, 'label', s.id), s.print ? 1 : 0, s.sort ?? 0);
    }

    const insCat = db.prepare('INSERT INTO categories (name, station, sort) VALUES (?, ?, ?)');
    const insArt = db.prepare(
      'INSERT INTO articles (category_id, name, price, station, active, sort) VALUES (?, ?, ?, ?, 1, ?)'
    );

    menu.categories.forEach((cat, ci) => {
      const name = labelFor(cat, 'name', `Category ${ci + 1}`);
      const { lastInsertRowid: catId } = insCat.run(name, cat.station, ci);
      cat.items.forEach((item, ii) => {
        insArt.run(catId, item.name, item.price, item.station ?? cat.station, ii);
      });
    });

    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'seeded',
      new Date().toISOString()
    );
  });

  tx();
  return { skipped: false };
}

// Run directly: node src/seed.js [--reset]
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = seed({ force: reset });
  if (res.skipped) {
    console.log('Database already seeded — nothing to do. Use "npm run seed:reset" to overwrite the menu.');
  } else {
    console.log(reset ? 'Menu reset to defaults.' : 'Database seeded with default menu.');
  }
  process.exit(0);
}
