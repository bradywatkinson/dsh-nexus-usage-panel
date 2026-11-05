// Release pipeline unit tests: the pure helpers in scripts/release.mjs.
// Guards the release mechanics (semver bumps, remote normalization, market
// entry shape) so a bad release can't be scripted by accident.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { bumpVersion, buildMarketEntry, normalizeRemote, parseVersion, prependMarketVersion } from "../scripts/release.mjs"

const here = dirname(fileURLToPath(import.meta.url))

// ---- parseVersion / bumpVersion --------------------------------------------

assert.deepEqual(parseVersion("0.3.0"), { major: 0, minor: 3, patch: 0 })
assert.throws(() => parseVersion("0.3"), "two-part versions rejected")
assert.throws(() => parseVersion("0.3.0-rc.1"), "prerelease tags rejected (releases are stable triples)")
assert.throws(() => parseVersion("latest"), "garbage rejected")

assert.equal(bumpVersion("0.3.0", "patch"), "0.3.1")
assert.equal(bumpVersion("0.3.0", "minor"), "0.4.0")
assert.equal(bumpVersion("0.3.0", "major"), "1.0.0")
assert.equal(bumpVersion("0.3.9", "patch"), "0.3.10")
assert.throws(() => bumpVersion("0.3.0", "beta"), "unknown kinds rejected")

// ---- normalizeRemote -------------------------------------------------------

assert.equal(normalizeRemote("git@github.com:bradywatkinson/dsh-nexus-usage-panel.git"),
	"https://github.com/bradywatkinson/dsh-nexus-usage-panel")
assert.equal(normalizeRemote("ssh://git@github.com/bradywatkinson/dsh-nexus-usage-panel.git"),
	"https://github.com/bradywatkinson/dsh-nexus-usage-panel")
assert.equal(normalizeRemote("https://github.com/bradywatkinson/dsh-nexus-usage-panel.git"),
	"https://github.com/bradywatkinson/dsh-nexus-usage-panel")

// ---- buildMarketEntry: key-for-key shape match with a real entry -----------

const market = JSON.parse(await readFile(join(here, "..", "market", "index.json"), "utf8"))
const released = market.plugins[0].versions[0]
const entry = buildMarketEntry({
	version: "9.9.9", commit: "abc123", timestamp: 1700000000,
	sourceUrl: "https://github.com/bradywatkinson/dsh-nexus-usage-panel", enginesDsh: ">=0.1.1-rc.2 <0.3.0",
})
assert.deepEqual(Object.keys(entry), Object.keys(released), "entry keys match the released shape")
assert.deepEqual(Object.keys(entry.source), Object.keys(released.source), "source keys match the released shape")
assert.deepEqual(Object.keys(entry.engines), Object.keys(released.engines), "engines keys match the released shape")

// ---- prependMarketVersion --------------------------------------------------

const withEntry = prependMarketVersion(market, "dsh-nexus-usage-panel", entry)
assert.equal(withEntry.plugins[0].versions[0].version, "9.9.9", "new entry lands first")
assert.equal(withEntry.plugins[0].versions[1].version, released.version, "prior entries preserved")
assert.equal(market.plugins[0].versions[0].version, released.version, "input market untouched")
assert.throws(() => prependMarketVersion(market, "no-such-plugin", entry), "unknown plugin rejected")

// Real-shape regression on the checked-in file itself: every version entry
// must carry version/publishTimestamp/source.commit/engines.dsh.
for (const version of market.plugins[0].versions) {
	assert.ok(Number.isInteger(version.publishTimestamp), `${version.version}: publishTimestamp is epoch seconds`)
	assert.match(version.source.commit, /^[0-9a-f]{40}$/, `${version.version}: source.commit is a full sha`)
	assert.ok(version.engines?.dsh, `${version.version}: engines.dsh present`)
}

console.log("release: ok")
