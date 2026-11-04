// Host-half test: response shaping and the read pipeline against a mocked
// gateway. Run: node test/host-usage.mjs
import assert from "node:assert/strict"
import { __testing } from "../lib/index.js"

const { currentPlan, seatUsage, gatewayBase, readUsage, spendSummary, savingsModelName, savingsStatus, spendRange, moneyValue } = __testing

// currentPlan picks the non-ended plan and maps tier names.
const plans = [
  { tier: "PRO", state: "ENDED" },
  { tier: "PRO", state: "ACTIVE", currentPeriodStartTime: "2026-11-03T00:00:00Z", currentPeriodEndTime: "2026-12-03T00:00:00Z" },
]
const plan = currentPlan(plans)
assert.equal(plan.tier, "pro")
assert.equal(plan.periodEnd, "2026-12-03T00:00:00Z")
assert.equal(currentPlan([{ tier: "PRO", state: "ENDED" }]), null)

// seatUsage maps monthly + rollingWindow percents.
const seat = seatUsage({ monthly: { usedPercent: 2.573, startTime: "a", endTime: "b" }, rollingWindow: { usedPercent: 12.8, startTime: "c", endTime: "d" } })
assert.equal(seat.monthly.usedPercent, 2.573)
assert.equal(seat.session.endTime, "d")
assert.equal(seatUsage(null), null)
assert.equal(seatUsage({ rollingWindow: { usedPercent: 1 } }), null)

// gatewayBase honors the override and strips trailing slashes.
assert.equal(gatewayBase({}), "https://api.fireworks.ai")
assert.equal(gatewayBase({ NEXUS_GATEWAY_URL: "http://localhost:8080/" }), "http://localhost:8080")

// readUsage shapes a full Overview read from the three endpoints.
const responses = {
  "accounts/acct/nexusPlans?pageSize=10": { nexusPlans: plans },
  "accounts/acct/users/u1/nexusPlanUsage": { monthly: { usedPercent: 2.5, endTime: "2026-12-03T00:00:00Z" }, rollingWindow: { usedPercent: 12.9, endTime: "2026-11-04T05:17:52Z" } },
  "accounts/acct/usageCosts:query": {
    attributionCompleteness: "COMPLETE",
    rows: [
      { dimensions: { startTime: "2026-11-03T10:00:00Z", model: "accounts/fireworks/models/kimi-k2p5" }, subtotal: { currencyCode: "USD", units: "0", nanos: 5e8 } },
      { dimensions: { startTime: "2026-11-04T01:00:00Z", model: "accounts/fireworks/models/glm-5p3" }, subtotal: { currencyCode: "USD", units: "1", nanos: 0 } },
    ],
    nextPageToken: "",
  },
  "accounts/acct/usageSavings:query": {
    basis: { baselineModelId: "claude-opus-5-5" },
    total: { actualTotalCost: { currencyCode: "USD", units: "1", nanos: 5e8 }, baselineCost: { currencyCode: "USD", units: "3", nanos: 0 }, estimatedSavings: { currencyCode: "USD", units: "1", nanos: 5e8 }, estimatedSavingsFraction: 0.5, cacheHitRateFraction: 0.25 },
  },
}
const value = await readUsage({
  key: "k", accountId: "acct", userName: "accounts/acct/users/u1",
  now: new Date("2026-11-04T12:00:00Z"),
  fetch: async (url) => {
    const path = url.replace(/^https:\/\/api\.fireworks\.ai\/v1\//, "")
    const body = responses[path]
    if (!body) throw new Error(`unexpected path ${path}`)
    return { ok: true, json: async () => body }
  },
})
assert.equal(value.ok, true)
assert.equal(value.plan.tier, "pro")
assert.equal(value.seat.monthly.usedPercent, 2.5)
assert.equal(value.seat.session.usedPercent, 12.9)
assert.equal(value.planError, null)
assert.equal(value.seatError, null)
// Milestone 2 reads
assert.equal(value.breakdown.models.length, 2)
assert.equal(value.breakdown.models[0].model, "accounts/fireworks/models/glm-5p3")
assert.equal(value.breakdown.models[0].total, 1)
assert.equal(value.breakdown.completeness, "COMPLETE")
assert.deepEqual(value.breakdown.days.map((d) => d.date), ["2026-11-03", "2026-11-04"])
assert.equal(value.savings.status, "ready")
assert.equal(value.savings.month.saved, 1.5)
assert.equal(value.savings.month.cacheHitFraction, 0.25)
assert.equal(value.savings.baselineLabel, "Claude Opus 5.5")

// Pure shapers
assert.equal(moneyValue({ units: "2", nanos: 5e8 }), 2.5)
assert.equal(moneyValue(null), 0)
assert.equal(spendSummary([]).models.length, 0)
assert.equal(savingsModelName("glm-5p3"), "GLM 5.3")
assert.equal(savingsStatus({ status: 403 }), "admin-only")
assert.equal(savingsStatus({ code: 9 }), "not-enabled")
assert.equal(savingsStatus({}), "error")
// spendRange uses the plan period when underway
const range = spendRange(plan, new Date("2026-11-04T00:00:00Z"))
assert.equal(range.start.toISOString(), "2026-11-03T00:00:00.000Z")

// A failing plan read leaves seat as null and records the error, sanitized.
const failed = await readUsage({
  key: "k", accountId: "acct", userName: "accounts/acct/users/u1",
  fetch: async () => ({ ok: false, status: 401, json: async () => ({ code: 16 }) }),
})
assert.equal(failed.plan.error, "Fireworks didn't accept this key for usage.")
assert.equal(failed.seat, null)

// Enterprise tiers skip the seat read entirely.
const enterprise = await readUsage({
  key: "k", accountId: "acct", userName: "accounts/acct/users/u1",
  fetch: async (url) => url.endsWith("nexusPlans?pageSize=10")
    ? { ok: true, json: async () => ({ nexusPlans: [{ tier: "ENTERPRISE", state: "ACTIVE" }] }) }
    : { ok: false, status: 500, json: async () => ({}) },
})
assert.equal(enterprise.plan.tier, "enterprise")
assert.equal(enterprise.seat, null)

console.log("host-usage: ok")
