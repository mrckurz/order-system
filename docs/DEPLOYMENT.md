# Deployment

OrderFlow is one Node app that serves **both** the PWA frontend and the API.
The recommended production setup is a single small rented server with automatic
HTTPS — no laptop, no GitHub Pages, no CORS.

- **[Option A — Self-hosted single server](#option-a--self-hosted-single-server-recommended)** ← recommended
- [Option B — Hybrid: PWA on GitHub Pages + cloud API](#option-b--hybrid-pwa-on-github-pages--cloud-api)

---

## Production checklist

- [ ] A small server (1–2 vCPU, 1–4 GB RAM is plenty).
- [ ] A domain/subdomain with a DNS **A record** pointing at the server IP.
- [ ] Strong bootstrap `ADMIN_PASSWORD` and a fixed `SESSION_SECRET`.
- [ ] HTTPS (handled automatically by Caddy below).
- [ ] A backup of `data/orderflow.db` after the event.

---

## Option A — Self-hosted single server (recommended)

This runs OrderFlow + Caddy (automatic Let's Encrypt HTTPS) via Docker Compose.

### 1. Rent a server

**Hetzner Cloud** is a great fit (EU/GDPR, cheap, hourly billing):

| Plan | Specs | ~Price | Notes |
| --- | --- | --- | --- |
| **CX22** *(recommended)* | 2 vCPU x86, 4 GB RAM, 40 GB SSD | ~€4–5/mo | safe, compatible default |
| CAX11 *(budget)* | 2 vCPU ARM, 4 GB RAM, 40 GB SSD | ~€3.8/mo | works just as well |

Create the server with **Ubuntu 24.04**, add your SSH key, pick a German region
(Nuremberg/Falkenstein). You can destroy it after the event to stop paying.

Other providers (Netcup, DigitalOcean, Vultr, …) work the same way — any host
that runs Docker.

### 2. Point your domain at it

Register a domain (a few €/year) and create a DNS **A record**:

```
order.example.at.   A   <your-server-ip>
```

Wait until `ping order.example.at` resolves to your server before continuing
(DNS can take a few minutes).

### 3. Install Docker on the server

```bash
ssh root@<your-server-ip>
curl -fsSL https://get.docker.com | sh
```

### 4. Deploy OrderFlow

```bash
git clone https://github.com/mrckurz/order-system.git
cd order-system
cp .env.server.example .env
nano .env            # set DOMAIN, ACME_EMAIL, PUBLIC_URL, ADMIN_PASSWORD, SESSION_SECRET
docker compose up -d --build
```

That's it. Caddy fetches a TLS certificate automatically and your app is live at
`https://order.example.at`. Check it:

```bash
docker compose ps
docker compose logs -f app
```

### 5. First run

1. Open `https://order.example.at/admin`, log in with the bootstrap
   `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. Go to **Team** → change your password, add more **Admins** and **Bar/Kitchen
   (station)** accounts as needed.
3. Go to **Menu** → adjust articles/prices (seeded from last year by default).
4. Open `/bar` and `/kitchen` on the station devices and log in with a station account.
5. Go to **Waiters** → create one per helper and share each single-use link.

### 6. Test before the event, then reset

You can test the whole flow on the live server. When you're ready to go live,
open **Admin → Team → ⚠️ Reset data** and click **Delete orders** (optionally
**+ waiters**) to start clean. Your menu and accounts stay intact.

### 7. Updates & backups

```bash
# update to the latest version
cd order-system && git pull && docker compose up -d --build

# back up the database (orders, menu, accounts, waiters)
docker compose cp app:/data/orderflow.db ./orderflow-backup.db
```

> The database lives in the `orderflow_data` Docker volume, so it survives
> restarts and rebuilds.

### Without Docker?

You can also run it directly with Node ≥ 20 + a process manager (`pm2`/systemd)
behind any reverse proxy that provides HTTPS. Set the same env vars from
`.env.server.example` (minus the Caddy ones) and run `npm ci && npm start`.

---

## Option B — Hybrid: PWA on GitHub Pages + cloud API

Use this only if you specifically want the frontend on GitHub Pages (free static
hosting) and the backend elsewhere. The backend (Render/Fly/any Docker host) must
set `CORS_ORIGIN` to your Pages origin and `FRONTEND_URL` to your Pages app URL;
the Pages build is told the API address via the `ORDERFLOW_API_URL` Actions
variable. See `render.yaml`, `fly.toml`, the Pages workflow, and `scripts/build-pages.js`.

> ⚠️ GitHub Pages can only host static files — it cannot run the API/database/websockets.

---

## Accounts & roles

- **admin** — full control: orders overview, menu, waiters, and the **Team**
  screen (create/edit/disable other admins and station accounts).
- **station** — Bar/Kitchen displays only; cannot open the admin overview.
- **waiters** — no password; each opens a single-use, device-bound, expiring link.

The first admin is created from `ADMIN_USERNAME`/`ADMIN_PASSWORD` on first start;
everything after that is managed in the UI. You can never lock yourself out — the
last active admin cannot be deleted or demoted.

## Troubleshooting

- **Certificate not issued** → DNS A record must point at the server and ports
  80/443 must be open (Hetzner firewall/Cloud Firewall). Check `docker compose logs caddy`.
- **Can't log in after restart** → set a fixed `SESSION_SECRET` (otherwise tokens
  are invalidated on every restart).
- **Forgot the admin password** → create a new admin via env on a fresh DB, or
  reset it in SQLite; see the repo issues/discussions for help.
