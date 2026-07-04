# project_guide.md

Everything needed to resume development on `pi-aftc-toolset` in a new
fresh context window. Read this once, then start work.

If you need a refresher on pi itself (events, tools, widgets,
themes, etc.), see [`pi_guide.md`](./pi_guide.md). For copies of the
official pi docs, see `docs/pi-docs/`.

---

## 1. What this project is

`pi-aftc-toolset` is a [pi](https://pi.dev) extension package that
adds a set of productivity tools to the pi coding agent:

- A **live cache-dashboard widget** rendered below the editor,
  showing model, thinking level, cache hit rate, cost rate, context
  window clock, tool costs, and thinking/response times.
- **SQLite-backed per-turn usage recording** with an HTML report
  generator (lifetime totals, model leaderboards, summary cards,
  trend chart, per-model cost tables, cost projections).
- A **SSH remote terminal** feature backed by a local PyQt6 GUI
  (credentials stay in the GUI, never in the prompt).
- A **response divider** (full-width rule above each assistant
  reply).
- `alt+c` shortcut to clear the input editor.
- `/theme` shortcut that opens a theme picker and switches the
  active theme.
- `/aftc-help` command reference, `/aftc-install` dependency
  installer, and various `/cache-*` commands.
- `/aftc-stop` / `/stfu` emergency-abort commands to escape
  runaway thinking or tool-call loops.
- `/cd` (with `/cd-set-max-depth`) interactive directory
  switcher.
- A bundled `cache-audit` skill, a bundled `bulk-read` skill
  (concatenates many files into one markdown document for fast
  project-wide reads), and two bundled themes: `cache-viz`
  (green/cyan, cache-focused) and `aftc-orange-viz`
  (orange-accented sea-shells variant).

Package root: `W:\Dev\pi-aftc-toolset` (Windows).
Global pi install: `C:\Users\Darcey\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent`.

---

## 2. Project layout

```
pi-aftc-toolset/
├── extensions/toolset/                ← single pi extension
│   ├── index.ts                       ← orchestrator (entry point)
│   ├── core.ts                        ← data + events + commands
│   ├── footer-widget.ts               ← widget rendering + /aftc-footer
│   ├── usage-recording.ts             ← per-turn SQLite recording
│   ├── usage-report.ts                ← /usage-report + /usage-clear
│   ├── install.ts                     ← /aftc-install
│   ├── help.ts                        ← /aftc-help
│   ├── ssh.ts                         ← SSH tools + commands
│   ├── response.ts                    ← response divider
│   ├── input-clear.ts                 ← alt+c shortcut
│   ├── theme.ts                       ← /theme shortcut to pi's theme picker
│   ├── stfu.ts                        ← /aftc-stop + /stfu interrupt commands
│   ├── cd.ts                          ← /cd + /cd-set-max-depth directory switcher
│   ├── db.ts                          ← SQLite utility
│   ├── paths.ts                       ← path helpers
│   ├── types.ts                       ← shared interfaces
│   ├── info.md                        ← ANSI/theme color reference
│   ├── readme.md                      ← folder-level overview
│   └── <name>.readme.md               ← per-file README (one per TS file)
│
├── skills/cache-audit/SKILL.md        ← bundled cache-audit skill
├── skills/bulk-read/SKILL.md          ← bundled bulk-read skill (Node.js script inline)
├── themes/cache-viz.json              ← bundled theme (green/cyan)
├── themes/aftc-orange-viz.json        ← bundled theme (orange sea-shells variant)
├── internal-python-gui/               ← SSH GUI (PyQt6 + paramiko + Flask)
│   ├── main.py
│   ├── std/                           ← IPC files (out.txt, in.txt, err.txt)
│   ├── bin/uv.exe                     ← bundled Python package manager
│   └── pyproject.toml
│
├── tests/                             ← integration tests (one folder each)
│   ├── readme.md
│   ├── parse-check/                   ← smoke test: jiti parses usage-report.ts
│   ├── full-check/                    ← DB + projections + HTML structure
│   ├── widget-render-check/           ← orchestrator + footer widget + ticker
│   ├── stfu-check/                    ← /aftc-stop + /stfu: idle / streaming / headless
│   ├── bulk-read-check/               ← bulk-read skill: script extract + walk + manifest
│   ├── theme-check/                   ← /theme: register, pick, cancel, setTheme-fail, no-UI
│   └── load-test/                     ← end-to-end: factory + events + commands + SQLite
│
├── docs/                              ← meta-documentation
│   ├── pi_guide.md                    ← working with pi (general)
│   ├── project_guide.md               ← this file
│   └── pi-docs/                       ← copies of official pi docs
│
├── .pi-aftc-toolset/                  ← extension-owned runtime state (gitignored)
│   └── data/
│       ├── state.json                 ← cross-session user preferences (the only persisted state)
│       ├── turns.db                   ← SQLite usage database
│       └── report.html                ← latest generated report

   `state.json` holds user preferences that persist across ALL
   session boundaries (footer AVG timeframe, footer on/off, response
   divider on/off). It is created with `DEFAULT_PREFERENCES` on first
   access and only re-written when one of those preferences actually
   changes. There is no per-session resumption state anymore — cache
   accumulators, timing, model info, and the context-window clock are
   per-session and live only in the `core.ts` closure, reset on every
   `session_start`. See `extensions/toolset/state.readme.md` for the
   full contract.
│
├── .pi/settings.json                  ← dev self-reference: { packages: [".."] }
├── package.json                       ← pi manifest + npm metadata
├── rules.md                           ← source-of-truth conventions
├── README.md                          ← public docs (install, commands, etc.)
├── LICENSE
├── full-check.mjs                     ← (legacy - moved to tests/full-check/)
├── parse-check.mjs                    ← (legacy - moved to tests/parse-check/)
└── widget-render-check.mjs            ← (legacy - moved to tests/widget-render-check/)
```

---

## 3. The orchestrator pattern (rules.md §1.5)

Feature modules do **not** import each other. The orchestrator
(`extensions/toolset/index.ts`) is the single place that knows
about every module and wires them together.

```
index.ts (orchestrator)
  ├─→ usage-recording.ts → UsageRecorder (TurnRecorder impl)
  ├─→ usage-report.ts → UsageModule
  ├─→ help.ts → HelpModule
  ├─→ install.ts → InstallModule
  ├─→ input-clear.ts (no return)
  ├─→ theme.ts (no return)
  ├─→ ssh.ts → SshModule
  ├─→ response.ts (no return)
  ├─→ stfu.ts (no return)
  ├─→ cd.ts (no return)
  ├─→ core.ts(pi, recorder) → FooterDataProvider
  └─→ footer-widget.ts(pi, dataProvider)
```

Two cross-module data flows:
1. `core.ts(pi, recorder)` - orchestrator passes the
   `UsageRecorder` instance into `createCore` so core can call
   `recordTurn(...)` on every `message_end`.
2. `footer-widget.ts(pi, footerData)` - orchestrator passes the
   `FooterDataProvider` returned by `createCore` into
   `createFooterWidget` so the widget reads cache/timing state
   without importing core.

Cross-module types live in `types.ts` (`TurnRecord`, `TurnRecorder`,
`FooterDataProvider` and the view types).

---

## 4. Rules to follow (rules.md in full)

`rules.md` is the source of truth. The most important rules:

1. **KISS** - keep code and folders logical, clean, simple. Don't over-engineer.
2. **Simplest approach** - fewer files, fewer abstractions, fewer events.
3. **No build step** - pi loads via jiti. TypeScript works as-is.
4. **Modular files** - `extensions/toolset/help.ts` handles help, `input-clear.ts` handles clearing, etc.
5. **Orchestrator pattern** - feature modules don't import each other.
6. **Version is in `package.json` only** - not in README, not in headings.
7. **Tests in `tests/<test-name>/`** - one subfolder per test.
8. **Per-file READMEs** - `<name>.readme.md` next to each TS file; folder-level `readme.md` for structural overview.

Read `rules.md` whenever you're not sure how to do something - it
has the conventions baked in.

---

## 5. Slash commands and tools registered

All commands register via `pi.registerCommand` and tools via
`pi.registerTool`. Keep `help.ts`'s static table in sync with the
actual `registerCommand` / `registerTool` calls in each file.

### Commands (21)

| Command | File | Description |
|---|---|---|
| `/aftc-help` | help.ts | Static command/shortcut reference |
| `/aftc-install` | install.ts | Install better-sqlite3 + Python SSH GUI deps |
| `/aftc-footer` | footer-widget.ts | Toggle the cache dashboard widget |
| `/aftc-footer-report-timeframe` | core.ts | Set the footer 4th-line time window (Today, 3h, 6h, 24h, 2d, 3d, 7d, 28d) |
| `/aftc-response-divider` | response.ts | Toggle the response divider |
| `/aftc-stop` | stfu.ts | Stop the current agent operation (alias for /stfu) |
| `/stfu` | stfu.ts | Short alias for /aftc-stop |
| `/cache-profile` | core.ts | Per-tool token costs, prefix shape, churn analysis |
| `/cache-stats` | core.ts | Current-context cache diagnostics + cost rate |
| `/cache-reset` | core.ts | Zero accumulators and timer (debugging) |
| (cost-timer removed) | - | Two-mode toggle removed. Context clock is always wall-clock from first user prompt. |
| `/cls` | core.ts | Clear the terminal screen |
| `/theme` | theme.ts | Open a theme picker and switch to the selected theme |
| `/cd` | cd.ts | Switch directory (interactive picker or one-shot path) |
| `/cd-set-max-depth [2-10]` | cd.ts | Set the /cd picker listing depth (default 3) |
| `/usage-report` | usage-report.ts | Write + open `report.html` |
| `/usage-clear` | usage-report.ts | Delete all SQLite rows (with confirmation) |
| `/ssh-gui` | ssh.ts | Launch the local PyQt6 SSH GUI |
| `/ssh-connect` | ssh.ts | Connect to `user@host[:port]` |
| `/ssh-run` | ssh.ts | Run a one-shot command on the connected server |
| `/ssh-status` | ssh.ts | Show GUI running state + connection status |
| `/ssh-disconnect` | ssh.ts | Disconnect the active SSH session |

Skills (loadable workflows, not slash commands in the strict sense but referenced via `/skill:<name>`):

| Skill | Location | Description |
|---|---|---|
| `/skill:cache-audit` | skills/cache-audit/SKILL.md | Bundled cache-hit and prefix diagnostics workflow |
| `/skill:bulk-read` | skills/bulk-read/SKILL.md | Bundled workflow for reading many files into one markdown document |

### Tools (5 - all from ssh.ts)

| Tool | Purpose |
|---|---|
| `ssh_status` | Is the GUI reachable? Is it connected? |
| `ssh_connect` | Launch GUI if needed, connect to `user@host[:port]`, optionally run initial command (default: `ls -la`) |
| `ssh_run` | Send a non-interactive shell command (1-120s timeout) |
| `ssh_peek` | Read recent output from API buffer or full `std/out.txt` log |
| `ssh_interrupt` | Send repeated Ctrl+C / Ctrl+D to break hung commands |

### Shortcuts (1)

| Shortcut | File | Description |
|---|---|---|
| `alt+c` | input-clear.ts | Clear the input editor |

---

## 6. SQLite schema (db.ts)

DB path: `<package-root>/.pi-aftc-toolset/data/turns.db`

```sql
CREATE TABLE IF NOT EXISTS turns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    turn            INTEGER NOT NULL,
    timestamp       INTEGER NOT NULL,
    model_name      TEXT,
    thinking_level  TEXT,
    thinking_ms     INTEGER NOT NULL,
    response_ms     INTEGER NOT NULL,
    cost_usd        REAL NOT NULL,
    input_tokens    INTEGER NOT NULL,
    output_tokens   INTEGER NOT NULL,
    cache_read      INTEGER NOT NULL,
    cache_write     INTEGER NOT NULL,
    user_prompt     INTEGER NOT NULL DEFAULT 0,
    prompt_index    INTEGER NOT NULL DEFAULT 0,
    sub_prompt      INTEGER NOT NULL DEFAULT 0,
    session_id      TEXT NOT NULL DEFAULT '',
    base_prompt     INTEGER NOT NULL DEFAULT 0,
    steering_prompt INTEGER NOT NULL DEFAULT 0,
    followup_prompt INTEGER NOT NULL DEFAULT 0,
    continuation_prompt INTEGER NOT NULL DEFAULT 0,
    prompt_kind     TEXT NOT NULL DEFAULT ''
);
```

Migrations are idempotent - each ALTER runs in a try/catch so
already-existing columns are silently skipped.

`getDb()` returns `null` if `better-sqlite3` isn't installed. Both
recorder and report handle `null` gracefully (recorder is a no-op,
report shows an error notification).

---

## 7. Event flow

```
session_start          → core.resetState, footer.show
  (no provider calls yet)

user submits prompt
  input                → core._pendingStreamingBehavior
  message_start (user) → core._pendingUserTurn = true
                          core._sessionStartTime = Date.now() (in-memory)
                          core.recomputeCachedSession
  before_agent_start   → core.refreshToolCache, response.divider inject
  agent_start          → (no handler)

  ┌─ turn loop ─┐
  │ message_start (assistant)  → core timing starts
  │ message_update             → core captures first output
  │ ...stream...
  │ message_end (assistant)    → core accumulators, recordTurn to SQLite
  │ tool_execution_*           → (no handler)
  │ turn_end                   → (no handler)
  └──────────────┘

  agent_end            → core logs to stdout (headless only)

(next prompt, or /compact, or /reload, etc.)
```

---

## 8. Adding a new feature module

Workflow for adding a new feature (e.g. a "recent files" widget):

1. **Create `extensions/toolset/recent-files.ts`** with the factory:
   ```typescript
   export function createRecentFiles(pi: ExtensionAPI): void {
       // subscribe to events, register commands, etc.
   }
   ```
2. **Create `extensions/toolset/recent-files.readme.md`** documenting:
   - What it does
   - Events subscribed
   - Commands / tools / shortcuts registered
   - Public factory signature
   - Failure modes
3. **Update `extensions/toolset/readme.md`** (folder-level) to add the
   new file to the file map table.
4. **Update `extensions/toolset/index.ts`** to instantiate the new
   module: `createRecentFiles(pi);`
5. **If the new module registers commands**: update `help.ts`'s
   `GENERAL_COMMANDS` (or appropriate category) table so `/aftc-help`
   lists it.
6. **If using data from another module**: define a structural
   interface in `types.ts` and have the producer module return it;
   the consumer module takes it via the orchestrator (no direct
   imports).
7. **Add a test** in `tests/<test-name>/` if the new module has
   non-trivial behaviour.

---

## 9. Common workflows

### Adding a new slash command

```typescript
// In an existing or new module
pi.registerCommand("my-cmd", {
    description: "What this command does.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
        // ctx has ExtensionCommandContext (newSession, fork, etc.)
        // Long output → ctx.ui.select(title, lines, { timeout })
    },
});
```

Then add the command to `help.ts` so `/aftc-help` lists it.

### Adding a new tool

```typescript
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "What this tool does for the LLM.",
    promptSnippet: "Short summary shown in Available tools.",
    promptGuidelines: [
        "Use my_tool when the user asks to X.",
    ],
    parameters: Type.Object({
        input: Type.String({ description: "..." }),
        count: Type.Optional(Type.Number({ minimum: 1 })),
    }),
    execute: async (_id, params, signal, onUpdate, ctx) => {
        // Throw on error (sets isError: true), don't return { isError: true }
        return {
            content: [{ type: "text", text: "result" }],
            details: { extra: "data" },
        };
    },
});
```

### Adding a new event handler

```typescript
pi.on("session_start", async (event, ctx) => {
    // event has reason, previousSessionFile?, etc.
    // ctx has cwd, hasUI, mode, model, signal, sessionManager, ui
    if (!ctx.hasUI) return;  // skip UI work in headless modes
    // ... setup ...
});

pi.on("session_shutdown", async (event, ctx) => {
    // Cleanup timers, processes, etc.
});
```

### Modifying the footer widget

`footer-widget.ts` reads from `FooterDataProvider`. To add a new line
or field to the widget:

1. Add a new view interface to `types.ts` (e.g. `MyDataView`).
2. Add the method to `FooterDataProvider`.
3. Implement the method in `core.ts`'s returned object.
4. Add a formatter in `footer-widget.ts` and a new line in `render()`.

### Modifying cache math

Cache-hit rate formula: `hitRate = cacheRead / (cacheRead + input)`.
`input` is the **new** prompt tokens only; `cacheRead` is the
cached prefix. Do not divide by `input` alone.

`core.ts` has `hitRateNum()` returning 0..1 (NaN if no data) and
`hitRate()` returning the formatted string. Modify these carefully
- the `/cache-profile` output and the widget both depend on them.

---

## 10. Tests

All tests are under `tests/`, each in its own subfolder.

```bash
node tests/parse-check/parse-check.mjs          # jiti parses usage-report.ts
node tests/full-check/full-check.mjs            # DB + projections + HTML structure
node tests/widget-render-check/widget-render-check.mjs  # orchestrator + widget + ticker
node tests/stfu-check/stfu-check.cjs            # /aftc-stop + /stfu: idle / streaming / headless
node tests/load-test/load-test.cjs              # end-to-end integration
```

Tests are dependency-free - `node` + `better-sqlite3` (already in
`dependencies`) + pi's bundled jiti only. No network, no TUI.

When adding a feature, add a test that exercises it. When changing
existing behaviour, update the relevant test.

---

## 11. Common pitfalls (also in pi_guide.md §14)

- **`ctx.model` is `undefined` on early renders.** Capture from
  `session_start` / `model_select` event contexts.
- **`pi.getAllTools()` order is not stable.** Sort before hashing
  or comparing.
- **`setFooter` is exclusive.** Use `setWidget` to coexist with
  other footer extensions.
- **Widget factories can be called multiple times.** Track the
  active component at module scope to avoid ticker leaks (see
  `footer-widget.ts`).
- **Don't `console.log` in TUI extensions.** Use `ctx.ui.notify`,
  `ctx.ui.select`, or your widget.
- **Errors throw, not return.** Throwing sets `isError: true`.
- **String enums use `StringEnum` from `@earendil-works/pi-ai`**,
  not `Type.Union` / `Type.Literal`.
- **No background resources in the factory.** Defer to
  `session_start` and clean up in `session_shutdown`.

---

## 12. Things that bit us (recent history)

- **Footer widget factory doing file I/O on every call.** Caused
  hangs / slowness. Fix: remove priming from factory; only prime in
  `show()`. Track active component at module scope to avoid
  ticker leaks.
- **`pi.exec is not a function` in tests.** The test stubs need to
  define `exec` and any other used API methods.
- **`ctx.ui.setStatus` and `ctx.ui.theme.fg` missing in test stubs.**
  The `response.ts` divider toggle uses both.
- **SQLite test failure: `user_prompt=0`.** The test was firing
  `message_end` for assistant without first firing `message_start`
  for user. Real pi always does this; tests must simulate it.
- **SQLite query returns rows from previous test runs.** Filter by
  `timestamp >= tsBefore` (captured before the test runs).

---

## 13. Quick start for the next session

```bash
cd W:/Dev/pi-aftc-toolset

# Run all tests to confirm baseline
node tests/parse-check/parse-check.mjs
node tests/full-check/full-check.mjs
node tests/widget-render-check/widget-render-check.mjs
node tests/load-test/load-test.cjs

# Read the per-file README for the module you're touching
# (e.g. extensions/toolset/core.readme.md)
```

When in doubt: read `rules.md`, then the per-file `<name>.readme.md`
for the file you're modifying.