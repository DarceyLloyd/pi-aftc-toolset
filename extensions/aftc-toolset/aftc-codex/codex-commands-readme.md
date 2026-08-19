# codex-commands.ts

The `/aftc-codex-*` slash commands + the config menu.

## Commands

| Command | Action |
| --- | --- |
| `/aftc-codex` | Open the config menu (AFTC UI) — the main config surface. |
| `/codex-enable` | Enable. Seeds on first enable (copies the shipped rules + guidance). |
| `/codex-disable` | Disable + strip ALL codex traces from context (sets silent; the context filter removes markers + doc pairs on the next LLM call). |
| `/aftc-codex-install` | Fresh install (or re-install): deletes the live codex (including your resources) and copies the shipped basics (rules + guidance) fresh. A destructive re-install needs the TUI confirm; headless refuses. |
| `/codex-init` | Prep now: load the rules, detect the project, fetch the relevant docs (eager; names detected topics). |
| `/aftc-codex-refresh` | Prune all codex from context, then re-prep (clean restart). |
| `/aftc-codex-learn` | Self-education prompt injection; refused while disabled. |
| `/aftc-codex-status` | Compact colored status in the TUI transcript: `AFTC Codex Enabled`, `Embedded in context`, `No' of codex files read: X/YY`, and whether the codex is installed. The read count is rebuilt from durable read-tracking entries, so it survives `/reload`, resume and compaction. |
| `/aftc-codex-list` (alias `/codex-list`) | List EVERY available codex load resource - a scrollable full-screen MODAL with type-to-filter (first item highlighted; ↑/↓ to move, Esc/Enter closes); `category/name` paths preserve structure; the `documentation-and-planning` guide is PINNED at the top (manual insertion). Headless prints the same list to the console. Read-only: works enabled or not; warns when nothing is seeded yet. |
| `/aftc-codex-load` (alias `/codex-load`) | Pick ONE codex resource to load - a scrollable menu with type-to-filter (same pattern as `/qd`): Enter picks the highlighted resource and the menu CLOSES. ONE marker instruction tells the AI to `codex_load` that topic now (eager turn when idle; follow-up when busy). A LOAD action, not a prep action: rules-only and un-prepped sessions are NOT refused (matching the user typing "codex load <x>"); headless points at `/codex-list` + telling the AI which to load. |
| `/codex-inject-rules` | Rules-only mode for THIS session: injects ONLY the Critical Global Rules section (no docs, list, guidance, marker or learn; works even with the feature disabled). One-way per session — `/new` + `/codex-init` returns to the full codex. Standalone name — no `/aftc-codex-*` variant. |

(`/codex-*` are aliases of the matching `/aftc-codex-*` commands, except `/codex-inject-rules`, which has no `/aftc-` variant.)

## List-regeneration wrapper

Start Fresh, `/aftc-codex-learn` and `/aftc-codex-install` regenerate
`codex-resource-list.md` via `node sync-codex-resources.mjs` so the list is
fresh. Pure toggles (`-enable`/`-disable`/`-status`) skip the spawn.

## Config menu

`/aftc-codex` opens a GRUB-style menu tree built ONLY from the `aftc-ui`
primitives (`showMenu`/`showConfirm`):

- **1 Main** — inline toggles (Codex Enabled · Inject Thought Guidance ·
  Auto-Detect & Load Docs · Auto Insert Codex Skills to Load into AGENTS.md —
  all shown as Yes/No) that re-render the screen, plus Resources & updates
  (→1.6).
  Auto Insert Codex Skills to Load into AGENTS.md (default No): when on,
  the AI may write/update the codex resources-to-load list (the
  AFTC-CODEX-STACK block) in the project's AGENTS.md / auto-inject files;
  when off, codex never writes those files (no insert, no cleanup) and
  /codex-init reports an existing block as left untouched.
  The body shows `AFTC Codex: <N> resources available` and the session state
  (Prepped / Not prepped (Run /codex-init to prep the AI) / Rules-only).
- **1.6 Resources & updates** — Start fresh (confirm-destructive: wipes the
  whole live codex dir - rules, guidance AND your resources - and re-copies the
  shipped basics; irreversible, no backup), Open codex resource dir (opens the
  live `resources/` folder in the OS file manager: `explorer.exe` / `open` /
  `xdg-open`).

All screens guard `ctx.hasUI` / `ctx.mode === "tui"`; print mode prints a
summary and never opens menus.

## Public API

`createCodexCommands(ctx, inject, learn)` — registers the commands. No return value.

## Failure modes

All handlers best-effort; menus no-op outside TUI;
`-learn` refuses when not enabled; print mode reports without menus.
