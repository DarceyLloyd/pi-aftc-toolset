# Contributing

How changes are made to pi-aftc-toolset: workflow, conventions, and the release process.

<!-- last-reviewed: 2026-08-04 20:37 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Overview

Solo-maintained project. The authoritative process rules live in the root `AGENTS.md` (read it first — it is preserved verbatim by docx runs). This doc is the contributor-facing summary.

## Prerequisites

- Node.js 22+, pi coding agent installed globally, Docker Desktop (for integration gates), Python 3.10+ + uv (for the SSH carrier).
- `npm install` in the repo root.

## Core conventions

- Orchestrator pattern: features are self-contained modules under `extensions/aftc-toolset/`; no cross-imports; wiring in `index.ts`; shared types in `types.ts`.
- Every `.ts` module has a sibling `<module>-readme.md` — update both in the same change.
- Every slash command gets exactly one `registerHelpEntry` beside its `pi.registerCommand` (category from `HELP_CATEGORY_ORDER`); run `tests/help-registry-check`.
- Keyboard shortcuts live ONLY in `keys.ts`; add a static row to `SHORTCUT_ROWS` in `help.ts` + `keys-readme.md` + `tests/keys-check`.
- New preferences: `Preferences` interface + `DEFAULT_PREFERENCES` + write-back migration + the defaults table doc; new user-facing features default to disabled.
- Console output via `ui/aftc-console.ts`; dialogs via `ui/aftc-ui.ts`.
- Structure-map discipline: new module = map node + master per-ID section + Documentation Index entry + ID-prefixed deep doc, in one commit.
- tasks.md is the working record: `[ ]` / `[/]` / `[X]`, updated continuously, functionality → Windows tests → Linux tests order.

## Examples

```bash
node tests/help-registry-check/help-registry-check.mjs   # after adding/renaming a command
node tests/docx/docx-check.mjs                            # docx feature suites
npm pack --dry-run                                        # before every release
node extensions/aftc-toolset/aftc-codex/scripts/live-to-seed-sync.mjs          # dry run
node extensions/aftc-toolset/aftc-codex/scripts/live-to-seed-sync.mjs --apply  # write
```

## Troubleshooting

- **My module edit does nothing in pi** — jiti caches compiled modules for the process; `/reload`.
- **help-registry-check fails after adding a command** — missing/duplicated `registerHelpEntry`.
- **Config change not visible** — you cached it; config is re-read from disk on every access by design.

## Release process

1. Functionality → Windows tests → Linux container verification (`tests/pi-linux-integration`).
2. `change-log.txt` entry (newest first, user-facing summaries).
3. Version bump (patch/minor/major per AGENTS.md). If the codex seed changed, bump `codexVersion` in `data/extension-config.json` in the same release.
4. `npm pack --dry-run`; commit `vX.X.X`; push; GitHub release with tag/name `vX.X.X`.

## Related

- 1.2 Orchestrator & Core Infrastructure
- 5 Tests, 6 Package & Distribution
