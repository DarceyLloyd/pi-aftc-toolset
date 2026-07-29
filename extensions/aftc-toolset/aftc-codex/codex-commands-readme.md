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

(`/codex-*` are aliases of the matching `/aftc-codex-*` commands.)

## List-regeneration wrapper

The resources menu (Start Fresh), `/aftc-codex-learn` and `/aftc-codex-install`
regenerate `codex-resource-list.md` via `node sync-codex-resources.mjs` so the
list is fresh. Pure toggles (`-enable`/`-disable`/`-status`) skip the spawn.

## Config menu

`/aftc-codex` opens a GRUB-style menu tree built ONLY from the `aftc-ui`
primitives (`showMenu`/`showConfirm`/`showInput`/`showViewer`):

- **1 Main** — inline toggles (Master switch · Inject thinking guidance ·
  Auto-load docs · Task Addition Approval) that re-render the screen, plus
  Resources & updates (→1.6) and Help (→1.8).
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
