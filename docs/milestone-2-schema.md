# Milestone 2 prep: usageCosts / usageSavings introspection (2026-11-03)

Read-only probes of `accounts/{account}/usageCosts:query` and
`accounts/{account}/usageSavings:query` with the local Nexus key (SELF scope).

## usageCosts:query

Request constraints discovered:

- `scope` is **required** and must be set (`SCOPE_UNSPECIFIED` is rejected); `SELF` works for a member key.
- `groupBy` requires **at least one** item.
- Accepted `groupBy` values: `DAY`, `HOUR`, `MODEL`, `API_KEY` (+ `USER`, but **SELF cannot group by USER** — "self_cannot_group_by_user").
- Rejected values (proto enum): `SESSION`, `PROVIDER`, `REQUEST_TYPE`, `ENDPOINT`.

Response shape (verified live):

```jsonc
{
  "attributionCompleteness": "INCOMPLETE",   // billing pipeline lag flag
  "evaluationTime": "2026-11-04T06:20:03.335Z",
  "nextPageToken": "",
  "rows": [
    // { "dimensions": { "startTime": ..., "model": ..., "apiKey"?: ... }, "subtotal": { "currencyCode": "USD", "units": "0", "nanos": 0 } }
  ],
  "subtotal": { "currencyCode": "USD", "units": "0", "nanos": 0 }
}
```

**Early-period behavior**: rows are empty while `attributionCompleteness` is
`INCOMPLETE` — model/spend rows arrive with billing lag, even though
`nexusPlanUsage` already shows a non-zero percent. The desktop app renders
these as zero-spend days.

**No token counts**: rows carry Money subtotals only (no request or token
fields surfaced). Token-level detail is not exposed by this endpoint.

## usageSavings:query

Works with `scope: "SELF"` on a Pro seat (the desktop app's comment said SELF
may be 403 for Pro/Teams — live behavior here is 200):

```jsonc
{
  "basis": { "baselineModelId": "claude-opus-5-5", "baselineProvider": "PROVIDER_ANTHROPIC", "priceVersionIds": ["..."] },
  "nextPageToken": "...",
  "totalSize": ...,                       // number
  "usageSavings": [ /* per-DAY rows when timeDimension: "DAY" */ ],
  "total": {
    "actualTotalCost": "Money",
    "baselineCost": "Money",
    "cacheHitRateFraction": "number",
    "dimensions": { ... },
    "estimatedSavings": "Money",
    "estimatedSavingsFraction": "number"
  }
}
```

This gives: actual spend, hypothetical cost at the baseline model price,
estimated savings + fraction, and **cache hit rate** — useful panel additions
for Milestone 2 beyond the per-model breakdown.

## Milestone 2 implications

- Per-model spend breakdown: `groupBy: ["DAY","MODEL"]` (or `["MODEL"]` for a
  period rollup) once attribution completes; per-hour drill-down with `HOUR`.
- Per-API-key attribution possible via `API_KEY` (the DSH host's gateway key
  vs other keys).
- Token volume is not directly exposed; cost is the available proxy. The
  savings endpoint adds cache-hit-rate as a second dimension.
