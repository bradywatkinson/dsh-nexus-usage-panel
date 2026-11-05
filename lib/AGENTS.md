# AGENTS.md

Orders for the two plugin halves in `lib/`. Repo-wide rules live in the [root AGENTS.md](../AGENTS.md).

## lib/index.js — host half

- Indent with two spaces. The cordis entry is `apply(ctx, config)` with `inject = ["webServer"]`; `config.enabled === false` disables the plugin entirely.
- Keep the exported shaping functions (`currentPlan`, `seatUsage`, `spendSummary`, `moneyValue`, `savingsModelName`, `savingsStatus`, `spendRange`, `gatewayBase`, `readNexusIdentity`) pure — no I/O — and expose new ones through `__testing` so [test/host-usage.mjs](../test/host-usage.mjs) can reach them.
- The gateway snapshot is cached for `CACHE_TTL_MS` (60s) with in-flight deduplication; a 401 in a plan or seat response forgets the stored key so the next read re-mints it from the keychain. Keep both behaviors when touching `snapshot` or the usage route.
- Enterprise accounts are never asked for seat usage: Fireworks answers `FAILED_PRECONDITION`, so `readUsage` only calls `nexusPlanUsage` for `pro` and `teams` tiers.

## lib/client.js — client half

- Indent with tabs. This file is a hand-maintained bundle loaded through `window.__ModuleLoader__.load`: no `import` statements; `require` inside the factory, and JSX written as `react_jsx_runtime.jsx`/`jsxs` calls — there is no transpile step for tests.
- [test/client-smoke.mjs](../test/client-smoke.mjs) pins the bundle shape: keep the `window.__ModuleLoader__.load({ id: "dsh-nexus-usage-panel"` entry, the `exports.apply`/`exports.inject` assignment, and the `settings.section` registration verbatim.
- The cordis entry is `apply(ctx)` with `inject = ["slots"]`; the card registers into the `settings.section` slot at `order: 40` and polls `/api/dsh-nexus-usage/usage` every 60s.
- The last successful usage snapshot lives in the module-level `usageCache`: a remount paints cached data instantly (never a "Loading" flash), shows the "⟳ Updating…" header indicator while a background refresh runs, and skips the refetch entirely while the cache is younger than `USAGE_CACHE_TTL_MS` (30s). Failed refreshes keep the cached card on screen. Keep all of this when touching `UsageCard`; [test/client-render.mjs](../test/client-render.mjs) seeds the cache through `exports.__testing`.
- Styling uses the Nexus-dark palette in `COLORS` with `var(--dsw-alias-*)` fallbacks so the card stays legible in either DSH theme; prefer those aliases over hardcoded colors when adding UI.
