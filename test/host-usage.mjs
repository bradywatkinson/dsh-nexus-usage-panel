// Host-half test: response shaping and the read pipeline against a mocked
// gateway. Run: node test/host-usage.mjs
import assert from "node:assert/strict"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __testing } from "../lib/index.js"

const { currentPlan, seatUsage, gatewayBase, readUsage, spendSummary, spendDays, savingsModelName, savingsStatus, spendRange, moneyValue, spendStyleValue, readSettings, writeSettings } = __testing

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

// readUsage shapes a full Overview read from the endpoints. The period
// usageCosts read is empty+INCOMPLETE (attribution lag), so readUsage retries
// over a wider window, which carries rows; usageSavings DAY rows also carry
// live per-day spend.
const costRows = [
  { dimensions: { startTime: "2026-10-28T10:00:00Z", model: "accounts/fireworks/models/kimi-k2p5" }, subtotal: { currencyCode: "USD", units: "0", nanos: 5e8 } },
  { dimensions: { startTime: "2026-11-04T01:00:00Z", model: "accounts/fireworks/models/glm-5p3" }, subtotal: { currencyCode: "USD", units: "1", nanos: 0 } },
]
const savingsResponse = {
  basis: { baselineModelId: "claude-opus-5-5" },
  usageSavings: [
    { dimensions: { startDate: { year: 2026, month: 11, day: 3 } }, actualTotalCost: { currencyCode: "USD", units: "4", nanos: 25e7 } },
    { dimensions: { startDate: { year: 2026, month: 11, day: 4 } }, actualTotalCost: { currencyCode: "USD", units: "7", nanos: 5e8 } },
  ],
  total: { actualTotalCost: { currencyCode: "USD", units: "1", nanos: 5e8 }, baselineCost: { currencyCode: "USD", units: "3", nanos: 0 }, estimatedSavings: { currencyCode: "USD", units: "1", nanos: 5e8 }, estimatedSavingsFraction: 0.5, cacheHitRateFraction: 0.25 },
}
const responses = {
  "accounts/acct/nexusPlans?pageSize=10": { nexusPlans: plans },
  "accounts/acct/users/u1/nexusPlanUsage": { monthly: { usedPercent: 2.5, endTime: "2026-12-03T00:00:00Z" }, rollingWindow: { usedPercent: 12.9, endTime: "2026-11-04T05:17:52Z" } },
  "accounts/acct/usageSavings:query": savingsResponse,
}
let costCalls = []
const value = await readUsage({
  key: "k", accountId: "acct", userName: "accounts/acct/users/u1",
  now: new Date("2026-11-04T12:00:00Z"),
  fetch: async (url, init) => {
    const path = url.replace(/^https:\/\/api\.fireworks\.ai\/v1\//, "")
    if (path === "accounts/acct/usageCosts:query") {
      const { startTime } = JSON.parse(init?.body ?? "{}")
      costCalls.push(startTime)
      const widened = startTime.startsWith("2026-10-")
      return { ok: true, json: async () => ({ attributionCompleteness: "INCOMPLETE", rows: widened ? costRows : [], nextPageToken: "" }) }
    }
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
// Milestone 2 reads: the empty period read widened to 30 days, where rows live.
assert.equal(costCalls.length, 2, `period + widened usageCosts reads (got ${costCalls.length})`)
assert.ok(costCalls[0].startsWith("2026-11-03"), `first read starts at the period (${costCalls[0]})`)
assert.ok(costCalls[1].startsWith("2026-10-05"), `second read widens 30 days (${costCalls[1]})`)
assert.equal(value.breakdown.models.length, 2)
assert.equal(value.breakdown.models[0].model, "accounts/fireworks/models/glm-5p3")
assert.equal(value.breakdown.models[0].total, 1)
assert.equal(value.breakdown.completeness, "INCOMPLETE")
assert.equal(value.breakdown.widened, true)
assert.deepEqual(value.breakdown.days.map((d) => d.date), ["2026-10-28", "2026-11-04"])
assert.equal(value.savings.status, "ready")
assert.equal(value.savings.month.saved, 1.5)
assert.equal(value.savings.month.cacheHitFraction, 0.25)
assert.equal(value.savings.baselineLabel, "Claude Opus 5.5")
assert.equal(value.savings.spend.total, 11.75)
assert.deepEqual(value.savings.spend.days.map((d) => d.date), ["2026-11-03", "2026-11-04"])

// A period read that already has rows never triggers the widened retry.
let widenAttempted = false
const attributed = await readUsage({
  key: "k", accountId: "acct", userName: "accounts/acct/users/u1",
  now: new Date("2026-11-04T12:00:00Z"),
  fetch: async (url, init) => {
    const path = url.replace(/^https:\/\/api\.fireworks\.ai\/v1\//, "")
    if (path === "accounts/acct/usageCosts:query") {
      const { startTime } = JSON.parse(init?.body ?? "{}")
      if (!startTime.startsWith("2026-11-03")) widenAttempted = true
      return { ok: true, json: async () => ({ attributionCompleteness: "COMPLETE", rows: costRows.slice(1), nextPageToken: "" }) }
    }
    if (path === "accounts/acct/nexusPlans?pageSize=10") return { ok: true, json: async () => ({ nexusPlans: plans }) }
    if (path === "accounts/acct/users/u1/nexusPlanUsage") return { ok: true, json: async () => ({ monthly: { usedPercent: 2.5 }, rollingWindow: { usedPercent: 1 } }) }
    return { ok: true, json: async () => ({}) }
  },
})
assert.equal(widenAttempted, false, "no widened read when the period has rows")
assert.equal(attributed.breakdown.widened, false)
assert.equal(attributed.breakdown.completeness, "COMPLETE")

// A failing widened read leaves the (empty) period summary, not an error part.
const widenFailed = await readUsage({
  key: "k", accountId: "acct", userName: "accounts/acct/users/u1",
  now: new Date("2026-11-04T12:00:00Z"),
  fetch: async (url, init) => {
    const path = url.replace(/^https:\/\/api\.fireworks\.ai\/v1\//, "")
    if (path === "accounts/acct/usageCosts:query") {
      const { startTime } = JSON.parse(init?.body ?? "{}")
      if (!startTime.startsWith("2026-11-03")) throw new Error("gateway exploded")
      return { ok: true, json: async () => ({ attributionCompleteness: "INCOMPLETE", rows: [], nextPageToken: "" }) }
    }
    if (path === "accounts/acct/nexusPlans?pageSize=10") return { ok: true, json: async () => ({ nexusPlans: plans }) }
    if (path === "accounts/acct/users/u1/nexusPlanUsage") return { ok: true, json: async () => ({ monthly: { usedPercent: 2.5 }, rollingWindow: { usedPercent: 1 } }) }
    return { ok: true, json: async () => ({}) }
  },
})
assert.equal(widenFailed.breakdown.error, undefined, "widened-read failure keeps the empty period summary")
assert.deepEqual(widenFailed.breakdown.models, [])
assert.equal(widenFailed.breakdown.widened, false)

// Pure shapers
assert.equal(moneyValue({ units: "2", nanos: 5e8 }), 2.5)

// The display style: "grid" is the default, unknown values fall back to it.
assert.equal(spendStyleValue("grid"), "grid")
assert.equal(spendStyleValue("table"), "table")
assert.equal(spendStyleValue("bogus"), "grid")
assert.equal(spendStyleValue(undefined), "grid")
assert.equal(spendStyleValue(null), "grid")

// Display settings persist to disk; a missing or malformed file answers the default.
const settingsPath = join(tmpdir(), `nexus-usage-panel-test-${process.pid}.json`)
await writeSettings({ spendStyle: "table" }, settingsPath)
assert.deepEqual(await readSettings(settingsPath), { spendStyle: "table" })
await writeSettings({ spendStyle: spendStyleValue("nonsense") }, settingsPath)
assert.deepEqual(await readSettings(settingsPath), { spendStyle: "grid" })
await unlink(settingsPath)
assert.deepEqual(await readSettings(settingsPath), { spendStyle: "grid" }, "missing settings file answers the grid default")
assert.equal(moneyValue(null), 0)
assert.equal(spendSummary([]).models.length, 0)
assert.deepEqual(spendDays([]), { currency: "USD", total: 0, days: [] })
assert.equal(spendDays(null).days.length, 0)
assert.deepEqual(spendDays(savingsResponse.usageSavings).days, [
  { date: "2026-11-03", total: 4.25 },
  { date: "2026-11-04", total: 7.5 },
])
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
