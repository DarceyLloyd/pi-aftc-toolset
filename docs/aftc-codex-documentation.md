# aftc-codex — Technical Documentation

An opt-in knowledge base for pi. Injects curated coding rules + guidance + a
resource list into the model's system prompt (cached prefix), and provides a
`codex_load` tool for on-demand topic docs. Off by default.

---

## Architecture

Coordinator pattern: `aftc-codex.ts` owns shared state and wires sub-modules.
Sub-modules import shared types FROM the coordinator (type-only) and never import
each other. Wired into the extension via one `createAftcCodex(pi)` call in
`extensions/aftc-toolset/index.ts`.

```
extensions/aftc-toolset/aftc-codex/
├── aftc-codex.ts              # Coordinator: createAftcCodex(pi), shared state, codex_load tool
├── codex-store.ts             # Data-dir layout, copy-only seeding, resource reads, script spawns
├── codex-inject.ts            # before_agent_start injection, session lifecycle, context prune
├── codex-detect.ts            # Project technology auto-detection
├── codex-learn.ts             # /aftc-codex-learn prompt injection
├── codex-entries.ts           # codex_add_entry / codex_edit_entry / codex_remove_entry tools
├── codex-compat.ts            # Version compatibility guard (pure TS)
├── codex-commands.ts          # /aftc-codex-* commands + config menu
├── codex-commands.ts          # /aftc-codex-* commands + config menu
├── scripts/
│   ├── sync-codex-resources.mjs   # Regenerates codex-resource-list.md (byte-stable)
│   ├── ensure-entry-ids.mjs       # Adds unique 6-char [ID]s to entries missing them
│   └── live-to-seed-sync.mjs      # Maintainer-only release tool (never wired in)
└── *-readme.md                # Per-module companion docs
```

### Shared types (exported from aftc-codex.ts)

```typescript
interface CodexState {
    prepped: boolean;             // AI prepped this session (rules inject when enabled)
    silent: boolean;              // Per-session suppression (set by /codex-disable)
    noticedThisSession: boolean;  // Fresh-session notice guard (once per session)
}

interface CodexContext {
    pi: ExtensionAPI;
    store: CodexStore;
    state: CodexState;
    detectTopics?(cwd: string): string[];  // Set after detect module is built
    checkCompat(): { isSafe: boolean; message: string };  // Central version guard
}
```

---

## Two-Copy Data Model

pi replaces the whole package directory on `pi update`, wiping anything inside.
The knowledge base therefore lives in two places:

```
SHIPPED SEED (source only, in package)          USER LIVE COPY (per-user, survives update)
─────────────────────────────────────────       ──────────────────────────────────────────
extensions/aftc-toolset/data/aftc-codex/   →   <dataDir>/aftc-codex/
├── codex-rules.md                              ├── codex-rules.md
├── thought-and-action-guidance.md              ├── thought-and-action-guidance.md
├── markdown-guidance.md                        ├── markdown-guidance.md
└── resources/                                  └── resources/
    ├── languages/*.md                              ├── codex-resource-list.md  (GENERATED, not shipped)
    ├── libraries/*.md                              ├── languages/*.md
    ├── frameworks/*.md                             ├── libraries/*.md
    ├── engines/*.md                                ├── frameworks/*.md
    ├── tools/*.md                                  ├── engines/*.md
    └── runtimes/*.md  (extra folder; ANY           ├── tools/*.md
        folder is discovered dynamically)            └── runtimes/*.md
```

**Rules:**
- Strict one-way copy: seed → live. The seed never overwrites a live file at
  runtime; shipped rule/guidance/resource updates reach the user only through a
  full reinstall ("Start Fresh" in the /codex menu, or `/aftc-codex-install`),
  which deletes the live copy and installs a full fresh copy of the seed.
- Seeding is copy-only for LEARNED content: existing live `resources/` files are never
  overwritten; user entries persist.
- The seed is SOURCE only: no generated/runtime files (`codex-resource-list.md`).
- User edits (via `/aftc-codex-learn` or manual) live only in the live copy.
- "Start Fresh" / re-install: delete the whole live codex dir and re-seed the
  full shipped copy (confirmed, irreversible).

**Data dir resolution** (`paths.ts`):
| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\pi-aftc-toolset\data\aftc-codex\` |
| macOS | `~/Library/Application Support/pi-aftc-toolset/data/aftc-codex/` |
| Linux | `$XDG_DATA_HOME/pi-aftc-toolset/data/aftc-codex/` (fallback `~/.local/share/...`) |
| Override | `AFTC_TOOLSET_DATA_ROOT` env |

---

## Injection Mechanics (Hybrid, Cache-Friendly)

### System-prompt prefix (stable, cached)

`before_agent_start` returns `{ systemPrompt: event.systemPrompt + block }` when
`enabled && prepped && !silent`. The block is read fresh from disk each turn
(byte-stable files → no prefix churn → cache hits every turn after the first):

```
# AFTC Codex — Knowledge Base Rules & Resources
<codex-rules.md content>

## Thinking & Action Guidance              (when aftcCodexInjectGuidance = true)
<thought-and-action-guidance.md content>

## Codex Resource List
<codex-resource-list.md content>

Fetch any listed resource on demand with codex_load...
```

Never pollutes history. Never accumulates. Resume-proof.

### Marker message (prunable, in history)

A lightweight `aftc-codex-marker` custom message is the detectable "codex presence"
in conversation history. It carries a short instruction to fetch relevant docs via
`codex_load`. When `aftcCodexAutoLoad` is on, detected project topics are appended.

### Durable per-session state

`prepped` / `silent` are persisted via `pi.appendEntry("aftc-codex-state", {...})`
(custom entry — NOT in LLM context). Restored on `session_start` by scanning entries.
Survives compaction and resume. `silent` resets each session; `prepped` persists.

### Fresh-session detection

Uses `session_start.reason` (no `getEntries()` heuristic):
- Fresh (`new` / `startup`): show a stand-out transcript notice (TUI) or auto-prep (print/headless).
- Restore (`resume` / `reload` / `fork`): restore `prepped` from entries, no nagging.

The notice is a durable custom entry (`aftc-codex-prep-notice`) rendered via
`registerEntryRenderer` — no timer, no TUI-ready wait. When the live copy is
behind the shipped version (the central guard, `ctx.checkCompat()`), the notice
gains a white `NOTICE: ... run /codex-install` line.

---

## Context Pruning

The `context` event handler is a NON-DESTRUCTIVE filter of the LLM-bound deep copy
(stored history is untouched — pi cannot delete stored entries):

- `codex_load` docs removed as matched **tool_use + tool_result PAIRS** (the ToolCall
  block is stripped from the assistant message AND its tool_result message removed).
  A tool_use is never orphaned. An assistant message emptied by pruning is dropped.
- When `!enabled || silent` → ALL codex (markers + docs) removed.
- Otherwise: the **latest generation** of docs (last assistant message with `codex_load`
  calls) and the **latest marker** are kept; older ones pruned.
- Non-codex messages/tool pairs are never touched.
- Returns `undefined` when nothing changed (referential equality preserved).

---

## Project Detection (`codex-detect.ts`)

Scans `ctx.cwd` and maps signals to topic docs:

| Signal type | Examples |
| --- | --- |
| File extensions | `.ts`→typescript, `.cpp/.hpp/.h`→cpp, `.cs/.sln/.csproj`→cs, `.razor`→blazor, `.rs`→rs, `.java`→java, `.twig`→twig, `.sh`→bash, `.bat/.cmd`→batch, `.wxs`→wix, `.scss`/`.sass`→scss |
| package.json deps | `three`→threejs, `chart.js`→chartjs, `gsap`, `puppeteer`, `vite`, `electron`, `@shoelace-style/shoelace`→shoelace |
| package.json scripts/fields | keys + values word-scanned for `bun`/`bunx`/`vite`/`webpack`/`node`; `bin`/`engines.node`→nodejs |
| Marker files | `Dockerfile`→docker, `composer.json`→php+composer, `project.godot`→godot, `deno.json`→deno, `nginx.conf`→nginx, `.htaccess`→apache, `CMakeLists.txt`→cmake, `Cargo.toml`→rs, `pom.xml`/`build.gradle`→java |
| Marker dirs | `aftc-framework/`→aftc-framework |
| Content scan (≤64 KB, ≤24 files) | `*.csproj`→blazor/dotnet-maui, `CMakeLists.txt`→juce, compose files→mysql/nginx |
| Auto-inject docs | the `<!-- AFTC-CODEX-STACK topics: ... -->` block (explicit pins, unioned) + a stoplisted whole-word keyword scan of `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/`.cursorrules`/`.windsurfrules`/`.github/copilot-instructions.md` |
| Pi manifest | `package.json` with `pi` key → pi-extension |
| Implied topics | any design domain→design-common, mysql→database-common |

Every `package.json` found in the walk is parsed (the root one first, guaranteed),
so tools declared by a nested app (eg `web/package.json`) are still detected.
The result SPLITS: `topics` (a live resource exists — loadable, named in the
marker) and `missing` (mapped but no resource file yet — named in the marker as a
"no codex resource yet" bootstrap hint). Guidance topics are excluded from both.
Results are cached per cwd for the session.

**The stack block** (`<!-- AFTC-CODEX-STACK` / `topics: a, b, c` / `-->`) is the
ONLY detection path for the design domains and target OS (nothing in a file tree
says "web-app") and doubles as user pinning — including for stoplisted topic
names (`go`, `windows`, `bun`, ...) that the free-text keyword scan ignores.
The codex rules instruct the model to create/maintain the block in the project's
auto-inject files.

**Bounded scan:** skips heavy dirs (`node_modules`, `.git`, `dist`, `.venv`,
`__pycache__`, any dot-dir), caps depth (6) and files visited (8000).

---

## Rules-only mode (`/codex-rules-only`)

A PER-SESSION mode (state, not a preference — nothing persists to config):
`/codex-rules-only` injects ONLY the `## Critical Global Rules` section
extracted from codex-rules.md (heading → next `## ` heading). No
enabled/prepped/silent/compat gates, no marker, no list, no guidance, no prep
notice — the zero-ceremony "common do-nots" option (the alternative to
hand-crafting per-project AGENTS.md rules). It works even with the feature
disabled (the `aftcCodexEnabled` pref is never touched), reads the LIVE rules
when seeded (user customisations honoured) and falls back to the SEED rules
when not. While active, `/codex-init`, `/codex-refresh` and `/codex-learn`
refuse with a warning. The state rides the durable `aftc-codex-state` entry so
it survives `/reload`, but a fresh session (`/new`) clears it — that is the way
back to the full codex: `/new`, then `/codex-init`.

---

## The codex entry tools (`codex-entries.ts`)

Three model tools make resource WRITES deterministic (replacing the old
hand-edit + hand-ID + bash-sync choreography):

- `codex_add_entry(topic, category?, entries[])` — batched appends. Generates
  the 6-char `[ID]` in TypeScript, strips wrapper noise (`- `, backticks,
  hand-made IDs, `Cause:`/`Fix:` prefixes, stale dates), validates the per-kind
  format (rule/gotcha = one line; issue = symptom + cause + fix with the current
  `(YYYY-MM)` auto-appended; one bad entry fails the whole batch, labelled
  `entries[i]`), inserts at the END of the matching canonical section, creates
  missing topic files (three-heading skeleton) and category folders (any
  well-formed lowercase name; new categories reported as a typo signal), and
  runs the list-sync internally ONLY when a topic file was created.
- `codex_edit_entry(topic, id, kind?, text?, cause?, fix?)` — targeted
  replacement by `[ID]`; unsupplied fields keep existing values; a `kind`
  change moves the entry to the matching section; issue dates refresh to
  current; unknown ID throws with the IDs present.
- `codex_remove_entry(topic, id)` — deletes the whole entry (an issue's
  Cause:/Fix: lines included). Never deletes the topic file; never touches the
  resource list.

**Guards (binding):** the central version guard runs first (unsafe => guard
message, no write); an EXISTING topic must have been read via `codex_load` THIS
SESSION (read-before-write, enforced via the coordinator-owned tracker:
`durableSeen` dedupes the durable `aftc-codex-read` entries, `sessionReads` is
cleared on fresh sessions and rebuilt from the durable entries on
resume/reload/fork); top-level fixed docs (rules/guidance/markdown/list) are
refused; an exact normalized duplicate lead is rejected with the existing
`[ID]` (semantic near-duplicates stay the model's job). Writes are atomic
(tmp + rename) and serialised through `withFileMutationQueue(absPath)`.

## The `codex_load` Tool

`codex_load(topic)` reads a topic doc on demand:
- Searches across ALL category folders + top-level (folder is organisation only).
- Fuzzy aliases: `ts`→typescript, `py`→python, `js`→javascript, `pine`→pinescript, `gd`→godot.
- Specials: `rules`, `guidance`, `list`, `markdown`.
- Strips a leading `@`, drops a trailing `.md`, supports explicit `category/name`.
- An empty resource (headings, no entries) returns a fixed one-liner ("exists but
  has no entries yet") instead of the file content — and still counts as a read
  for the entry tools' read-before-write guard.
- Truncates huge files (`truncateTail`, 50 KB / 2000 lines), states the full path.
- Throws on unknown topic with the valid list.
- Tracks reads durably via `pi.appendEntry("aftc-codex-read", { relPath })` for `/aftc-codex-status`.

---

## Self-Education (`/aftc-codex-learn`)

Injects a user message instructing the model to persist DURABLE, GENERAL lessons
using the codex entry tools (above). No hand-edited files, no bash-run sync —
the tools own every mechanical step; the prompt keeps only model judgement.

Steps enforced by the prompt:
1. Review the session for durable, general lessons.
2. Consult `codex-resource-list.md` (in the system prompt, or `codex_load("list")`)
   — update existing docs, never duplicate; create a new topic
   (`category/name`, new categories allowed) only when nothing covers it.
3. `codex_load` each target topic and check the lesson is not already there —
   ENFORCED: the write tools refuse a topic not loaded this session and reject
   exact duplicates.
4. Classify each lesson into one of the THREE entry kinds and write it with
   `codex_add_entry` (batched per topic; auto-add by default, or
   propose-then-confirm when `aftcCodexAutoAddEntries` is false):
   - **Rule** (`## Rules`) — a convention WE enforce; one line, no date:
     `- [ID] Never/Always X — one short reason.`
   - **Gotcha** (`## Gotchyas`) — a trap built INTO the technology; ONE line with
     BOTH the trap AND the countermeasure; no date:
     `- [ID] LEAD — the trap; what to do / watch for.`
   - **Issue & Solution** (`## Issues & Solutions`) — an OBSERVED failure with a
     diagnosis; the only dated kind (the tool appends the current date):
     ```
     - [ID] LEAD_TOKEN — one-line symptom
       Cause: why it happens.
       Fix: what to do. (YYYY-MM)
     ```
   All three headings are always present in every resource file (canonical order,
   even when empty — created by the tool's skeleton). Routing: TECH lessons >
   the correct `resources/{category}/<topic>.md` only (`-learn` never writes to
   the fixed top-level docs).
5. Correct or remove outdated entries noticed along the way
   (`codex_edit_entry` / `codex_remove_entry`).

The prompt names the live OS-data copy as the write target (the package seed is
read-only — the tools never touch it).

---

## Codex version + wipe-on-mismatch

The shipped codex carries an integer version in
`extensions/aftc-toolset/data/extension-config.json` (`codexVersion`; a package-shipped
config file that is never copied to the user's data dir). The user's live copy
records the version it was seeded from in the `aftcCodexVersion` config
preference (default 0 = pre-versioning installs).

- **Central guard:** `ctx.checkCompat()` (coordinator-wired, backed by
  `checkCodexCompatibility()` in codex-compat.ts) returns
  `{ isSafe: boolean; message: string }`. Every codex feature calls it:
  `before_agent_start` injection and `codex_load` pause when unsafe (an
  out-of-date copy is never injected/served), and the `/aftc-codex-*` commands show the
  message in an aftc-ui modal (Enter/Esc closes) and refuse to run — EXCEPT
  `/codex-install` (the fix), `/codex-disable` and `/codex-status`.
- **Wipe-on-mismatch:** when the versions differ, `/codex-install` (or Start
  Fresh in the /codex menu) DELETES the live codex dir (no backup, by design)
  and installs a full fresh copy of the seed, then `aftcCodexVersion` is set
  to the shipped version by the seed. On a mismatch there is NO confirmation
  prompt — the guard has been telling the user to run exactly this command,
  so typing it is the confirmation (works headless too). The confirmation
  modal only appears when the versions MATCH (a destructive re-install for
  no version reason).
- A missing/unreadable seed version disables all version logic (fail-soft:
  never wipes when unsure).
- The fresh-session NOTICE ("run /codex-install") is driven by the same guard,
  so a version mismatch surfaces without the user running anything.

---

## Commands

| Command | Aliases | Action |
| --- | --- | --- |
| `/aftc-codex` | `/codex` | Open the config menu (TUI only) |
| `/aftc-codex-enable` | `/codex-enable` | Enable + seed on first use (choice in TUI) |
| `/aftc-codex-disable` | `/codex-disable` | Disable + strip ALL codex from context |
| `/aftc-codex-init` | `/codex-init` | Prep: rules live + marker + model fetches docs |
| `/aftc-codex-refresh` | `/codex-refresh` | Strip all codex, then re-init (clean restart) |
| `/aftc-codex-install` | `/codex-install` | Fresh install or re-install (confirmed destructive when versions match; NO confirm on a version mismatch — the command itself is the confirmation) |
| `/aftc-codex-learn` | `/codex-learn` | Self-education prompt injection |
| `/aftc-codex-status` | `/codex-status` | Colored status: enabled, embedded, files read |
| `/aftc-codex-rules-only` | `/codex-rules-only` | Rules-only mode for this session: critical rules only, no docs/learn; `/new` + `/codex-init` returns to full |

**List-regeneration:** the resources menu (Start Fresh), `-learn`, `-install`, `-init`, and `-refresh`
spawn the list-regeneration script. Pure toggles (`-enable`/`-disable`/`-status`) skip it.

### Config menu structure

```
/aftc-codex — Main Menu (inline toggles re-render, selection preserved)
├── AFTC Codex Enabled .............. | Yes/No     [toggle; first enable → seed choice]
├── Thinking Guidance Injection ..... | ON/OFF     [toggle]
├── Auto-Detect & Load Docs ......... | ON/OFF     [toggle]
├── Task Addition Approval .......... | Auto/Manual [submenu]
├── Resources & Updates .............              [submenu]
│   ├── Start Fresh ................. [confirm-destructive] wipe live codex dir + full fresh seed copy
│   └── Open Codex Resource Dir ..... opens live resources/ in OS file manager
└── Help & Commands ................. [viewer]
```

---

## Config Preferences (`config.json`)

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `aftcCodexEnabled` | bool | `false` | Feature on/off |
| `aftcCodexInjectGuidance` | bool | `true` | Inject `thought-and-action-guidance.md` |
| `aftcCodexAutoLoad` | bool | `true` | Auto-detect project techs + name them in marker |
| `aftcCodexSeeded` | bool | `false` | First-run seed choice done |
| `aftcCodexAutoAddEntries` | bool | `true` | Auto-add entries (uniqueness-checked) vs propose-then-confirm |
| `aftcCodexVersion` | int | `0` | Live codex version (internal bookkeeping; mismatch vs the shipped data/extension-config.json `codexVersion` = wipe + re-seed on next /codex-install) |

All migrated into an existing `config.json` via the write-back pattern.

---

## Scripts

### `sync-codex-resources.mjs`

Regenerates `codex-resource-list.md` from the live resources. Callers:
1. The extension spawns it (child_process, arg array, no shell; falls back to
   `process.execPath`) as the first step of resource-touching commands.
2. `codex_add_entry` spawns it internally when it creates a new topic file.
The model never runs the script by hand (the entry tools own every write).

**Byte-stable** (cache-critical — the list rides the system-prompt prefix):
deterministic code-unit sort, no timestamps, atomic write (tmp + rename), write
SKIPPED when content unchanged. Never throws (exit 0 with a note on error).

### `ensure-entry-ids.mjs`

Ensures every entry in resource files has a unique 6-char alphanumeric `[ID]`.
Idempotent. Processes only category subfolder `.md` files. Never throws.
Backstop for hand-edits — the codex entry tools generate IDs themselves.

### `live-to-seed-sync.mjs` (maintainer-only)

One-off release tool, run by hand from the dev repo — NEVER wired to any command,
menu, or extension code. Reverses the normal flow: ports live-only resource
entries (keyed by `[ID]`) and new live topic files into the package seed so
learned entries ship with the release. Dry run by default; `--apply` writes.
Seed-only entries are kept; same-ID text differences are reported as conflicts,
never auto-overwritten; the generated `codex-resource-list.md` is never copied.
Paths resolve like the extension (`AFTC_TOOLSET_DATA_ROOT` override honoured).

---

## Events Subscribed

| Event | Module | Purpose |
| --- | --- | --- |
| `before_agent_start` | codex-inject | Append rules/guidance/list to system prompt |
| `context` | codex-inject | Prune accumulated codex docs + markers |
| `session_start` | codex-inject | Restore state; fresh-session notice / auto-prep |
| `session_start` | codex-entries | Clear (fresh) / rebuild (restore) the session read set |

---

## Renderers Registered

| Type | Custom type | Purpose |
| --- | --- | --- |
| Entry | `aftc-codex-prep-notice` | Fresh-session "run /codex-init" notice (TUI only) |
| Entry | `aftc-codex-status` | Colored status output from `/aftc-codex-status` |
| Entry | `aftc-codex-read` | Durable read-tracking (counted by status) |
| Message | `aftc-codex-marker` | In-history marker (accent-colored text) |

---

## Production-Safety Invariants

1. Never destroy user data — seeding is copy-only; destructive actions are explicit + confirmed.
2. Never break a session — pruning is a non-destructive `context` filter only.
3. Fail soft — every I/O op is best-effort try/catch → safe default / no-op.
4. Off by default.
5. Idempotent + resumable — seed/list-regen re-run safely.
6. Copy-only seeding — never overwrites an existing file; shipped updates reach
   the live copy only via a confirmed full reinstall (Start Fresh / /codex-install).
7. One-way copy — the seed never AUTO-overwrites a live file at runtime;
   user-learned content (resources/) always persists.
8. Destructive actions (Start Fresh, re-install) are confirmed and irreversible by design.
9. No surprise context pollution — codex injected only when enabled + prepped.
10. Bounded resource use — no processes/timers in the factory.
11. Cross-platform correctness — Node `os`/`path`; no shell assumptions.
12. Privacy — no prompt/response text recorded; no credentials.
13. Packaging safety — never ship user data or generated/runtime files; seed is source only.
14. Value-preserving migrations — config write-back preserves existing values.
15. Reversibility — enable, seed, prune each have an undo path (disable / re-seed).

---

## Key Design Decisions

- **Hybrid injection** (not message-based): rules ride the cached system-prompt prefix
  (cache-friendly, zero history pollution); only a lightweight marker lives in history.
- **No timers for startup UI**: `appendEntry` + `registerEntryRenderer` is reliable
  where `ctx.ui.custom()` overlays from `session_start` are flaky/dropped.
- **`session_start.reason`** for fresh-vs-resume (no `getEntries().length` heuristic).
- **Matched-pair pruning**: tool_use + tool_result removed together to avoid orphaning.
- **Simplest solution that fully delivers the functionality.** Cut machinery the
  feature doesn't need; never cut functionality for the sake of simplicity.
  Deterministic code beats prompt-choreography for steps the model can get wrong
  (why resource writes are tool-executed: `[ID]` generation, format validation,
  section placement, list sync).
- **Byte-stable list generation**: the resource list rides the cached prefix, so any
  non-determinism would cause cache misses every turn.
- **Detection stays out of the prefix**: session-specific data (detected topics) goes in
  the marker message, never the system prompt.
- **`silent` resets each session**: disable is per-session; the persistent `enabled`
  pref is the cross-session on/off switch.
