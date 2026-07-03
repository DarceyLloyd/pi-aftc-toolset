/**
 * pi-aftc-toolset — shared SQLite database utility.
 *
 * Owns the singleton better-sqlite3 connection used by both the recorder
 * (usage-recording.ts → recordTurn) and the report generator
 * (usage-report.ts → generateReportHtml). The DB lives at:
 *   <package-root>/.pi-aftc-toolset/data/turns.db
 *
 * This is a utility module, NOT a feature module. Per rules.md §1.5,
 * feature modules (usage-recording.ts, usage-report.ts, core.ts,
 * footer-widget.ts, input-clear.ts, etc.) must not import each other,
 * but they're all free to import this file.
 *
 * better-sqlite3 is an optional runtime dependency — if it's not
 * installed, getDb() returns null forever and a single console.warn is
 * emitted at load time. Both callers handle null gracefully.
 *
 * See `db.readme.md` for schema, API, and failure modes.
 */

import * as fs from "node:fs";
import { getDataDir, getDbFile } from "./paths";

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
    console.clear();
    console.log(
        `\n\x1b[33m################################################################\x1b[0m\n` +
        `\x1b[33mAFTC PI UTILS - WARNING: better-sqlite3 not available\x1b[0m\n` +
        `\x1b[33m################################################################\x1b[0m\n` +
        `\x1b[36mRun /aftc-install in pi to install it automatically.\x1b[0m\n` +
        `\x1b[33m################################################################\x1b[0m\n`
        // `(${(err as Error).message})`,
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
// See `usage-recording.readme.md` for the full column reference
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
        console.log(`[aftc-toolset] SQLite init error: ${(err as Error).message}`);
        return null;
    }
}

/** True if better-sqlite3 loaded successfully at module-init time. */
export function isDbAvailable(): boolean {
    return Database !== null;
}
