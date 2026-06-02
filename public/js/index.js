import { loadConfig, t, registerSW } from './common.js';

await loadConfig().catch(() => {});
registerSW();

document.getElementById('lead').textContent = t('selectRole');
for (const span of document.querySelectorAll('[data-t]')) {
  span.textContent = t(span.dataset.t);
}
