import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function bool(v, def = false) {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const config = {
  port: Number(process.env.PORT) || 3000,
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, ''),
  // Where the PWA is hosted (e.g. the GitHub Pages URL in hybrid mode). Used to
  // build waiter links. Falls back to publicUrl (backend-served mode).
  frontendUrl: (process.env.FRONTEND_URL || '').replace(/\/$/, ''),
  // Allowed CORS origins for the API + websockets. Comma-separated, or "*".
  // In hybrid mode set this to your GitHub Pages origin.
  corsOrigins: (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),

  // Bootstrap admin — created only on first start when no account exists yet.
  // Afterwards manage all accounts in the Admin → Team screen.
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'changeme',
  // Optional bootstrap station account (Bar/Kitchen helpers). Created on first
  // start if STATION_PASSWORD is set.
  stationUsername: process.env.STATION_USERNAME || 'station',
  stationPassword: process.env.STATION_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  waiterTokenTtlHours: Number(process.env.WAITER_TOKEN_TTL_HOURS) || 24,

  defaultLang: process.env.DEFAULT_LANG || 'de',
  currency: process.env.CURRENCY || 'EUR',

  printer: {
    type: (process.env.PRINTER_TYPE || 'none').toLowerCase(),
    host: process.env.PRINTER_HOST || '127.0.0.1',
    port: Number(process.env.PRINTER_PORT) || 9100,
    width: Number(process.env.PRINTER_WIDTH) || 42,
    spool: bool(process.env.SPOOL, false),
  },

  dataDir: path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),
  configDir: path.join(ROOT, 'config'),
  // Override the SQLite file location (used by tests).
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'orderflow.db'),
};

export default config;
