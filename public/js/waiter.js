import {
  loadConfig, api, t, money, el, tokens, connectSocket, registerSW,
} from './common.js';

registerSW();
await loadConfig().catch(() => {});

const $ = (id) => document.getElementById(id);
const toastEl = $('toast');
let toastTimer;
function toast(msg, err = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('err', err);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ---- Authentication: claim a single-use link, or use stored session ----
// The claim token arrives either as a query param (?c=… — used on GitHub Pages)
// or as a path segment (/w/… — backend-served convenience route).
function readClaimToken() {
  const q = new URLSearchParams(location.search).get('c');
  if (q) return q;
  const m = location.pathname.match(/\/w\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function authenticate() {
  const claimToken = readClaimToken();
  if (claimToken) {
    try {
      const r = await api('/waiters/claim', { method: 'POST', body: { claimToken } });
      tokens.setWaiter(r.sessionToken);
      // Drop the claim token from the URL so it isn't re-used or shared.
      history.replaceState(null, '', 'waiter.html');
      return r.sessionToken;
    } catch (e) {
      // If we already hold a valid session, the link was just re-opened — ignore.
      if (tokens.waiter() && e.status === 409) {
        history.replaceState(null, '', 'waiter.html');
        return tokens.waiter();
      }
      return { error: e.status === 409 ? 'already_claimed' : 'invalid' };
    }
  }
  return tokens.waiter();
}

function showInvalid(reason) {
  $('app').innerHTML = '';
  $('app').append(
    el('div', { class: 'empty-state' },
      el('h2', {}, '🔒'),
      el('p', {}, t('invalidLink'))
    )
  );
}

const token = await authenticate();
if (!token || token.error) {
  $('loading')?.remove();
  showInvalid(token?.error);
  throw new Error('no waiter session');
}

// ---- Load profile + menu ----
let me;
try {
  me = await api('/me', { token });
} catch {
  tokens.clearWaiter();
  showInvalid('invalid');
  throw new Error('invalid session');
}

$('waiterName').textContent = me.name;
$('logoutBtn').textContent = t('logout');
$('logoutBtn').hidden = false;
$('logoutBtn').addEventListener('click', () => {
  tokens.clearWaiter();
  location.href = 'index.html';
});
$('sendLabel').textContent = t('send');
$('clearBtn').textContent = t('clear');
$('reviewLabel').textContent = t('finishOrder');
$('reviewTitle').textContent = t('reviewTitle');
$('reviewTotalLabel').textContent = t('total');
$('reviewBack').textContent = t('back');
$('tableInput').placeholder = t('table') + ' * (' + t('required') + ')';
$('noteInput').placeholder = t('note') + ' (optional)';

const menu = await api('/menu', { token });

// ---- Cart state ----
const cart = new Map(); // articleId -> { article, qty }
function cartTotal() {
  let sum = 0;
  for (const { article, qty } of cart.values()) sum += article.price * qty;
  return sum;
}
function setQty(article, qty) {
  if (qty <= 0) cart.delete(article.id);
  else cart.set(article.id, { article, qty });
  renderCart();
  syncTiles();
}

// ---- Render menu tiles ----
const app = $('app');
$('loading')?.remove();
for (const cat of menu.categories) {
  if (!cat.items.length) continue;
  app.append(el('h2', { class: 'cat-title' }, cat.name));
  const grid = el('div', { class: 'tiles' });
  for (const art of cat.items) {
    const tile = el('button', {
      class: 'tile', 'data-id': art.id,
      onclick: () => setQty(art, (cart.get(art.id)?.qty || 0) + 1),
    },
      el('span', { class: 'name' }, art.name),
      el('span', { class: 'price' }, money(art.price))
    );
    grid.append(tile);
  }
  app.append(grid);
}

function syncTiles() {
  for (const tile of document.querySelectorAll('.tile')) {
    const id = Number(tile.dataset.id);
    const qty = cart.get(id)?.qty || 0;
    tile.style.outline = qty ? '3px solid var(--brand)' : '';
    let badge = tile.querySelector('.tile-badge');
    if (qty) {
      if (!badge) {
        badge = el('span', { class: 'tile-badge tag warn' });
        badge.style.position = 'absolute';
        tile.style.position = 'relative';
        tile.append(badge);
      }
      badge.textContent = `×${qty}`;
      badge.style.cssText = 'position:absolute;top:6px;right:6px';
    } else if (badge) {
      badge.remove();
    }
  }
}

// ---- Render cart ----
// A single editable cart line, reused by the compact list and the review sheet.
function cartLineEl(article, qty) {
  return el('div', { class: 'cart-line' },
    el('span', { class: 'grow' }, article.name),
    el('span', { class: 'muted' }, money(article.price * qty)),
    el('div', { class: 'qty-ctrl' },
      el('button', { class: 'btn-ghost', onclick: () => setQty(article, qty - 1) }, '−'),
      el('span', {}, String(qty)),
      el('button', { class: 'btn-ghost', onclick: () => setQty(article, qty + 1) }, '+')
    )
  );
}

// The item list stays collapsed by default so the menu tiles remain visible;
// the waiter expands it deliberately (via the summary row) to edit.
let cartExpanded = false;
function renderCart() {
  const list = $('cartList');
  list.innerHTML = '';
  const empty = cart.size === 0;
  $('cartBar').hidden = empty;
  if (empty) {
    cartExpanded = false;
    closeReview();
  }
  let totalQty = 0;
  for (const { article, qty } of cart.values()) {
    totalQty += qty;
    list.append(cartLineEl(article, qty));
  }
  list.hidden = !cartExpanded;
  $('cartChevron').classList.toggle('open', cartExpanded);
  $('cartSummaryText').textContent = `${totalQty} ${t('items')} · ${money(cartTotal())}`;
  $('cartTotal').textContent = money(cartTotal());
  updateCartSpacing();
  renderReview();
}

$('cartSummary').addEventListener('click', () => {
  cartExpanded = !cartExpanded;
  $('cartList').hidden = !cartExpanded;
  $('cartChevron').classList.toggle('open', cartExpanded);
  updateCartSpacing();
});

// Reserve exactly as much space at the bottom of the menu as the cart bar
// occupies, so every menu item stays reachable by scrolling.
function updateCartSpacing() {
  const bar = $('cartBar');
  $('app').style.paddingBottom = (bar.hidden ? 24 : bar.offsetHeight + 24) + 'px';
}
window.addEventListener('resize', updateCartSpacing);

$('clearBtn').addEventListener('click', () => {
  cart.clear();
  renderCart();
  syncTiles();
});

// ---- Offline order queue (survives WiFi drops; auto-resends) ----
// Orders are buffered in localStorage with a client key for idempotency, so a
// dropped connection never loses an order and a re-send never duplicates one.
const PENDING_KEY = 'orderflow.pending.' + me.id;
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${me.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
function getPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; } }
function setPending(arr) { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); updatePendingBadge(); }
function updatePendingBadge() {
  const n = getPending().length;
  const b = $('pending');
  b.hidden = n === 0;
  b.textContent = '⏳ ' + n;
  b.style.background = navigator.onLine ? 'rgba(255,255,255,.2)' : 'var(--warn)';
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    let q = getPending();
    while (q.length) {
      try {
        await api('/orders', { method: 'POST', token, body: q[0] });
      } catch (e) {
        // permanent client error (e.g. article removed): drop it, inform; otherwise keep & retry later
        if (e.status >= 400 && e.status < 500 && e.status !== 429) {
          q.shift(); setPending(q);
          toast(e.message, true);
          continue;
        }
        break; // network / server / rate limit → try again later
      }
      q.shift(); setPending(q);
    }
  } finally {
    flushing = false;
    updatePendingBadge();
  }
}

// ---- Review step (final check before an order is sent) ----
function closeReview() { $('reviewOverlay').hidden = true; }

function renderReview() {
  if ($('reviewOverlay').hidden) return;
  const list = $('reviewList');
  list.innerHTML = '';
  for (const { article, qty } of cart.values()) list.append(cartLineEl(article, qty));
  const table = $('tableInput').value.trim();
  const note = $('noteInput').value.trim();
  const meta = $('reviewMeta');
  meta.innerHTML = '';
  meta.append(
    el('div', {}, el('strong', {}, t('table') + ': '), table || '–'),
    note ? el('div', {}, el('strong', {}, t('note') + ': '), note) : null
  );
  $('reviewTotal').textContent = money(cartTotal());
}

// Enforce the mandatory table number, then open the review sheet.
function requireTable() {
  const table = $('tableInput').value.trim();
  if (table === '') {
    toast(t('tableRequired'), true);
    $('tableInput').focus();
    return null;
  }
  return table;
}

$('reviewBtn').addEventListener('click', () => {
  if (cart.size === 0) return;
  if (requireTable() === null) return;
  $('reviewOverlay').hidden = false;
  renderReview();
});
$('reviewClose').addEventListener('click', closeReview);
$('reviewBack').addEventListener('click', closeReview);

$('confirmSendBtn').addEventListener('click', () => {
  if (cart.size === 0) return;
  const table = requireTable();
  if (table === null) { closeReview(); return; }
  const order = {
    clientKey: newKey(),
    table,
    note: $('noteInput').value.trim(),
    items: [...cart.values()].map(({ article, qty }) => ({ articleId: article.id, qty })),
  };
  setPending([...getPending(), order]); // accept immediately (persisted locally)
  cart.clear();
  $('tableInput').value = '';
  $('noteInput').value = '';
  closeReview();
  renderCart();
  syncTiles();
  toast(navigator.onLine ? t('sent') : t('savedOffline'));
  flushQueue();
});

// Resend triggers: on load, when back online, and periodically while pending.
updatePendingBadge();
flushQueue();
window.addEventListener('online', () => { updatePendingBadge(); flushQueue(); });
window.addEventListener('offline', updatePendingBadge);
setInterval(() => { if (getPending().length) flushQueue(); }, 15000);

// ---- Realtime confirmation (keeps the waiter session "alive" on the server) ----
connectSocket({ token, room: 'waiter', on: {
  'order:confirmed': () => {},
  connect: flushQueue,
} });
