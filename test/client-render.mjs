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
  savings: { status: "ready", baselineLabel: "Claude Opus 5.5", month: { saved: 6.64, savedFraction: 0.67, cacheHitFraction: 0.95, currency: "USD" } },
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
    return [stateSlot, (v) => { stateSlot = v; rerender?.() }]
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
const walk = (node) => {
  if (node == null || typeof node === "boolean") return
  if (typeof node === "string" || typeof node === "number") { strings.push(String(node)); return }
  if (Array.isArray(node)) { node.forEach(walk); return }
  if (typeof node === "object" && "props" in node) {
    // Function components render by invocation, as React does.
    if (typeof node.type === "function") { walk(node.type(node.props)); return }
    walk(node.props.children)
  }
}
walk(lastTree)
const text = strings.join(" ")

assert.ok(text.includes("This month"), `monthly header rendered (got: ${text.slice(0, 200)})`)
assert.ok(text.includes("2.6%"), "monthly percent rendered")
assert.ok(text.includes("12.9%") || text.includes("13%"), "session percent rendered")
assert.ok(text.includes("Resets"), "reset text rendered")
assert.ok(text.includes("Pro"), "tier badge rendered")
assert.ok(text.includes("Spend by model"), "breakdown section rendered")
assert.ok(text.includes("accounts/fireworks/models/glm-5p3"), "model row rendered")
assert.ok(text.includes("$6.64"), "savings amount rendered")
assert.ok(text.includes("cache hit"), "cache hit rendered")
assert.ok(!text.includes("undefined"), "no undefined leaked into text")

console.log("client-render: ok")
console.log("rendered text:", text.slice(0, 300))
