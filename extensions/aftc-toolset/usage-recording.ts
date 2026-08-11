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
import type { ErrorRecord, TaskRecord, TurnRecord, TurnRecorder } from "./types";
import { getDb } from "./db";
import { getDeviceId } from "./paths";
import { hostname } from "node:os";
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
// Online push — CODE CONSTANTS, deliberately NOT in config.json (v1.21.x).
//
// The ENDPOINT, shared KEY and ENABLED flag all live here in the TS file,
// for the foreseeable future (even when the feature goes public). Users wander the data
// dir, so none of this sits in a readable JSON file next to their settings.
// The key is OPEN/SHARED on purpose (public package): it only gates out
// non-extension traffic, not other users — obfuscation-by-location, not a
// secret. Never move these into config.json or anywhere user-visible.
// The env override (AFTC_USAGE_PUSH_ENABLED=0) is a test/maintainer seam
// only — it lets the suite exercise the disabled path without code edits.
// Read at call time (not module load) so the seam works mid-run.
// -----------------------------------------------------------------------------
const PUSH_ENABLED = () => process.env.AFTC_USAGE_PUSH_ENABLED !== "0";
const PUSH_ENDPOINT = "https://dev.aftc.uk/pi-aftc-toolset/usage/index.php";
const PUSH_API_KEY = "b7007670bcd1e0ab08a435a3f1bf88a16ceed27e45f9e0f9a5b24ec900d7ff5f";

// -----------------------------------------------------------------------------
// Per-installation owner id (device_id)
//
// One UUID per data dir (created atomically by paths.ts getDeviceId). Tagged
// onto every recorded row locally and in the mirror push so the online pull
// can filter to THIS machine's rows. Cached here (the file is created once
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
        const db = getDb();
        if (!db) return;
        // Recording policy: every turn is recorded by default, including
        // $0-cost turns from free / subscription plans (see
        // RECORD_ZERO_COST_TURNS above). Negative cost is impossible from a
        // real provider and would corrupt aggregates — always skipped.
        if (!Number.isFinite(record.costUsd) || record.costUsd < 0) return;
        if (!RECORD_ZERO_COST_TURNS && record.costUsd === 0) return;
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
            // Real-time mirror push (fire-and-forget; never retried).
            this.pushTurn(record);
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] SQLite insert error: ${(err as Error).message}`);
        }
    }

    recordTask(record: TaskRecord): void {
        const db = getDb();
        if (!db) return;
        // Defensive: a task duration must be a non-negative finite number.
        if (!Number.isFinite(record.taskMs) || record.taskMs < 0) return;
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
            // Real-time mirror push (fire-and-forget; never retried).
            this.pushTask(record);
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
                    model_name, thinking_level, error_type, error_message, device_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                record.sessionId,
                record.promptIndex,
                record.timestamp,
                record.modelName,
                record.thinkingLevel,
                record.errorType,
                record.errorMessage,
                deviceId(),
            );
            // Real-time mirror push (fire-and-forget; never retried).
            this.pushError(record);
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] SQLite errors insert error: ${(err as Error).message}`);
        }
    }

    // -----------------------------------------------------------------------
    // Real-time mirror push (v1.21.7)
    //
    // After a row is recorded locally it is ALSO pushed to the online usage
    // mirror endpoint (index.php), one record per request, in real time.
    // Configured via config.json preferences (usagePushEnabled /
    // usagePushEndpoint / usagePushApiKey — read FRESH from disk every time;
    // never cached).
    //
    // ERROR POLICY: on ANY error from the endpoint (non-200 response or a
    // network failure) the push is DROPPED and logged — it is never retried
    // and never queued. The local database is the source of truth; a missed
    // online push is accepted. The push is fire-and-forget and never blocks
    // the recording path.
    // -----------------------------------------------------------------------

    private push(table: "turns" | "tasks" | "errors", row: Record<string, unknown>): void {
        // Gate is the PUSH_ENABLED code constant (default ON). Endpoint +
        // key are code constants too — nothing about the push is in
        // config.json (users wander the data dir).
        if (!PUSH_ENABLED()) return;
        if (typeof fetch !== "function") return;
        const payload = JSON.stringify({ source: hostname(), [table]: [row] });
        void (async () => {
            try {
                const res = await fetch(PUSH_ENDPOINT, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-API-Key": PUSH_API_KEY },
                    body: payload,
                    signal: AbortSignal.timeout(10_000),
                });
                if (!res.ok) {
                    aftcConsole.logError(`[aftc-toolset] usage push ${table} rejected (HTTP ${res.status}) — dropped, never retried`);
                }
                await res.text().catch(() => undefined); // drain (empty body expected)
            } catch (err) {
                aftcConsole.logError(`[aftc-toolset] usage push ${table} failed: ${(err as Error).message} — dropped, never retried`);
            }
        })();
    }

    private pushTurn(record: TurnRecord): void {
        this.push("turns", {
            turn: record.turn,
            timestamp: record.timestamp,
            device_id: deviceId(),
            model_name: record.modelName,
            thinking_level: record.thinkingLevel,
            thinking_ms: record.thinkingMs,
            response_ms: record.responseMs,
            cost_usd: record.costUsd,
            input_tokens: record.inputTokens,
            output_tokens: record.outputTokens,
            cache_read: record.cacheRead,
            cache_write: record.cacheWrite,
            user_prompt: record.isUserPrompt ? 1 : 0,
            base_prompt: record.isBasePrompt ? 1 : 0,
            sub_prompt: record.isSubPrompt ? 1 : 0,
            steering_prompt: record.isSteeringPrompt ? 1 : 0,
            followup_prompt: record.isFollowupPrompt ? 1 : 0,
            continuation_prompt: record.isContinuationPrompt ? 1 : 0,
            prompt_kind: record.promptKind,
            prompt_index: record.promptIndex,
            session_id: record.sessionId,
            context_window: record.contextWindow || 0,
            context_tokens: record.contextTokens || 0,
            provider: record.provider || "",
            tool_calls: record.toolCalls || 0,
            response_chars: record.responseChars || 0,
            prompt_chars: record.promptChars || 0,
        });
    }

    private pushTask(record: TaskRecord): void {
        this.push("tasks", {
            session_id: record.sessionId,
            prompt_index: record.promptIndex,
            timestamp: record.timestamp,
            device_id: deviceId(),
            task_ms: record.taskMs,
            stop_reason: record.stopReason,
            model_name: record.modelName,
            thinking_level: record.thinkingLevel,
            turn_count: record.turnCount,
            context_window: record.contextWindow || 0,
            context_start_tokens: record.contextStartTokens || 0,
            context_end_tokens: record.contextEndTokens || 0,
            allow_provider: record.allowProvider || "",
            allow_5h_start: record.allow5hStart ?? null,
            allow_5h_end: record.allow5hEnd ?? null,
            allow_weekly_start: record.allowWeeklyStart ?? null,
            allow_weekly_end: record.allowWeeklyEnd ?? null,
            allowance_reported: record.allowanceReported ? 1 : 0,
            provider: record.provider || "",
        });
    }

    private pushError(record: ErrorRecord): void {
        this.push("errors", {
            session_id: record.sessionId,
            prompt_index: record.promptIndex,
            timestamp: record.timestamp,
            device_id: deviceId(),
            model_name: record.modelName,
            thinking_level: record.thinkingLevel,
            error_type: record.errorType,
            error_message: record.errorMessage,
        });
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