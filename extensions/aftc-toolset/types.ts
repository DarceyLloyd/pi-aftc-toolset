/**
 * Shared types for cross-module communication.
 *
 * Per AGENTS.md, feature modules must not import each other directly.
 * The orchestrator (index.ts) wires them through these interfaces.
 *
 * Structural typing handles the rest: the UsageRecorder class in
 * usage-recording.ts satisfies TurnRecorder as long as its method
 * signatures match. The footer widget in footer-widget.ts reads only
 * the methods declared on FooterDataProvider — it never imports
 * core.ts.
 *
 * See `types-readme.md` for the full type catalogue and structural-
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
    /** Context used at message_end (pi's getContextUsage().tokens — the
     *  input-side context estimate: system prompt + history). 0 when pi
     *  had no estimate (e.g. aborted / empty turns). */
    contextTokens: number;
    /** Model's declared context window in tokens (pi's
     *  getContextUsage().contextWindow, fallback to the model def's
     *  contextWindow). 0 when unknown. */
    contextWindow: number;
    /** Provider id of the turn (deepseek, qwencloud, kimi-coding, zai,
     *  minimax, openai, anthropic, openrouter, ...) — from the assistant
     *  message / model event. Lets the report distinguish same-named
     *  models across providers. '' when unknown. */
    provider: string;
    /** Tool calls made in this turn (assistant content parts). */
    toolCalls: number;
    /** Response text length in chars (assistant text parts). */
    responseChars: number;
    /** User prompt text length in chars (the user message this turn
     *  answered). */
    promptChars: number;
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
 * One completed TASK (a single user prompt's full agent run: enter → settle).
 * Recorded by core.ts on `agent_settled` via TurnRecorder.recordTask. A task spans
 * one or more assistant turns; `taskMs` is the wall-clock duration the user waited
 * from pressing enter to the agent returning control (complete, error, or abort).
 * Questions (ask_user_question) do NOT end a task — the agent does not settle while
 * waiting for the answer, so the timer runs through them. See usage-recording-readme.md.
 */
export interface TaskRecord {
    /** Stable per-runtime-session id (matches TurnRecord.sessionId). */
    sessionId: string;
    /** 1-based user-prompt number this task belongs to. */
    promptIndex: number;
    /** ms since epoch at task START (first agent_start). */
    timestamp: number;
    /** Wall-clock task duration in ms (enter → settle). */
    taskMs: number;
    /** How the task ended: "complete" | "error" | "aborted". */
    stopReason: string;
    /** Model that ran the task (eg "MiniMax-M3"). */
    modelName: string;
    /** Thinking level (eg "high", "low", "off"). */
    thinkingLevel: string;
    /** Number of assistant turns the task took. */
    turnCount: number;
    /** Model's declared context window in tokens at task time (0 = unknown). */
    contextWindow: number;
    /** pi's context-usage estimate at task START (message_start of the user
     *  prompt): the context that will be sent, before this task grows it. */
    contextStartTokens: number;
    /** pi's context-usage estimate at task END (last message_end): the
     *  context after the final answer, input-side. */
    contextEndTokens: number;
    /** Provider label of the allowance snapshot (eg "ChatGPT Plus", "Z.ai
     *  GLM") — provider-level, only when the active provider reports an
     *  allowance. Empty when no snapshot was available. */
    allowProvider: string;
    /** 5-hour allowance used % at task start / end (provider-reported;
     *  null when the provider exposes no 5h window). */
    allow5hStart: number | null;
    allow5hEnd: number | null;
    /** Weekly allowance used % at task start / end (provider-reported;
     *  null when the provider exposes no weekly window). */
    allowWeeklyStart: number | null;
    allowWeeklyEnd: number | null;
    /** True when the active provider ACTUALLY reported a 5h / weekly
     *  allowance window for this task (subscription plans only — Codex,
     *  Claude, MiniMax, Z.ai GLM, Kimi). Mirrors the footer line-5
     *  show/hide: API providers (DeepSeek etc.) never report windows and
     *  are recorded false, so the report can gate allowance-window
     *  metrics (5h / window, 1M flag) on this. */
    allowanceReported: boolean;
    /** Provider id that ran the task (deepseek, qwencloud, kimi-coding,
     *  ...) — '' when unknown. */
    provider: string;
}

/**
 * One failed LLM call (assistant turn that ended with stopReason "error" —
 * network failure, rate limit, overloaded, 404, auth, timeout). Recorded by
 * core.ts on the failing message_end via TurnRecorder.recordError. User
 * aborts (stopReason "aborted") are NOT errors — they are counted as a stat
 * from the tasks table. Error text is stored locally for the report's Errors
 * tab; it never leaves the machine.
 */
export interface ErrorRecord {
    /** Stable per-runtime-session id (matches TurnRecord.sessionId). */
    sessionId: string;
    /** 1-based user-prompt number the failed call belonged to. */
    promptIndex: number;
    /** ms since epoch at the failing message_end. */
    timestamp: number;
    /** Model that failed (eg "MiniMax-M3"). */
    modelName: string;
    /** Thinking level (eg "high", "low", "off"). */
    thinkingLevel: string;
    /** Classified category: "rate-limit" | "overloaded" | "not-found" |
     *  "auth" | "timeout" | "network" | "other". */
    errorType: string;
    /** The raw error message from pi (provider text, may mention HTTP
     *  status / retry-after). */
    errorMessage: string;
    /** Extracted HTTP status code from the message (429, 503, ...);
     *  null when the message carries no code. */
    errorCode: number | null;
    /** Provider id of the failing model (deepseek, qwencloud, ...) —
     *  distinguishes same-named models across providers. '' when unknown. */
    provider: string;
}

/**
 * One failed TOOL call (a tool_result whose `isError` was true — model
 * misuse: wrong args, stale anchors, bad regex, missing binary, timeout).
 * Recorded by core.ts on the tool_result hook via TurnRecorder.recordToolError.
 * Distinct from ErrorRecord (provider failures). Stored locally only; the
 * error message is bounded and normalised into `errorSignature` so the
 * report can collapse repeated identical mistakes into a repeat count.
 */
export interface ToolErrorRecord {
    sessionId: string;
    promptIndex: number;
    timestamp: number;
    modelName: string;
    thinkingLevel: string;
    provider: string;
    toolName: string;
    /** Classified category: "invalid-args" | "stale-anchor" | "not-found" |
     *  "bad-regex" | "permission" | "timeout" | "network" |
     *  "missing-binary" | "other". */
    errorKind: string;
    /** Bounded raw error message (local-only). */
    errorMessage: string;
    /** Normalised message (lowercase, whitespace collapsed, digits/paths
     *  replaced) for repeat-dedup in the report. */
    errorSignature: string;
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
    /** Record one settled task (user prompt → settle, any outcome). See TaskRecord. */
    recordTask(record: TaskRecord): void;
    /** Record one failed LLM call (stopReason "error"). See ErrorRecord. */
    recordError(record: ErrorRecord): void;
    /** Record one failed tool call (tool_result isError). See ToolErrorRecord. */
    recordToolError(record: ToolErrorRecord): void;
}

// ──────────────────────────────────────────────────────────────────────
// Subscription allowance (allowance.ts → core.ts → footer-widget.ts)
//
// Line 5 of the footer. Supported subscription providers are
// `openai-codex` (ChatGPT), `minimax` / `minimax-cn` (Token Plan),
// `zai` / `zai-coding-cn` (GLM Coding Plan), `kimi-coding` (Kimi for
// Coding), and Anthropic OAuth through response headers. Other
// providers return null so line 5 stays hidden.
// See `allowance.ts` for the fetch and parse logic.
// ──────────────────────────────────────────────────────────────────────

/** One rolling allowance window (5-hour or weekly).
 *  `usedPercent` is normalized to 0..100 USED (MiniMax reports remaining
 *  and is converted; Codex reports used directly). Reset fields are null
 *  when the provider did not return them. */
export interface AllowanceWindow {
    usedPercent: number;            // 0..100 used
    resetSeconds: number | null;    // seconds until the window resets
    resetAt: number | null;         // epoch ms at which the window resets
}

/** Snapshot of subscription allowance for the active model's provider.
 *  `providerLabel` is a short human label (e.g. "ChatGPT Plus", "MiniMax").
 *  Either window may be null when the provider omits it. The footer builds
 *  line 5 from whichever windows are present; if both are null the line is
 *  hidden. */
export interface AllowanceView {
    providerLabel: string;
    fiveHour: AllowanceWindow | null;
    weekly: AllowanceWindow | null;
    /** Epoch ms of the last successful fetch (for staleness display). */
    fetchedAt: number;
}

/** Surface that core.ts exposes to footer-widget.ts, implemented by
 *  allowance.ts. Returns the cached snapshot — the fetch happens
 *  asynchronously on session_start / model_select / agent_end. */
export interface AllowanceProvider {
    /** Current cached allowance snapshot, or null when the active provider
     *  is unsupported or no successful fetch has happened yet. */
    getAllowance(): AllowanceView | null;
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
 *
 * Turn-count fields split cleanly into three buckets so the footer can
 * report "User prompts" and "AI prompts" without confusing them:
 *   - `userTurns` - assistant turns that were the FIRST reply to a
 *     user message (i.e. prompted directly by the human). Always 0
 *     for automated tool-call continuations.
 *   - `aiTurns`   - assistant turns the model itself initiated (i.e.
 *     tool-call continuations: it received a tool result and decided
 *     to keep talking). Increments every time the agent loop calls
 *     the model after a tool returns.
 *   - `turns`     - total assistant turns (`userTurns + aiTurns`).
 *     Used by `/cache-stats` and `/cache-profile` for "total turns";
 *     the footer reads the split fields instead so a single user
 *     prompt shows as "User 1 / AI 0" even though the model responded.
 */
export interface AccumulatorView {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
    cost: number;
    turns: number;
    userTurns: number;
    aiTurns: number;
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
 * `timeframeLabel` is a long-form display label matching the
 * /aftc-set-costs-timeframe slash command vocabulary: "Today",
 * "Last 3 Hours", "Last 6 Hours", "Last 24 Hours", "Last 2 Days",
 * "Last 3 Days", "Last 7 Days", "Last 28 Days". Cache hit rates are
 * 0..1 (0..100%). Default fields are 0 when
 * the database is unavailable or no turns fall in the timeframe.
 */
export interface TimeframeStatsView {
    timeframeLabel: string;   // full label, eg "Last 3 Days" (console output)
    timeframeShort: string;   // footer prefix, eg "3 Day" ("3 Day Averages:")
    costUsd: number;
    userPrompts: number;
    totalTurns: number;
    avgCacheHit: number;      // 0..1 — average cache hit rate over the timeframe
    avgTaskMs: number;        // avg wall-clock of COMPLETED tasks in the window (0 if none)
}

/** One selectable timeframe for the footer line-4 averages (menu row). */
export interface TimeframeOption {
    key: string;
    /** Menu text, eg "Last 3 hours" / "3 Days" / "Month". */
    label: string;
    /** Rolling-window hint shown next to "Last" options; "" for
     *  date-based options. */
    description: string;
    /** True = rolling window from the current time; false = anchored
     *  to calendar boundaries (start of day/month/year). */
    rolling: boolean;
}

/**
 * Surface that footer-widget.ts reads from core.ts.
 *
 * core.ts implements this; the orchestrator (index.ts) passes the
 * returned object to footer-widget.ts so the widget never imports
 * core.ts directly. This keeps the orchestrator pattern (AGENTS.md):
 * feature modules communicate through structural interfaces,
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
    /** Aggregate stats for the active timeframe (configurable via the
     *  /aftc-footer menu) from the SQLite turns + tasks tables.
     * Cached and refreshed at most every 10s, or immediately on
     * timeframe change. */
    getTimeframeStats(): TimeframeStatsView;
    /** All selectable timeframes for the footer averages, in menu
     *  order (rolling "Last" options first, then date-based). */
    getTimeframeOptions(): TimeframeOption[];
    /** Key of the currently active timeframe. */
    getTimeframeKey(): string;
    /** Set the active timeframe by key (persists the preference).
     *  Returns false for an unknown key. */
    setTimeframe(key: string): boolean;
    /** Subscription allowance snapshot for line 5 (5h + weekly used %
     *  + reset countdown). Null for unsupported providers, after any
     *  fetch/parse failure, or before the first successful fetch.
     *  Backed by allowance.ts via the orchestrator. */
    getAllowance(): AllowanceView | null;
    /** Called from the footer's 1Hz ticker; recomputes the session
     * clock + cost rates and lets the widget render them. */
    onTick(): void;
    /** Pi's own context-usage estimate (same number shown in the
     *  native status bar). Refreshed on every message_end and on the
     *  1Hz ticker. Null when pi hasn't computed one yet (e.g. before
     *  the first LLM response). */
    getContextUsage(): ContextUsageView | null;
    /** Task-time view for the footer "Task Time" segment: the wall-clock duration
     *  of the current (running) or last completed task (one user prompt's full agent
     *  run, enter → settle). See TaskTimeView. */
    getTaskTime(): TaskTimeView;
}

export interface ContextUsageView {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
}

/** Snapshot of the task timer for the footer "Task Time" segment. */
export interface TaskTimeView {
    /** True while a task is in flight (enter pressed, not yet settled). */
    running: boolean;
    /** Live elapsed ms when running; the last task's duration when idle. */
    elapsedMs: number;
    /** Last completed task duration in ms (0 before the first task). */
    lastMs: number;
    /** How the last task ended: "" (none yet) | "complete" | "error" | "aborted". */
    lastStopReason: string;
}