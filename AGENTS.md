# CRITICAL GLOBAL RULES
- IMPORTANT: Never use the character '§' in any code comment, file or documentation (excluding in this line, do not remove the character '§' from this line).
- Never use the word "master" for on/off switches or enable flags (no "master on/off", "master switch", "master toggle"). Naming convention: a feature's enable flag is `featureNameEnabled = true/false` in code and `{"feature_name_enabled": true/false}` in JSON (this project's live config.json uses camelCase keys, eg `warGamesEnabled`). In prose say "on/off", "true/false", or "<feature> enabled".
- Never create NUL files.
- Never read or process any files in folders named ".bak", ".old", ".git", unless specifically asked.
- Keep answers short and to the point. Only give detailed responses when asked or when planning. It is fine to just say "done" or "ready". Never leave the user wondering if you are finished.
- Any script or command you run must be self-terminating: add exit/escape timers (or timeouts) to tests, servers, watchers and one-off scripts so they can never hold the session in an infinite wait. Never run anything that blocks on stdin or runs indefinitely without a guaranteed exit path.
- If you need to ask a question, ask immediately. Never assume.
- Edit tool rules (learned from repeated failures):
  - `lines` holds literal file content ONLY — never paste `LINE#HASH:` anchors, op names, or any JSON keys into it.
  - INSERTING lines (nothing deleted) = `prepend`/`append` ONLY. Never use a single-anchor `replace` with a multi-line payload to insert — it works but warns, and normalising that warning hides real mistakes.
  - REPLACING lines = `replace` with `pos`+`end` spanning EXACTLY the lines to delete, both anchors copied verbatim from the SAME fresh read. If the payload's first/last line resembles a neighbour you want to keep, your range is wrong — stop.
  - One edit call per file, then STOP: read the edited region before the next edit call on that file. Line numbers shift on every edit; anchors from before the latest edit are stale by definition.
  - On ANY warning or `[E_STALE_ANCHOR]`: do not retry blindly. Re-read the region first, verify what actually applied (a failed batch applies NOTHING — re-apply the whole batch, not just the failed entry), then edit with fresh anchors.
- Never overwrite user settings in config.json: only ADD missing keys via the write-back migration; existing values are sacred. Never auto-store a saved replay prompt (default empty). New user-facing features are disabled by default.

---

# About this project

`pi-aftc-toolset` is a [pi](https://pi.dev) extension package that adds
productivity tools to the pi coding agent. Look at each file in
`extensions/aftc-toolset/` to understand what features exist.

## Understanding pi

Before writing or modifying ANY extension code, read these:

- `C:\Users\Darcey\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\extensions.md` — the primary API reference (events, tools, commands, UI, state)
- `C:\Users\Darcey\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\examples` — working extension implementations
- `extensions/aftc-toolset/data/aftc-codex/resources/tools/pi-extension.md` — gotchas and conventions for building pi extensions (CRITICAL, non-optional)

**You MUST understand the lifecycle hooks before writing code.** Key hooks:
`session_start` (reason field), `before_agent_start` (system prompt injection),
`context` (non-destructive message filter), `tool_call` (can block),
`tool_result` (can modify), `message_end` (can replace message),
`agent_settled` (pi truly done), `session_shutdown` (cleanup).
Do NOT guess event names, payloads, or return shapes.

**Error/completion detection:** there is NO error event. Track `stopReason` from
`message_end` (assistant), act at `agent_settled`. Values: `"stop"` (done),
`"error"` (provider failure), `"aborted"` (user cancelled), `"toolUse"` (calling
tools). `agent_end` is NOT final (pi may retry/compact after it).

**User dialogs:** most AI models make a mess of these. See `cd.ts` for the
reference implementation. Read `docs/aftc-ui-documentation.md` before building any UI.

---

# Feature documentation (read BEFORE working on a feature)

| Feature | Read this first |
| --- | --- |
| aftc-ui (dialogs & overlays) | `docs/aftc-ui-documentation.md` |
| aftc-console (console output) | `docs/aftc-console-documentation.md` |
| Usage report | `docs/usage-report-rules.md` |
| Data dir & packaging | `docs/data-and-packaging.md` |
| Config files (live + shipped) | `docs/working-with-config.md` |
| aftc-codex knowledge base | `docs/aftc-codex-documentation.md` |
| Footer widget | `docs/footer-widget-documentation.md` |
| SSH | `docs/ssh-documentation.md` |
| Audio notifications | `docs/aftc-notifications.md` |
| Slash commands (create/edit/delete) | `docs/help-registry.md` |
| Keyboard shortcuts (add/change) | `extensions/aftc-toolset/keys-readme.md` |
| Quick dir access (/qd) | `extensions/aftc-toolset/quick-open-dir-readme.md` |

If any modifications or changes are requested or needed to be made to a feature,
you must read its documentation file listed above before making them.

**Adding a keyboard shortcut.** All global shortcuts live in ONE place:
`extensions/aftc-toolset/keys.ts` — never register a shortcut in another module
(component-scoped keys inside dialogs/overlays stay with their component).
How: `pi.registerShortcut("alt+x", { description, handler })`, guard handlers
with `ctx.hasUI`. Shortcuts are NOT help-registry material — add a static row to
`SHORTCUT_ROWS` in `help.ts` instead, update `keys-readme.md`, and extend
`tests/keys-check/`. If the action also gets a companion slash command, that
command follows `docs/help-registry.md`. Key/chord format and the built-in
defaults to avoid colliding with: pi's `docs/keybindings.md`.

---

## aftc-console — transcript + diagnostic output

Every feature writes to the user's console through `ui/aftc-console.ts` — never raw
`ctx.ui.notify` or `console.log("[aftc-toolset]…")`. Read
`docs/aftc-console-documentation.md` before using it. Quick map:

- `aftcConsole.init(pi)` — once per session (`index.ts` only).
- `aftcConsole.emphasis(ctx, text)` — accent/emphasis line for status / success / state-change (NOT a warning).
- `aftcConsole.warn(ctx, text)` — yellow; the action could not proceed (nothing selected, missing args, not connected).
- `aftcConsole.error(ctx, text)` — red; hard failure.
- `aftcConsole.info(ctx, text)` — dim; rare neutral aside.
- `aftcConsole.log(text)` — `[aftc-toolset]` stdout diagnostic.


# Live vs seed (terminology)

- **live** = the user's per-user copy in the persistent OS data dir
  (`<dataDir>/`, eg `%APPDATA%\pi-aftc-toolset\data\` on Windows;
  `AFTC_TOOLSET_DATA_ROOT` override). Holds `config.json`, `aftc-codex/`,
  `turns.db`, `ssh.json`, `report.html`. Survives `pi update`.
- **seed / shipped** = source-only defaults + assets inside the package
  (`extensions/aftc-toolset/data/`): `extension-config.json`, the `aftc-codex/`
  seed, audio MP3s, intro assets. Replaced on every `pi update`. Flow is
  one-way: seed -> live, copy-only.

# Config files — read `docs/working-with-config.md` FIRST

Two config files, never to be confused:

- **LIVE** `<dataDir>/config.json` — user preferences. API:
  `getPreference`/`setPreference` (`config.ts`). "config.json" in docs and
  conversation means THIS file.
- **SHIPPED** `<packageRoot>/extensions/aftc-toolset/data/extension-config.json`
  — package-shipped values (`codexVersion` today). Never copied to live.

BINDING: never cache either file in module memory — read from disk on EVERY
access. pi keeps extension modules alive across `/new`, so a cache serves
stale values after a hand edit, and a later `setPreference` would flush the
stale cache back and clobber the user's edits. `setPreference` is a fresh
read-modify-write. Full contract + edge cases: `docs/working-with-config.md`.


# Code structure rules

- Keep code, folders, and control flow simple. Prefer fewer files, abstractions,
  events, and dependencies.
- Pi loads TypeScript through jiti. No build step, no `tsc`, no bundlers, no `dist/`.
- Features are modular under `extensions/aftc-toolset/`. Entry: `index.ts`.
- Feature modules must not import each other. Share interfaces in `types.ts`,
  wire dependencies through `index.ts`.
- **Factory sub-folders** (eg `intros/`, `ssh/`) name the coordinator with a
  descriptive name (eg `intro-factory.ts`) — never `index.ts`.
- **Shipped defaults** live under `extensions/aftc-toolset/data/`, one subfolder
  per feature. Never mix two features' files. See `docs/data-and-packaging.md`.
- Each `.ts` module needs a sibling `<module-name>-readme.md`. Keep both current.
- Re-read only the relevant documentation when needed. Do not reload everything.
- Never read/modify files under `.old`, `.bak`, or `.git` unless asked.
- Do not use Git unless the user explicitly asks.
- Workflow: functionality first > Windows tests > Linux tests > full suite.

---

# Extension conventions

- Export a default extension factory. Keep it synchronous unless truly needed.
- Do not start processes/sockets/watchers/timers in the factory. Start from
  `session_start` or a command/tool/event. Clean up in `session_shutdown`.
- Keep session state in the factory closure. Use `pi.appendEntry()` for durable state.
- Guard dialogs with `ctx.hasUI`. Guard TUI components with `ctx.mode === "tui"`.
- Pass `ctx.signal` to nested async work.
- Truncate tool output with `truncateHead`/`truncateTail` and say when truncated.
- Wrap file-mutating tools in `withFileMutationQueue()` (absolute target path).
- Use `StringEnum` from `@earendil-works/pi-ai` for tool string enums.
- Throw from tool `execute()` to report errors.
- Send all console output through `ui/aftc-console.ts` (`aftcConsole.warn/error/info/emphasis` for the transcript, `aftcConsole.log` for `[aftc-toolset]` stdout). See `docs/aftc-console-documentation.md`.
- Give every tool a `promptSnippet`. Make `promptGuidelines` bullets name the tool
  explicitly ("Use my_tool when...", never "Use this tool when...").
- Strip a leading `@` from path parameters (some models add it).
- SSH model tools use saved connections by name and opaque session ids only.
  Credentials never cross into model-visible context.
- **Config persistence rule.** User-configurable values go in `config.json` via
  `getPreference`/`setPreference`. New preference: add to `Preferences` interface,
  `DEFAULT_PREFERENCES`, AND the write-back migration in `config.ts`. See
  `docs/data-and-packaging.md` for the full table and process.

---

# Spawned subprocesses

- Start lazily (on first use), never in the factory.
- Spawn with `node:child_process` argument arrays, no shell, cross-platform names
  (`uv.exe` on Windows, `uv` elsewhere).
- Tear down in `session_shutdown`. Child must self-exit on stdin EOF.
- Add an idle self-exit watchdog in the child (env-configurable timeout).

---

# Package layout

- `package.json` `pi` manifest points at `./extensions`, `./skills`, `./themes`.
- Root `README.md` is user-facing (not a changelog). Changelog: `change-log.txt`.
- Technical detail belongs in per-module `*-readme.md` files and `docs/`.

---

# Documentation and releases

- Versioning: `major.minor.patch`.
- Patch bump: fix or enhancement to existing behaviour.
- Minor bump (reset patch): brand-new feature (new capability area).
- Major bump: overhaul or rewrite.
- After tests pass, add entry to `change-log.txt` under `Updates v<major>.<minor>.x`.
  Newest first. Short user-facing summaries only.
- Keep root documentation aligned with implemented behaviour.

---

# Tests

**EVERY TEST MUST HAVE A TIMEOUT.** Register a global watchdog near the top:
`setTimeout(() => process.exit(2), N).unref()`. Timeouts by type:
- Pure-mock / no I/O: 20s
- Module-load + jiti: 30s
- SSH / carrier smoke: 60s
- Docker integration: 600s (`ssh-replacement`), 1500s (`pi-linux-integration`)

Rules:
- Each test in `tests/<test-name>/` with its own script and fixtures.
- Use dependencies already in the project tree. No network or TUI for ordinary tests.
- Resolve paths from the test script, never `process.cwd()`.
- Test the feature being changed. Full suite only when requested.
- Do not automate visual UI checks. Ask the user to verify.

---

# Linux container

Container runs Pi as user `pi`. Definition: `tests/pi-linux-integration/`.

Verification cycle:
1. Copy latest package files to `/opt/pi-aftc-toolset`.
2. Run `pi -p /aftc-install` as user `pi` AFTER the copy.
3. Check exit status. If install fails, fix on Windows first.
4. Run Linux tests only after install succeeds.
5. If a Linux test fails, fix on Windows, verify Windows, restart at step 1.

Never push container state/credentials to any registry.

---

# Task processing (tasks.md)

- `tasks.md` is the authoritative record. Group tasks into sections.
- Markers: `[ ]` not started, `[/]` in progress, `[X]` complete.
- Update continuously (never batch). Flip to `[/]` on start, `[X]` on verify.
- If a task affects an older task, reset the older one to `[ ]` and process it.
- Order: functionality first, Windows verify, Linux last.
- Split combined "verify Windows and Linux" into two separate tasks.
- Before stopping, report: `Progress: <complete>/<total> complete, <remaining> remaining`

---

# PROJECT RULES

- Every `*.ts` file has a matching `*-readme.md`. Keep it current.
- **CRITICAL — NON-OPTIONAL.** Before writing or modifying ANY pi extension code,
  you MUST read and understand
  `extensions/aftc-toolset/data/aftc-codex/resources/tools/pi-extension.md`.
  This is the maintained gotchas and conventions for building pi extensions.
  Do NOT guess pi behaviour, event payloads, or return shapes. Re-read the
  relevant entries before relying on a pi API.
- If any modifications or changes are requested or needed to be made to the
  aftc-codex feature you must read `docs/aftc-codex-documentation.md` before making them.
