# db.ts

The shared better-sqlite3 connection. Owns the singleton DB that
both `usage-recording.ts` (writer) and `usage-report.ts` (reader)
use.

## What it does

Lazy-opens the SQLite database at
`<package-root>/.pi-aftc-toolset/data/turns.db` on first call to
`getDb()`. Creates the `turns` table if it doesn't exist and runs
any pending migrations.

## What is stored (and what is NOT)

This DB stores **per-turn metrics and prompt-type classification
flags only**. The actual text of user prompts, sub-prompts, or
assistant responses is **never** stored here. That keeps the DB
small (~100 bytes per row) even for long sessions — and avoids
storing anything sensitive. The model call content lives in pi's
own session JSONL; this DB only stores metrics + classification.

If you want to know *what the user asked*, read the session JSONL.
If you want to know *how much that cost and how the assistant
responded over time*, query this DB.

## Schema

20 columns per row. The initial schema covers the metrics; the
flag columns are added via migrations when the recorder is first
updated to populate them.

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

Migrations for the prompt-flag columns added after the initial
schema (idempotent — each runs in a try/catch, errors swallowed
because the column already exists):

- `user_prompt`, `prompt_index`, `sub_prompt`, `session_id`
- `base_prompt`, `steering_prompt`, `followup_prompt`,
  `continuation_prompt`
- `prompt_kind`

For the full column reference and what each `prompt_kind` value
means, see `usage-recording.readme.md`.

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

Per rules.md §1.5, feature modules don't import each other. They
both need the DB, so the DB connection is a utility — `db.ts`
imports `getDb`, both feature modules import `getDb`. No feature
imports any other feature.

## Failure modes

- better-sqlite3 not installed — `console.warn` at load time with
  a hint to run `/aftc-install`. `getDb()` returns `null` forever.
- DB file unwritable — `console.log` the error, `getDb()` returns
  `null` for the rest of the session.
- Schema migration error (column already exists) — silently
  ignored, migration is a no-op.
