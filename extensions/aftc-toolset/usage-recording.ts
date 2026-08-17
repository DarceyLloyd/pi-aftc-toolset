/**
 * pi-aftc-toolset — per-turn SQLite recording feature module.
 *
 * Every completed assistant turn is inserted into the shared DB (see
 * ./db.ts) so the user can query historical per-turn stats via
 * /usage-report.
 *
 * Per AGENTS.md, this is a self-contained feature module: it owns
 * no shared state with other feature modules and is wired into pi by
 * the orchestrator in index.ts. It does not import core.ts or
 * usage-report.ts.
 *
 * ---- What is recorded ----
 * Per-turn METRICS and prompt-type CLASSIFICATION flags only. The
 * actual text of user prompts, sub-prompts, or assistant responses
 * is NEVER recorded — only classification flags. The model call
 * content lives in pi's own session JSONL; this DB only stores
 * metrics + classification. Keeps the DB small (~100 bytes per row)
 * and avoids storing anything sensitive.
 *
 * Zero-cost turns (free models, subscription plans reporting $0) ARE
 * recorded by default — their prompt counts and thinking/response
 * times are useful data, and /usage-report keeps them out of COST
 * averages with paid-only denominators. Set RECORD_ZERO_COST_TURNS
 * (below) to false to skip recording them entirely. Negative-cost
 * turns are never recorded (defensive; impossible from a real
 * provider). The in-memory footer accumulator always updates so the
 * live footer shows the real last-turn cost regardless.
 *
 * The 20 columns written per row are:
 *
 *   Metrics (one row per assistant turn):
 *     - turn, timestamp, session_id, prompt_index
 *     - model_name, thinking_level
 *     - thinking_ms, response_ms, cost_usd
 *     - input_tokens, output_tokens, cache_read, cache_write
 *
 *   Prompt-type classification flags (0/1):
 *     - user_prompt             (1 = direct response to a user msg,
 *                                0 = automated tool-call continuation)
 *     - base_prompt             (1 = first user prompt of a task)
 *     - sub_prompt              (1 = any follow-up / refinement)
 *     - steering_prompt         (1 = sub-prompt sent while agent
 *                                was still active — pi's `steer()`)
 *     - followup_prompt         (1 = sub-prompt queued for after
 *                                agent finished — pi's `followUp()`)
 *     - continuation_prompt     (1 = idle follow-up in same task
 *                                thread)
 *     - prompt_kind             (text — denormalised label, one of
 *                                "base" / "continuation" / "steer" /
 *                                "followup" / "auto")
 *
 * What is NOT recorded: the actual text of prompts or responses,
 * file paths, tool names, tool arguments, or thinking-block
 * content. If you want the model call content, read the session
 * JSONL.
 *
 * History: this module previously also owned /show-thinking and
 * /hide-thinking which toggled visibility of the footer line 3 timing
 * segments. Those commands were removed — pi already has Ctrl+T
 * (app.thinking.toggle) for collapsing/expanding <thinking> blocks in
 * the main output, and the hideThinkingBlock setting for the default.
 * The footer timing info (Thinking time / Response time) is now always
 * visible — that is the useful diagnostic data for this extension.
 *
 * The /usage-report command lives in usage-report.ts; this file only
 * handles the SQLite recording.
 *
 * See `usage-recording-readme.md` for the full schema, history, and
 * failure modes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ErrorRecord, TaskRecord, ToolErrorRecord, TurnRecord, TurnRecorder } from "./types";
import { getDb } from "./db";
import { getDeviceId } from "./paths";
import * as aftcConsole from "./ui/aftc-console";

// -----------------------------------------------------------------------------
// $0-cost turn policy
//
// Some providers (subscription plans, free models) report cost_usd = 0 on
// every turn. When true (default), those turns are still recorded: their
// prompt counts, cache activity and thinking/response times feed the
// /usage-report averages, and the report excludes them from COST averages
// via paid-only denominators. Set to false to skip recording $0 turns
// entirely (the pre-flag behaviour).
// -----------------------------------------------------------------------------
const RECORD_ZERO_COST_TURNS = true;

// -----------------------------------------------------------------------------
// Per-installation owner id (device_id)
//
// One UUID per data dir (created atomically by paths.ts getDeviceId). Tagged
// onto every recorded row. Cached here (the file is created once
// and never changes mid-installation); read lazily on the first record.
// -----------------------------------------------------------------------------
let _deviceId: string | null = null;
function deviceId(): string {
    if (_deviceId === null) _deviceId = getDeviceId();
    return _deviceId;
}

// -----------------------------------------------------------------------------
// UsageRecorder
// -----------------------------------------------------------------------------

class UsageRecorder implements TurnRecorder {
    constructor(private pi: ExtensionAPI) {}

    attach(): void {
        // No commands registered. This module exists solely to record
        // turns into SQLite; visibility/scoping of <thinking> blocks is
        // pi's responsibility (Ctrl+T / hideThinkingBlock setting).
    }

    recordTurn(record: TurnRecord): void {
        // Recording policy: every turn is recorded by default, including
        // $0-cost turns from free / subscription plans (see
        // RECORD_ZERO_COST_TURNS above). Negative cost is impossible from a
        // real provider and would corrupt aggregates — always skipped.
        if (!Number.isFinite(record.costUsd) || record.costUsd < 0) return;
        if (!RECORD_ZERO_COST_TURNS && record.costUsd === 0) return;
        const db = getDb();
        if (!db) return;
        try {
            db.prepare(
                `INSERT INTO turns (
                turn, timestamp, model_name, thinking_level,
                thinking_ms, response_ms, cost_usd,
                input_tokens, output_tokens, cache_read, cache_write,
                context_tokens, context_window,
                user_prompt, session_id, prompt_index,
                base_prompt, sub_prompt, steering_prompt, followup_prompt,
                continuation_prompt, prompt_kind, device_id,
                provider, tool_calls, response_chars, prompt_chars
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                record.contextTokens || 0,
                record.contextWindow || 0,
                record.isUserPrompt ? 1 : 0,
                record.sessionId,
                record.promptIndex,
                record.isBasePrompt ? 1 : 0,
                record.isSubPrompt ? 1 : 0,
                record.isSteeringPrompt ? 1 : 0,
                record.isFollowupPrompt ? 1 : 0,
                record.isContinuationPrompt ? 1 : 0,
                record.promptKind,
                deviceId(),
                record.provider || "",
                record.toolCalls || 0,
                record.responseChars || 0,
                record.promptChars || 0,
            );
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] SQLite insert error: ${(err as Error).message}`);
        }
    }

    recordTask(record: TaskRecord): void {
        // Defensive: a task duration must be a non-negative finite number.
        if (!Number.isFinite(record.taskMs) || record.taskMs < 0) return;
        const db = getDb();
        if (!db) return;
        try {
            db.prepare(
                `INSERT INTO tasks (
                    session_id, prompt_index, timestamp, task_ms, stop_reason,
                    model_name, thinking_level, turn_count,
                    context_window, context_start_tokens, context_end_tokens,
                    allow_provider, allow_5h_start, allow_5h_end,
                    allow_weekly_start, allow_weekly_end, device_id, allowance_reported, provider
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                record.sessionId,
                record.promptIndex,
                record.timestamp,
                record.taskMs,
                record.stopReason,
                record.modelName,
                record.thinkingLevel,
                record.turnCount,
                record.contextWindow || 0,
                record.contextStartTokens || 0,
                record.contextEndTokens || 0,
                record.allowProvider || "",
                record.allow5hStart ?? null,
                record.allow5hEnd ?? null,
                record.allowWeeklyStart ?? null,
                record.allowWeeklyEnd ?? null,
                deviceId(),
                record.allowanceReported ? 1 : 0,
                record.provider || "",
            );
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] SQLite tasks insert error: ${(err as Error).message}`);
        }
    }

    recordError(record: ErrorRecord): void {
        const db = getDb();
        if (!db) return;
        try {
            db.prepare(
                `INSERT INTO errors (
                    session_id, prompt_index, timestamp,
                    model_name, thinking_level, error_type, error_message, error_code, provider, device_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                record.sessionId,
                record.promptIndex,
                record.timestamp,
                record.modelName,
                record.thinkingLevel,
                record.errorType,
                record.errorMessage,
                record.errorCode ?? null,
                record.provider || "",
                deviceId(),
            );
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] SQLite errors insert error: ${(err as Error).message}`);
        }
    }

    recordToolError(record: ToolErrorRecord): void {
        const db = getDb();
        if (!db) return;
        try {
            db.prepare(
                `INSERT INTO tool_errors (
                    session_id, prompt_index, timestamp,
                    model_name, thinking_level, provider,
                    tool_name, error_kind, error_message, error_signature, device_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                record.sessionId,
                record.promptIndex,
                record.timestamp,
                record.modelName,
                record.thinkingLevel,
                record.provider || "",
                record.toolName,
                record.errorKind,
                record.errorMessage,
                record.errorSignature,
                deviceId(),
            );
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] SQLite tool_errors insert error: ${(err as Error).message}`);
        }
    }
}

// -----------------------------------------------------------------------------
// Public factory — the orchestrator (index.ts) calls this and passes the
// returned instance to createCore. The instance is structurally typed as
// TurnRecorder so core.ts doesn't need to import UsageRecorder.
// -----------------------------------------------------------------------------

export function createUsageRecording(pi: ExtensionAPI): TurnRecorder {
    const m = new UsageRecorder(pi);
    m.attach();
    return m;
}
