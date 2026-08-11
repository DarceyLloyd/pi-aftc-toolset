/**
 * pi-aftc-toolset — shared SQLite database utility.
 *
 * Owns the singleton better-sqlite3 connection used by both the recorder
 * (usage-recording.ts → recordTurn) and the report generator
 * (usage-report.ts → data.json + the report app in <dataDir>/usage-report/). The DB lives in the persistent
 * OS data dir (see paths.ts getPersistentRoot/getDataDir — outside the installed
 * package so it survives `pi update --extensions`), eg
 *   %APPDATA%\pi-aftc-toolset\data\turns.db   (Windows)
 *
 * This is a utility module, NOT a feature module. Per AGENTS.md,
 * feature modules (usage-recording.ts, usage-report.ts, core.ts,
 * footer-widget.ts, etc.) must not import each other,
 * but they're all free to import this file.
 *
 * better-sqlite3 is an optional runtime dependency — if it's not
 * installed, getDb() returns null forever and a single console.warn is
 * emitted at load time. Both callers handle null gracefully.
 *
 * See `db-readme.md` for schema, API, and failure modes.
 */

import * as fs from "node:fs";
import { getDataDir, getDbFile } from "./paths";
import * as aftcConsole from "./ui/aftc-console";

// -----------------------------------------------------------------------------
// Optional SQLite (better-sqlite3) — loaded once; failure is non-fatal.
// -----------------------------------------------------------------------------
let Database: any = null;
try {
    // CommonJS require works under jiti (pi's extension loader) and gives us
    // a synchronous load — important because recordTurn is called from
    // synchronous pi event handlers.
    Database = require("better-sqlite3");
} catch (err) {
    console.log(
        `\n[aftc-toolset] better-sqlite3 not available — /usage-report and timeframe stats disabled. ` +
        `Run /aftc-install to install it. (${(err as Error).message})`,
    );
}

const DATA_DIR = getDataDir();
const DB_FILE = getDbFile();

// Schema design note:
// One row = one assistant turn. The schema stores METRICS (tokens,
// cost, cache, timing) and prompt-type CLASSIFICATION FLAGS only.
// The actual text of user prompts, sub-prompts, or assistant
// responses is NEVER stored here — that keeps the DB small
// (~100 bytes per row) even for long sessions, and avoids storing
// anything sensitive. The model call content lives in pi's own
// session JSONL.
//
// The 20 columns are:
//   - id, turn, timestamp, session_id, prompt_index
//   - model_name, thinking_level
//   - thinking_ms, response_ms, cost_usd
//   - input_tokens, output_tokens, cache_read, cache_write
//   - user_prompt, base_prompt, sub_prompt
//   - steering_prompt, followup_prompt, continuation_prompt
//   - prompt_kind (text: "base" | "continuation" | "steer" |
//     "followup" | "auto")
//
// See `usage-recording-readme.md` for the full column reference
// and what each prompt-kind value means.
const SCHEMA = `
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
    CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
    CREATE INDEX IF NOT EXISTS idx_turns_turn      ON turns(turn);

    -- One row per completed TASK (a single user prompt's full agent run,
    -- enter → settle). Per-task grain (vs the per-turn turns table above).
    -- Recorded by core.ts on agent_settled via usage-recording.recordTask.
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
    CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp);

    -- One row per FAILED LLM call (assistant turn with stopReason "error" —
    -- network, rate limit, overloaded, 404, auth, timeout). Recorded by
    -- core.ts on the failing message_end via usage-recording.recordError.
    -- User aborts are NOT errors (they are counted from the tasks table).
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
    CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp);
`;

const MIGRATIONS = [
    `ALTER TABLE turns ADD COLUMN user_prompt INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN prompt_index INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN sub_prompt INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE turns ADD COLUMN base_prompt INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN steering_prompt INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN followup_prompt INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN continuation_prompt INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN prompt_kind TEXT NOT NULL DEFAULT ''`,

    // v1.21.x — context-window tracking. context_window = model's declared
    // window (tokens); context_tokens = pi's getContextUsage() estimate at
    // message_end. Old rows stay 0 (report falls back to token-derived
    // context when 0).
    `ALTER TABLE turns ADD COLUMN context_window INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE turns ADD COLUMN context_tokens INTEGER NOT NULL DEFAULT 0`,

    // v1.21.x — task-level context + provider allowance snapshots. Allowance
    // fields are REAL (nullable) because only some providers report an
    // allowance; NULL = no data for that window.
    `ALTER TABLE tasks ADD COLUMN context_window INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN context_start_tokens INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN context_end_tokens INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN allow_provider TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE tasks ADD COLUMN allow_5h_start REAL`,
    `ALTER TABLE tasks ADD COLUMN allow_5h_end REAL`,
    `ALTER TABLE tasks ADD COLUMN allow_weekly_start REAL`,
    `ALTER TABLE tasks ADD COLUMN allow_weekly_end REAL`,

    // v1.21.x — per-installation owner id for the online usage mirror.
    // One UUID per data dir (paths.ts getDeviceId); tags every row locally
    // and in the mirror push so a date-range pull can filter to this
    // machine. '' = legacy row (recorded before device ids existed).
    `ALTER TABLE turns ADD COLUMN device_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE tasks ADD COLUMN device_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE errors ADD COLUMN device_id TEXT NOT NULL DEFAULT ''`,
];

let _db: any = null;

/**
 * Returns the singleton DB connection, opening it lazily on first call.
 * Returns null if better-sqlite3 is not installed or the DB can't be
 * opened — callers must handle null gracefully.
 */
export function getDb(): any | null {
    if (_db) return _db;
    if (!Database) return null;
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        _db = new Database(DB_FILE);
        _db.exec(SCHEMA);
        // Run column migrations (idempotent — errors ignored if column exists)
        for (const m of MIGRATIONS) {
            try { _db.exec(m); } catch (_) { /* column already exists */ }
        }
        return _db;
    } catch (err) {
        aftcConsole.logError(`[aftc-toolset] SQLite init error: ${(err as Error).message}`);
        return null;
    }
}

/** True if better-sqlite3 loaded successfully at module-init time. */
export function isDbAvailable(): boolean {
    return Database !== null;
}
