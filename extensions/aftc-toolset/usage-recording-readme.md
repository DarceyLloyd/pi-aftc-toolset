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

Every completed assistant turn is inserted into the shared `turns`
table, including turns whose cost is `$0` (free models, subscription
plans). Their prompt counts, cache activity and thinking/response
times are useful data, and `/usage-report` keeps them out of COST
averages with paid-only denominators. To skip `$0` turns entirely,
set `RECORD_ZERO_COST_TURNS = false` in `usage-recording.ts`.
Negative-cost turns are always skipped (defensive; impossible from a
real provider). The in-memory footer accumulator in `core.ts` always
updates, so the live footer shows the real last-turn cost regardless.

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
| `provider` | text | Provider id (e.g. `minimax`, `deepseek`, `qwencloud`, `kimi-coding`) — distinguishes same-named models across providers; `''` when unknown/legacy |
| `tool_calls` | int | Tool calls made in this turn (assistant content parts) |
| `response_chars` | int | Response text length in chars |
| `prompt_chars` | int | User prompt text length in chars |
| `thinking_level` | text | e.g. `high`, `low`, `off` |
| `thinking_ms` | int | Time to first non-thinking output |
| `response_ms` | int | Total turn duration (request-sent → message end) |
| `cost_usd` | real | Cost of this turn |
| `input_tokens` | int | New prompt tokens |
| `output_tokens` | int | Output tokens |
| `cache_read` | int | Cached prefix tokens served |
| `cache_write` | int | Tokens written to cache this turn |
| `context_window` | int | Model's declared context window in tokens at this turn (`getContextUsage().contextWindow`); 0 when unknown (old rows) |
| `context_tokens` | int | pi's context-usage estimate at `message_end` (`getContextUsage().tokens`, input side); 0 when unavailable |
| `device_id` | text | Per-installation owner id (one UUID per data dir, `paths.ts getDeviceId`) — tags every row with this installation; `''` = legacy row recorded before device ids existed |
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

### `tasks` table (per-task metrics)

A separate table at **per-task** grain (vs the per-turn `turns` table
above). One row per SETTLED task — a single user prompt's full agent
run (enter → settle) — inserted by `core.ts` on `agent_settled` via
`recordTask`. Records every task regardless of cost (including `$0`
subscription turns). The timer starts on the user prompt and stops on
the single `agent_settled`; questions, steering, retries and compaction
don't settle the agent, so `task_ms` spans all of them.

EVERY settled task is recorded, whatever its outcome: `stop_reason` is
`complete`, `error` or `aborted` (classified from the last assistant
`stopReason`). Failed rows carry the time-to-failure so the usage
report's Timings tab can count errors/aborts. The report only ever
AVERAGES `stop_reason = 'complete'` rows — a failed duration is shown
in the footer and counted, but never mixed into the Task Time metric.

| Column | Type | Meaning |
|---|---|---|
| `id` | int PK | Auto-increment row id |
| `session_id` | text | Stable per-runtime-session id (matches `turns.session_id`) |
| `prompt_index` | int | 1-based user-prompt number the task belongs to |
| `timestamp` | int | ms since epoch at task START (first `agent_start`) |
| `task_ms` | int | Wall-clock task duration (enter → settle; time-to-failure for error/abort) |
| `stop_reason` | text | How the task ended: `complete` / `error` / `aborted` |
| `model_name` | text | Model that ran the task |
| `thinking_level` | text | Thinking level (`high` / `low` / `off`) |
| `turn_count` | int | Number of assistant turns the task took |
| `context_window` | int | Model's declared context window in tokens at task time; 0 when unknown |
| `context_start_tokens` | int | pi's context-usage estimate at task START (captured on `message_start` of the user prompt) |
| `context_end_tokens` | int | pi's context-usage estimate at task END (captured on the last `message_end`) |
| `allow_provider` | text | Provider label of the allowance snapshot (eg `ChatGPT Plus`) — empty when the provider reports no allowance |
| `allow_5h_start` | real · null | Provider 5-hour allowance used % at task start / end (NULL = no snapshot) |
| `allow_5h_end` | real · null | ditto |
| `allow_weekly_start` | real · null | Provider weekly allowance used % at task start / end (NULL = no snapshot) |
| `allow_weekly_end` | real · null | ditto |
| `allowance_reported` | int | 1 = the active provider actually reported a 5h / weekly allowance window for this task (subscription plans only — Codex, Claude, MiniMax, Z.ai GLM, Kimi); 0 for API providers (DeepSeek etc.). Mirrors footer line-5 availability; the report gates the 5h/window + 1M-flag metrics on it |
| `provider` | text | Provider id that ran the task (e.g. `kimi-coding`) — `''` when unknown |
| `device_id` | text | Per-installation owner id (one UUID per data dir) — `''` for legacy rows |

Allowance snapshots are taken by `core.ts` at `agent_start` (once per
task) and `agent_settled` from the allowance provider (see
`allowance-readme.md`) — provider-level, only for providers that
report a 5h / weekly window (Codex, Claude, MiniMax, Z.ai GLM, Kimi).
Other providers leave the columns NULL and the report shows N/A.

### `errors` table (one row per failed LLM call)

Inserted by `core.ts` on the failing `message_end` (`stopReason ===
"error"`) via `recordError`. A failed call is a turn that ended in an
error — network failure, rate limit, overloaded, 404, auth or
timeout. User aborts (`stopReason === "aborted"`) are NOT errors.

| Column | Type | Meaning |
|---|---|---|
| `id` | int PK | Auto-increment row id |
| `session_id` | text | Stable per-runtime-session id |
| `prompt_index` | int | 1-based user-prompt number the failed call belonged to |
| `timestamp` | int | ms since epoch at the failing `message_end` |
| `model_name` | text | Model that failed |
| `thinking_level` | text | Thinking level at the time |
| `error_type` | text | Classified category: `rate-limit` / `overloaded` / `not-found` / `auth` / `timeout` / `network` / `other` |
| `error_message` | text | Raw error text from pi (HTTP status / provider message) |
| `device_id` | text | Per-installation owner id (one UUID per data dir) — `''` for legacy rows |

Classification happens in `core.ts`'s `classifyError()` — order
matters: 5xx beats timeout/network (a 503 gateway timeout is a server
problem). The Errors tab groups by model × type.

### `tool_errors` table (one row per failed tool call)

Inserted by `core.ts` on the `tool_result` hook via `recordToolError` — a
tool result whose `isError` was true. Model misuse (wrong args, stale edit
anchors, bad regex, missing files/binaries, timeouts), distinct from the
`errors` table above (provider failures).

| Column | Type | Meaning |
|---|---|---|
| `id` | int PK | Auto-increment row id |
| `session_id` | text | Stable per-runtime-session id |
| `prompt_index` | int | 1-based user-prompt number the failed call belonged to |
| `timestamp` | int | ms since epoch at the failing `tool_result` |
| `model_name` | text | Model that ran the tool |
| `thinking_level` | text | Thinking level at the time |
| `provider` | text | Provider id of the model (distinguishes same-named models) |
| `tool_name` | text | The tool whose result carried `isError` |
| `error_kind` | text | Classified: `invalid-args` / `stale-anchor` / `not-found` / `bad-regex` / `permission` / `timeout` / `network` / `missing-binary` / `other` |
| `error_message` | text | Bounded (400 chars) raw error text |
| `error_signature` | text | Normalised message (lowercase, digits → N) for repeat dedup |
| `device_id` | text | Per-installation owner id — `''` for legacy rows |

Classification happens in `core.ts`'s `classifyToolError()` (order
matters: tool-specific `edit` anchors first, then missing-binary, then
not-found, bad-regex, permission, timeout, network, invalid-args, other).
`error_signature` is `toolErrorSignature()` — the report collapses repeated
identical mistakes into a repeat count.

### What is NOT recorded

- The actual **text** of user prompts, sub-prompts, or assistant
  responses.
- Tool ARGUMENTS the assistant passed. (Tool NAMES are recorded in
  `tool_errors` as error metadata — the name of the tool that failed;
  the bounded error message may contain file paths/ids.)
- Reasoning or thinking-block content (only `thinking_ms` is
  recorded as a duration).

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
