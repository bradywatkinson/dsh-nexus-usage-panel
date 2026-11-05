// Client render test: evaluate the bundle with stubbed window/require, drive
// apply() through a fake slots ledger, and render the registered component
// with a fake fetch. Walks the element tree and asserts the dashboard text.
// This catches render-time ReferenceErrors (e.g. misnamed JSX runtime) that a
// syntax check cannot.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(here, "..", "lib", "client.js"), "utf8")

// ---- stubs ----------------------------------------------------------------

const USAGE = {
  ok: true,
  checkedAt: "2026-11-04T00:00:00Z",
  plan: { tier: "pro", state: "ACTIVE", periodStart: "2026-11-03T00:00:00Z", periodEnd: "2026-12-03T00:00:00Z" },
  planError: null,
  seat: {
    monthly: { usedPercent: 2.57, startTime: "2026-11-03T00:00:00Z", endTime: "2026-12-03T00:00:00Z" },
    session: { usedPercent: 12.86, startTime: "2026-11-04T00:17:52Z", endTime: "2026-11-04T05:17:52Z" },
  },
  seatError: null,
  breakdown: {
    currency: "USD", total: 1.5, completeness: "COMPLETE",
    models: [{ model: "accounts/fireworks/models/glm-5p3", total: 1 }, { model: "accounts/fireworks/models/kimi-k2p5", total: 0.5 }],
    days: [],
  },
  savings: { status: "ready", baselineLabel: "Claude Opus 5.5", month: { saved: 6.64, savedFraction: 0.67, cacheHitFraction: 0.95, currency: "USD" }, spend: { currency: "USD", total: 11.75, days: [{ date: "2026-11-03", total: 4.25 }, { date: "2026-11-04", total: 7.5 }] } },
}

globalThis.fetch = async (url) => {
  assert.ok(String(url).includes("/api/dsh-nexus-usage/usage"), `unexpected fetch ${url}`)
  return { json: async () => USAGE }
}
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

let rerender = null
let stateSlot = undefined
let effectRan = false

const fakeReact = {
  useState(init) {
    if (stateSlot === undefined) stateSlot = typeof init === "function" ? init() : init
    return [stateSlot, (v) => { stateSlot = typeof v === "function" ? v(stateSlot) : v; rerender?.() }]
  },
  useEffect(fn) {
    if (!effectRan) { effectRan = true; fn() }
  },
}

const fakeJsx = { jsx: (type, props) => ({ type, props: props ?? {} }), jsxs: (type, props) => ({ type, props: props ?? {} }) }

const fakeRequire = (name) => {
  if (name === "react") return fakeReact
  if (name === "react/jsx-runtime") return fakeJsx
  throw new Error(`unexpected require: ${name}`)
}

// ---- evaluate the bundle ---------------------------------------------------

let captured = null
const window = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
new Function("window", source)(window)
assert.ok(captured, "bundle registered with the ModuleLoader")
assert.equal(captured.id, "dsh-nexus-usage-panel")

const mod = captured.factory(fakeRequire)
assert.equal(typeof mod.apply, "function")
assert.deepEqual(mod.inject, ["slots"])

// ---- drive apply() through a fake slots ledger -----------------------------

let Component = null
const ctx = {
  slots: {
    inject(name, fn) {
      assert.equal(name, "settings.section")
      fn()
    },
    register(props, component) {
      assert.equal(props.name, "settings.section")
      assert.equal(props.id, "dsh-nexus-usage-panel")
      Component = component
    },
  },
}
mod.apply(ctx)
assert.ok(Component, "a component was registered")

// ---- render with the fake fetch -------------------------------------------

let lastTree = null
const render = () => { lastTree = Component({}) }
rerender = render
render()
await new Promise((resolve) => setTimeout(resolve, 20))

const strings = []
const walk = (node, sink = strings) => {
  if (node == null || typeof node === "boolean") return
  if (typeof node === "string" || typeof node === "number") { sink.push(String(node)); return }
  if (Array.isArray(node)) { node.forEach((n) => walk(n, sink)); return }
  if (typeof node === "object" && "props" in node) {
    // Function components render by invocation, as React does.
    if (typeof node.type === "function") { walk(node.type(node.props), sink); return }
    walk(node.props.children, sink)
  }
}
walk(lastTree)
const text = strings.join(" ")

// Meter fill widths must reflect the real fractions (regression: the 0.2.0
// Meter treated 0–1 fractions as 0–100 percents, rendering a 2.6% fill as a
// 0.026%-wide sliver).
const widths = []
const walkWidths = (node) => {
  if (node == null || typeof node === "boolean") return
  if (Array.isArray(node)) { node.forEach(walkWidths); return }
  if (typeof node === "object" && "props" in node) {
    if (typeof node.type === "function") { walkWidths(node.type(node.props)); return }
    const width = node.props?.style?.width
    if (typeof width === "string" && width.endsWith("%") && width !== "100%") widths.push(width)
    walkWidths(node.props.children)
  }
}
walkWidths(lastTree)
assert.ok(widths.includes("2.57%"), `monthly meter fill 2.57% (got: ${widths.join(", ")})`)
assert.ok(widths.includes("12.86%"), `session meter fill 12.86% (got: ${widths.join(", ")})`)
assert.ok(widths.includes("50%"), `second model meter fill 50% (got: ${widths.join(", ")})`)

assert.ok(text.includes("This month"), `monthly header rendered (got: ${text.slice(0, 200)})`)
assert.ok(text.includes("2.6%"), "monthly percent rendered")
assert.ok(text.includes("12.9%") || text.includes("13%"), "session percent rendered")
assert.ok(text.includes("Resets"), "reset text rendered")
assert.ok(text.includes("Pro"), "tier badge rendered")
assert.ok(text.includes("Spend by model"), "breakdown section rendered")
assert.ok(text.includes("accounts/fireworks/models/glm-5p3"), "model row rendered")
assert.ok(text.includes("Daily spend · live"), "live spend trend rendered")
assert.ok(text.includes("$1.50 this period"), "attributed window total rendered")
assert.ok(text.includes("$6.64"), "savings amount rendered")
assert.ok(text.includes("cache hit"), "cache hit rendered")
assert.ok(!text.includes("undefined"), "no undefined leaked into text")

// Second pass: attribution still pending (INCOMPLETE, no rows) → the panel
// keeps the section alive with the pending note and the live spend trend.
stateSlot = { loading: false, error: null, usage: { ...USAGE, breakdown: { currency: "USD", total: 0, models: [], days: [], completeness: "INCOMPLETE", widened: false } } }
rerender()
const pendingStrings = []
walk(lastTree, pendingStrings)
const pendingText = pendingStrings.join(" ")
assert.ok(pendingText.includes("Model attribution pending"), `pending note rendered (got: ${pendingText.slice(0, 300)})`)
assert.ok(pendingText.includes("$11.75 this month · live"), "live spend total labeled while pending")
assert.ok(pendingText.includes("Daily spend · live"), "live spend trend still rendered while pending")
assert.ok(!pendingText.includes("undefined"), "no undefined leaked into pending text")

// ---- cache behavior ---------------------------------------------------------
// Reopening the settings page remounts the card; with a cached snapshot it
// must paint instantly (no "Loading" flash), show the updating indicator while
// a background refresh runs, and clear it when the refresh lands.
let fetchCount = 0
const baseFetch = globalThis.fetch
globalThis.fetch = async (url) => { fetchCount += 1; return baseFetch(url) }

stateSlot = undefined
effectRan = false
mod.__testing.setUsageCache(USAGE, Date.now() - 10 * 60_000) // 10 min old → stale
render()
const instantStrings = []
walk(lastTree, instantStrings)
const instantText = instantStrings.join(" ")
assert.ok(instantText.includes("This month"), `cached card painted instantly (got: ${instantText.slice(0, 200)})`)
assert.ok(instantText.includes("Updating"), "updating indicator shown during background refresh")
assert.ok(!instantText.includes("Loading Nexus usage"), "no loading flash over cached data")
assert.ok(instantText.includes("2.6%"), "cached data actually rendered")

await new Promise((resolve) => setTimeout(resolve, 20))
const refreshedStrings = []
walk(lastTree, refreshedStrings)
const refreshedText = refreshedStrings.join(" ")
assert.ok(refreshedText.includes("This month"), "card still rendered after background refresh")
assert.ok(!refreshedText.includes("Updating"), "updating indicator cleared once refresh lands")
assert.ok(!refreshedText.includes("Loading Nexus usage"), "no loading state after refresh")

// A cache fetched moments ago is fresh: the refetch is skipped entirely.
stateSlot = undefined
effectRan = false
const fetchesBefore = fetchCount
mod.__testing.setUsageCache(USAGE, Date.now())
render()
await new Promise((resolve) => setTimeout(resolve, 20))
assert.equal(fetchCount, fetchesBefore, "fresh cache skips the background refetch")
const freshStrings = []
walk(lastTree, freshStrings)
assert.ok(!freshStrings.join(" ").includes("Updating"), "no indicator when nothing is fetching")

mod.__testing.clearUsageCache()
globalThis.fetch = baseFetch

console.log("client-render: ok")
console.log("rendered text:", text.slice(0, 300))
