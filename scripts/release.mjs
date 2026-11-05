#!/usr/bin/env node
// Git tag-driven release publishing for dsh-nexus-usage-panel.
//
// A release IS a git tag. Bump `version` in package.json inside the change,
// tag the release (`git tag -a v<MAJOR.MINOR.PATCH> -m "<message>"`), then run
// this script to publish the matching market entries. Node builtins only —
// no npm and no dependencies anywhere in the flow:
//
//   node scripts/release.mjs [--dry-run] [--skip-test] [--engines "<range>"]
//
// Steps: run every test/*.mjs directly with node → collect v* tags that have
// no market entry yet (oldest first) → validate each tag (its own commit's
// package.json must declare the tag's version) → prepend the pinned market
// entry (the tag's commit sha, the tag's creation time, the dsh engines
// range) → one "market index: <version> default" commit per tag. Nothing is
// pushed or published anywhere else; `git push --follow-tags` is the publish.
//
// The pure helpers are exported and unit-tested by test/release.mjs.

import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- pure helpers (unit-tested by test/release.mjs) ------------------------

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG_RE = /^v(\d+\.\d+\.\d+)$/;

/** "0.3.0" → { major, minor, patch }; throws on any other shape. */
export function parseVersion(version) {
	const match = VERSION_RE.exec(version);
	if (!match) throw new Error(`unsupported version "${version}": expected MAJOR.MINOR.PATCH`);
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Release tag name → version ("v0.4.0" → "0.4.0"); anything else → null. */
export function tagVersion(tag) {
	const match = TAG_RE.exec(String(tag).trim());
	return match ? match[1] : null;
}

/** "git@host:org/repo.git" | "ssh://git@host/org/repo.git" → "https://host/org/repo". */
export function normalizeRemote(raw) {
	const url = String(raw).trim().replace(/\.git$/, "");
	if (url.startsWith("git@")) {
		const at = url.indexOf(":");
		if (at > 0) return `https://${url.slice(4, at)}/${url.slice(at + 1)}`;
	}
	if (url.startsWith("ssh://git@")) return `https://${url.slice("ssh://git@".length)}`;
	return url;
}

/** One market/index.json versions[] entry, matching the existing entry shape. */
export function buildMarketEntry({ version, commit, timestamp, sourceUrl, enginesDsh }) {
	return {
		version,
		publishTimestamp: timestamp,
		source: { type: "git", url: sourceUrl, commit },
		engines: { dsh: enginesDsh },
	};
}

/** New market object with `entry` prepended to the named plugin's versions. */
export function prependMarketVersion(market, pluginName, entry) {
	const plugins = market.plugins.map((plugin) => plugin.name === pluginName
		? { ...plugin, versions: [entry, ...plugin.versions] }
		: plugin);
	if (plugins.every((plugin) => plugin.name !== pluginName)) {
		throw new Error(`market has no plugin named "${pluginName}"`);
	}
	return { ...market, plugins };
}

// ---- CLI -------------------------------------------------------------------

const usage = 'usage: node scripts/release.mjs [--dry-run] [--skip-test] [--engines "<range>"]';

function parseArgs(argv) {
	const flags = { engines: null, skipTest: false, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") flags.dryRun = true;
		else if (arg === "--skip-test") flags.skipTest = true;
		else if (arg === "--engines") flags.engines = argv[++i];
		else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}\n${usage}`);
		else throw new Error(`unexpected argument ${arg}\n${usage}`);
	}
	return flags;
}

/** Run a command, capture stdout; `inherit` streams test output live. */
function run(command, args, { inherit = false } = {}) {
	const result = execFileSync(command, args, {
		cwd: root, encoding: "utf8", stdio: inherit ? "inherit" : ["ignore", "pipe", "inherit"],
	});
	return inherit ? "" : result.trim();
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));

	const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const marketPath = join(root, "market/index.json");
	const market = JSON.parse(await readFile(marketPath, "utf8"));
	const plugin = market.plugins.find((p) => p.name === pkg.name);
	if (!plugin) throw new Error(`market has no plugin named "${pkg.name}"`);
	const enginesDsh = opts.engines ?? plugin.versions[0]?.engines?.dsh;

	if (!opts.skipTest) {
		// Node directly: the release flow has no npm dependency.
		const tests = (await readdir(join(root, "test"))).filter((f) => f.endsWith(".mjs")).sort();
		if (!tests.length) throw new Error("no test files found under test/");
		for (const test of tests) run(process.execPath, [join(root, "test", test)], { inherit: true });
	}

	const known = new Set(plugin.versions.map((v) => v.version));
	const tags = run("git", ["tag", "-l", "v*", "--sort=v:refname"]).split("\n").filter(Boolean);
	const pending = [];
	for (const tag of tags) {
		const version = tagVersion(tag);
		if (!version) { console.log(`market: skipping ${tag} — not a v<MAJOR.MINOR.PATCH> release tag`); continue; }
		if (known.has(version)) continue;
		pending.push({ tag, version });
	}
	if (!pending.length) {
		console.log(`market: every v* tag already has an entry (working tree at ${pkg.version})`);
		console.log("release: nothing to publish");
		return;
	}

	const sourceUrl = normalizeRemote(run("git", ["remote", "get-url", "origin"]));
	const entries = [];
	for (const { tag, version } of pending) {
		// The tag's own commit must agree with the tag: the version is declared
		// in the commit, the tag only names it.
		const commit = run("git", ["rev-parse", `${tag}^{commit}`]);
		const taggedPkg = JSON.parse(run("git", ["show", `${tag}:package.json`]));
		if (taggedPkg.version !== version) {
			throw new Error(`${tag} points at ${commit.slice(0, 12)} whose package.json says ${taggedPkg.version} — fix or delete the tag`);
		}
		const timestamp = Number(run("git", ["for-each-ref", "--format=%(creatordate:unix)", `refs/tags/${tag}`]));
		entries.push({ version, entry: buildMarketEntry({ version, commit, timestamp, sourceUrl, enginesDsh }) });
		console.log(`market: ${version} @ ${commit} (tagged ${new Date(timestamp * 1000).toISOString()}, dsh ${enginesDsh})`);
	}

	if (opts.dryRun) {
		console.log(`release: dry run — ${entries.length} market entr${entries.length === 1 ? "y" : "ies"} would be committed, nothing written`);
		return;
	}

	// The market entry pins the tag's commit, so it can only be written after
	// the tag exists — hence the separate market commit, matching every prior
	// release in the history.
	let updated = market;
	for (const { entry } of entries) updated = prependMarketVersion(updated, pkg.name, entry);
	await writeFile(marketPath, `${JSON.stringify(updated, null, 2)}\n`);
	for (const { version } of entries) {
		run("git", ["add", "market/index.json"]);
		run("git", ["commit", "-m", `market index: ${version} default`]);
	}

	console.log("push: skipped (git push --follow-tags publishes the releases)");
	console.log(`release: done — published ${entries.map((e) => e.version).join(", ")}`);
}

/** Only execute when invoked directly, so test/release.mjs can import helpers. */
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`release: FAILED — ${error?.message ?? error}`);
		process.exitCode = 1;
	});
}
