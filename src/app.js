import path from 'node:path';
import express from 'express';
import config from './config.js';
import { seed } from './seed.js';
import api from './routes.js';

// Build the Express app (without starting a listener or websockets).
// Kept separate from server.js so tests can mount it on an ephemeral port.
export function createApp({ runSeed = true } = {}) {
  if (runSeed) seed();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));

  // Security headers (dependency-free).
  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; " +
        "style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self'; " +
        "frame-ancestors 'none'; object-src 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  app.use('/api', api);
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Waiter deep link: /w/<claimToken> — the page claims it client-side.
  app.get('/w/:token', (req, res) => {
    res.sendFile(path.join(config.publicDir, 'waiter.html'), {
      headers: { 'Cache-Control': 'no-store' },
    });
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
