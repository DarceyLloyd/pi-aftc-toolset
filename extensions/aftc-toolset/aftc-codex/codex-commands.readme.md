# codex-commands.ts

The `/aftc-codex-*` slash commands + the config menu.

## Commands

| Command | Action |
| --- | --- |
| `/aftc-codex` | Open the config menu (AFTC UI) — the main config surface. |
| `/codex-enable` | Enable + prep the AI. Warns if codex is already active in the context. Seeds on first enable (choice in TUI). |
| `/codex-disable` | Disable + strip ALL codex traces from context (sets silent; the context filter removes markers + doc pairs on the next LLM call). |
| `/aftc-codex-install` | Fresh install (or re-install with confirm): deletes the live copy and copies the seed fresh. |
| `/codex-init` | Prep now: load the rules, detect the project, fetch the relevant docs (eager; names detected topics). |
| `/aftc-codex-refresh` | Prune all codex from context, then re-prep (clean restart). |
| `/aftc-codex-learn` | Self-education prompt injection; refused while disabled. |
| `/aftc-codex-sync` | Seed → live merge (see `codex-merge.readme.md`): copies missing top-level files + seed-only resource files, and appends seed entries whose `[ID]` is missing from a live file — your own entries are never touched. Always regenerates the resource list afterwards, then reports what was copied/merged. |
| `/aftc-codex-status` | Compact colored status in the TUI transcript: `AFTC Codex Enabled`, `Embedded in context`, and `No' of codex files read: X/YY`. The read count is rebuilt from durable read-tracking entries, so it survives `/reload`, resume and compaction. |

(`/codex-*` are aliases of the matching `/aftc-codex-*` commands.)

## List-regeneration wrapper

The resources menu, `/aftc-codex-learn` and `/aftc-codex-install` spawn
`node sync-codex-resources.mjs` first so `codex-resource-list.md` is fresh. Pure
toggles (`-enable`/`-disable`/`-status`) skip the spawn. `/aftc-codex-sync` runs
its merge first, then ALWAYS spawns the sync script (even when nothing changed).

## Config menu

`/aftc-codex` opens a GRUB-style menu tree built ONLY from the `aftcUi`
primitives (`showMenu`/`showConfirm`/`showInput`/`showViewer`):

- **1 Main** — inline toggles (Master switch · Inject thinking guidance ·
  Auto-load docs · Task Addition Approval) that re-render the screen, plus
  Resources & updates (→1.6) and Help (→1.8).
- **1.6 Resources & updates** — Re-seed (→1.9, copy-only), Start fresh
  (`Clear and restore default codex resources` — confirm-destructive: wipes the
  live copy and re-copies the seed; irreversible, no backup), Open codex
  resource dir (opens the live `resources/` folder in the OS file manager:
  `explorer.exe` / `open` / `xdg-open`), Sync codex resources (closes the menu
  and runs the `/codex-sync` merge + report — same code path as the command).
- **1.8 Help** — viewer. (Status is the `/aftc-codex-status` transcript output.)
- **1.9 Seed choice** — Pre-trained (Recommended) / Fresh start.

All screens guard `ctx.hasUI` / `ctx.mode === "tui"`; print mode prints a
summary and never opens menus.

## Public API

`createCodexCommands(ctx, inject, learn)` — registers the commands. No return value.

## Failure modes

All handlers best-effort; seed cancellation honoured; menus no-op outside TUI;
`-learn` refuses when not enabled; print mode reports without menus.
