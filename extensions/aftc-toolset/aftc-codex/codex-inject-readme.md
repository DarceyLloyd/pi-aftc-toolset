# codex-inject.ts

System-prompt injection + session lifecycle for the aftc-codex feature.

## What it adds to the extension

The cache-friendly "hybrid" injection (spec D1 / D7):

- **Stable always-on content** (`codex-rules.md` + `thought-and-action-guidance.md`
  when `aftcCodexInjectGuidance` + the generated `codex-resource-list.md`) rides the
  CACHED system-prompt prefix via `before_agent_start` returning `{ systemPrompt }`.
  Read fresh from disk each turn (byte-stable files → no prefix churn). Never
  pollutes history, never accumulates, resume-proof.
- **Marker message** (`aftc-codex-marker` custom message) — the detectable/prunable
  "codex presence" in history: a short visible note + the instruction to fetch docs
  via `codex_load`. Rendered in the transcript.
- **Durable per-session state** (`prepped` / `silent`) persisted via
  `pi.appendEntry("aftc-codex-state", …)` (a custom entry — NOT in LLM context),
  restored on `session_start` by scanning the entries. Survives compaction.

## Injection condition

Rules inject only when `aftcCodexEnabled && prepped && !silent` and the rules
file is non-empty (seeded).

### Rules-only mode (`/codex-inject-rules`)

Per-SESSION state (not a preference — nothing is written to config). When
`state.rulesOnly` is set, injection short-circuits BEFORE every gate (enabled,
prepped, silent, compat): the block is just the `## Critical Global Rules`
section extracted from codex-rules.md (heading -> next `## ` heading). No
marker, no resource list, no guidance, no prep notice, no `/codex-init`
requirement — the zero-ceremony "common do-nots" option. It works even with
the feature disabled (the enabled pref is never touched). The rules text is
read from the LIVE copy when seeded (user customisations honoured) and falls
back to the SEED when not. The state rides the durable `aftc-codex-state`
entry (survives `/reload`); a fresh session (`/new`) clears it — that plus
`/codex-init` is the way back to the full codex.

## Events subscribed

- `before_agent_start` — append the rules/guidance/list block to the system prompt.
- `context` — prune accumulated codex docs + markers (step 3.1, see below).
- `session_start` — restore `prepped`; on a fresh session
  (`reason` = `new` | `startup`) that is enabled + un-prepped, append a stand-out
  transcript notice (TUI) or auto-prep (print/headless). Restore reasons
  (`resume` | `reload` | `fork`) never nag. Rules-only mode returns early —
  no notice, no auto-prep.

## Renderers registered

- `aftc-codex-prep-notice` (entry renderer) — the unmissable "run /codex-init"
  notice. TUI transcript only; not in LLM context. The entry is DURABLE (pi
  re-renders it on every /reload and /resume), so the renderer NEVER trusts the
  append-time snapshot in the entry data — it derives from CURRENT truth on
  every paint (the compat guard's fresh disk reads, TTL-cached 2s, plus the live
  session state): the `WARNING: Your AFTC codex is outdated.` line (plus "Run
  `/codex-sync` to update (keeps your learned entries) or `/codex-install` for a
  fresh copy.") shows only while the guard STILL fails; an entry appended as a
  warning flips to a "synced — you are up to date now" line once the version is
  fixed; a prepped session gets a one-line "Codex is active" note instead of the
  stale /codex-init nag (rules-only sessions get a rules-only line).
- `aftc-codex-marker` (message renderer) — renders the marker text in accent colour.

## Public API

`createCodexInject(ctx, detect?)` returns `CodexInjectApi` (the optional `detect`
resets its cache on `session_start` and supplies topics for print auto-prep):

- `injectMarker(busy, eager, topics?, missing?)` — append the marker. `busy` → `deliverAs: "followUp"`;
  idle + `eager` → `triggerTurn: true` (the `/codex-init` force); idle + lazy →
  append only (print auto-prep). When `topics` is supplied (autoLoad, step 4.2) a
  "Detected project topics: …" line is appended after the stable base instruction;
  `missing` (mapped topics with no resource file yet) adds a "No codex resource
  yet for: …" bootstrap hint line.
- `buildPromptBlock()` — the system-prompt block, or `null` when nothing injects.
- `persistState()` — write the durable `aftc-codex-state` entry.

Also exports the entry/message type constants. (`isCommandBusy`
moved to `codex-commands.ts` - command handlers only.)

## Failure modes

All handlers are best-effort try/catch → no-op on error (spec Part G fail-soft).
Missing rules file → no injection. Corrupt state entry → defaults (false/false).

## Context pruning (step 3.1)

The `context` handler is a NON-DESTRUCTIVE filter of the LLM-bound deep copy (stored
history is untouched — spec G1/G2):

- `codex_load` docs are removed as matched **tool_use + tool_result PAIRS** (the
  ToolCall block is stripped from the assistant message AND its tool_result message
  is removed) so a tool_use is never orphaned (spec M-C1). An assistant message
  emptied by pruning is dropped.
- When `!enabled || silent` → ALL codex (markers + docs) is removed (spec M-C5).
- Otherwise the **latest generation** of docs (the last assistant message with
  `codex_load` calls) and the **latest marker** are kept; older ones are pruned.
- Non-codex messages/tool pairs are never touched. Returns `undefined` when nothing
  changed (keeps the array referentially equal).
