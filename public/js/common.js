// Shared client helpers for all OrderFlow screens.

export const STR = {
  de: {
    appName: 'OrderFlow',
    waiter: 'Kellner', bar: 'Schank', kitchen: 'Speisenausgabe', admin: 'Admin',
    selectRole: 'Bildschirm wählen',
    login: 'Anmelden', logout: 'Abmelden', password: 'Passwort', wrongPassword: 'Falsches Passwort',
    table: 'Tisch', note: 'Notiz', total: 'Summe', send: 'Bestellung senden', cart: 'Warenkorb',
    empty: 'Noch nichts ausgewählt', sent: 'Bestellung gesendet!', clear: 'Leeren',
    myOrders: 'Meine Bestellungen', orders: 'Bestellungen', done: 'Erledigt', reprint: 'Erneut drucken',
    waiters: 'Kellner', addWaiter: 'Kellner hinzufügen', name: 'Name', validFor: 'Gültig (Std.)',
    link: 'Link', copy: 'Kopieren', copied: 'Kopiert!', revoke: 'Abmelden', reactivate: 'Reaktivieren',
    remove: 'Löschen', active: 'aktiv', expired: 'abgelaufen', revoked: 'abgemeldet',
    menu: 'Speisekarte', category: 'Kategorie', price: 'Preis', station: 'Station',
    addCategory: 'Kategorie', addArticle: 'Artikel', save: 'Speichern', activeShort: 'Aktiv',
    invalidLink: 'Dieser Link ist ungültig oder abgelaufen. Bitte den Admin kontaktieren.',
    connecting: 'Verbinde…', noOpen: 'Keine offenen Bestellungen', waiterName: 'Kellner',
    qty: 'Anz.', print: 'Druck', share: 'Teilen', allDone: 'Alles erledigt',
    username: 'Benutzername', wrongCredentials: 'Benutzername oder Passwort falsch',
    team: 'Team', addAccount: 'Konto hinzufügen', role: 'Rolle',
    roleAdmin: 'Admin', roleStation: 'Schank/Küche', newPassword: 'Neues Passwort',
    deactivate: 'Deaktivieren', you: 'du', lastAdminError: 'Der letzte aktive Admin kann nicht entfernt werden.',
    dangerZone: 'Daten zurücksetzen', resetOrders: 'Bestellungen löschen',
    resetOrdersWaiters: 'Bestellungen + Kellner löschen',
    resetConfirm: 'Wirklich alle Bestellungen unwiderruflich löschen?',
    resetDone: 'Zurückgesetzt', changePw: 'Passwort ändern',
  },
  en: {
    appName: 'OrderFlow',
    waiter: 'Waiter', bar: 'Bar', kitchen: 'Kitchen', admin: 'Admin',
    selectRole: 'Choose a screen',
    login: 'Log in', logout: 'Log out', password: 'Password', wrongPassword: 'Wrong password',
    table: 'Table', note: 'Note', total: 'Total', send: 'Send order', cart: 'Cart',
    empty: 'Nothing selected yet', sent: 'Order sent!', clear: 'Clear',
    myOrders: 'My orders', orders: 'Orders', done: 'Done', reprint: 'Reprint',
    waiters: 'Waiters', addWaiter: 'Add waiter', name: 'Name', validFor: 'Valid (hrs)',
    link: 'Link', copy: 'Copy', copied: 'Copied!', revoke: 'Log out', reactivate: 'Reactivate',
    remove: 'Delete', active: 'active', expired: 'expired', revoked: 'logged out',
    menu: 'Menu', category: 'Category', price: 'Price', station: 'Station',
    addCategory: 'Category', addArticle: 'Article', save: 'Save', activeShort: 'Active',
    invalidLink: 'This link is invalid or expired. Please contact the admin.',
    connecting: 'Connecting…', noOpen: 'No open orders', waiterName: 'Waiter',
    qty: 'Qty', print: 'Print', share: 'Share', allDone: 'All done',
    username: 'Username', wrongCredentials: 'Wrong username or password',
    team: 'Team', addAccount: 'Add account', role: 'Role',
    roleAdmin: 'Admin', roleStation: 'Bar/Kitchen', newPassword: 'New password',
    deactivate: 'Deactivate', you: 'you', lastAdminError: 'You cannot remove the last active admin.',
    dangerZone: 'Reset data', resetOrders: 'Delete orders',
    resetOrdersWaiters: 'Delete orders + waiters',
    resetConfirm: 'Really delete all orders permanently?',
    resetDone: 'Reset done', changePw: 'Change password',
  },
};

let LANG = 'de';
let CURRENCY = 'EUR';
export function t(key) { return (STR[LANG] || STR.de)[key] ?? key; }
export function setLang(l) { if (STR[l]) LANG = l; }
export function money(v) {
  return new Intl.NumberFormat(LANG === 'de' ? 'de-AT' : 'en-US', {
    style: 'currency', currency: CURRENCY,
  }).format(v || 0);
}
// The currency symbol alone (e.g. "€" for EUR) — used to label price inputs.
export function currencySymbol() {
  try {
    const parts = new Intl.NumberFormat(LANG === 'de' ? 'de-AT' : 'en-US', {
      style: 'currency', currency: CURRENCY,
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || CURRENCY;
  } catch {
    return CURRENCY;
  }
}
export function time(ts) {
  return new Date(ts).toLocaleTimeString(LANG === 'de' ? 'de-AT' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  });
}

// ---- token storage ----
const ADMIN_KEY = 'orderflow.admin';
const WAITER_KEY = 'orderflow.waiter';
export const tokens = {
  admin: () => localStorage.getItem(ADMIN_KEY),
  setAdmin: (t) => localStorage.setItem(ADMIN_KEY, t),
  clearAdmin: () => localStorage.removeItem(ADMIN_KEY),
  waiter: () => localStorage.getItem(WAITER_KEY),
  setWaiter: (t) => localStorage.setItem(WAITER_KEY, t),
  clearWaiter: () => localStorage.removeItem(WAITER_KEY),
};

// ---- Runtime config (set by public/config.js, overwritten at Pages build) ----
// apiBase: origin of the backend API ("" = same origin, for backend-served mode).
// socketScript: URL of the socket.io client ("" = derive from apiBase).
const RT = (typeof window !== 'undefined' && window.ORDERFLOW_CONFIG) || {};
export const API_BASE = (RT.apiBase || '').replace(/\/$/, '');

// ---- API ----
export async function api(pathName, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api${pathName}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (res.status === 204) return null;
  return res.json();
}

// Load global config (lang, currency, stations) and apply it.
export async function loadConfig() {
  const cfg = await api('/config');
  setLang(cfg.lang);
  CURRENCY = cfg.currency || 'EUR';
  document.documentElement.lang = cfg.lang;
  return cfg;
}

// ---- realtime ----
// Load the socket.io client on demand. In backend-served mode it comes from
// `${API_BASE}/socket.io/socket.io.js`; the Pages build vendors a local copy
// and sets ORDERFLOW_CONFIG.socketScript instead.
let ioLoading;
function loadIo() {
  if (window.io) return Promise.resolve();
  if (!ioLoading) {
    const src = RT.socketScript || `${API_BASE}/socket.io/socket.io.js`;
    ioLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return ioLoading;
}

export async function connectSocket({ token, room, on = {} }) {
  try {
    await loadIo();
  } catch {
    return null; // realtime unavailable; screens still work via manual refresh
  }
  const socket = window.io(API_BASE || '/', { auth: { token, room } });
  for (const [evt, fn] of Object.entries(on)) socket.on(evt, fn);
  return socket;
}

// ---- PWA ----
export function registerSW() {
  if ('serviceWorker' in navigator) {
    // Relative path so the scope matches the GitHub Pages subpath too.
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// Ensure we hold a valid staff token (admin or station). Shows a login box if
// not. Resolves with { token, role }. `minRole` = 'admin' restricts to admin.
export async function ensureStaff({ minRole = 'station', title = 'Login' } = {}) {
  const existing = tokens.admin();
  if (existing) {
    try {
      const who = await api('/whoami', { token: existing });
      if (minRole === 'admin' && who.role !== 'admin') {
        tokens.clearAdmin();
      } else {
        return { token: existing, role: who.role };
      }
    } catch {
      tokens.clearAdmin();
    }
  }
  return new Promise((resolve) => {
    document.body.innerHTML = '';
    const err = el('p', { class: 'muted' });
    const userI = el('input', { placeholder: t('username'), autocomplete: 'username', autocapitalize: 'none' });
    const passI = el('input', { type: 'password', placeholder: t('password'), autocomplete: 'current-password' });
    const submit = async () => {
      err.textContent = '';
      try {
        const r = await api('/login', { method: 'POST', body: { username: userI.value.trim(), password: passI.value } });
        if (minRole === 'admin' && r.role !== 'admin') {
          err.textContent = t('wrongCredentials');
          return;
        }
        tokens.setAdmin(r.token);
        document.body.innerHTML = '';
        resolve({ token: r.token, role: r.role, username: r.username });
      } catch {
        err.textContent = t('wrongCredentials');
      }
    };
    passI.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const box = el('div', { class: 'login-box card' },
      el('h2', {}, title),
      el('label', {}, t('username')), userI,
      el('label', {}, t('password')), passI, err,
      el('button', { class: 'btn-primary btn-block', onclick: submit }, t('login'))
    );
    document.body.append(el('div', { class: 'center-screen' }, box));
    userI.focus();
  });
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}
