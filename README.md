<div align="center">

# 🍺 OrderFlow

**A self-hosted, open-source order system for events — built for volunteer-run festivals, clubs and pop-up bars.**

Waiters take orders on their own phones · the bar and kitchen see them live · kitchen tickets print in arrival order.

[![CI](https://github.com/mrckurz/order-system/actions/workflows/ci.yml/badge.svg)](https://github.com/mrckurz/order-system/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

OrderFlow was originally built so a volunteer fire brigade could run the drinks-and-food stand at its summer festival without paper slips and shouting across the yard. It is **not fire-brigade specific** — any event with waiters, a bar and a food counter can use it: sports clubs, school fêtes, scout camps, street food markets, weddings.

It can run on **a single laptop on the local WiFi** or on **a small rented server** with HTTPS. No SaaS, no subscription, no external/cloud accounts — the app and its data stay on your own machine.

## How it works

```
 Waiter phones (PWA)            One laptop on the festival WiFi              Stations
 ┌───────────────┐             ┌──────────────────────────────┐           ┌──────────────┐
 │  📱 Anna       │── order ───▶│  Node.js + SQLite            │── live ──▶│ 🍺 Bar iPad   │
 │  📱 Bernd      │             │  (Express + Socket.IO)       │           ├──────────────┤
 │  📱 Clara      │◀─ confirm ──│                              │── live ──▶│ 🍴 Kitchen    │
 └───────────────┘             └──────────────┬───────────────┘    + 🖨   └──────────────┘
                                              │
                                       ⚙️ Admin (you)
```

1. **You (admin)** open the Admin screen, create a waiter for each helper and hand each one a **single-use login link** (QR code, message, or just type it).
2. Each **waiter** opens their link once on their own phone. The link is consumed and the phone is bound to that waiter — the link can't be reused or shared. They install the PWA and start taking orders.
3. Orders appear **instantly** on the **Bar** display (drinks) and the **Kitchen** display (food). Each order shows which waiter placed it, so you can hand them a ready tray.
4. The **Kitchen** also **prints a ticket** for every incoming order on a thermal printer, in arrival order.
5. You watch **all orders** live in the Admin overview and can log waiters out at any time.

## Features

- 📱 **Installable PWA** — works on any phone/tablet, no app store. Survives brief WiFi drops.
- 🔗 **Single-use waiter links** with an expiry — create them up front, hand them out, done.
- 🍺🍴 **Live station displays** for bar and kitchen, grouped by order and showing the waiter.
- 🖨 **Thermal printer support** (ESC/POS over network) — kitchen tickets in arrival order, with a console/file fallback for testing.
- ⚙️ **Configurable menu** — categories, articles, prices and stations editable from the Admin screen at runtime.
- 👥 **Accounts & roles** — log in with username + password; create and manage **multiple admins** and **station logins** from the Admin → Team screen (you can't lock out the last admin).
- 👀 **Admin overview** of every order; a one-click **reset** lets you test then start the event clean.
- 🔒 **Security-minded** — hashed passwords (scrypt), role separation (admin vs station), device-bound single-use waiter links, rate-limited logins, hardened HTTP headers. See [SECURITY.md](SECURITY.md).
- 🌍 **i18n** — ships with German and English; default language is configurable.
- 🪶 **Tiny footprint** — SQLite file, a handful of dependencies, runs on a laptop or a Raspberry Pi.

## Quick start

Requirements: **Node.js ≥ 20**.

```bash
git clone https://github.com/mrckurz/order-system.git
cd order-system
npm install
cp .env.example .env        # then edit .env — at least set ADMIN_USERNAME / ADMIN_PASSWORD!
npm run icons               # generate the PWA icons (placeholder branding)
npm start
```

Open <http://localhost:3000> and pick a screen:

| Screen | URL | Who |
| --- | --- | --- |
| Admin | `/admin` | You — menu, waiters, all orders, **Team** (manage admins/stations). Log in with the bootstrap admin account |
| Bar | `/bar` | Bar staff — live drink orders (station account) |
| Kitchen | `/kitchen` | Food counter — live food orders + auto-print (station account) |
| Waiter | `/w/<link>` | Each waiter — single-use link created in Admin |

## Running it at your event

1. Put a laptop on the same WiFi as everyone's phones and find its LAN IP (e.g. `192.168.0.10`).
2. In `.env` set `PUBLIC_URL=http://192.168.0.10:3000` (this is what waiter links point to) and a strong `ADMIN_PASSWORD`.
3. `npm start`. Open `/admin`, log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`, then in **Admin → Team** add station accounts (Bar/Kitchen) and any extra admins. Create your waiters and share each link (the **Share**/**Copy** buttons make this easy — paste into your group chat or show a QR code).
4. Open `/bar` on the bar iPad and `/kitchen` on the kitchen device, then **Add to Home Screen** so they run full-screen.
5. Waiters open their link once, **Add to Home Screen**, and they're ready.

> 💡 **Tip:** keep the laptop awake and plugged in. All data lives in `data/orderflow.db` — back it up after the event if you want the numbers.

## Deployment options

OrderFlow is two parts — a **static PWA** (`public/`) and a **Node backend** (`src/`) — that you can run together or split apart. See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for full step-by-step guides.

| Model | Frontend | Backend | Good for |
| --- | --- | --- | --- |
| **Single server** *(recommended)* | served by the backend | one rented VPS (or laptop / Pi) | a real, always-on instance with HTTPS |
| **Hybrid** | **GitHub Pages** (free HTTPS) | cloud (Render / Fly.io / any Docker host) | when you specifically want the static frontend on Pages |

**Single-server (recommended):** one small server (e.g. Hetzner CX22, ~€4–5/mo) runs everything with automatic HTTPS via the included `docker-compose.yml` + `Caddyfile`:

```bash
# on an Ubuntu server with your domain's DNS pointing at it
curl -fsSL https://get.docker.com | sh
git clone https://github.com/mrckurz/order-system.git && cd order-system
cp .env.server.example .env   # set DOMAIN, ADMIN_PASSWORD, SESSION_SECRET, …
docker compose up -d --build
```

Your app is then live at `https://your-domain` with a free Let's Encrypt certificate. Full step-by-step runbook (server, DNS, first login, testing/reset, backups) in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

> ⚠️ **GitHub Pages can't run the backend** — it only hosts static files. The hybrid model keeps the API/database/websockets on a cloud server; ready-made `Dockerfile`, `render.yaml`, `fly.toml` and a Pages workflow are included.

## Configuration

All configuration is via `.env` (see [.env.example](.env.example) for the full list):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `PUBLIC_URL` | `http://localhost:3000` | Base URL used in waiter links |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `changeme` | **Set the password.** Bootstrap admin, created on first start; manage all accounts afterwards in Admin → Team |
| `STATION_USERNAME` / `STATION_PASSWORD` | `station` / _(empty)_ | Optional: if the password is set, a Bar/Kitchen **station** account is created on first start (otherwise create station logins in Team) |
| `SESSION_SECRET` | random | Signs staff sessions; set a fixed value to survive restarts |
| `WAITER_TOKEN_TTL_HOURS` | `24` | Default lifetime of a waiter link |
| `DEFAULT_LANG` | `de` | `de` or `en` |
| `CURRENCY` | `EUR` | ISO currency code for price formatting |
| `PRINTER_TYPE` | `none` | `none` (log/file) or `network` (ESC/POS over TCP) |
| `PRINTER_HOST` / `PRINTER_PORT` | — | Address of the thermal printer (e.g. `9100`) |

### The menu

The initial menu is seeded from [`config/default-menu.json`](config/default-menu.json) on first start. After that, **edit everything in the Admin → Menu screen** — categories, articles, prices and which station (bar/kitchen) each item goes to. To re-seed from the file (wiping the current menu): `npm run seed:reset`.

### Printer

Most network thermal printers (Epson TM-series and compatibles) speak ESC/POS on TCP port `9100`. Set `PRINTER_TYPE=network`, `PRINTER_HOST` and `PRINTER_PORT` and kitchen tickets print automatically. With `PRINTER_TYPE=none`, tickets are logged to the console (and to `./spool` when `SPOOL=1`) so you can develop without hardware.

## Architecture

```
src/
  server.js     # HTTP server + websockets bootstrap
  app.js        # Express app factory (routes, security headers, static) — testable
  routes.js     # REST API (config, login, accounts, waiters, menu, orders, stations, reset)
  auth.js       # accounts (scrypt) + signed session tokens, single-use waiter claims, rate limiting
  orders.js     # order creation, station queues, print triggering
  realtime.js   # Socket.IO rooms (staff vs. waiter)
  printer.js    # ESC/POS rendering + network/console/spool output
  db.js         # SQLite schema (better-sqlite3)
  seed.js       # seed default menu
  config.js     # env-based configuration
public/          # the PWA (vanilla JS, no build step)
config/          # default-menu.json
test/            # node:test integration tests
```

**Stack:** Node.js · Express · Socket.IO · better-sqlite3 · vanilla-JS PWA. No build step, no framework lock-in.

## Development

```bash
npm run dev     # auto-restart on changes
npm test        # run the integration test suite
```

## Contributing

Contributions are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issues](https://github.com/mrckurz/order-system/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

Ideas on the roadmap: QR-code rendering for waiter links, per-waiter / per-article sales reports, payment tracking, table-plan view, more languages.

## License

[MIT](LICENSE) © OrderFlow contributors. Use it for your fire brigade, your club, or your business — no strings attached.
