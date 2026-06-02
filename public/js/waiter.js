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
async function authenticate() {
  const match = location.pathname.match(/^\/w\/(.+)$/);
  if (match) {
    const claimToken = decodeURIComponent(match[1]);
    try {
      const r = await api('/waiters/claim', { method: 'POST', body: { claimToken } });
      tokens.setWaiter(r.sessionToken);
      // Drop the claim token from the URL so it isn't re-used or shared.
      history.replaceState(null, '', '/waiter.html');
      return r.sessionToken;
    } catch (e) {
      // If we already hold a valid session, the link was just re-opened — ignore.
      if (tokens.waiter() && e.status === 409) {
        history.replaceState(null, '', '/waiter.html');
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
  location.href = '/';
});
$('sendLabel').textContent = t('send');
$('clearBtn').textContent = t('clear');
$('tableInput').placeholder = t('table');
$('noteInput').placeholder = t('note');

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
function renderCart() {
  const list = $('cartList');
  list.innerHTML = '';
  $('cartBar').hidden = cart.size === 0;
  for (const { article, qty } of cart.values()) {
    list.append(
      el('div', { class: 'cart-line' },
        el('span', { class: 'grow' }, article.name),
        el('span', { class: 'muted' }, money(article.price * qty)),
        el('div', { class: 'qty-ctrl' },
          el('button', { class: 'btn-ghost', onclick: () => setQty(article, qty - 1) }, '−'),
          el('span', {}, String(qty)),
          el('button', { class: 'btn-ghost', onclick: () => setQty(article, qty + 1) }, '+')
        )
      )
    );
  }
  $('cartTotal').textContent = money(cartTotal());
}

$('clearBtn').addEventListener('click', () => {
  cart.clear();
  renderCart();
  syncTiles();
});

$('sendBtn').addEventListener('click', async () => {
  if (cart.size === 0) return;
  const items = [...cart.values()].map(({ article, qty }) => ({ articleId: article.id, qty }));
  $('sendBtn').disabled = true;
  try {
    await api('/orders', {
      method: 'POST',
      token,
      body: { table: $('tableInput').value.trim(), note: $('noteInput').value.trim(), items },
    });
    cart.clear();
    $('noteInput').value = '';
    renderCart();
    syncTiles();
    toast(t('sent'));
  } catch (e) {
    toast(e.message, true);
  } finally {
    $('sendBtn').disabled = false;
  }
});

// ---- Realtime confirmation (keeps the waiter session "alive" on the server) ----
connectSocket({ token, room: 'waiter', on: {
  'order:confirmed': () => {},
} });
