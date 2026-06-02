import path from 'node:path';
import express from 'express';
import config from './config.js';
import { seed } from './seed.js';
import { ensureBootstrapAccounts } from './auth.js';
import api from './routes.js';

// Build the Express app (without starting a listener or websockets).
// Kept separate from server.js so tests can mount it on an ephemeral port.
export function createApp({ runSeed = true } = {}) {
  if (runSeed) seed();
  ensureBootstrapAccounts();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // CORS — required for hybrid mode (PWA on a different origin than the API).
  // Bearer tokens are sent in the Authorization header (no cookies), so we do
  // not enable credentials. Set CORS_ORIGIN to your frontend origin in prod.
  const allowAll = config.corsOrigins.includes('*');
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowAll || config.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  // Security headers (dependency-free).
  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      // Scripts are strict ('self'); inline style attributes are used by the UI
      // so styles allow 'unsafe-inline' (far lower risk than inline scripts).
      "default-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; " +
        "style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; " +
        "form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  app.use('/api', api);
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Waiter deep link (backend-served convenience): /w/<claimToken> redirects to
  // the canonical static URL the PWA understands.
  app.get('/w/:token', (req, res) => {
    res.redirect(302, `/waiter.html?c=${encodeURIComponent(req.params.token)}`);
  });

  // Clean URLs for the staff screens.
  for (const page of ['admin', 'bar', 'kitchen']) {
    app.get(`/${page}`, (req, res) => res.sendFile(path.join(config.publicDir, `${page}.html`)));
  }

  // Static PWA assets.
  app.use(
    express.static(config.publicDir, {
      setHeaders(res, filePath) {
        if (/sw\.js$|manifest\.webmanifest$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // JSON error handler.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'internal_error' });
  });

  return app;
}
