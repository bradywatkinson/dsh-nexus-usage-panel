# AGENTS.md

DSH Web GUI plugin that mirrors the Fireworks Nexus desktop app's usage card as a "Nexus Usage" settings page. The full product contract, install paths, and screenshots live in [README.md](README.md); this file carries only standing orders.

## Layout

- [lib/index.js](lib/index.js) — host half: a cordis plugin (Node builtins only) that reads the Fireworks API and serves `GET /api/dsh-nexus-usage/usage`.
- [lib/client.js](lib/client.js) — client half: a browser bundle that renders the dashboard card into the `settings.section` slot.
- [cordis.patch.yml](cordis.patch.yml) — the bundle row that mounts the plugin.
- [docs/research-api.md](docs/research-api.md) — the endpoint map for Fireworks' private Nexus REST API.
- [docs/milestone-2-schema.md](docs/milestone-2-schema.md) — verified `usageCosts:query` / `usageSavings:query` request and response constraints.
- [market/index.json](market/index.json) — the custom plugin-market index (format 1).
- [test/](test) — plain `node:assert` scripts; there is no test framework.

## Standing orders

- Run `npm test` before finishing any change. Each test file is a standalone `node:assert/strict` script wired into the `test` script in [package.json](package.json); add new files there too.
- `lib/index.js` uses Node builtins only and has zero runtime dependencies. `lib/client.js` may require only `react`, `react/jsx-runtime`, and the `@deepseek-ai/dsh-client-*` modules listed under `dsh.client.inject` in [package.json](package.json).
- The Nexus keychain key (service `FireworksAI`, account `fireworks-api-key`) never leaves the host process: never log it, never return it in an API response, and sanitize gateway errors before they reach the client.
- The client bundle must never contain secret material. [test/client-smoke.mjs](test/client-smoke.mjs) enforces this by asserting `lib/client.js` matches no `Bearer|keychain|find-generic-password`.
- Never call the live Fireworks gateway from tests. Exercise the host half through the `__testing` exports of [lib/index.js](lib/index.js) with an injected `fetch`, as [test/host-usage.mjs](test/host-usage.mjs) does.
- `readUsage` fails per part: plan, seat, breakdown, and savings each resolve to either data or an `error` field so one failing read never removes the others from the response. Preserve this when touching the read pipeline.
- Keep [test/client-render.mjs](test/client-render.mjs) green: it evaluates the client bundle with stubbed globals and catches render-time `ReferenceError`s that a syntax check cannot, so new render-time globals (`fetch`, `setInterval`, …) need matching stubs there.
- When Fireworks endpoint semantics change, update [docs/research-api.md](docs/research-api.md) or [docs/milestone-2-schema.md](docs/milestone-2-schema.md) in the same change; those files are the API source of truth, and the schemas there were verified live against the gateway.
- On release, run `npm run release -- <major|minor|patch> "<release message>"` ([scripts/release.mjs](scripts/release.mjs)): it runs the test suite, bumps `version` in [package.json](package.json), commits as `<version>: <message>`, tags `v<version>`, prepends the pinned entry (release commit sha and dsh engines range) to `versions` in [market/index.json](market/index.json), and makes the `market index: <version> default` commit. `--push` publishes; `--engines` overrides the dsh range (default: the previous entry's).
