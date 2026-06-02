# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
