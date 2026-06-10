import { registerSW } from './common.js';

registerSW();
const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());
