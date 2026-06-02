# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Events/festivals as first-class entities.** Create named events; one is "active".
  Menu, waiters and orders are all scoped per event and stored permanently.
  - Admin → **Feste/Events** tab: create (optionally copying another event's menu),
    activate, rename, close/reopen, delete; the active event shows in the header.
  - Safe migration: existing data is preserved as the first event ("Mein Fest").
- **Statistics dashboard per event** (Admin → Statistik): total revenue, order count,
  average order, revenue/orders per waiter, products sold, and per-station breakdown,
  with **CSV export** per event.
- Currency symbol (e.g. €) shown next to the editable price fields in the Admin → Menu editor.
- **Account-based authentication**: log in with username + password (scrypt-hashed).
  - Multiple **admin** and **station** accounts, managed in the new Admin → **Team** screen
    (create, rename, change password, deactivate, delete).
  - The last active admin cannot be deleted or demoted; deactivation takes effect immediately.
  - First admin bootstrapped from `ADMIN_USERNAME`/`ADMIN_PASSWORD` on a fresh database.
- **Event-data reset** (Admin → Team → danger zone): clear orders (optionally waiters) to
  test before going live, keeping menu and accounts.
- **Single-server deployment** with automatic HTTPS: `docker-compose.yml` + `Caddyfile`
  (Let's Encrypt), `.env.server.example`, and a full Hetzner/VPS runbook in `docs/DEPLOYMENT.md`.

### Changed
- Login is now username + password (was a single shared password); `STATION_PASSWORD`
  is only used to bootstrap an optional station account on first start.

- **Hybrid deployment**: host the PWA on GitHub Pages and the API in the cloud.
  - Configurable API base + vendored Socket.IO client (`public/config.js`, build-injected).
  - `scripts/build-pages.js` + "Deploy PWA to GitHub Pages" workflow (CSP meta, `.nojekyll`, `404.html`).
  - `Dockerfile`, `render.yaml`, `fly.toml` for the backend; `docs/DEPLOYMENT.md` guide.
  - CORS support (`CORS_ORIGIN`) for the API and websockets.
  - `FRONTEND_URL` to build waiter links; links now use the static `waiter.html?c=<token>` form
    so they work on static hosting (with a `/w/:token` redirect on the backend).
  - Relative asset paths throughout so the PWA works under a Pages subpath.
- Initial release of OrderFlow.
- Waiter PWA for taking orders on personal phones.
- Live Bar and Kitchen station displays via Socket.IO, grouped by order and waiter.
- ESC/POS thermal printing of kitchen tickets in arrival order, with console/spool fallback.
- Admin screen: live overview of all orders, waiter management, runtime menu editor.
- Single-use, device-bound, expiring waiter login links.
- Separate admin and station passwords (role split).
- Rate-limited authentication and hardened HTTP headers.
- German/English i18n; default menu seeded from a JSON config.
- Integration test suite and CI on Node 20/22.
