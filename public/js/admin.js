import {
  loadConfig, api, t, money, time, el, tokens, connectSocket, ensureStaff, registerSW,
} from './common.js';

registerSW();
const cfg = await loadConfig().catch(() => ({ stations: [] }));
const { token } = await ensureStaff({ minRole: 'admin', title: t('admin') });
const me = await api('/whoami', { token }).catch(() => ({}));

const toastEl = el('div', { class: 'toast', id: 'toast' });
function toast(msg, err = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('err', err);
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}

document.body.innerHTML = '';
const tabs = ['orders', 'waiters', 'menu', 'team'];
const tabLabels = { orders: t('orders'), waiters: t('waiters'), menu: t('menu'), team: t('team') };
let current = 'orders';

const nav = el('header', { class: 'topbar' },
  el('h1', {}, 'OrderFlow · ' + t('admin')),
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
  else if (current === 'waiters') renderWaiters();
  else if (current === 'menu') renderMenu();
  else renderTeam();
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
async function renderMenu() {
  const data = await api('/admin/menu', { token });
  content.innerHTML = '';
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

  for (const cat of data.categories) {
    const card = el('div', { class: 'card' });
    card.append(el('div', { class: 'row spread' },
      el('strong', {}, cat.name),
      el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
        if (!confirm(`${t('remove')} "${cat.name}"?`)) return;
        await api(`/admin/categories/${cat.id}`, { method: 'DELETE', token });
        renderMenu();
      } }, '🗑')
    ));

    for (const a of cat.items) {
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
      card.append(el('div', { class: 'row wrap', style: 'border-top:1px solid var(--border);padding-top:.5rem;margin-top:.5rem' },
        nameI, priceI, stationS,
        el('label', { style: 'margin:0;display:flex;align-items:center;gap:.3rem' }, activeC, t('activeShort')),
        el('button', { class: 'btn-sm btn-primary', onclick: save }, t('save')),
        el('button', { class: 'btn-sm btn-ghost', onclick: async () => {
          if (!confirm(`${t('remove')} "${a.name}"?`)) return;
          await api(`/admin/articles/${a.id}`, { method: 'DELETE', token });
          renderMenu();
        } }, '🗑')
      ));
    }

    // add article to this category
    const newName = el('input', { placeholder: t('addArticle'), class: 'grow' });
    const newPrice = el('input', { type: 'number', step: '0.10', value: '0', style: 'max-width:90px' });
    card.append(el('div', { class: 'row wrap', style: 'margin-top:.6rem' },
      newName, newPrice,
      el('button', { class: 'btn-sm btn-primary', onclick: async () => {
        if (!newName.value.trim()) return;
        await api('/admin/articles', { method: 'POST', token, body: {
          categoryId: cat.id, name: newName.value.trim(), price: Number(newPrice.value) || 0, station: cat.station,
        } });
        renderMenu();
      } }, '+')
    ));
    content.append(card);
  }
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

  // Add account
  const uName = el('input', { placeholder: t('username'), autocapitalize: 'none' });
  const uPass = el('input', { type: 'password', placeholder: t('password') });
  const uRole = el('select', {},
    el('option', { value: 'admin' }, t('roleAdmin')),
    el('option', { value: 'station' }, t('roleStation'))
  );
  const add = async () => {
    if (!uName.value.trim() || !uPass.value) return;
    try {
      await api('/admin/accounts', { method: 'POST', token, body: { username: uName.value.trim(), password: uPass.value, role: uRole.value } });
      uName.value = ''; uPass.value = '';
      renderTeam();
    } catch (e) { toast(errMsg(e), true); }
  };
  content.append(el('div', { class: 'card' },
    el('h3', {}, t('addAccount')),
    el('div', { class: 'row wrap' },
      el('div', { class: 'grow' }, el('label', {}, t('username')), uName),
      el('div', { class: 'grow' }, el('label', {}, t('password')), uPass),
      el('div', {}, el('label', {}, t('role')), uRole),
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

// Live order updates while on the orders tab.
connectSocket({ token, room: 'admin', on: {
  'order:new': () => { if (current === 'orders') renderOrders(); },
  'order:update': () => { if (current === 'orders') renderOrders(); },
  unauthorized: () => { tokens.clearAdmin(); location.reload(); },
} });

select('orders');
