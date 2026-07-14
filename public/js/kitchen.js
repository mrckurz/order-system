import { startStation } from './station.js';

// The Kitchen/Speisenausgabe display shows the "food" station. No reprint
// button — this deployment runs without a printer.
startStation({ station: 'food', titleKey: 'kitchen', accentClass: 'food', showReprint: false });
