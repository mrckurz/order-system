import crypto from 'node:crypto';
import db from './db.js';
import config from './config.js';

// ---- Staff sessions (stateless, HMAC-signed token) ----
// Two roles: "admin" (full control — only the organizer) and "station"
// (Bar/Kitchen displays only). Token: base64url(payloadJSON).hexHMAC

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

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Returns the role for a given password, or null. Admin password wins.
export function roleForPassword(password) {
  if (safeEqual(password, config.adminPassword)) return 'admin';
  if (config.stationPassword && safeEqual(password, config.stationPassword)) return 'station';
  return null;
}

export function createStaffToken(role, ttlHours = 12) {
  return sign({ role, exp: Date.now() + ttlHours * 3600_000 });
}

// ---- Waiter tokens ----
export function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Claim a single-use link: binds the waiter to the first device and returns a
// session token. Subsequent claims of the same link fail.
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

// ---- Express helpers ----
function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query.token || null;
}

export function requireAdmin(req, res, next) {
  const payload = verify(bearer(req));
  if (!payload || payload.role !== 'admin') return res.status(401).json({ error: 'unauthorized' });
  req.staff = payload;
  next();
}

// Admin OR station — used for the Bar/Kitchen displays.
export function requireStaff(req, res, next) {
  const payload = verify(bearer(req));
  if (!payload || !['admin', 'station'].includes(payload.role)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.staff = payload;
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
  const staff = verify(token);
  if (staff && ['admin', 'station'].includes(staff.role)) return { role: staff.role };
  const waiter = getWaiterBySession(token);
  if (waiter) return { role: 'waiter', waiter };
  return null;
}

// ---- Simple in-memory rate limiter (per IP + bucket) ----
const buckets = new Map();
export function rateLimit({ bucket, max, windowMs }) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const entry = buckets.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count += 1;
    buckets.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: 'too_many_requests' });
    }
    next();
  };
}
