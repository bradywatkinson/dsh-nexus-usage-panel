---
name: release
description: Cut a versioned release of the dsh-nexus-usage-panel plugin — run the scripted pipeline, choose the bump level, and publish. Use when the user asks to release, ship, cut, or publish a version of this plugin, or to prepare the next one.
---

# Release dsh-nexus-usage-panel

Releases go through one script — `npm run release` → [scripts/release.mjs](../../scripts/release.mjs). Never bump `version` in [package.json](../../package.json) or edit `market/index.json` by hand: the script is the single path, and it pins each market entry to the release commit's sha.

## Steps

1. Run the pipeline (it runs the full test suite first and aborts on any failure):

   ```
   npm run release -- <major|minor|patch> "<one-line release message>"
   ```

   - **Bump level**: `patch` for fixes, `minor` for new features or behavior changes, `major` for breaking changes.
   - **Message**: one line, what changed and why, in the voice of the existing history; no version prefix — the script adds `<version>: ` itself.
   - Useful flags: `--dry-run` to preview, `--push` to also run `git push --follow-tags`, `--engines "<range>"` when the dsh compatibility range changed (default: the previous market entry's range).

2. Read the output and confirm it produced exactly two commits: `<version>: <message>` (tagged `v<version>`) and `market index: <version> default` with the new entry pinned to the first commit's sha.

3. Publishing is a separate, deliberate step: without `--push` nothing leaves the machine. Only push (`git push --follow-tags origin <branch>`) when the user asks to publish or has confirmed.

## Constraints

- **Never amend or rebase a release commit** — the market entry already pins its sha; a rewritten sha breaks the published index.
- The pipeline aborts if the version already has a market entry, or if package.json and the latest market entry disagree — release from a synced tree.
- Docs are updated in the *change* commits, not the release: keep [README.md](../../README.md), [docs/](../../docs), and the AGENTS.md orders current before releasing.
- Release commits sweep the whole working tree (`git add -A`): start from a tree containing only what should ship.
