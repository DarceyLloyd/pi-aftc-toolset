# usage-recording.ts

Per-turn SQLite recording. The "writer" half of the usage pipeline
(`usage-report.ts` is the "reader").

## What it does

Every completed assistant turn is inserted into the shared
`turns` table (see `db.ts`) so the user can query historical
per-turn stats via `/usage-report`.

The single class implements the `TurnRecorder` interface declared
in `types.ts`. `core.ts` calls `recordTurn(record)` from its
`message_end` handler. The orchestrator (`index.ts`) wires the
`UsageRecorder` instance into `createCore` so core doesn't need
to import this file.

## What is recorded (and what is NOT)

Every **chargeable** completed assistant turn is inserted into the
shared `turns` table. Turns whose cost is `$0` (or, defensively, any
non-positive cost) are **skipped** — free turns (some subscription
plans report $0) would taint the averages, totals, burn-rate, and
projection maths in `/usage-report`. The in-memory footer
accumulator in `core.ts` still updates, so the live footer keeps
showing the real last-turn cost; only the historical DB row is
skipped.

If you want to know *what the user asked*, read the session
JSONL. If you want to know *how much that cost and how the
assistant responded over time*, query this DB.

## Schema (see `db.ts`)

### Per-row columns - metrics

| Column | Type | Meaning |
|---|---|---|
| `id` | int PK | Auto-increment row id |
| `turn` | int | Session-scoped turn counter |
| `timestamp` | int | ms since epoch at `message_end` |
| `model_name` | text | e.g. `MiniMax-M3` |
| `thinking_level` | text | e.g. `high`, `low`, `off` |
| `thinking_ms` | int | Time to first non-thinking output |
| `response_ms` | int | Total turn duration (request-sent → message end) |
| `cost_usd` | real | Cost of this turn |
| `input_tokens` | int | New prompt tokens |
| `output_tokens` | int | Output tokens |
| `cache_read` | int | Cached prefix tokens served |
| `cache_write` | int | Tokens written to cache this turn |
| `session_id` | text | Stable per-runtime-session id |
| `prompt_index` | int | 1-based user-prompt number; all automated continuations share the same index as the user prompt that caused them |

### Per-row columns - prompt-type classification (flags)

These flag the *kind of trigger* for the assistant turn - **not
the content of the prompt**. They're either `0` (false) or `1`
(true).

| Column | Meaning |
|---|---|
| `user_prompt` | `1` if this assistant turn is a direct response to a user message. `0` for automated tool-call continuation rounds. |
| `base_prompt` | `1` if this is the first user prompt of a task (top-level, drives projections). Always `0` when `user_prompt = 0`. |
| `sub_prompt` | `1` if this is any follow-up / refinement under the current task. Always `0` when `user_prompt = 0`. |
| `steering_prompt` | `1` if the user sent this sub-prompt while the agent was still actively processing the previous one (pi's `steer()`). |
| `followup_prompt` | `1` if the user queued this sub-prompt to be delivered after the agent finished (pi's `followUp()`). |
| `continuation_prompt` | `1` if this is an idle follow-up / refinement sent in the same task thread. |
| `prompt_kind` | text - single human-readable label (see below) |

### `prompt_kind` values

Redundant with the flag columns above (the flags are derived from
the same source) but a useful denormalised index for sorting and
grouping in the report.

| `user_prompt` | `prompt_kind` | Meaning |
|---|---|---|
| 1 | `base` | First user prompt of a task (top-level, drives projections). |
| 1 | `continuation` | Idle follow-up / refinement in the same task thread. |
| 1 | `steer` | Sub-prompt sent while the agent was still actively processing the previous one. |
| 1 | `followup` | Sub-prompt queued in the editor and delivered after the agent finished. |
| 0 | `auto` | Automated tool-call continuation round - no new user input between this and the prior turn. |

### What is NOT recorded

- The actual **text** of user prompts, sub-prompts, or assistant
  responses.
- File paths, tool names, or arguments the assistant invoked
  tools with.
- Reasoning or thinking-block content (only `thinking_ms` is
  recorded as a duration).

## Why this used to be called `thinking.ts`

The old name was misleading - this module has nothing to do with the
model's `<thinking>` blocks (those are handled by pi's Ctrl+T and
the `hideThinkingBlock` setting). The new name describes what it
actually does: record usage data to SQLite.

## History

This module previously owned `/show-thinking` and `/hide-thinking`
which toggled visibility of the footer line 3 timing segments. Those
commands were removed - pi already has Ctrl+T (`app.thinking.toggle`)
for collapsing/expanding `<thinking>` blocks in the main output, and
the `hideThinkingBlock` setting for the default. The footer timing
info (Thinking time / Response time) is now always visible.

## Public factory

```typescript
export function createUsageRecording(pi: ExtensionAPI): TurnRecorder
```

Returns a `TurnRecorder` (structurally typed, see `types.ts`) that
core.ts can call on every `message_end`. Never import this file
directly - go through the orchestrator.

## Failure mode

If better-sqlite3 isn't installed (user hasn't run `/aftc-install`),
`getDb()` returns `null` and `recordTurn` is a silent no-op. A turn
whose `costUsd` is `<= 0` is also a silent no-op (see above). The
SQLite insert itself is wrapped in try/catch - any other error is
logged via `console.log` and swallowed. Per-turn failures never break
the agent loop.
