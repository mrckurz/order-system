import { startStation } from './station.js';

// The Kitchen/Speisenausgabe display shows the "food" station and offers
// reprinting of tickets. Tickets print automatically on arrival (see printer).
startStation({ station: 'food', titleKey: 'kitchen', accentClass: 'food', showReprint: true });
