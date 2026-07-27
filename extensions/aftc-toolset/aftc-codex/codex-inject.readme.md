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

## Events subscribed

- `before_agent_start` — append the rules/guidance/list block to the system prompt.
- `context` — prune accumulated codex docs + markers (step 3.1, see below).
- `session_start` — restore `prepped`; on a fresh session
  (`reason` = `new` | `startup`) that is enabled + un-prepped, append a stand-out
  transcript notice (TUI) or auto-prep (print/headless). Restore reasons
  (`resume` | `reload` | `fork`) never nag.

## Renderers registered

- `aftc-codex-prep-notice` (entry renderer) — the unmissable "run /codex-init"
  notice. TUI transcript only; not in LLM context.
- `aftc-codex-marker` (message renderer) — renders the marker text in accent colour.

## Public API

`createCodexInject(ctx, detect?)` returns `CodexInjectApi` (the optional `detect`
resets its cache on `session_start` and supplies topics for print auto-prep):

- `injectMarker(busy, eager, topics?)` — append the marker. `busy` → `deliverAs: "followUp"`;
  idle + `eager` → `triggerTurn: true` (the `/codex-init` force); idle + lazy →
  append only (print auto-prep). When `topics` is supplied (autoLoad, step 4.2) a
  "Detected project topics: …" line is appended after the stable base instruction.
- `buildPromptBlock()` — the system-prompt block, or `null` when nothing injects.
- `persistState()` — write the durable `aftc-codex-state` entry.

Also exports `isCommandBusy(ctx)` and the entry/message type constants.

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
