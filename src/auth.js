import crypto from 'node:crypto';
import db from './db.js';
import config from './config.js';

// ============================================================================
// Password hashing (scrypt, dependency-free). Format: scrypt$<saltHex>$<hashHex>
// ============================================================================
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ============================================================================
// Accounts (admins + station logins), stored in the DB and managed in the UI
// ============================================================================
export const ROLES = ['superadmin', 'admin', 'station'];

export function createAccount({ username, password, role = 'admin', ownerId = null }) {
  const uname = String(username || '').trim();
  if (!uname) throw Object.assign(new Error('username_required'), { status: 400 });
  if (!password || String(password).length < 4)
    throw Object.assign(new Error('password_too_short'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('invalid_role'), { status: 400 });
  try {
    const info = db
      .prepare('INSERT INTO accounts (username, password_hash, role, owner_id, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .run(uname, hashPassword(password), role, ownerId, Date.now());
    return info.lastInsertRowid;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw Object.assign(new Error('username_taken'), { status: 409 });
    throw e;
  }
}

export function getAccountById(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function verifyAccount(username, password) {
  const acc = db.prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE').get(String(username || '').trim());
  if (!acc || !acc.active) return null;
  if (!verifyPassword(password, acc.password_hash)) return null;
  return acc;
}

export function countActiveSuperadmins(excludeId = null) {
  return db
    .prepare("SELECT COUNT(*) n FROM accounts WHERE role = 'superadmin' AND active = 1 AND id != ?")
    .get(excludeId ?? -1).n;
}

// Create the first account (a superadmin) from env on a fresh database.
export function ensureBootstrapAccounts() {
  const count = db.prepare('SELECT COUNT(*) n FROM accounts').get().n;
  if (count > 0) return;
  const id = createAccount({ username: config.adminUsername, password: config.adminPassword, role: 'superadmin' });
  console.log(`Created bootstrap super-admin "${config.adminUsername}".`);
  if (config.stationPassword) {
    createAccount({ username: config.stationUsername, password: config.stationPassword, role: 'station', ownerId: id });
    console.log(`Created bootstrap station account "${config.stationUsername}".`);
  }
  if (config.adminPassword === 'changeme') {
    console.warn('  ⚠  bootstrap super-admin password is "changeme" — log in and change it immediately!');
  }
}

// ============================================================================
// Stateless session tokens (HMAC-SHA256 signed). Payload carries uid + role.
// ============================================================================
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('hex');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('hex');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(account, ttlHours = 12) {
  return sign({ uid: account.id, role: account.role, exp: Date.now() + ttlHours * 3600_000 });
}

// Resolve a session token to a live, still-active account (so deactivating an
// account takes effect immediately, not just at token expiry).
function staffFromToken(token) {
  const payload = verify(token);
  if (!payload?.uid) return null;
  const acc = getAccountById(payload.uid);
  if (!acc || !acc.active) return null;
  return acc;
}

// ============================================================================
// Waiter tokens (single-use, device-bound links)
// ============================================================================
export function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function claimWaiterLink(claimToken) {
  const w = db.prepare('SELECT * FROM waiters WHERE claim_token = ?').get(claimToken);
  if (!w) return { error: 'invalid_link' };
  if (!w.active) return { error: 'revoked' };
  if (Date.now() > w.expires_at) return { error: 'expired' };
  if (w.session_token) return { error: 'already_claimed' };
  const sessionToken = newToken();
  db.prepare('UPDATE waiters SET session_token = ?, claimed_at = ? WHERE id = ?').run(
    sessionToken,
    Date.now(),
    w.id
  );
  return { sessionToken, name: w.name, expires_at: w.expires_at };
}

export function getWaiterBySession(sessionToken) {
  if (!sessionToken) return null;
  const w = db.prepare('SELECT * FROM waiters WHERE session_token = ?').get(sessionToken);
  if (!w || !w.active || Date.now() > w.expires_at) return null;
  return w;
}

// ============================================================================
// Express middleware
// ============================================================================
function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query.token || null;
}

// Admin OR super-admin (both have full control over their own events).
export function requireAdmin(req, res, next) {
  const acc = staffFromToken(bearer(req));
  if (!acc || !['admin', 'superadmin'].includes(acc.role)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.staff = acc;
  next();
}

// Platform operator only.
export function requireSuperadmin(req, res, next) {
  const acc = staffFromToken(bearer(req));
  if (!acc || acc.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' });
  req.staff = acc;
  next();
}

export function requireStaff(req, res, next) {
  const acc = staffFromToken(bearer(req));
  if (!acc || !['superadmin', 'admin', 'station'].includes(acc.role)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.staff = acc;
  next();
}

export function requireWaiter(req, res, next) {
  const waiter = getWaiterBySession(bearer(req));
  if (!waiter) return res.status(401).json({ error: 'invalid_or_expired_token' });
  req.waiter = waiter;
  next();
}

// Used by Socket.IO handshake.
export function authForSocket(token) {
  const acc = staffFromToken(token);
  if (acc) return { role: acc.role };
  const waiter = getWaiterBySession(token);
  if (waiter) return { role: 'waiter', waiter };
  return null;
}

// ============================================================================
// Simple in-memory rate limiter (per IP + bucket)
// ============================================================================
const buckets = new Map();
export function rateLimit({ bucket, max, windowMs }) {
  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const entry = buckets.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count += 1;
    buckets.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: 'too_many_requests' });
    next();
  };
}
