#!/usr/bin/env node
// Versioned release pipeline for dsh-nexus-usage-panel.
//
// Codifies the repo's release convention (see the git history and the root
// AGENTS.md "On release" order) into one audited command:
//
//   node scripts/release.mjs <major|minor|patch> "<release message>"
//     [--engines "<range>"]  dsh engines range for the market entry
//                           (default: the previous entry's range)
//     [--no-tag]             skip the v<version> git tag
//     [--push]               push the release branch and tag after committing
//     [--skip-test]          skip `npm test` (CI or an immediate re-run)
//     [--dry-run]            print every step without writing or committing
//
// Steps: npm test → bump package.json → release commit "<version>: <message>"
// → annotated tag v<version> → prepend the pinned market entry (release commit
// hash + dsh engines range) to market/index.json → market commit
// "market index: <version> default" → optional push.
//
// Zero dependencies: Node builtins only, like lib/index.js. The pure helpers
// are exported and unit-tested by test/release.mjs.

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- pure helpers (unit-tested by test/release.mjs) ------------------------

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
/** "0.3.0" → { major, minor, patch }; throws on any other shape. */
export function parseVersion(version) {
	const match = VERSION_RE.exec(version);
	if (!match) throw new Error(`unsupported version "${version}": expected MAJOR.MINOR.PATCH`);
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** "0.3.0" + "major"|"minor"|"patch" → "1.0.0". Prerelease tags are rejected. */
export function bumpVersion(version, kind) {
	const { major, minor, patch } = parseVersion(version);
	if (kind === "major") return `${major + 1}.0.0`;
	if (kind === "minor") return `${major}.${minor + 1}.0`;
	if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
	throw new Error(`unknown release kind "${kind}": expected major, minor, or patch`);
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

const usage = 'usage: node scripts/release.mjs <major|minor|patch> "<message>" [--engines <range>] [--no-tag] [--push] [--skip-test] [--dry-run]';

function parseArgs(argv) {
	const positional = [];
	const flags = { engines: null, tag: true, push: false, skipTest: false, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--engines") flags.engines = argv[++i];
		else if (arg === "--no-tag") flags.tag = false;
		else if (arg === "--push") flags.push = true;
		else if (arg === "--skip-test") flags.skipTest = true;
		else if (arg === "--dry-run") flags.dryRun = true;
		else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}\n${usage}`);
		else positional.push(arg);
	}
	const [kind, message] = positional;
	if (!["major", "minor", "patch"].includes(kind) || !message?.trim()) throw new Error(usage);
	return { kind, message: message.trim(), ...flags };
}

/** Run a command, capture stdout; `inherit` streams npm test output live. */
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

	const next = bumpVersion(pkg.version, opts.kind);
	if (plugin.versions.some((v) => v.version === next)) {
		throw new Error(`market already has an entry for ${next}`);
	}
	const latest = plugin.versions[0];
	if (latest && latest.version !== pkg.version) {
		throw new Error(`package.json (${pkg.version}) and the latest market entry (${latest.version}) disagree — release from a synced tree`);
	}
	const enginesDsh = opts.engines ?? latest?.engines?.dsh;
	if (!enginesDsh) throw new Error("no dsh engines range: pass --engines \"<range>\"");

	if (!opts.skipTest) run("npm", ["test"], { inherit: true });
	run("git", ["rev-parse", "--is-inside-work-tree"]);

	const releaseMessage = `${next}: ${opts.message}`;
	console.log(`release: ${pkg.version} → ${next}${opts.dryRun ? " (dry run)" : ""}`);

	if (!opts.dryRun) {
		await writeFile(join(root, "package.json"), `${JSON.stringify({ ...pkg, version: next }, null, 2)}\n`);
		run("git", ["add", "-A"]);
		run("git", ["commit", "-m", releaseMessage]);
		if (opts.tag) run("git", ["tag", "-a", `v${next}`, "-m", opts.message]);
	}

	const commit = run("git", ["rev-parse", "HEAD"]);
	console.log(`release: commit ${commit}${opts.tag ? `, tag v${next}` : ", untagged"}`);

	// The market entry must pin the release commit itself, so it can only be
	// written after that commit exists — hence the separate market commit,
	// matching every prior release in the history.
	const remote = normalizeRemote(run("git", ["remote", "get-url", "origin"]));
	const entry = buildMarketEntry({ version: next, commit, timestamp: Math.floor(Date.now() / 1000), sourceUrl: remote, enginesDsh });
	const updated = prependMarketVersion(market, pkg.name, entry);
	console.log(`market: ${next} @ ${commit} (dsh ${enginesDsh}) → ${remote}`);

	if (!opts.dryRun) {
		await writeFile(marketPath, `${JSON.stringify(updated, null, 2)}\n`);
		run("git", ["add", "market/index.json"]);
		run("git", ["commit", "-m", `market index: ${next} default`]);
	}

	if (opts.push) {
		const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
		run("git", ["push", "--follow-tags", "origin", branch], { inherit: true });
		console.log(`push: origin/${branch} with tags`);
	} else {
		console.log("push: skipped (run git push --follow-tags to publish)");
	}

	console.log(`release: done — ${next}${opts.dryRun ? " (dry run, nothing written)" : ""}`);
}

/** Only execute when invoked directly, so test/release.mjs can import helpers. */
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`release: FAILED — ${error?.message ?? error}`);
		process.exitCode = 1;
	});
}
