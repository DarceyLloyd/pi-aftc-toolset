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
├── codex-commands.ts          # /aftc-codex-* commands + config menu
├── scripts/
│   ├── sync-codex-resources.mjs   # Regenerates codex-resource-list.md (byte-stable)
│   └── ensure-entry-ids.mjs       # Adds unique 6-char [ID]s to entries missing them
└── *.readme.md                # Per-module companion docs
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
- Strict one-way copy: seed → live. The seed never auto-overwrites a live file.
- Seeding is copy-only: existing live files are never overwritten.
- The seed is SOURCE only: no generated/runtime files (`codex-resource-list.md`).
- User edits (via `/aftc-codex-learn` or manual) live only in the live copy.
- "Start Fresh" / re-install: delete the live copy and re-seed (confirmed, irreversible).

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
`registerEntryRenderer` — no timer, no TUI-ready wait.

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
| File extensions | `.ts`→typescript, `.py`→python, `.gd`→godot, `.css`→css, `.vue`→vue |
| package.json deps | `three`→threejs, `chart.js`→chartjs, `gsap`, `puppeteer`, `vite` |
| Marker files | `Dockerfile`→docker, `composer.json`→php+composer, `project.godot`→godot |
| Pi manifest | `package.json` with `pi` key → pi-extension |

Result is intersected with resources actually present (`store.listTopics()`), guidance
topics excluded, sorted, and cached per cwd for the session.

**Bounded scan:** skips heavy dirs (`node_modules`, `.git`, `dist`, `.venv`,
`__pycache__`, any dot-dir), caps depth (6) and files visited (8000).

---

## The `codex_load` Tool

`codex_load(topic)` reads a topic doc on demand:
- Searches across ALL category folders + top-level (folder is organisation only).
- Fuzzy aliases: `ts`→typescript, `py`→python, `js`→javascript, `pine`→pinescript, `gd`→godot.
- Specials: `rules`, `guidance`, `list`, `markdown`.
- Strips a leading `@`, drops a trailing `.md`, supports explicit `category/name`.
- Truncates huge files (`truncateTail`, 50 KB / 2000 lines), states the full path.
- Throws on unknown topic with the valid list.
- Tracks reads durably via `pi.appendEntry("aftc-codex-read", { relPath })` for `/aftc-codex-status`.

---

## Self-Education (`/aftc-codex-learn`)

Injects a user message instructing the model to persist DURABLE, GENERAL lessons
using its standard tools (read/edit/write + bash). No separate model tool.

Steps enforced by the prompt:
1. Sync first (`node sync-codex-resources.mjs`).
2. Consult `codex-resource-list.md` — update existing docs, never duplicate.
3. Write entries in canonical format (auto-add with uniqueness checks by default,
   or propose-then-confirm when `aftcCodexAutoAddEntries` is false):
   ```
   - [ID] LEAD_TOKEN — one-line symptom
     Cause: why it happens.
     Fix: what to do. (YYYY-MM)
   ```
   Routing: thinking lessons → `thought-and-action-guidance.md`;
   tech gotchas → the correct `resources/{category}/<topic>.md`.
4. Sync after writing.

The prompt names the live OS-data copy as the write target (the package seed is read-only).

---

## Commands

| Command | Aliases | Action |
| --- | --- | --- |
| `/aftc-codex` | `/codex` | Open the config menu (TUI only) |
| `/aftc-codex-enable` | `/codex-enable` | Enable + seed on first use (choice in TUI) |
| `/aftc-codex-disable` | `/codex-disable` | Disable + strip ALL codex from context |
| `/aftc-codex-init` | `/codex-init` | Prep: rules live + marker + model fetches docs |
| `/aftc-codex-refresh` | `/codex-refresh` | Strip all codex, then re-init (clean restart) |
| `/aftc-codex-install` | `/codex-install` | Fresh install or re-install (confirmed destructive) |
| `/aftc-codex-learn` | `/codex-learn` | Self-education prompt injection |
| `/aftc-codex-status` | `/codex-status` | Colored status: enabled, embedded, files read |

**Sync-first:** the resources menu, `-learn`, `-install`, `-init`, and `-refresh`
spawn the sync script first. Pure toggles (`-enable`/`-disable`/`-status`) skip it.

### Config menu structure

```
/aftc-codex — Main Menu (inline toggles re-render, selection preserved)
├── AFTC Codex Enabled .............. | Yes/No     [toggle; first enable → seed choice]
├── Thinking Guidance Injection ..... | ON/OFF     [toggle]
├── Auto-Detect & Load Docs ......... | ON/OFF     [toggle]
├── Task Addition Approval .......... | Auto/Manual [submenu]
├── Resources & Updates .............              [submenu]
│   ├── Re-Seed Resources ........... copy-only, never overwrites → seed choice
│   ├── Start Fresh ................. [confirm-destructive] wipe + re-seed
│   └── Open Codex Resource Dir ..... opens live resources/ in OS file manager
└── Help & Commands ................. [viewer]
```

---

## Config Preferences (`config.json`)

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `aftcCodexEnabled` | bool | `false` | Master on/off |
| `aftcCodexInjectGuidance` | bool | `true` | Inject `thought-and-action-guidance.md` |
| `aftcCodexAutoLoad` | bool | `true` | Auto-detect project techs + name them in marker |
| `aftcCodexSeeded` | bool | `false` | First-run seed choice done |
| `aftcCodexAutoAddEntries` | bool | `true` | Auto-add entries (uniqueness-checked) vs propose-then-confirm |

All migrated into an existing `config.json` via the write-back pattern.

---

## Scripts

### `sync-codex-resources.mjs`

Regenerates `codex-resource-list.md` from the live resources. Two callers:
1. The extension spawns it (child_process, arg array, no shell; falls back to
   `process.execPath`) as the first step of resource-touching commands.
2. The model runs it via bash after manual edits (path embedded in injected rules).

**Byte-stable** (cache-critical — the list rides the system-prompt prefix):
deterministic code-unit sort, no timestamps, atomic write (tmp + rename), write
SKIPPED when content unchanged. Never throws (exit 0 with a note on error).

### `ensure-entry-ids.mjs`

Ensures every entry in resource files has a unique 6-char alphanumeric `[ID]`.
Idempotent. Processes only category subfolder `.md` files. Never throws.

---

## Events Subscribed

| Event | Module | Purpose |
| --- | --- | --- |
| `before_agent_start` | codex-inject | Append rules/guidance/list to system prompt |
| `context` | codex-inject | Prune accumulated codex docs + markers |
| `session_start` | codex-inject | Restore state; fresh-session notice / auto-prep |

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
6. Copy-only seeding — never overwrites an existing file.
7. One-way copy — the seed never auto-overwrites a live file; user edits persist.
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
- **No separate `codex_learn` tool**: the model uses its standard read/edit/write tools
  (KISS); the learn command just injects instructions.
- **Byte-stable list generation**: the resource list rides the cached prefix, so any
  non-determinism would cause cache misses every turn.
- **Detection stays out of the prefix**: session-specific data (detected topics) goes in
  the marker message, never the system prompt.
- **`silent` resets each session**: disable is per-session; the persistent `enabled`
  pref is the cross-session master switch.
