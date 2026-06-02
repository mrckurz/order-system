import http from 'node:http';
import config from './config.js';
import db from './db.js';
import { createApp } from './app.js';
import { initRealtime } from './realtime.js';

const app = createApp();
const server = http.createServer(app);
initRealtime(server);

server.listen(config.port, () => {
  console.log(`\nOrderFlow running:`);
  console.log(`  Local:   http://localhost:${config.port}`);
  console.log(`  Network: ${config.publicUrl}`);
  console.log(`  Admin:   ${config.publicUrl}/admin`);
  if (config.adminPassword === 'changeme') {
    console.warn('  ⚠  ADMIN_PASSWORD is still "changeme" — set it in .env before going live!');
  }
  console.log(`  Printer: ${config.printer.type}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
