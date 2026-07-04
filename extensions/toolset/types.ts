/**
 * Shared types for cross-module communication.
 *
 * Per rules.md §1.5, feature modules must not import each other directly.
 * The orchestrator (index.ts) wires them through these interfaces.
 *
 * Structural typing handles the rest: the UsageRecorder class in
 * usage-recording.ts satisfies TurnRecorder as long as its method
 * signatures match. The footer widget in footer-widget.ts reads only
 * the methods declared on FooterDataProvider — it never imports
 * core.ts.
 *
 * See `types.readme.md` for the full type catalogue and structural-
 * typing rationale.
 */

// ──────────────────────────────────────────────────────────────────────
// Turn recording (core.ts → usage-recording.ts via SQLite)
// ──────────────────────────────────────────────────────────────────────

export interface TurnRecord {
    /** Session-scoped turn counter (matches the widget's turn count). */
    turn: number;
    /** ms since epoch at message_end time. */
    timestamp: number;
    /** e.g. "MiniMax-M3" — captured from the model that produced the turn. */
    modelName: string;
    /** e.g. "high", "low", "off" — captured from the active thinking level. */
    thinkingLevel: string;
    /** Time to first text or tool-call output (ms). */
    thinkingMs: number;
    /** Total turn duration (ms) — request-sent → message-end. */
    responseMs: number;
    /** Cost of this turn in USD. */
    costUsd: number;
    /** New prompt tokens for this turn. */
    inputTokens: number;
    /** Output tokens for this turn. */
    outputTokens: number;
    /** Cache-read tokens for this turn. */
    cacheRead: number;
    /** Cache-write tokens for this turn. */
    cacheWrite: number;
    /** True when this is the first assistant turn after a user message
     * (not an automated tool-call continuation). */
    isUserPrompt: boolean;
    /** Stable-ish ID for the active runtime session; used with promptIndex
     * so per-prompt grouping does not collide across sessions. */
    sessionId: string;
    /** 1-based user prompt number within the session. Automated continuation
     * turns share the same prompt index as the user prompt that caused them. */
    promptIndex: number;
    /** True for top-level prompts used as the projection baseline. */
    isBasePrompt: boolean;
    /** True when this is any follow-up/refinement prompt under an existing task. */
    isSubPrompt: boolean;
    /** True when pi classified this user input as an active mid-stream steer. */
    isSteeringPrompt: boolean;
    /** True when pi classified this user input as an active queued follow-up. */
    isFollowupPrompt: boolean;
    /** True for idle follow-up/refinement prompts that continue the task. */
    isContinuationPrompt: boolean;
    /** Readable classification: base | steer | followup | continuation | auto. */
    promptKind: string;
}

/**
 * Surface that core.ts relies on from the thinking module.
 *
 * Only recordTurn remains — /show-thinking / /hide-thinking were removed
 * (pi's built-in Ctrl+T + hideThinkingBlock setting cover thinking-block
 * visibility), so there is no longer a "is timing visible?" flag to query.
 */
export interface TurnRecorder {
    recordTurn(record: TurnRecord): void;
}

// ──────────────────────────────────────────────────────────────────────
// Footer widget data (core.ts → footer-widget.ts)
// ──────────────────────────────────────────────────────────────────────

/**
 * Snapshot of the current context's cache / token / cost accumulator.
 *
 * Mirrors the private `CacheAccumulator` interface in core.ts but only
 * exposes the fields the footer actually renders. Returning a fresh
 * view each call is fine — the widget caches the rendered string.
 */
export interface AccumulatorView {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
    cost: number;
    turns: number;
    userTurns: number;
    lastTurnCacheRead: number;
    lastTurnInput: number;
    lastTurnOutput: number;
    lastTurnCost: number;
}

/** Minimal model fields the footer needs. */
export interface ModelView {
    name: string;
    reasoning: boolean;
    contextWindow: number;
    thinkingLevel: string;
}

/** Per-tool token cost summary. */
export interface ToolCacheView {
    getCount(): number;
    getTotal(): number;
    getSkillCount(): number;
    getSkillToks(): number;
}

/** Current context-window clock + cost rates (already sampled). */
export interface SessionView {
    sessionStr: string;
    costPerHour: number;
    costPerMinute: number;
}

/**
 * Aggregate stats over a configurable timeframe, computed from the
 * SQLite `turns` table for the footer widget's 4th line.
 *
 * `timeframeLabel` is a short display label like "Today", "3h", "24h",
 * "7d". Cache hit rates are 0..1 (0..100%). Default fields are 0 when
 * the database is unavailable or no turns fall in the timeframe.
 */
export interface TimeframeStatsView {
    timeframeLabel: string;
    costUsd: number;
    userPrompts: number;
    totalTurns: number;
    avgCacheHit: number;      // 0..1 — average cache hit rate over the timeframe
    avgThinkingMs: number;    // 0 if no turns with thinking data
    avgResponseMs: number;    // 0 if no turns
}

/**
 * Surface that footer-widget.ts reads from core.ts.
 *
 * core.ts implements this; the orchestrator (index.ts) passes the
 * returned object to footer-widget.ts so the widget never imports
 * core.ts directly. This keeps the orchestrator pattern (rules.md
 * §1.5): feature modules communicate through structural interfaces,
 * not by importing each other.
 *
 * All getters must be cheap — render() runs every TUI frame.
 */
export interface FooterDataProvider {
    getAccumulator(): AccumulatorView;
    getRecentAvg(): number;
    getModel(): ModelView;
    getToolCache(): ToolCacheView;
    getCachedSession(): SessionView | null;
    /** Number of skills the agent/user has actually invoked this
     *  session (read a SKILL.md, or a `/skill:name` user command).
     *  Best-effort heuristic; reset on session_start. */
    getUsedSkillCount(): number;
    getLastThinkingMs(): number;
    getAvgThinkingMs(): number;
    getLastResponseMs(): number;
    getAvgResponseMs(): number;
    /** Aggregate stats for the active timeframe (configurable via
     * `/aftc-footer-report-timeframe`) from the SQLite turns table.
     * Cached and refreshed at most every 10s, or immediately on
     * timeframe change. */
    getTimeframeStats(): TimeframeStatsView;
    /** Called from the footer's 1Hz ticker; recomputes the session
     * clock + cost rates and lets the widget render them. */
    onTick(): void;
}