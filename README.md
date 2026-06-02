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

It's **self-hosted**: run it on a small server you control (a cheap VPS, or even a Raspberry Pi) with automatic HTTPS. No SaaS, no subscription, no external/cloud accounts — the app and its data stay yours.

## How it works

```
 Waiter phones (PWA)              Your self-hosted server                   Stations
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
- 🎪 **Multiple events/festivals** — each event keeps its **own menu, waiters and orders**, stored permanently. One event is "active"; start a new one for next year (optionally copying last year's menu).
- 📊 **Statistics dashboard per event** — total revenue, orders, average order, revenue per waiter, products sold and a per-station breakdown, with **CSV export**.
- ⚙️ **Configurable menu** — categories, articles, prices and stations editable from the Admin screen at runtime.
- 👥 **Accounts & roles** — log in with username + password; create and manage **multiple admins** and **station logins** from the Admin → Team screen (you can't lock out the last admin).
- 👀 **Admin overview** of every order; a one-click **reset** lets you test then start the event clean.
- 🔒 **Security-minded** — hashed passwords (scrypt), role separation (admin vs station), device-bound single-use waiter links, rate-limited logins, hardened HTTP headers. See [SECURITY.md](SECURITY.md).
- 🌍 **i18n** — ships with German and English; default language is configurable.
- 🪶 **Tiny footprint** — SQLite file, a handful of dependencies, runs happily even on a Raspberry Pi.

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
| Admin | `/admin` | You — orders, **Statistik**, menu, waiters, **Team** (admins/stations) and **Feste** (events). Log in with the bootstrap admin account |
| Bar | `/bar` | Bar staff — live drink orders (station account) |
| Kitchen | `/kitchen` | Food counter — live food orders + auto-print (station account) |
| Waiter | `/w/<link>` | Each waiter — single-use link created in Admin |

## Running your event

Once OrderFlow is deployed (see **Deployment** below), set everything up from the Admin screen at `https://your-domain/admin`:

1. Log in with the bootstrap admin account.
2. In **Feste/Events**, name your event (e.g. *Summer Festival 2026*). It becomes the active event — menu, waiters and orders all live under it. Next year, create a new event and optionally copy this year's menu.
3. In **Team**, change your password and add station accounts (Bar/Kitchen) plus any extra admins.
4. In **Menu**, adjust articles and prices.
5. In **Waiters**, create one per helper and share each single-use link (Share/Copy buttons — paste into your group chat or show a QR code).
6. Open `/bar` and `/kitchen` on the station devices (log in with a station account) and **Add to Home Screen** for full-screen.
7. Waiters open their link once, **Add to Home Screen**, and they're ready.

> 💡 Test freely, then **Admin → Team → Reset** (or simply start a fresh event) to go live clean. After the event, review the numbers in **Statistik** and **export CSV** — the data stays stored under that event.

## Deployment options

OrderFlow is two parts — a **static PWA** (`public/`) and a **Node backend** (`src/`) — that you can run together or split apart. See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for full step-by-step guides.

| Model | Frontend | Backend | Good for |
| --- | --- | --- | --- |
| **Single server** *(recommended)* | served by the backend | one small VPS (or a Raspberry Pi) | a real, always-on instance with HTTPS |
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
  routes.js     # REST API (config, login, accounts, events, stats, waiters, menu, orders, stations)
  auth.js       # accounts (scrypt) + signed session tokens, single-use waiter claims, rate limiting
  events.js     # events/festivals: active event, create/copy/activate/archive
  stats.js      # per-event sales statistics + CSV export
  orders.js     # order creation, station queues, print triggering
  realtime.js   # Socket.IO rooms (staff vs. waiter)
  printer.js    # ESC/POS rendering + network/console/spool output
  db.js         # SQLite schema + migrations (better-sqlite3)
  seed.js       # seed default menu into an event
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

Ideas on the roadmap: QR-code rendering for waiter links, payment tracking, table-plan view, more languages, an offline order queue.

## License

[MIT](LICENSE) © OrderFlow contributors. Use it for your fire brigade, your club, or your business — no strings attached.
