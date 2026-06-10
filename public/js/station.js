// Shared logic for the Bar and Kitchen station displays.
import {
  loadConfig, api, t, el, time, tokens, connectSocket, ensureStaff, registerSW,
} from './common.js';

export async function startStation({ station, titleKey, accentClass = '', showReprint = false }) {
  registerSW();
  const cfg = await loadConfig().catch(() => ({ stations: [] }));
  const stationLabel = cfg.stations?.find((s) => s.id === station)?.label || t(titleKey);

  const { token } = await ensureStaff({ minRole: 'station', title: stationLabel });

  document.title = `OrderFlow · ${stationLabel}`;
  document.body.innerHTML = '';
  const header = el('header', { class: 'topbar' },
    el('h1', {}, stationLabel),
    el('span', { class: 'badge', id: 'count' }, '0'),
    el('button', {
      class: 'btn-sm btn-ghost', style: 'color:#fff',
      onclick: () => { tokens.clearAdmin(); location.href = 'index.html'; },
    }, t('logout'))
  );
  const main = el('main', {}, el('div', { class: 'cols', id: 'queue' }));
  document.body.append(header, main);
  const queueEl = document.getElementById('queue');
  const countEl = document.getElementById('count');

  let orders = [];

  function render() {
    queueEl.innerHTML = '';
    countEl.textContent = String(orders.filter((o) => !o.done).length); // open count
    if (!orders.length) {
      queueEl.append(el('div', { class: 'empty-state' }, t('noOpen')));
      return;
    }
    for (const o of orders) {
      const num = o.order_no ?? o.id;
      const card = el('div', { class: `card order ${accentClass}` + (o.done ? ' order-done' : '') },
        el('h3', {},
          el('span', {}, `#${num}` + (o.table_no ? ` · ${t('table')} ${o.table_no}` : '')),
          el('span', { class: 'meta' }, o.done ? '✓ ' + t('done') : time(o.created_at))
        ),
        el('div', { class: 'meta' }, `${t('waiterName')}: ${o.waiter_name || '—'}`),
        o.note ? el('div', { class: 'tag warn', style: 'margin:.3rem 0' }, o.note) : null,
        ...o.items.map((it) =>
          el('div', { class: `item-line ${it.status === 'done' ? 'done' : ''}` },
            el('span', {}, el('span', { class: 'q' }, `${it.qty}×`), it.name),
            it.status === 'done' ? null :
              el('button', { class: 'btn-sm btn-ok', onclick: () => markItem(it.id) }, '✓')
          )
        ),
        el('div', { class: 'row', style: 'margin-top:.6rem' },
          showReprint
            ? el('button', { class: 'btn-sm btn-ghost', onclick: () => reprint(o.id) }, '🖨 ' + t('reprint'))
            : null,
          o.done
            ? el('button', { class: 'btn-sm btn-ghost grow', onclick: () => reopenOrder(o.id) }, '↩ ' + t('reopenEvent'))
            : el('button', { class: 'btn-sm btn-ok grow', onclick: () => markOrder(o.id) }, '✓ ' + t('allDone'))
        )
      );
      queueEl.append(card);
    }
  }

  async function load() {
    orders = await api(`/stations/${station}/queue`, { token });
    render();
  }
  async function markItem(id) {
    await api(`/order-items/${id}/done`, { method: 'POST', token });
    await load();
  }
  async function markOrder(id) {
    await api(`/orders/${id}/done`, { method: 'POST', token, body: { station } });
    await load();
  }
  async function reopenOrder(id) {
    await api(`/orders/${id}/reopen`, { method: 'POST', token, body: { station } });
    await load();
  }
  async function reprint(id) {
    await api(`/orders/${id}/reprint`, { method: 'POST', token });
  }

  await load();

  // Live updates: reload on any change so arrival order stays correct.
  connectSocket({ token, room: 'station', on: {
    'order:new': load,
    'order:update': load,
    unauthorized: () => { tokens.clearAdmin(); location.reload(); },
  } });
}
