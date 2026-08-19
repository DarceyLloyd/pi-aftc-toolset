# CRITICAL GLOBAL RULES

- NEVER SHIP automatically. The user always tests changes hands-on first.
  Never run `ship-it.bat`, bump the version, commit, push, or create a
  release unless the user has EXPLICITLY asked to ship in the current
  conversation ("ship it", "ship vX.X.X", etc.). Finishing the code,
  passing tests and peer confirmations are NOT shipping permission —
  report done and wait for the user to test and say ship.
<!-- AFTC-CODEX-STACK
topics: pi-extension, typescript, powershell, nodejs, npm, git, bash, docker, documentation-and-planning
-->

<!-- AFTC-DOCX
Documentation lives in ./docx/. Do NOT read documentation up front. When
you are about to work on an area, find its doc: read the Documentation
Index in ./docx/project_documentation.md or the annotations in
./docx/project_map.md, then load ONLY that doc from ./docx/. Never
follow documentation links for areas you are not working on. When you
change documented code, update its doc in the same change and refresh its
last-reviewed stamp.
-->
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
- **CRITICAL — user-facing wording.** Everything a user reads (menus, option
  labels, descriptions, confirms, warnings, console output, guides) is
  written from the USER's perspective, not the developer's. The user does
  not know this extension's internals: no unexplained jargon — never
  "seed", "live copy", "frontmatter", "built-in", "eject", "shipped
  default" as bare terms; say what happens FOR THEM ("copies the preset to
  your agents folder so you can edit it"). Every menu option must say what
  it does; every toggle shows its current state plus a one-line plain
  description of what turning it changes; every confirm says the
  consequence, not the mechanism. The test: if a first-time user could read
  it and think "wtf does that do?", it is not finished — rewrite it.

---

# About this project

`pi-aftc-toolset` is a [pi](https://pi.dev) extension package that adds
productivity tools to the pi coding agent. Look at each file in
`extensions/aftc-toolset/` to understand what features exist.

## Usage report screenshots (README upkeep)

When the user asks to capture screenshots of the usage report ("update the
usage report images", "screenshot the report", etc.), do this automatically:

1. Make sure the report server is running (127.0.0.1:8713+ — /usage-report,
or `node regenerate-usage-report.mjs` + the running server).
2. Run `node scripts/usage-report-screenshots.mjs` — captures a full-page
   PNG of EVERY tab into `images/ur-<tab-name>.png` (zero-dependency CDP
   driver using the system Edge/Chrome; `EDGE_PATH`/`CHROME_PATH` override;
   one tab only: `node scripts/usage-report-screenshots.mjs <tab>`).
3. Update the README "Usage report" section: one subsection per tab, in tab
   order — `### <Tab name>`, the image, then a short user-facing description
   of what THAT tab shows (no jargon). Do not dump one big block + a wall of
   images.
4. The tab set can change (tabs added/removed/renamed): re-run the script,
   delete orphaned `images/ur-*.png`, and add/remove/rename the README
   subsections + image names to match. The filename derives from the tab
   display name (lowercase, spaces -> dashes, symbols dropped).
5. The images are shipped (README references them) — regenerate + README
   updates belong in the SAME change. The screenshot script itself is
   maintainer-only (git/npm/docker-ignored), like the other dev helpers.

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

**User dialogs:** most AI models make a mess of these. The reference
implementation is `ui/aftc-ui.ts` (all dialogs go through it). Read `docx/1_extension_source/1.3_ui/1.3_ui_documentation.md` before building any UI.

---

# Feature documentation (read BEFORE working on a feature)

| Feature | Read this first |
| --- | --- |
| aftc-ui (dialogs & overlays) | `docx/1_extension_source/1.3_ui/1.3_ui_documentation.md` |
| aftc-console (console output) | `docx/1_extension_source/1.3_ui/1.3_ui_documentation.md` |
| Usage report | `docx/1_extension_source/1.4_footer_usage/1.4_footer_usage_documentation.md` |
| Data dir & packaging | `docx/2_packaging/2_packaging_documentation.md` |
| Config files (live + shipped) | `docx/1_extension_source/1.2_core_infrastructure_documentation.md` |
| aftc-codex knowledge base | `docx/1_extension_source/1.7_aftc_codex/1.7_aftc_codex_documentation.md` |
| Footer widget | `docx/1_extension_source/1.4_footer_usage/1.4_footer_usage_documentation.md` |
| SSH | `docx/1_extension_source/1.6_ssh/1.6_ssh_documentation.md` |
| Audio notifications | `docx/1_extension_source/1.5_feature_modules/1.5_feature_modules_documentation.md` |
| Slash commands (create/edit/delete) | `docx/1_extension_source/1.5_feature_modules/1.5_feature_modules_documentation.md` |
| Sub-agents (/007) | `docx/1_extension_source/1.9_subagents/1.9_subagents_documentation.md` |
| Peer chat (/chat) | `docx/1_extension_source/1.5_feature_modules/1.5.16_chat.md` |
| Background terminals (/bt) | `docx/1_extension_source/1.5_feature_modules/1.5.17_background_terminals.md` |
| File search (fd + rg) | `docx/1_extension_source/1.5_feature_modules/1.5.19_file_search.md` |
| Tool-error tracking (report Errors tab) | `docx/1_extension_source/1.4_footer_usage/1.4.5_usage_report.md` |
| Keyboard shortcuts (add/change) | `extensions/aftc-toolset/keys-readme.md` |
| Quick dir access (/qd) | `extensions/aftc-toolset/quick-open-dir-readme.md` |
| docx documentation generator (/docx) | `extensions/aftc-toolset/docx/docx-readme.md` |

If any modifications or changes are requested or needed to be made to a feature,
you must read its documentation file listed above before making them.

**Adding a keyboard shortcut.** All global shortcuts live in ONE place:
`extensions/aftc-toolset/keys.ts` — never register a shortcut in another module
(component-scoped keys inside dialogs/overlays stay with their component).
How: `pi.registerShortcut("alt+x", { description, handler })`, guard handlers
with `ctx.hasUI`. Shortcuts are NOT help-registry material — add a static row to
`SHORTCUT_ROWS` in `help.ts` instead, update `keys-readme.md`, and extend
`tests/keys-check/`. If the action also gets a companion slash command, that
command follows `docx/1_extension_source/1.5_feature_modules/1.5_feature_modules_documentation.md`. Key/chord format and the built-in
defaults to avoid colliding with: pi's `docs/keybindings.md`.

---

## aftc-console — transcript + diagnostic output

Every feature writes to the user's console through `ui/aftc-console.ts` — never raw
`ctx.ui.notify` or `console.log("[aftc-toolset]…")`. Read
`docx/1_extension_source/1.3_ui/1.3_ui_documentation.md` before using it. Quick map:

- `aftcConsole.init(pi)` — once per session (`index.ts` only).
- `aftcConsole.emphasis(ctx, text)` — accent/emphasis line for status / success / state-change (NOT a warning).
- `aftcConsole.warn(ctx, text)` — yellow; the action could not proceed (nothing selected, missing args, not connected).
- `aftcConsole.error(ctx, text)` — red; hard failure.
- `aftcConsole.info(ctx, text)` — dim; rare neutral aside.
- `aftcConsole.log(text)` — `[aftc-toolset]` stdout diagnostic chatter; the stdout echo is gated by `debugLoggingEnabled` (default off, `/aftc-debug-log-on|off`) and every line is captured in `<dataDir>/debug.log` either way.
- `aftcConsole.logError(text)` — failure diagnostics; never gated (stdout + debug.log).
- `aftcConsole.print(text)` — headless command responses; never gated, not filed.


# Live vs seed (terminology)

- **live** = the user's per-user copy in the persistent OS data dir
  (`<dataDir>/`, eg `%APPDATA%\pi-aftc-toolset\data\` on Windows;
  `AFTC_TOOLSET_DATA_ROOT` override). Holds `config.json`, `aftc-codex/`,
  `turns.db`, `ssh.json`, `subagents-config.json`, `usage-report/` (report
  app + generated `data.json`). Survives `pi update`.
- **seed / shipped** = source-only defaults + assets inside the package
  (`extensions/aftc-toolset/data/`): `extension-config.json`, the `aftc-codex/`
  seed, audio MP3s, intro assets. Replaced on every `pi update`. Flow is
  one-way: seed -> live, copy-only.

# Config files — read `docx/1_extension_source/1.2_core_infrastructure_documentation.md` FIRST

Two config files, never to be confused:

- **LIVE** `<dataDir>/config.json` — user preferences. API:
  `getPreference`/`setPreference` (`config.ts`). "config.json" in docs and
  conversation means THIS file.
- **SHIPPED** `<packageRoot>/extensions/aftc-toolset/data/extension-config.json`
  — package-shipped values (`subagentsSeedVersion`, `usageReportVersion`
  today). Never copied to live.

BINDING: never cache either file in module memory — read from disk on EVERY
access. pi keeps extension modules alive across `/new`, so a cache serves
stale values after a hand edit, and a later `setPreference` would flush the
stale cache back and clobber the user's edits. `setPreference` is a fresh
read-modify-write. Full contract + edge cases: `docx/1_extension_source/1.2_core_infrastructure_documentation.md`.


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
  per feature. Never mix two features' files. See `docx/2_packaging/2.1_shipped_data.md`.
- Each `.ts` module needs a sibling `<module-name>-readme.md`. Keep both current.
- Re-read only the relevant documentation when needed. Do not reload everything.
- Never read/modify files under `.old`, `.bak`, or `.git` unless asked.
- Do not use Git unless the user explicitly asks.
- Workflow: functionality first, then hands-on Windows verification.

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
- Send all console output through `ui/aftc-console.ts` (`aftcConsole.warn/error/info/emphasis` for the transcript, `aftcConsole.log` for `[aftc-toolset]` stdout). See `docx/1_extension_source/1.3_ui/1.3_ui_documentation.md`.
- Give every tool a `promptSnippet`. Make `promptGuidelines` bullets name the tool
  explicitly ("Use my_tool when...", never "Use this tool when...").
- Strip a leading `@` from path parameters (some models add it).
- SSH model tools use saved connections by name and opaque session ids only.
  Credentials never cross into model-visible context.
- **Config persistence rule.** User-configurable values go in `config.json` via
  `getPreference`/`setPreference`. New preference: add to `Preferences` interface,
  `DEFAULT_PREFERENCES`, AND (only when the migrated value can't be the
  default) a special-case backfill in `config.ts` — plain keys are backfilled
  automatically; retiring a key = remove it from both + one line in
  `RETIRED_KEYS`. See
  `docx/1_extension_source/1.2_core_infrastructure_documentation.md` for the full table and process.

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
- Root `README.md` is user-facing.
- Technical detail belongs in per-module `*-readme.md` files and `./docx/`.

---

# Documentation and releases

- Versioning: `major.minor.patch`.
- Patch bump: any fix or change to an EXISTING feature — including new
  commands/options added to it (eg a new `/codex-*` command is a change to
  the codex feature, so it is a patch, not a minor).
- Minor bump (reset patch): a brand-new feature that is NOT part of an
  existing feature (a new capability area, eg `/docx` when it was added).
  The ONLY time an existing feature gets a minor bump is when that feature
  is heavily re-written.
- Major bump: overhaul or rewrite of the package as a whole.
- Keep root documentation aligned with implemented behaviour.

## Shipping ("ship it", "push it up to github", "release it", "ship vX.X.X")

When the user says ANY of these, run `ship-it.bat` from the repo root
(Windows, `cmd /c ship-it.bat`). That is the ENTIRE flow - one run, no
checklist, no asking which steps, no manual git/gh steps:

1. Make sure `package.json`'s `version` is what is being shipped - never
   invent it. If the user named a version ("ship vX.X.X") or a bump is
   needed per the version rules above, set it now, then continue.
2. Run `cmd /c ship-it.bat` from the repo root.

The bat reads the version, `git add -A` (stages everything - make sure the
working tree is what you want shipped), commits `vX.X.X`, pushes, and
creates the GitHub release (tag = title = vX.X.X, no notes), skipping the
commit or release when there is nothing to do. Do NOT repeat any of those
steps by hand afterwards, and do NOT add extra steps (no tests run by the
flow, no descriptions). `ship-it.bat` is local-only
(git/docker/npm ignored, never committed) and contains no credentials.

---

# Tests

There are no automated test suites in this project — the `tests/` directory
has been removed. Verification is hands-on: make the change, load the
extension (a jiti module-load smoke check catches import/type errors), and
have the user exercise the feature in a real pi session on Windows before
declaring it done. Do not automate visual UI checks — ask the user to verify.
A broken feature is caught by the user's hands-on test, not a suite.

---

# Task processing (tasks.md)

- `tasks.md` is the authoritative record. Group tasks into sections.
- Markers: `[ ]` not started, `[/]` in progress, `[X]` complete.
- Update continuously (never batch). Flip to `[/]` on start, `[X]` on verify.
- If a task affects an older task, reset the older one to `[ ]` and process it.
- Order: functionality first, then Windows verification.
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
  aftc-codex feature you must read `docx/1_extension_source/1.7_aftc_codex/1.7_aftc_codex_documentation.md` before making them.
