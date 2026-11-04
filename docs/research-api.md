## Goal

Determine whether a public or private API drives https://nexus.fireworks.ai/ and the Nexus desktop app's usage display ("This month — 2% used · Resets Thu, Dec 3", "8% Current session · Resets at 9:17 PM").

## Findings (2026-11-03)

Yes — a private (undocumented but real) REST API on Fireworks' public gateway drives the Nexus Overview/dashboard. Source: `@Applications/Nexus.app/Contents/Resources/node/signin/usage.mjs` (shipped read-only usage reader, v0.1.3 of the desktop app, CLI v0.11.0).

- **Base URL**: `https://api.fireworks.ai/v1/` (overridable via `NEXUS_GATEWAY_URL`)
- **Auth**: `Authorization: Bearer <key>` — a Nexus-minted key stored in the macOS Keychain (per-machine; `~/.nexus/minted-key.json` records `keyId`, `userName`, `displayName`, `createdAt`; `~/.nexus/key-storage.json` says the secret lives in "keychain")
- **Endpoints**:
  - `GET accounts/{accountId}/nexusPlans?pageSize=10` → active plan: `tier` (PRO/TEAMS/ENTERPRISE), `state`, `currentPeriodStartTime`, `currentPeriodEndTime`
  - `GET accounts/{accountId}/users/{userId}/nexusPlanUsage` → `{ monthly: { usedPercent, startTime, endTime }, rollingWindow: { usedPercent, startTime, endTime } }` — **this is the "This month" and "Current session · Resets at …" card data** (rollingWindow = 5-hour session window)
  - `POST accounts/{accountId}/usageCosts:query` body `{ startTime, endTime, scope: "SELF", groupBy: ["DAY","MODEL"] }` → per-day, per-model spend rows (`subtotal` as google.type.Money) — **Milestone 2's model/token breakdown source**
  - `POST accounts/{accountId}/usageSavings:query` → savings vs baseline model (baseline `claude-opus-5-5`), 403 = admin-only, code 9 = not enabled
  - `GET accounts/{accountId}/users/{userId}/usageLimits` → Enterprise member spend limits
- **Semantics**: "2% used" is `monthly.usedPercent`; session window is `rollingWindow.usedPercent` with `endTime` = reset time. `nexusPlanUsage` exposes **percentages only** — but `usageSavings:query` returns dollar amounts to a SELF member key (verified live 2026-11-04: actual $11.58 vs baseline $22.56, savings $10.98, cache hit 92%); see [milestone-2-schema.md](milestone-2-schema.md). Its per-day rows are current even while `usageCosts:query` attribution is still `INCOMPLETE`, though its per-model split is plan-gated (403).
- **Which model is this session running?** The DSH desktop profile routes via `https://api.fireworks.ai/inference/v1` with model id `auto` ("Nexus Auto") — routing is server-side at Fireworks; the client never learns the routed model. Per-model attribution must come from `usageCosts:query` (Milestone 2).

## Acceptance

- [x] Identify API + auth source
- [x] Document endpoints in repo
- [ ] Verify a live read of `nexusPlanUsage` with the local keychain key (no secret exposure)
