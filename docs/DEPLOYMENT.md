# Deployment

OrderFlow has two parts:

1. **The PWA frontend** (`public/`) — plain static files.
2. **The backend API** (`src/`) — Node.js + Socket.IO + SQLite.

You can run them **together** (one server serves both) or **split** (frontend on
GitHub Pages, backend in the cloud). Pick the model that fits your event.

> ⚠️ **GitHub Pages cannot run the backend.** Pages only hosts static files. The
> API, database and websockets must run on a real server somewhere.

---

## Production checklist (read first)

- [ ] Strong `ADMIN_PASSWORD` (only you) and `STATION_PASSWORD` (bar/kitchen helpers).
- [ ] A fixed `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- [ ] Backend reachable over **HTTPS** (required for PWA install + secure password entry off-LAN).
- [ ] `CORS_ORIGIN` set to your frontend origin (not `*`) in hybrid mode.
- [ ] A **persistent volume** for the SQLite DB if you can't afford to lose orders on restart.
- [ ] Backend not exposed beyond what you need; keep the admin device physically secure.

---

## Option A — One server (simplest)

Run the whole app on one machine (a laptop at the venue, a VPS, a Raspberry Pi).
The backend serves the PWA too, so there is no CORS or cross-origin setup.

```bash
cp .env.example .env       # set ADMIN_PASSWORD, STATION_PASSWORD, SESSION_SECRET
npm ci && npm run icons
NODE_ENV=production npm start
```

Leave `FRONTEND_URL` empty and `CORS_ORIGIN=*`. Waiter links will use `PUBLIC_URL`.
For a venue laptop, set `PUBLIC_URL=http://<lan-ip>:3000`. Use a process manager
(`pm2`, `systemd`) to keep it running, and a reverse proxy (Caddy/Nginx) if you
want HTTPS on a custom domain.

---

## Option B — Hybrid: PWA on GitHub Pages + backend in the cloud

This is the setup the project is preconfigured for.

### 1. Deploy the backend

Use any host that runs a Node server or a Docker container. Two ready-made configs
are included:

**Render** (`render.yaml`)
1. Push this repo to GitHub.
2. On render.com → **New + → Blueprint** → pick the repo.
3. Set `ADMIN_PASSWORD`, `STATION_PASSWORD`, `CORS_ORIGIN`, `FRONTEND_URL` in the dashboard.
4. Note the service URL, e.g. `https://orderflow-api.onrender.com`.
   > The free plan has an **ephemeral** disk. For a real event, enable the disk
   > block in `render.yaml` (paid) or use Fly.io below.

**Fly.io** (`fly.toml`, with a persistent volume)
```bash
fly launch --no-deploy
fly volumes create orderflow_data --size 1 --region fra
fly secrets set ADMIN_PASSWORD=... STATION_PASSWORD=... \
  SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  CORS_ORIGIN=https://<user>.github.io \
  FRONTEND_URL=https://<user>.github.io/order-system
fly deploy
```

Any Docker host works too — the included `Dockerfile` listens on `$PORT` and stores
the DB at `/data/orderflow.db` (mount a volume at `/data`).

### 2. Point the backend at your frontend

Set these env vars on the backend:

| Variable | Value |
| --- | --- |
| `CORS_ORIGIN` | `https://<user>.github.io` |
| `FRONTEND_URL` | `https://<user>.github.io/order-system` |

`CORS_ORIGIN` is the **origin** (scheme + host) so the browser allows cross-origin
API calls. `FRONTEND_URL` is the full app base used to build waiter links.

### 3. Deploy the frontend to GitHub Pages

1. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables →** add a repository
   **variable** `ORDERFLOW_API_URL` = your backend URL (e.g. `https://orderflow-api.onrender.com`).
3. Push to `main` (or run the **"Deploy PWA to GitHub Pages"** workflow manually).

The workflow runs `npm run build:pages`, which:
- writes `config.js` with your `apiBase`,
- vendors the Socket.IO browser client locally,
- injects a Content-Security-Policy that allows your API origin,
- adds `.nojekyll` and a `404.html` fallback,
- publishes `dist/` to Pages.

Your app is then at `https://<user>.github.io/order-system/`.

### How admin access works in hybrid mode

The Admin screen is just `admin.html` on Pages, but the **password is verified by the
backend**, never stored in the frontend. You open
`https://<user>.github.io/order-system/admin.html`, enter `ADMIN_PASSWORD`, and the
backend returns a short-lived signed token (HMAC, `SESSION_SECRET`). Bar/Kitchen
helpers use the separate `STATION_PASSWORD` and **cannot** reach the admin overview.
All of this rides on HTTPS (Pages + your HTTPS backend). Logins are rate-limited.

---

## Updating the menu / data

The menu seeds once from `config/default-menu.json`; after that, edit it live in
**Admin → Menu**. To reset to the file: `npm run seed:reset` (wipes the menu).
Back up `data/orderflow.db` after the event to keep your sales numbers.

## Troubleshooting

- **CORS errors in the browser console** → `CORS_ORIGIN` doesn't match the Pages
  origin exactly (scheme + host, no trailing slash, no path).
- **Waiter link 404 on Pages** → make sure links use `…/waiter.html?c=<token>`
  (they do automatically when `FRONTEND_URL` is set on the backend).
- **Realtime not updating** → check the backend allows websockets and `CORS_ORIGIN`
  includes your Pages origin; the screens still work with manual refresh as a fallback.
- **Data disappeared after redeploy** → you're on an ephemeral filesystem; attach a
  persistent volume and set `DB_PATH` to it.
