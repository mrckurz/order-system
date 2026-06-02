import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { ROOT } from './config.js';

// Minimal ESC/POS command set — enough for a kitchen ticket on most
// thermal printers (Epson TM-series and compatibles). No external deps.
const ESC = 0x1b;
const GS = 0x1d;
const cmd = {
  init: Buffer.from([ESC, 0x40]),
  alignLeft: Buffer.from([ESC, 0x61, 0]),
  alignCenter: Buffer.from([ESC, 0x61, 1]),
  boldOn: Buffer.from([ESC, 0x45, 1]),
  boldOff: Buffer.from([ESC, 0x45, 0]),
  doubleOn: Buffer.from([GS, 0x21, 0x11]), // double width + height
  doubleOff: Buffer.from([GS, 0x21, 0x00]),
  feed: (n = 1) => Buffer.from([ESC, 0x64, n]),
  cut: Buffer.from([GS, 0x56, 0x42, 0x00]), // partial cut with feed
};

const W = config.printer.width;
const line = (ch = '-') => ch.repeat(W);

function pad(left, right) {
  const space = Math.max(1, W - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

// Build a kitchen ticket as ESC/POS bytes.
function renderTicket(ticket) {
  const parts = [cmd.init, cmd.alignCenter, cmd.boldOn, cmd.doubleOn];
  parts.push(Buffer.from(`${ticket.stationLabel}\n`, 'latin1'));
  parts.push(cmd.doubleOff, cmd.boldOff);
  parts.push(Buffer.from(`#${ticket.orderId}\n`, 'latin1'));
  parts.push(cmd.alignLeft);
  parts.push(Buffer.from(line() + '\n', 'latin1'));
  parts.push(cmd.boldOn);
  parts.push(Buffer.from(pad(ticket.waiter || '-', ticket.table ? `Tisch ${ticket.table}` : '') + '\n', 'latin1'));
  parts.push(cmd.boldOff);
  parts.push(Buffer.from(new Date(ticket.createdAt).toLocaleTimeString() + '\n', 'latin1'));
  parts.push(Buffer.from(line() + '\n', 'latin1'));
  parts.push(cmd.doubleOn);
  for (const it of ticket.items) {
    parts.push(Buffer.from(`${it.qty}x ${it.name}\n`, 'latin1'));
    if (it.note) parts.push(Buffer.from(`   ! ${it.note}\n`, 'latin1'));
  }
  parts.push(cmd.doubleOff);
  if (ticket.note) {
    parts.push(Buffer.from(line() + '\n', 'latin1'));
    parts.push(Buffer.from(`${ticket.note}\n`, 'latin1'));
  }
  parts.push(cmd.feed(2), cmd.cut);
  return Buffer.concat(parts);
}

// Plain-text version for console / spool / dev.
function renderText(ticket) {
  const rows = [];
  rows.push(`=== ${ticket.stationLabel} — #${ticket.orderId} ===`);
  rows.push(pad(ticket.waiter || '-', ticket.table ? `Tisch ${ticket.table}` : ''));
  rows.push(new Date(ticket.createdAt).toLocaleTimeString());
  rows.push(line());
  for (const it of ticket.items) {
    rows.push(`${it.qty}x ${it.name}`);
    if (it.note) rows.push(`   ! ${it.note}`);
  }
  if (ticket.note) {
    rows.push(line());
    rows.push(ticket.note);
  }
  return rows.join('\n');
}

function sendNetwork(bytes) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('printer connection timeout'));
    }, 5000);
    socket.connect(config.printer.port, config.printer.host, () => {
      socket.write(bytes, () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function spool(ticket) {
  if (!config.printer.spool) return;
  const dir = path.join(ROOT, 'spool');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `order-${ticket.orderId}-${Date.now()}.txt`);
  fs.writeFileSync(file, renderText(ticket) + '\n');
}

// Print (or simulate printing) a ticket. Never throws — printer failures
// must not break order taking; they are logged instead.
export async function printTicket(ticket) {
  try {
    spool(ticket);
    if (config.printer.type === 'network') {
      await sendNetwork(renderTicket(ticket));
      return { printed: true };
    }
    // type === 'none' (or unknown): log to console so dev still sees output
    console.log('\n[PRINT]\n' + renderText(ticket) + '\n');
    return { printed: false, simulated: true };
  } catch (err) {
    console.error(`[printer] failed to print order #${ticket.orderId}:`, err.message);
    return { printed: false, error: err.message };
  }
}

export const _internals = { renderText };
