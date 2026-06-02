// Builds the static PWA into ./dist for GitHub Pages (hybrid mode).
//
// - copies public/ -> dist/
// - injects the backend API URL into config.js (from ORDERFLOW_API_URL)
// - vendors the socket.io browser client locally (no cross-origin script)
// - injects a Content-Security-Policy meta tag allowing the API origin
// - adds .nojekyll and a 404.html fallback
//
// Usage: ORDERFLOW_API_URL="https://your-api.example.com" node scripts/build-pages.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const out = path.join(root, 'dist');

const API_URL = (process.env.ORDERFLOW_API_URL || '').replace(/\/$/, '');
if (!API_URL) {
  console.warn('⚠  ORDERFLOW_API_URL is not set — the PWA will call its own origin for the API.');
}

// Reset dist/
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(src, out, { recursive: true });

// 1) config.js — point the frontend at the cloud API + vendored socket client.
fs.writeFileSync(
  path.join(out, 'config.js'),
  `window.ORDERFLOW_CONFIG = {\n` +
    `  apiBase: ${JSON.stringify(API_URL)},\n` +
    `  socketScript: "./vendor/socket.io.min.js",\n` +
    `};\n`
);

// 2) Vendor the socket.io browser client.
const candidates = [
  path.join(root, 'node_modules/socket.io/client-dist/socket.io.min.js'),
  path.join(root, 'node_modules/socket.io-client/dist/socket.io.min.js'),
];
const clientFile = candidates.find((p) => fs.existsSync(p));
if (!clientFile) {
  console.error('✗ Could not find the socket.io browser client. Run "npm install" first.');
  process.exit(1);
}
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.copyFileSync(clientFile, path.join(out, 'vendor', 'socket.io.min.js'));

// 3) Inject a CSP meta tag into every HTML file (allows the API origin).
let apiOrigin = '';
try { apiOrigin = API_URL ? new URL(API_URL).origin : ''; } catch {}
const wsOrigin = apiOrigin ? apiOrigin.replace(/^http/, 'ws') : '';
const connect = ["'self'", apiOrigin, wsOrigin].filter(Boolean).join(' ');
const csp =
  `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; ` +
  `script-src 'self'; connect-src ${connect}; base-uri 'self'; ` +
  `form-action 'self'; frame-ancestors 'none'; object-src 'none'`;
const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;

for (const file of fs.readdirSync(out)) {
  if (!file.endsWith('.html')) continue;
  const p = path.join(out, file);
  let html = fs.readFileSync(p, 'utf8');
  html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  ${cspMeta}`);
  fs.writeFileSync(p, html);
}

// 4) Pages housekeeping.
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// Graceful fallback for unknown deep links under the Pages subpath.
fs.copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html'));

console.log(`✓ Built static PWA into dist/ (API: ${API_URL || 'same-origin'})`);
