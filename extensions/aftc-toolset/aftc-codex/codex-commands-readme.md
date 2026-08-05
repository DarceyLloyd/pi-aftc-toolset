# codex-commands.ts

The `/aftc-codex-*` slash commands + the config menu.

## Commands

| Command | Action |
| --- | --- |
| `/aftc-codex` | Open the config menu (AFTC UI) — the main config surface. |
| `/codex-enable` | Enable + prep the AI. Warns if codex is already active in the context. Seeds on first enable (choice in TUI). |
| `/codex-disable` | Disable + strip ALL codex traces from context (sets silent; the context filter removes markers + doc pairs on the next LLM call). |
| `/aftc-codex-install` | Fresh install (or re-install): deletes the live copy and copies the seed fresh. On a VERSION MISMATCH there is no confirmation — typing the command is the confirmation (the guard sent the user here). When versions match, a destructive re-install needs the TUI confirm (headless refuses). |
| `/codex-init` | Prep now: load the rules, detect the project, fetch the relevant docs (eager; names detected topics). |
| `/aftc-codex-refresh` | Prune all codex from context, then re-prep (clean restart). |
| `/aftc-codex-learn` | Self-education prompt injection; refused while disabled. |
| `/aftc-codex-status` | Compact colored status in the TUI transcript: `AFTC Codex Enabled`, `Embedded in context`, and `No' of codex files read: X/YY`. The read count is rebuilt from durable read-tracking entries, so it survives `/reload`, resume and compaction. |
| `/aftc-codex-sync` | NON-DESTRUCTIVE update (alias `/codex-sync`) — the recommended fix when the version guard reports the live codex out of date. Runs `seed-to-live-sync.mjs`: seed-only topic files are copied whole, seed entries missing from a live topic are appended at the end of their section, top-level fixed docs are updated to the shipped version. Learned/live-only entries are never touched; same-[ID]-different-text conflicts keep the LIVE version and are reported. Applies directly (nothing destructive, so no dry-run/confirm), then stamps `aftcCodexVersion` to the shipped version so the guard clears. Refuses when nothing is installed (points at `/codex-install`) or when already up to date. Success message depends on state: disabled -> run `/codex-enable` then `/codex-init`; prepped -> `/codex-refresh`; otherwise -> `/codex-init`. |
| `/codex-inject-rules` | Rules-only mode for THIS session: injects ONLY the Critical Global Rules section (no docs, list, guidance, marker or learn; works even with the feature disabled). One-way per session — `/new` + `/codex-init` returns to the full codex. Standalone name — no `/aftc-codex-*` variant. |
| `/codex-live-to-seed [--apply]` | Maintainer-only, dev-gated by the `.dev` marker folder (refuses with a warning outside the dev checkout): runs the live->seed sync as a dry run (viewer/stdout), confirms, then applies and EXITS (no second viewer). `--apply` skips the confirm. Conflicts are reported, never auto-overwritten - resolve by hand first. When the apply actually wrote seed files (new topics / merged entries) it bumps the shipped `codexVersion` automatically (a no-op sync leaves it alone); the success message reports the new version. Standalone name - no `/aftc-` variant. |

(`/codex-*` are aliases of the matching `/aftc-codex-*` commands, except `/codex-inject-rules` and `/codex-live-to-seed`, which have no `/aftc-` variant.)

The reverse-direction script for maintainers is `live-to-seed-sync.mjs` (live -> seed, dev-gated); the user-facing update is `seed-to-live-sync.mjs` (seed -> live, non-destructive, behind `/codex-sync`). Both merge entries by their `[ID]` and never auto-overwrite a conflict.

## List-regeneration wrapper

The resources menu (Start Fresh), `/aftc-codex-learn` and `/aftc-codex-install`
regenerate `codex-resource-list.md` via `node sync-codex-resources.mjs` so the
list is fresh. Pure toggles (`-enable`/`-disable`/`-status`) skip the spawn.

## Config menu

`/aftc-codex` opens a GRUB-style menu tree built ONLY from the `aftc-ui`
primitives (`showMenu`/`showConfirm`/`showInput`/`showViewer`):

- **1 Main** — inline toggles (Codex Enabled · Inject Thought Guidance ·
  Auto-Detect & Load Docs · Auto Sync Codex Update on Startup — all shown as
  Yes/No) that re-render the screen, plus Resources & updates (→1.6).
  The body shows `AFTC Codex: <N> resources available` and the session state
  (Prepped / Not prepped (Run /codex-init to prep the AI) / Rules-only).
- **1.6 Resources & updates** — Start fresh
  (`Wipe users codex files and start fresh` — confirm-destructive: wipes the
  whole live codex dir and installs a full fresh copy of the seed; irreversible,
  no backup), Open codex resource dir (opens the live `resources/` folder in
  the OS file manager: `explorer.exe` / `open` / `xdg-open`).
- **1.8 Help** — viewer. (Status is the `/aftc-codex-status` transcript output.)
- **1.9 Seed choice** — Pre-trained (Recommended) / Fresh start.

All screens guard `ctx.hasUI` / `ctx.mode === "tui"`; print mode prints a
summary and never opens menus.

## Public API

`createCodexCommands(ctx, inject, learn)` — registers the commands. No return value.

## Failure modes

All handlers best-effort; seed cancellation honoured; menus no-op outside TUI;
`-learn` refuses when not enabled; print mode reports without menus.
