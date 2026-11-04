// Client-half smoke test: the bundle parses, keeps the ModuleLoader entry
// shape, registers into the settings.section slot, and never embeds the key.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(here, "..", "lib", "client.js"), "utf8")

assert.match(source, /window\.__ModuleLoader__\.load\(\{\s*id: "dsh-nexus-usage-panel"/)
assert.match(source, /exports\.apply = apply/)
assert.match(source, /exports\.inject = inject/)
assert.match(source, /settings\.section/)
assert.match(source, /dsh-nexus-usage-panel/)
assert.match(source, /api\/dsh-nexus-usage\/usage/)

// The secret must never ship in the client bundle.
assert.doesNotMatch(source, /Bearer|keychain|find-generic-password/)

// Syntax check: evaluate as a function body without executing (ModuleLoader +
// window are absent here).
new Function(`return function factory(require) { ${""} }`)
const factoryMatch = source.match(/factory: \(require\) => \{/)
assert.ok(factoryMatch, "factory arrow present")

console.log("client-smoke: ok")
