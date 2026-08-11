# db.ts

The shared better-sqlite3 connection. Owns the singleton DB that
both `usage-recording.ts` (writer) and `usage-report.ts` (reader)
use.

## What it does

Lazy-opens the SQLite database at
`<persistent-data-dir>/turns.db` (OS-specific; see `paths-readme.md`) on first call to
`getDb()`. Creates the `turns` table if it doesn't exist and runs
any pending migrations.

## What is stored (and what is NOT)

This DB stores **per-turn metrics and prompt-type classification
flags only**. The actual text of user prompts, sub-prompts, or
assistant responses is **never** stored here. That keeps the DB
small (~100 bytes per row) even for long sessions - and avoids
storing anything sensitive. The model call content lives in pi's
own session JSONL; this DB only stores metrics + classification.

If you want to know *what the user asked*, read the session JSONL.
If you want to know *how much that cost and how the assistant
responded over time*, query this DB.

## Schema

The base `turns` schema covers the metrics; the prompt-flag, context
and allowance columns are added via migrations when the recorder is
first updated to populate them (idempotent - each runs in a
try/catch, errors swallowed because the column already exists):

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
    cache_write     INTEGER NOT NULL
);
```

Migrated columns (added via `MIGRATIONS`, each idempotent):

- Prompt flags: `user_prompt`, `prompt_index`, `sub_prompt`,
  `session_id`, `base_prompt`, `steering_prompt`, `followup_prompt`,
  `continuation_prompt`, `prompt_kind`
- v1.21.x context tracking: `context_window` (int), `context_tokens`
  (int) on `turns`; `context_window`, `context_start_tokens`,
  `context_end_tokens` (int) and `allow_provider` (text),
  `allow_5h_start`/`allow_5h_end`/`allow_weekly_start`/
  `allow_weekly_end` (nullable REAL) on `tasks`.
- v1.21.x device owner tag: `device_id` (text, `''` default) on
  `turns`, `tasks` AND `errors` — one UUID per data dir
  (`paths.ts getDeviceId`) tagging rows with this installation's owner id.
- v1.21.x allowance availability: `allowance_reported` (int, 0 default)
  on `tasks` — 1 when the active provider reported a 5h / weekly
  allowance window (subscription plans only; footer line-5 semantics).
- v1.21.x provider + size metrics: `provider` (text, `''` default) on
  `turns` AND `tasks`; `tool_calls`, `response_chars`, `prompt_chars`
  (int, 0 default) on `turns` — distinguishes same-named models across
  providers and feeds verbosity / tool-use dimensions.

A second table, `tasks`, holds per-task metrics (one row per completed
task — a user prompt's full agent run, enter → settle; recorded by
core.ts on `agent_settled`):

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL DEFAULT '',
    prompt_index    INTEGER NOT NULL DEFAULT 0,
    timestamp       INTEGER NOT NULL,
    task_ms         INTEGER NOT NULL,
    stop_reason     TEXT NOT NULL DEFAULT '',
    model_name      TEXT,
    thinking_level  TEXT,
    turn_count      INTEGER NOT NULL DEFAULT 0
);
```

A third table, `errors`, holds one row per FAILED LLM call (assistant
turn that ended with `stopReason === "error"`; user aborts are NOT
errors). Recorded by core.ts on the failing `message_end` via
`recordError`:

```sql
CREATE TABLE IF NOT EXISTS errors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL DEFAULT '',
    prompt_index    INTEGER NOT NULL DEFAULT 0,
    timestamp       INTEGER NOT NULL,
    model_name      TEXT,
    thinking_level  TEXT,
    error_type      TEXT NOT NULL DEFAULT 'other',
    error_message   TEXT NOT NULL DEFAULT ''
);
```

Migrations run on every `getDb()` open, so an existing user's old DB
is upgraded in place the first time it is opened after an update — no
manual step needed. Old rows keep their defaults (context columns 0,
allowance columns NULL) and the report falls back / shows N/A.

## API

```typescript
export function getDb(): any | null
```

Returns the singleton connection, opening it lazily on first call.
Returns `null` if `better-sqlite3` is not installed or the DB
cannot be opened. Callers must handle `null` gracefully.

```typescript
export function isDbAvailable(): boolean
```

True if better-sqlite3 loaded successfully at module-init time.

## Why a utility module, not a feature

Per AGENTS.md, feature modules don't import each other. They
both need the DB, so the DB connection is a utility - `db.ts`
imports `getDb`, both feature modules import `getDb`. No feature
imports any other feature.

## Failure modes

- better-sqlite3 not installed - `console.warn` at load time with
  a hint to run `/aftc-install`. `getDb()` returns `null` forever.
- DB file unwritable - `console.log` the error, `getDb()` returns
  `null` for the rest of the session.
- Schema migration error (column already exists) - silently
  ignored, migration is a no-op.
