import {
  loadConfig, api, t, money, time, el, tokens, connectSocket, ensureStaff, registerSW, currencySymbol, API_BASE,
} from './common.js';

registerSW();
const cfg = await loadConfig().catch(() => ({ stations: [] }));
const { token } = await ensureStaff({ minRole: 'admin', title: t('admin') });
const me = await api('/whoami', { token }).catch(() => ({}));
const isSuper = me.role === 'superadmin';

const toastEl = el('div', { class: 'toast', id: 'toast' });
function toast(msg, err = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('err', err);
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}

document.body.innerHTML = '';
// Super-admin is oversight-only (users + their events + stats);
// fest-admins get the full operational set.
const tabs = isSuper
  ? ['festadmins', 'stats']
  : ['orders', 'stats', 'menu', 'waiters', 'team', 'events'];
const tabLabels = {
  orders: t('orders'), stats: t('statistics'), menu: t('menu'),
  waiters: t('waiters'), team: t('team'), events: t('events'), festadmins: t('festAdmins'),
};
let current = tabs[0];

const nav = el('header', { class: 'topbar' },
  el('h1', {}, 'OrderFlow'),
  me.activeEvent ? el('span', { class: 'badge' }, '🎪 ' + me.activeEvent.name) : null,
  isSuper ? el('span', { class: 'badge', style: 'background:rgba(255,255,255,.15)' }, '★ ' + t('roleSuper')) : null,
  el('button', {
    class: 'btn-sm btn-ghost', style: 'color:#fff',
    onclick: () => { tokens.clearAdmin(); location.href = 'index.html'; },
  }, t('logout'))
);
const tabBar = el('div', { class: 'row wrap', style: 'padding:.6rem 1rem;gap:.4rem;position:sticky;top:0;background:var(--bg);z-index:5' },
  ...tabs.map((tab) =>
    el('button', { class: 'btn-sm', 'data-tab': tab, onclick: () => select(tab) }, tabLabels[tab])
  )
);
const content = el('main', { id: 'content' });
document.body.append(nav, tabBar, content, toastEl);

function select(tab) {
  current = tab;
  for (const b of tabBar.querySelectorAll('[data-tab]')) {
    b.classList.toggle('btn-primary', b.dataset.tab === tab);
  }
  render();
}

function render() {
  content.innerHTML = '';
  if (current === 'orders') renderOrders();
  else if (current === 'stats') renderStats();
  else if (current === 'menu') renderMenu();
  else if (current === 'waiters') renderWaiters();
  else if (current === 'team') renderTeam();
  else if (current === 'festadmins') renderFestAdmins();
  else renderEvents();
}

// ---------------- Orders ----------------
let orders = [];
async function renderOrders() {
  orders = await api('/admin/orders', { token });
  content.innerHTML = '';
  if (!orders.length) {
    content.append(el('div', { class: 'empty-state' }, t('noOpen')));
    return;
  }
  const grid = el('div', { class: 'cols' });
  for (const o of orders) {
    const allDone = o.items.every((i) => i.status === 'done');
    grid.append(
      el('div', { class: 'card order' + (allDone ? '' : ' food') },
        el('h3', {},
          el('span', {}, `#${o.id}` + (o.table_no ? ` · ${t('table')} ${o.table_no}` : '')),
          el('span', { class: 'meta' }, time(o.created_at))
        ),
        el('div', { class: 'meta' }, `${o.waiter_name || '—'}`),
        ...o.items.map((it) =>
          el('div', { class: `item-line ${it.status === 'done' ? 'done' : ''}` },
            el('span', {}, `${it.qty}× ${it.name}`),
            el('span', { class: 'muted' }, money(it.price * it.qty))
          )
        ),
        el('div', { class: 'row spread', style: 'margin-top:.5rem' },
          el('strong', {}, t('total') + ': ' + money(o.total)),
          allDone ? el('span', { class: 'tag ok' }, '✓') : el('span', { class: 'tag warn' }, '…')
        )
      )
    );
  }
  content.append(grid);
}

// ---------------- Waiters ----------------
async function renderWaiters() {
  const waiters = await api('/admin/waiters', { token });
  content.innerHTML = '';

  // Add form
  const nameI = el('input', { placeholder: t('name') });
  const ttlI = el('input', { type: 'number', value: '24', min: '1' });
  const add = async () => {
    if (!nameI.value.trim()) return;
    await api('/admin/waiters', { method: 'POST', token, body: { name: nameI.value.trim(), ttlHours: Number(ttlI.value) || 24 } });
    nameI.value = '';
    renderWaiters();
  };
  content.append(
    el('div', { class: 'card' },
      el('h3', {}, t('addWaiter')),
      el('div', { class: 'row wrap' },
        el('div', { class: 'grow' }, el('label', {}, t('name')), nameI),
        el('div', {}, el('label', {}, t('validFor')), ttlI),
        el('button', { class: 'btn-primary', style: 'align-self:flex-end', onclick: add }, '+')
      )
    )
  );

  // List
  for (const w of waiters) {
    const statusTag = {
      active: el('span', { class: 'tag ok' }, t('active')),
      pending: el('span', { class: 'tag warn' }, t('link')),
      expired: el('span', { class: 'tag muted' }, t('expired')),
      revoked: el('span', { class: 'tag muted' }, t('revoked')),
    }[w.status];

    const actions = el('div', { class: 'row wrap', style: 'margin-top:.5rem' });
    if (w.link) {
      const copyBtn = el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        try { await navigator.clipboard.writeText(w.link); toast(t('copied')); }
        catch { prompt(t('link'), w.link); }
      } }, '📋 ' + t('copy'));
      actions.append(copyBtn);
      if (navigator.share) {
        actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: () =>
          navigator.share({ title: 'OrderFlow', text: `${w.name}: ${w.link}`, url: w.link }).catch(() => {})
        }, '📤 ' + t('share')));
      }
    }
    actions.append(
      el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        const r = await api(`/admin/waiters/${w.id}/relink`, { method: 'POST', token });
        renderWaiters();
        if (r.link) { try { await navigator.clipboard.writeText(r.link); toast(t('copied')); } catch {} }
      } }, '🔗 ' + t('link'))
    );
    if (w.status === 'active' || w.status === 'pending') {
      actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        await api(`/admin/waiters/${w.id}/revoke`, { method: 'POST', token });
        renderWaiters();
      } }, '⏻ ' + t('revoke')));
    }
    actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
      if (!confirm(`${t('remove')} ${w.name}?`)) return;
      await api(`/admin/waiters/${w.id}`, { method: 'DELETE', token });
      renderWaiters();
    } }, '🗑'));

    content.append(
      el('div', { class: 'card' },
        el('div', { class: 'row spread' }, el('strong', {}, w.name), statusTag),
        w.link ? el('div', { class: 'muted', style: 'word-break:break-all;font-size:.8rem;margin-top:.3rem' }, w.link) : null,
        el('div', { class: 'meta' }, `gültig bis ${time(w.expires_at)} · ${new Date(w.expires_at).toLocaleDateString()}`),
        actions
      )
    );
  }
}

// ---------------- Menu ----------------
async function downloadMenuCsv() {
  const res = await fetch(`${API_BASE}/api/admin/menu/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { toast('Export ✗', true); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = el('a', { href: url, download: 'speisekarte.csv' });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Reorder helpers: swap an item with its neighbour and persist the new order.
const moveArr = (arr, i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return null;
  const a = arr.slice();
  [a[i], a[j]] = [a[j], a[i]];
  return a;
};
async function reorder(path, ids) {
  await api(path, { method: 'POST', token, body: { ids } });
  renderMenu();
}

// Pointer-based drag sorting (works with mouse and touch).
function dragAfter(container, itemSel, y) {
  let best = { offset: -Infinity, el: null };
  for (const child of container.querySelectorAll(itemSel + ':not(.dragging)')) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > best.offset) best = { offset, el: child };
  }
  return best.el;
}
function enableDragSort(container, itemSel, handleSel, persist) {
  for (const handle of container.querySelectorAll(handleSel)) {
    handle.addEventListener('pointerdown', (e) => {
      const item = handle.closest(itemSel);
      if (!item) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      item.classList.add('dragging');
      const move = (ev) => {
        const after = dragAfter(container, itemSel, ev.clientY);
        if (!after) container.appendChild(item);
        else if (after !== item) container.insertBefore(item, after);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        item.classList.remove('dragging');
        persist([...container.querySelectorAll(itemSel)].map((el) => Number(el.dataset.id)));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
      handle.addEventListener('pointercancel', up, { once: true });
    });
  }
}

async function renderMenu() {
  const data = await api('/admin/menu', { token });
  content.innerHTML = '';
  const curSym = currencySymbol();
  const euro = () => el('span', { class: 'muted', style: 'margin:0 .4rem 0 .1rem' }, curSym);

  // Import / export card
  const ta = el('textarea', { placeholder: 'Getränke;0,5l Bier;4.50;drinks;1', style: 'min-height:90px;font-family:monospace;font-size:.85rem' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv', style: 'min-height:auto' });
  file.addEventListener('change', async () => { if (file.files[0]) ta.value = await file.files[0].text(); });
  const replace = el('input', { type: 'checkbox', style: 'width:auto;min-height:auto' });
  content.append(el('div', { class: 'card' },
    el('div', { class: 'row spread wrap' },
      el('h3', { style: 'margin:0' }, t('importMenu')),
      el('button', { class: 'btn-sm btn-ghost', onclick: downloadMenuCsv }, '⬇ ' + t('exportMenu'))
    ),
    el('p', { class: 'muted', style: 'font-size:.85rem;margin:.3rem 0' }, t('importHint')),
    ta,
    el('div', { class: 'row wrap', style: 'margin-top:.5rem' },
      file,
      el('label', { style: 'margin:0;display:flex;align-items:center;gap:.3rem' }, replace, t('replaceMenu')),
      el('button', { class: 'btn-sm btn-primary', onclick: async () => {
        if (!ta.value.trim()) return;
        try {
          const r = await api('/admin/menu/import', { method: 'POST', token, body: { csv: ta.value, replace: replace.checked } });
          toast(r.imported + ' ' + t('imported'));
          renderMenu();
        } catch (e) { toast(e.message, true); }
      } }, t('importBtn'))
    )
  ));
  const stationOpts = (sel) => data.stations.map((s) =>
    el('option', { value: s.id, ...(s.id === sel ? { selected: '' } : {}) }, s.label)
  );

  // Add category
  const catName = el('input', { placeholder: t('category') });
  const catStation = el('select', {}, ...stationOpts(data.stations[0]?.id));
  content.append(el('div', { class: 'card' },
    el('h3', {}, t('addCategory')),
    el('div', { class: 'row wrap' },
      el('div', { class: 'grow' }, catName),
      catStation,
      el('button', { class: 'btn-primary', onclick: async () => {
        if (!catName.value.trim()) return;
        await api('/admin/categories', { method: 'POST', token, body: { name: catName.value.trim(), station: catStation.value } });
        renderMenu();
      } }, '+')
    )
  ));

  const catBox = el('div');
  content.append(catBox);

  data.categories.forEach((cat, ci) => {
    const card = el('div', { class: 'card sortable-cat', 'data-id': cat.id });
    card.append(el('div', { class: 'row spread' },
      el('div', { class: 'row' },
        el('span', { class: 'drag-handle cat-handle', title: 'Ziehen / Drag' }, '⠿'),
        el('strong', {}, cat.name)
      ),
      el('div', { class: 'row' },
        el('button', { class: 'btn-sm btn-ghost', onclick: () => { const ids = moveArr(data.categories.map((c) => c.id), ci, -1); if (ids) reorder('/admin/categories/reorder', ids); } }, '↑'),
        el('button', { class: 'btn-sm btn-ghost', onclick: () => { const ids = moveArr(data.categories.map((c) => c.id), ci, 1); if (ids) reorder('/admin/categories/reorder', ids); } }, '↓'),
        el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
          if (!confirm(`${t('remove')} "${cat.name}"?`)) return;
          await api(`/admin/categories/${cat.id}`, { method: 'DELETE', token });
          renderMenu();
        } }, '🗑')
      )
    ));

    const artBox = el('div');
    card.append(artBox);

    cat.items.forEach((a, ai) => {
      const nameI = el('input', { value: a.name, class: 'grow' });
      const priceI = el('input', { type: 'number', step: '0.10', value: a.price, style: 'max-width:90px' });
      const stationS = el('select', { style: 'max-width:130px' }, ...stationOpts(a.station));
      const activeC = el('input', { type: 'checkbox', style: 'width:auto;min-height:auto', ...(a.active ? { checked: '' } : {}) });
      const save = async () => {
        await api(`/admin/articles/${a.id}`, { method: 'PATCH', token, body: {
          name: nameI.value, price: Number(priceI.value), station: stationS.value, active: activeC.checked ? 1 : 0,
        } });
        toast(t('save'));
      };
      artBox.append(el('div', { class: 'row wrap sortable-art', 'data-id': a.id, style: 'border-top:1px solid var(--border);padding-top:.5rem;margin-top:.5rem' },
        el('span', { class: 'drag-handle art-handle' }, '⠿'),
        nameI, priceI, euro(), stationS,
        el('label', { style: 'margin:0;display:flex;align-items:center;gap:.3rem' }, activeC, t('activeShort')),
        el('button', { class: 'btn-sm btn-primary', onclick: save }, t('save')),
        el('button', { class: 'btn-sm btn-ghost', onclick: () => { const ids = moveArr(cat.items.map((x) => x.id), ai, -1); if (ids) reorder('/admin/articles/reorder', ids); } }, '↑'),
        el('button', { class: 'btn-sm btn-ghost', onclick: () => { const ids = moveArr(cat.items.map((x) => x.id), ai, 1); if (ids) reorder('/admin/articles/reorder', ids); } }, '↓'),
        el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
          if (!confirm(`${t('remove')} "${a.name}"?`)) return;
          await api(`/admin/articles/${a.id}`, { method: 'DELETE', token });
          renderMenu();
        } }, '🗑')
      ));
    });

    // add article to this category
    const newName = el('input', { placeholder: t('addArticle'), class: 'grow' });
    const newPrice = el('input', { type: 'number', step: '0.10', value: '0', style: 'max-width:90px' });
    card.append(el('div', { class: 'row wrap', style: 'margin-top:.6rem' },
      newName, newPrice, euro(),
      el('button', { class: 'btn-sm btn-primary', onclick: async () => {
        if (!newName.value.trim()) return;
        await api('/admin/articles', { method: 'POST', token, body: {
          categoryId: cat.id, name: newName.value.trim(), price: Number(newPrice.value) || 0, station: cat.station,
        } });
        renderMenu();
      } }, '+')
    ));
    catBox.append(card);
    enableDragSort(artBox, '.sortable-art', '.art-handle', (ids) => reorder('/admin/articles/reorder', ids));
  });

  enableDragSort(catBox, '.sortable-cat', '.cat-handle', (ids) => reorder('/admin/categories/reorder', ids));
}

// ---------------- Team (accounts) + reset ----------------
function errMsg(e) {
  if (e.message === 'last_admin') return t('lastAdminError');
  if (e.message === 'username_taken') return t('username') + ' ✗';
  if (e.message === 'password_too_short') return 'min. 4';
  return e.message;
}

async function renderTeam() {
  const accounts = await api('/admin/accounts', { token });
  content.innerHTML = '';

  // Add a Bar/Kitchen (station) login
  const uName = el('input', { placeholder: t('username'), autocapitalize: 'none' });
  const uPass = el('input', { type: 'password', placeholder: t('password') });
  const add = async () => {
    if (!uName.value.trim() || !uPass.value) return;
    try {
      await api('/admin/accounts', { method: 'POST', token, body: { username: uName.value.trim(), password: uPass.value } });
      uName.value = ''; uPass.value = '';
      renderTeam();
    } catch (e) { toast(errMsg(e), true); }
  };
  content.append(el('div', { class: 'card' },
    el('h3', {}, t('stationsTitle')),
    el('p', { class: 'muted', style: 'margin:.2rem 0 .6rem;font-size:.9rem' }, t('stationsHint')),
    el('div', { class: 'row wrap' },
      el('div', { class: 'grow' }, el('label', {}, t('username')), uName),
      el('div', { class: 'grow' }, el('label', {}, t('password')), uPass),
      el('button', { class: 'btn-primary', style: 'align-self:flex-end', onclick: add }, '+')
    )
  ));

  // List
  for (const a of accounts) {
    const isSelf = a.id === me.uid;
    const roleTag = el('span', { class: 'tag ' + (a.role === 'admin' ? 'ok' : 'muted') },
      a.role === 'admin' ? t('roleAdmin') : t('roleStation'));
    const actions = el('div', { class: 'row wrap', style: 'margin-top:.5rem' },
      el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        const pw = prompt(t('newPassword'));
        if (!pw) return;
        try { await api(`/admin/accounts/${a.id}`, { method: 'PATCH', token, body: { password: pw } }); toast(t('changePw')); }
        catch (e) { toast(errMsg(e), true); }
      } }, '🔑 ' + t('changePw')),
      el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        try { await api(`/admin/accounts/${a.id}`, { method: 'PATCH', token, body: { active: !a.active } }); renderTeam(); }
        catch (e) { toast(errMsg(e), true); }
      } }, a.active ? '⏻ ' + t('deactivate') : '✓ ' + t('reactivate'))
    );
    if (!isSelf) {
      actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        if (!confirm(`${t('remove')} ${a.username}?`)) return;
        try { await api(`/admin/accounts/${a.id}`, { method: 'DELETE', token }); renderTeam(); }
        catch (e) { toast(errMsg(e), true); }
      } }, '🗑'));
    }
    content.append(el('div', { class: 'card' },
      el('div', { class: 'row spread' },
        el('strong', {}, a.username + (isSelf ? ` (${t('you')})` : '')),
        el('div', { class: 'row' }, roleTag, a.active ? null : el('span', { class: 'tag muted' }, '—'))
      ),
      actions
    ));
  }

  // Danger zone — reset event data for testing
  content.append(el('div', { class: 'card', style: 'border-color:var(--brand)' },
    el('h3', {}, '⚠️ ' + t('dangerZone')),
    el('div', { class: 'row wrap' },
      el('button', { class: 'btn-sm', onclick: () => doReset(false) }, t('resetOrders')),
      el('button', { class: 'btn-sm', onclick: () => doReset(true) }, t('resetOrdersWaiters'))
    )
  ));
}

async function doReset(waiters) {
  if (!confirm(t('resetConfirm'))) return;
  await api('/admin/reset', { method: 'POST', token, body: { waiters } });
  toast(t('resetDone'));
  if (current === 'orders') renderOrders();
}

// ---------------- Events (Feste) ----------------
async function renderEvents() {
  const events = await api('/admin/events', { token });
  content.innerHTML = '';

  // Create event (optionally copy menu from an existing one)
  const nameI = el('input', { placeholder: t('eventName') });
  const copySel = el('select', {},
    el('option', { value: '' }, t('noCopy')),
    ...events.map((e) => el('option', { value: e.id }, t('copyMenu') + ' ' + e.name))
  );
  const add = async () => {
    if (!nameI.value.trim()) return;
    const body = { name: nameI.value.trim() };
    if (copySel.value) body.copyMenuFrom = Number(copySel.value);
    await api('/admin/events', { method: 'POST', token, body });
    location.reload(); // new event becomes active → refresh everything
  };
  content.append(el('div', { class: 'card' },
    el('h3', {}, t('addEvent')),
    el('div', { class: 'row wrap' },
      el('div', { class: 'grow' }, el('label', {}, t('eventName')), nameI),
      el('div', {}, el('label', {}, t('copyMenu')), copySel),
      el('button', { class: 'btn-primary', style: 'align-self:flex-end', onclick: add }, '+')
    )
  ));

  for (const e of events) {
    const tags = el('div', { class: 'row wrap' },
      e.active ? el('span', { class: 'tag ok' }, t('activeBadge')) : null,
      e.status === 'archived' ? el('span', { class: 'tag muted' }, t('archived')) : null,
      isSuper && e.owner_name ? el('span', { class: 'tag muted' }, '👤 ' + e.owner_name) : null,
      el('span', { class: 'tag muted' }, e.orders + ' ' + t('ordersCount'))
    );
    const actions = el('div', { class: 'row wrap', style: 'margin-top:.5rem' });
    if (!e.active) {
      actions.append(el('button', { class: 'btn-sm btn-primary', onclick: async () => {
        await api(`/admin/events/${e.id}/activate`, { method: 'POST', token });
        location.reload();
      } }, '▶ ' + t('activate')));
    }
    actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
      const n = prompt(t('eventName'), e.name);
      if (!n) return;
      await api(`/admin/events/${e.id}`, { method: 'PATCH', token, body: { name: n } });
      e.active ? location.reload() : renderEvents();
    } }, '✎'));
    actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
      await api(`/admin/events/${e.id}`, { method: 'PATCH', token, body: { status: e.status === 'archived' ? 'active' : 'archived' } });
      renderEvents();
    } }, e.status === 'archived' ? t('reopenEvent') : t('closeEvent')));
    if (!e.active) {
      actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        if (!confirm(`${t('deleteEvent')} "${e.name}"? ${t('resetConfirm')}`)) return;
        try { await api(`/admin/events/${e.id}`, { method: 'DELETE', token }); renderEvents(); }
        catch (err) { toast(err.message, true); }
      } }, '🗑'));
    }
    content.append(el('div', { class: 'card' },
      el('div', { class: 'row spread' }, el('strong', {}, e.name), tags),
      actions
    ));
  }
}

// ---------------- Statistics dashboard ----------------
let statsEventId = null;
function kpi(label, val) {
  return el('div', { class: 'card', style: 'flex:1;min-width:130px;text-align:center;margin:0' },
    el('div', { class: 'muted', style: 'font-size:.8rem' }, label),
    el('div', { style: 'font-size:1.5rem;font-weight:700' }, String(val))
  );
}
function tableCard(title, headers, rows) {
  const body = rows.length
    ? rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, String(c)))))
    : [el('tr', {}, el('td', { colspan: String(headers.length), class: 'muted' }, t('noData')))];
  return el('div', { class: 'card' },
    el('h3', {}, title),
    el('table', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h))), ...body)
  );
}
async function downloadCsv(eventId) {
  const res = await fetch(`${API_BASE}/api/admin/events/${eventId}/export.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `orderflow-event-${eventId}.csv` });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
async function renderStats() {
  const events = await api('/admin/events', { token });
  content.innerHTML = '';
  if (!events.length) {
    content.append(el('div', { class: 'empty-state' }, t('noFests')));
    return;
  }
  if (!statsEventId || !events.some((e) => e.id === statsEventId)) {
    statsEventId = (events.find((e) => e.active) || events[0])?.id;
  }
  const sel = el('select', {},
    ...events.map((e) => el('option', { value: e.id, ...(e.id === statsEventId ? { selected: '' } : {}) }, e.name))
  );
  sel.addEventListener('change', () => { statsEventId = Number(sel.value); renderStats(); });
  content.append(el('div', { class: 'card' },
    el('div', { class: 'row spread wrap' },
      el('div', { class: 'grow' }, el('label', {}, t('selectEvent')), sel),
      el('button', { class: 'btn-sm btn-ghost', style: 'align-self:flex-end', onclick: () => downloadCsv(statsEventId) }, '⬇ ' + t('exportCsv'))
    )
  ));
  const s = await api('/admin/stats?eventId=' + statsEventId, { token });
  content.append(el('div', { class: 'row wrap', style: 'gap:.6rem' },
    kpi(t('revenue'), money(s.totals.revenue)),
    kpi(t('ordersCount'), s.totals.orders),
    kpi(t('avgOrder'), money(s.totals.avgOrder)),
    kpi(t('items'), s.totals.items)
  ));
  content.append(tableCard(t('perWaiter'), [t('waiterName'), t('ordersCount'), t('revenue')],
    s.perWaiter.map((r) => [r.waiter, r.orders, money(r.revenue)])));
  content.append(tableCard(t('perProduct'), [t('product'), t('qtySold'), t('revenue')],
    s.perProduct.map((r) => [r.name, r.qty, money(r.revenue)])));
  content.append(tableCard(t('perStation'), [t('station'), t('qtySold'), t('revenue')],
    s.perStation.map((r) => [r.station, r.qty, money(r.revenue)])));
}

// ---------------- Fest-Admins (super-admin oversight) ----------------
// Shows every user and, nested beneath, their events with a drill-in to stats.
async function renderFestAdmins() {
  const [admins, events] = await Promise.all([
    api('/admin/festadmins', { token }),
    api('/admin/events', { token }),
  ]);
  content.innerHTML = '';

  // Create a new fest-admin
  const uName = el('input', { placeholder: t('username'), autocapitalize: 'none' });
  const uPass = el('input', { type: 'password', placeholder: t('password') });
  const add = async () => {
    if (!uName.value.trim() || !uPass.value) return;
    try {
      await api('/admin/festadmins', { method: 'POST', token, body: { username: uName.value.trim(), password: uPass.value } });
      uName.value = ''; uPass.value = '';
      renderFestAdmins();
    } catch (e) { toast(saErr(e), true); }
  };
  content.append(el('div', { class: 'card' },
    el('h3', {}, t('addFestAdmin')),
    el('div', { class: 'row wrap' },
      el('div', { class: 'grow' }, el('label', {}, t('username')), uName),
      el('div', { class: 'grow' }, el('label', {}, t('password')), uPass),
      el('button', { class: 'btn-primary', style: 'align-self:flex-end', onclick: add }, '+')
    )
  ));

  for (const a of admins) {
    const self = a.id === me.uid;
    const roleTag = el('span', { class: 'tag ' + (a.role === 'superadmin' ? 'warn' : 'ok') },
      a.role === 'superadmin' ? t('roleSuper') : t('roleAdmin'));
    const actions = el('div', { class: 'row wrap', style: 'margin-top:.6rem' },
      el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        const pw = prompt(t('newPassword'));
        if (!pw) return;
        try { await api(`/admin/festadmins/${a.id}`, { method: 'PATCH', token, body: { password: pw } }); toast(t('changePw')); }
        catch (e) { toast(saErr(e), true); }
      } }, '🔑 ' + t('changePw')),
      el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        try { await api(`/admin/festadmins/${a.id}`, { method: 'PATCH', token, body: { active: !a.active } }); renderFestAdmins(); }
        catch (e) { toast(saErr(e), true); }
      } }, a.active ? '⏻ ' + t('deactivate') : '✓ ' + t('reactivate'))
    );
    if (!self) {
      actions.append(el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        if (!confirm(`${a.username}: ${t('deleteFestAdminConfirm')}`)) return;
        try { await api(`/admin/festadmins/${a.id}`, { method: 'DELETE', token }); renderFestAdmins(); }
        catch (e) { toast(saErr(e), true); }
      } }, '🗑'));
    }

    // Nested list of this user's events, each with a stats drill-in.
    const evs = events.filter((e) => e.owner_id === a.id);
    const evRows = evs.length
      ? evs.map((e) => el('div', { class: 'row spread', style: 'border-top:1px solid var(--border);padding:.45rem 0' },
          el('span', {}, '🎪 ' + e.name + (e.status === 'archived' ? ` (${t('archived')})` : '')),
          el('div', { class: 'row' },
            el('span', { class: 'tag muted' }, e.orders + ' ' + t('ordersCount')),
            el('button', { class: 'btn-sm btn-ghost', onclick: () => { statsEventId = e.id; select('stats'); } }, '📊 ' + t('statistics'))
          )
        ))
      : [el('div', { class: 'muted', style: 'padding:.45rem 0' }, t('noFests'))];

    content.append(el('div', { class: 'card' },
      el('div', { class: 'row spread' },
        el('strong', {}, a.username + (self ? ` (${t('you')})` : '')),
        el('div', { class: 'row' }, roleTag, el('span', { class: 'tag muted' }, evs.length + ' ' + t('eventsCount')), a.active ? null : el('span', { class: 'tag muted' }, '—'))
      ),
      ...(self && a.role === 'superadmin' ? [] : evRows),
      actions
    ));
  }
}
function saErr(e) {
  if (e.message === 'last_superadmin') return t('cannotDeleteLastSuper');
  if (e.message === 'username_taken') return t('username') + ' ✗';
  return e.message;
}

// Live order updates while on the orders tab.
connectSocket({ token, room: 'admin', on: {
  'order:new': () => { if (current === 'orders') renderOrders(); },
  'order:update': () => { if (current === 'orders') renderOrders(); },
  unauthorized: () => { tokens.clearAdmin(); location.reload(); },
} });

select(current);
