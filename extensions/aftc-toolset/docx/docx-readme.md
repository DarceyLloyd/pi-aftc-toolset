# docx.ts

`/docx` + `/docx-update` — project documentation generator/updater.

- `/docx` — regenerates the project's full documentation set into
  `./docx/` per the shipped `documentation_guide.md` (this folder).
- `/docx-update` — reconciles an EXISTING `./docx/` set with the source
  of truth instead of regenerating: mints docs for new source files,
  retires docs for removed files (IDs marked reserved), corrects drifted
  docs in place, keeps map/master/index/sitemap in sync, then adjusts the
  root README.md IN PLACE (fact-check + minimal targeted edits; layout,
  formatting and tone preserved — never rewritten).

Both stage the previous documentation into `./docx/old_docs/` (the
model's recon input during the run) and zip it into `./docx/backups/` at
the END of the run under a timestamped name.

## What happens when the user runs `/docx` or `/docx-update`

Both commands share one handler (`handleDocxRun`), parameterised by the
`DOCX_MODES` table:

| Mode | Command | Guide section | Zip label | Zip name |
| --- | --- | --- | --- | --- |
| `generate` | `/docx` | 18 "AI Execution Prompt" | `original` | `Original Documentation Backup YYMMDD HHMM.zip` |
| `update` | `/docx-update` | 22 "AI Update Execution Prompt" | `update` | `Documentation Backup YYMMDD HHMM.zip` |

0. **Hard gate** (applies even with `--yes`): when
   `ctx.getContextUsage().percent` is >= 25, the command flat-out refuses
   — a compaction mid-run could corrupt the docs. TUI: a full-screen
   informational modal (single auto-selected OK; Enter/Esc closes) shows
   the % used, why, and the two steps (`/new`, then the command).
   Headless: a warning line saying the same.
1. **Update-mode gate** (`/docx-update` only): no `./docx/` at the
   project root -> warn and refuse ("nothing to update - run /docx
   first"). Requires an existing doc set; a first-time project runs
   `/docx`.
1b. **Existing-docx modal** (`/docx` only, TUI only): when a `./docx/`
   folder already exists, a modal asks "An existing docx folder has been
   detected, would you like to:" — *Update your existing documentation*
   (hands the run over to the update pipeline: its own gates, wording and
   zip label) or *Re-build your documentation fresh* (the normal generate
   flow continues). Esc cancels cleanly. Headless is unchanged: `--yes`
   rebuilds as before; without `--yes` the command already refuses and
   asks for `--yes`.
2. **Context-window advisory** (skipped by `--yes`): at >= 20% used, a
   modal notes that context use is modest but the run is LONG, and highly
   advises `/new` first. Options: *Exit* (default) / *Proceed anyway*.
3. **Confirm modal** (skipped by `--yes`, mode-specific wording): `/docx`
   warns that all previous documentation moves to `./docx/old_docs/`
   (zipped into `./docx/backups/` at the end of the run) and advises
   making a backup; `/docx-update` explains the reconcile (new/removed/
   drifted docs, README fact-checked WITHOUT rewriting) and the backup
   zip. Both set the long-wait expectation. Options: *No, exit*
   (default) / *Yes, proceed*.
4. **Project-type selection**: the injected prompt is the mode's CORE
   prompt (guide section 18 or 22) plus ONE type pack from
   `prompts/<key>.md` — never a giant all-in-one. TUI: a picker modal
   lists the 10 types (auto-detect result pre-selected; Esc cancels).
   Headless: `--type <key>` wins; without it the command auto-detects and
   says what it picked; when detection finds nothing it refuses and lists
   the valid keys.
5. **Deterministic backup** (`docx-backup.ts`): moves the old docs into
   `./docx/old_docs/` with rel-from-root structure preserved and the move
   count verified. Any error aborts BEFORE the model is engaged.
6. **Prompt injection** (`buildDocxPrompt`): the mode's core prompt is
   extracted from `documentation_guide.md` and the pack read from
   `prompts/<key>.md` (both read fresh from disk on every run — never
   cached) and sent via `pi.sendUserMessage`
   (`deliverAs: "followUp"` when the agent is busy). Placeholders
   substituted across core+pack: `[PROJECT_PATH]`, `[GUIDE_PATH]`,
   `[MAP_SCAN_PATH]`, `[LINK_AUDIT_PATH]`, `[ZIP_OLD_PATH]`
   (forward-slash absolute paths) and `[ZIP_OLD_LABEL]` (the mode's zip
   label).
7. The model does the work; its LAST action runs
   `scripts/zip-old.mjs <root> <label>`, packing `docx/old_docs/` into
   the timestamped zip inside `docx/backups/` and deleting the folder so
   future sessions never read superseded docs. `/docx` generates the full
   set (master, map, deep docs, sub-maps, leaf docs for every surface
   INCLUDING modals/popups, per-UI-branch sitemaps and design-rules docs,
   all in the mirrored folder tree). `/docx-update` follows its section-22
   prompt: diff plan -> mint new nodes -> retire removed nodes -> correct
   drift -> cross-references + link-audit -> root README adjusted in
   place -> report + finalise.

## Project types (`--type <key>`)

| Key | For |
| --- | --- |
| `web-app` | PHP/Apache/MySQL/Docker, custom MVC backends, Angular/React/Next/Vue + custom TS/JS frontends |
| `basic-website` | Static HTML/CSS/JS(MJS), no framework or backend |
| `webgpu-webgl` | Three.js / Babylon.js canvas apps and games |
| `desktop-app` | Electron, .NET, Java, Qt, native toolkits |
| `juce-vst` | C++ JUCE VST / audio plugins |
| `mobile-app` | Android/iOS native, React Native, Flutter |
| `python-app` | Python CLI, web, GUI, TUI, services |
| `cli-tool` | Command-line tools and terminal-UI apps (any language) |
| `shell-scripts` | bash/sh/ps1/bat automation collections |
| `server-stack` | Linux server / Docker hosting stacks (compose, nginx/Apache, ops scripts, systemd) |
| `generic` | Closest-match fallback (libraries, SDKs, anything else) |

Auto-detection is heuristic (package.json deps, manifests, compose files,
build files) and ordered: Electron → JUCE → mobile → WebGPU/WebGL → web →
server stack (compose + scripts/nginx, no app manifest) → Python → native
desktop → CLI bin → shell scripts → static site.

## Backup scheme (both commands)

- Staging: `./docx/old_docs/` (rel-from-root paths preserved) — stays
  readable for the whole run because the model uses it as recon input.
- Final zip (tooling-owned `scripts/zip-old.mjs`, the model's LAST
  action): a TIMESTAMPED zip inside `./docx/backups/` —
  "Original Documentation Backup YYMMDD HHMM.zip" for `/docx` (label
  `original`), "Documentation Backup YYMMDD HHMM.zip" for `/docx-update`
  (label `update`).
- `docx/backups/` accumulates across runs and is NEVER folded into a new
  backup (the backup skips `old_docs/` and `backups/` when folding the
  previous `./docx/` output). The old single fold-in zip directly under
  `docx/` is gone.
- `.gitignore` gains `docx/old_docs/` and `docx/backups/` (idempotent
  append by the backup tooling).
- Restore: unzip the relevant backup from `docx/backups/` and copy files
  back to their recorded paths.

## Output layout (in the USER's project)

There is NO `docs/` subfolder — `docx/` IS the documentation folder, and
its tree mirrors the structure map (one `<id>_<name>/` folder per map node
with children, holding the node's own doc + sub-map + partners; leaf docs
live in their parent's folder):

```
<projectRoot>/
  README.md            # REAL github readme — /docx generates it LAST;
                       # /docx-update adjusts it IN PLACE (never rewrites)
  AGENTS.md            # edited in place: managed <!-- AFTC-DOCX ... --> block
  docx/
    project_documentation.md
    project_map.md
    design.md  contributing.md  dependency_map.md ...   # cross-cutting, no ID
    <id>_<branch>/                                      # one folder per node-with-children
      <id>_<branch>_documentation.md
      <id>_<branch>_map.md
      <id>_<branch>_sitemap.md
      <childId>_<artefact>.md                           # leaf (page/modal/model/component)
      <childId>_<sub>/                                  # recurse
    old_docs/            # staging during a run (gone after the final zip)
    backups/             # timestamped backup zips, accumulate across runs
```

The root README is never written by the tooling. `/docx`: the model
generates it as the final content step (guide step 10), when the project
is fully understood; an extensive old README becomes the structural
skeleton of the new one (sections followed closely, images kept after
verifying the files exist), a thin or absent one is built from the
guide's project-type archetype (tool/extension/library vs
runtime/multi-service app). `/docx-update`: the README is fact-checked
against source and corrected with MINIMAL targeted edits — layout,
formatting, tone and emphasis preserved, never rewritten or reordered.

## Commands registered (2)

- `/docx [--yes] [--type <key>]` — generate/regenerate documentation.
- `/docx-update [--yes] [--type <key>]` — reconcile the existing
  `./docx/` set with the source; requires an existing `./docx/` (refuses
  and points to `/docx` otherwise).

Both: help-registry category General. `--yes` skips both modals for
headless use; `--type` picks the prompt pack (see the table). Without UI
and without `--yes` the command refuses with a warning; headless without
`--type` it auto-detects, and refuses with the key list when nothing
matches.

## Scripts (run BY THE MODEL during the run, never by docx.ts)

| Script | When | What |
| --- | --- | --- |
| `scripts/map-scan.mjs <root>` | guide step 1 | deterministic recon on stdout: dir tree + manifest/container/test inventory + UI surface hints (template/surface-named files the model must VERIFY against source) |
| `scripts/link-audit.mjs <root>` | audit step (guide step 11 / update step 5) | mechanical link/stamp/ID/map-doc audit + mirrored-tree checks (ID-prefixed folders, ancestry chains, a folder per node-with-children, cross-cutting docs at the docx/ root) + content-depth lint (References/Related, sitemap HIGH+LOW LEVEL, page-leaf States) + surface coverage (every UI-hint file must be referenced by a doc); exit 1 with failures listed |
| `scripts/zip-old.mjs <root> <label>` | final action | label `original` (/docx) or `update` (/docx-update): zip `docx/old_docs/` -> `docx/backups/<timestamped name>.zip`, verify entry count, delete `old_docs/` |

All three: pure Node stdlib (zip-old also uses the `adm-zip` dependency),
no shell, self-terminating watchdog, exit 0/1. UI-hint collection is shared
between map-scan and link-audit via `scripts/ui-hints.mjs` (one source of
truth — never two hint regex sets).

## Failure behaviour (fail-soft, never destructive by accident)

- Backup destination cannot be created -> error, nothing moved, no prompt.
- Any move/copy error or count mismatch -> error listing failures, no prompt.
- `/docx-update` without an existing `./docx/` -> warning pointing to
  `/docx`, no backup, no prompt.
- Unknown `--type`, or headless with no detectable type -> warning naming
  the valid keys, no backup, no prompt.
- Guide file or pack file missing/malformed -> error, no prompt (backup
  already done is still restorable from `docx/old_docs/`).
- `sendUserMessage` throws -> error line; `docx/old_docs/` remains for
  manual restore (or a later zip-old run).

## Public factory

```typescript
export function createDocx(pi: ExtensionAPI): void
```

Self-contained: registers both commands (each with its help-registry
entry, category General) and is done. No events, no timers, no config
preferences (a slash command is opt-in by nature).

## Notes

- No model tool is registered — the model drives the run through the
  injected prompt and its normal file tools.
- The context gate reads pi's own `ctx.getContextUsage()` (same estimate
  the footer shows) and `ctx.model.contextWindow` for the window size.
- The pack files are feature-folder assets read in place
  (`docx/prompts/<key>.md`) — the same asset rule as the guide (see
  `data/` docs for the shipped-asset location rule).
- Guide maintenance: `documentation_guide.md` is an adapted copy of the
  maintainer's source guide (`W:\Dev\0 - AFTC Project Doc Guide\`). When
  the source guide changes, re-copy and re-apply the `./docx/` layout
  adaptations and keep the shipped-only content (UI-surface/sitemap/design
  rules, mirrored-tree rules, the section-18 core + section-22 update core
  + type packs).
