# Security Policy

OrderFlow handles live orders at events, so a few security properties are
intentional and should be preserved by any contribution.

## Threat model & design

OrderFlow is designed to run on a **trusted local network** (the event WiFi), not
exposed directly to the public internet. Within that network it nonetheless
defends against unauthorized order manipulation:

- **Two separate staff credentials.**
  - `ADMIN_PASSWORD` unlocks the full Admin screen (menu, waiters, *all orders*) — intended for the organizer only.
  - `STATION_PASSWORD` unlocks only the Bar/Kitchen displays for helpers. Station staff **cannot** view or use the admin overview.
- **Single-use, device-bound waiter links.** A waiter link can be *claimed* exactly
  once. The first device to open it receives a private session token; the link is
  then dead and cannot be reused or shared. Lost a phone? The admin issues a fresh
  link, which invalidates the old session.
- **Expiring sessions.** Waiter links/sessions expire after a configurable time and
  can be revoked instantly from the Admin screen.
- **Least privilege per role.** Waiters can only create orders and see their own;
  only staff can mark orders done; only the admin can manage the menu and waiters.
- **Rate-limited authentication** on login and link-claim endpoints to slow brute force.
- **Hardened HTTP headers** (CSP, `X-Frame-Options`, `X-Content-Type-Options`, etc.).
- **Signed, stateless staff tokens** (HMAC-SHA256) using `SESSION_SECRET`.

## Your responsibilities when deploying

- **Set a strong `ADMIN_PASSWORD`** (and `STATION_PASSWORD`) — never ship `changeme`.
- **Set a fixed `SESSION_SECRET`** so sessions survive restarts and can't be forged.
- **Do not expose the server to the public internet.** If you must, put it behind a
  TLS-terminating reverse proxy (HTTPS) and a firewall. PWAs and secure cookies
  require HTTPS off-LAN.
- Keep the laptop physically secured — anyone with the Admin screen open has full control.

## Reporting a vulnerability

Please report security issues **privately**:

- Use **GitHub Security Advisories** (“Report a vulnerability” on the Security tab), or
- email the maintainer listed on the GitHub profile.

Please do **not** open a public issue. We'll acknowledge within a reasonable time,
work with you on a fix, and credit you (unless you prefer to stay anonymous).

## Supported versions

This is pre-1.0 software; the latest `main` receives fixes. Pin a commit for events.
