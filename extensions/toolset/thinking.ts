/**
 * pi-aftc-toolset — per-turn SQLite recording feature module.
 *
 * Every completed assistant turn is inserted into the shared DB (see
 * ./db.ts) so the user can query historical per-turn stats via
 * /usage-report.
 *
 * Per rules.md §2, this is a self-contained feature module: it owns no
 * shared state with other feature modules and is wired into pi by the
 * orchestrator in index.ts. It does not import core.ts or usage.ts.
 *
 * History: this module previously also owned /show-thinking and
 * /hide-thinking which toggled visibility of the footer line 3 timing
 * segments. Those commands were removed — pi already has Ctrl+T
 * (app.thinking.toggle) for collapsing/expanding <thinking> blocks in
 * the main output, and the hideThinkingBlock setting for the default.
 * The footer timing info (Thinking time / Response time) is now always
 * visible — that is the useful diagnostic data for this extension.
 *
 * The /usage-report command lives in usage.ts; this file only handles
 * the SQLite recording.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TurnRecord, TurnRecorder } from "./types";
import { getDb } from "./db";

// -----------------------------------------------------------------------------
// ThinkingModule
// -----------------------------------------------------------------------------

class ThinkingModule implements TurnRecorder {
    constructor(private pi: ExtensionAPI) {}

    attach(): void {
        // No commands registered. This module exists solely to record
        // turns into SQLite; visibility/scoping of <thinking> blocks is
        // pi's responsibility (Ctrl+T / hideThinkingBlock setting).
    }

    recordTurn(record: TurnRecord): void {
        const db = getDb();
        if (!db) return;
        try {
            db.prepare(
                `INSERT INTO turns (
                    turn, timestamp, model_name, thinking_level,
                    thinking_ms, response_ms, cost_usd,
                    input_tokens, output_tokens, cache_read, cache_write,
                    user_prompt, session_id, prompt_index,
                    base_prompt, sub_prompt, steering_prompt, followup_prompt,
                    continuation_prompt, prompt_kind
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                record.turn,
                record.timestamp,
                record.modelName,
                record.thinkingLevel,
                record.thinkingMs,
                record.responseMs,
                record.costUsd,
                record.inputTokens,
                record.outputTokens,
                record.cacheRead,
                record.cacheWrite,
                record.isUserPrompt ? 1 : 0,
                record.sessionId,
                record.promptIndex,
                record.isBasePrompt ? 1 : 0,
                record.isSubPrompt ? 1 : 0,
                record.isSteeringPrompt ? 1 : 0,
                record.isFollowupPrompt ? 1 : 0,
                record.isContinuationPrompt ? 1 : 0,
                record.promptKind,
            );
        } catch (err) {
            console.log(`[aftc-toolset] SQLite insert error: ${(err as Error).message}`);
        }
    }
}

// -----------------------------------------------------------------------------
// Public factory — the orchestrator (index.ts) calls this and passes the
// returned instance to createCore. The instance is structurally typed as
// TurnRecorder so core.ts doesn't need to import ThinkingModule.
// -----------------------------------------------------------------------------

export function createThinkingModule(pi: ExtensionAPI): TurnRecorder {
    const m = new ThinkingModule(pi);
    m.attach();
    return m;
}