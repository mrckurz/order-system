# Contributing to OrderFlow

Thanks for taking the time to contribute! OrderFlow is a community project and we
welcome issues, ideas, translations and pull requests of any size.

## Ways to help

- 🐛 **Report bugs** — open an issue with steps to reproduce.
- 💡 **Suggest features** — open a feature request; describe the event scenario it helps.
- 🌍 **Translate** — add a language to `public/js/common.js` (`STR`) and the seed labels.
- 🧑‍💻 **Code** — pick up a [good first issue](https://github.com/mrckurz/order-system/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) or propose your own.

## Development setup

```bash
npm install
cp .env.example .env
npm run icons
npm run dev      # auto-restarting server on http://localhost:3000
npm test         # integration tests (node:test)
```

No build step is required — the frontend in `public/` is plain ES modules.

## Guidelines

- **Keep dependencies minimal.** This must run on a laptop or a Raspberry Pi at an
  event with no internet. Prefer the standard library and the existing stack.
- **Match the surrounding style.** 2-space indent, ES modules, small focused functions.
- **Security matters.** Order data must not be manipulable by unauthenticated users.
  Don't weaken the auth/role model without discussion (see [SECURITY.md](SECURITY.md)).
- **Add or update tests** in `test/` for behaviour changes; `npm test` must pass.
- **One logical change per PR.** Describe the event/use-case it improves.

## Pull request process

1. Fork and create a branch off `main`.
2. Make your change, add tests, run `npm test`.
3. Open a PR using the template; link any related issue.
4. A maintainer will review. Be patient — this is a volunteer project. 🙂

## Reporting security issues

Please **do not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
