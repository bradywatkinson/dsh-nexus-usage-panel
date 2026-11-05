---
name: release
description: Cut a versioned release of the dsh-nexus-usage-panel plugin — the git tag is the release; publish the market entries and tags. Use when the user asks to release, ship, cut, or publish a version of this plugin, or to prepare the next one.
---

# Release dsh-nexus-usage-panel

A release is a git tag, nothing else. Never bump versions with npm tooling and never edit `market/index.json` by hand — [scripts/release.mjs](../../scripts/release.mjs) is the single path to the market index, and it pins each entry to the tag's commit sha.

## Steps

1. Bump `version` in [package.json](../../package.json) inside the change commit: `patch` for fixes, `minor` for new features or behavior changes, `major` for breaking changes.

2. Tag the release — this is the act of releasing:

   ```
   git tag -a v<MAJOR.MINOR.PATCH> -m "<one-line release message>"
   ```

   The message is one line, what changed and why, in the voice of the existing history. The tag must be on a commit whose package.json declares the same version — the publishing script enforces this.

3. Publish the market entry (node-only; no npm, no dependencies):

   ```
   node scripts/release.mjs [--dry-run] [--skip-test] [--engines "<range>"]
   ```

   It runs every `test/*.mjs` directly with node, finds `v*` tags with no market entry yet, validates each tag against its own commit, prepends the pinned entry (tag's commit sha, tag creation time, dsh engines range — default: the previous entry's), and commits `market index: <version> default`. `--dry-run` previews everything without writing.

4. Publishing to the remote is a separate, deliberate step: only `git push --follow-tags origin <branch>` when the user asks to publish or has confirmed. Nothing in the flow pushes.

## Constraints

- **Never amend or rebase a tagged release commit** — the market entry already pins its sha; a rewritten sha breaks the published index.
- The script rejects a tag whose commit's package.json disagrees with the tag name; fix or delete the tag, never the market entry by hand.
- The tag must exist before the market entry is written — the entry pins the tag's commit, which is why the market index is always a separate commit after the tag.
- Docs are updated in the *change* commits, not the release: keep [README.md](../../README.md), [docs/](../../docs), and the AGENTS.md orders current before tagging.
- Release work happens on a clean tree: the market commits touch only `market/index.json`, but unrelated staged changes would ride along in the commit.
