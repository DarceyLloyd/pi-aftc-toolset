/**
 * pi-aftc-toolset — cache-diagnostics data module.
 *
 * Owns the cache / timing / cost accumulators, the per-tool token cost
 * cache, the prefix-shape tracker, and the context-window clock.
 *
 * Rendering lives in footer-widget.ts; this file never imports it and
 * never calls `ctx.ui.setWidget`. The orchestrator (index.ts) wires
 * this module's returned `FooterDataProvider` to the widget so the
 * footer reads the latest data via cheap getters (rules.md §1.5,
 * §7.2 — never block in render).
 *
 * Hit-rate formula (matches OpenAI usage shape):
 *   hit% = cacheRead / (cacheRead + input)
 * where pi's `input` is *new* prompt tokens only and `cacheRead` is
 * the cached prefix. The true total prompt is their sum. Do not
 * divide by `input` alone.
 *
 * Thinking time = request-sent → first text or tool-call output
 *                 (time to first visible output).
 * Response time = request-sent → message end (total turn duration).
 * These are tracked per turn and averaged over the recent window.
 *
 * Performance: all expensive work (tool cost computation, prefix-shape
 * hashing) is cached and refreshed from events — never inside the
 * widget's render(). A 1s ticker in footer-widget.ts calls
 * `data.onTick()` so the context-window clock and cost rates stay
 * current.
 *
 * Context-window clock: wall-clock elapsed since the first user
 * prompt of the current session. Tracked in-memory only (set in
 * `message_start` for user, cleared in `resetTiming`). No file I/O
 * — the clock is per-session and resets at every session boundary
 * (`session_start` / `/reload` / `/new` / `/resume`), so persistence
 * would be pointless.
 *
 * Model/thinking come from session_start + model_select events
 * (ctx.model can be undefined on early renders, so we capture from
 * event contexts).
 *
 * Model and thinking-level changes update footer labels only; they do
 * not reset the context-window clock or accumulated cost.
 *
 * Layout (per rules.md §1.4):
 *   - index.ts          — orchestrator
 *   - core.ts           — this file: data + events + commands
 *   - footer-widget.ts  — widget rendering + /aftc-footer toggle
 *   - input-clear.ts    — Alt+C shortcut to clear the input editor
 *
 * See `core.readme.md` for the full contract (events, commands,
 * public factory signature, closure state).
 */

import type { ExtensionAPI, ExtensionCommandContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import type {
    AccumulatorView,
    AllowanceProvider,
    TimeframeStatsView,
    FooterDataProvider,
    ModelView,
    ToolCacheView,
    SessionView,
    TurnRecorder,
} from "./types";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import * as path from "node:path";
import { getDb } from "./db";
import {
    getPreference,
    setPreference,
} from "./state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheAccumulator {
    cacheRead: number;
    cacheWrite: number;
    input: number;       // total new prompt tokens across the session
    output: number;      // total output tokens across the session
    cost: number;
    turns: number;       // total assistant turns (userTurns + aiTurns)
    userTurns: number;   // user-prompted turns only (first assistant turn after each user message)
    aiTurns: number;     // AI-initiated turns (tool-call continuations): the model decided to keep talking after a tool returned. Stays 0 for a single user prompt that produces a final answer with no tool calls.
    lastTurnCacheRead: number;
    lastTurnCacheWrite: number;
    lastTurnInput: number;   // last turn only — total prompt tokens (new + cached)
    lastTurnOutput: number;  // last turn only
    lastTurnCost: number;    // last turn only — usage.cost.total for that turn
}

interface PrefixShape {
    systemHash: string;
    toolsHash: string;
    prefixHash: string;
    toolSchemaTokens: number;
}

interface ModelInfo {
    name: string;
    reasoning: boolean;
    contextWindow: number;
    thinkingLevel: string;
}

interface ToolCost {
    name: string;
    tokens: number;
}

// Cached view of the current context window, refreshed at 1Hz by the footer
// ticker and read by render(). Sampling here, not in render(), keeps rates
// stable while the user types and the TUI re-renders frequently.
//
// The footer's cost rate is deliberately context-local: current footer cost
// divided by the current context-window clock. The durable usage DB and
// report still track all historical/today usage separately.
interface CachedSession {
    sessionMs: number;
    sessionStr: string;
    costPerHour: number;
    costPerMinute: number;
}

// ---------------------------------------------------------------------------
// Hashing & formatting helpers
// ---------------------------------------------------------------------------

function shortHash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, "0");
}

function estimateTokens(s: string): number { return s ? Math.ceil(s.length / 4) : 0; }

function fmt(n: number): string {
    if (n < 1000) return n.toString();
    if (n < 10000) return (n / 1000).toFixed(1) + "K";
    if (n < 1000000) return Math.round(n / 1000) + "K";
    return (n / 1000000).toFixed(1) + "M";
}

// Long-form duration for the context-window clock. Adaptive: lower-case
// suffixes (10s 10m 10h 10d), drops zero sub-units. Two-unit precision
// so e.g. "5m 30s" is shown when at least 1 minute has elapsed.
function fmtDurationLong(ms: number): string {
    if (ms <= 0) return "0s";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
    return `${sec}s`;
}

// Duration for thinking/response. Always a float in seconds to one
// decimal place with a lowercase "s" suffix — e.g. "1.5s", "83.0s".
function fmtDurationShort(ms: number): string {
    if (ms <= 0) return "0.0s";
    return (ms / 1000).toFixed(1) + "s";
}

// hit% = cacheRead / (cacheRead + input). Returns a number 0..1, or NaN if no data.
function hitRateNum(cached: number, input: number): number {
    const total = cached + input;
    if (total <= 0) return NaN;
    return cached / total;
}

function hitRate(cached: number, input: number): string {
    const r = hitRateNum(cached, input);
    return Number.isNaN(r) ? "—" : (r * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// ToolCostCache — per-tool token cost, computed once, signature-invalidated
// ---------------------------------------------------------------------------

class ToolCostCache {
    private costs: ToolCost[] = [];
    private total = 0;
    private skillCount = 0;
    private skillToks = 0;
    private skillSignature = "";
    private signature = "";

    /** Stringify a tool the same way everywhere — one source of truth. */
    private serialize(t: ToolInfo): string {
        return JSON.stringify({ name: t.name, description: t.description || "", parameters: (t as any).parameters || {} });
    }

    /** Recompute only if the active tool set changed. Returns true if refreshed. */
    refresh(tools: ToolInfo[]): boolean {
        const sig = JSON.stringify(tools.map(t => ({ n: t.name, d: t.description || "", p: (t as any).parameters || {} })));
        if (sig === this.signature) return false;
        this.signature = sig;

        this.costs = tools
            .map(t => ({ name: t.name, tokens: estimateTokens(this.serialize(t)) }))
            .sort((a, b) => b.tokens - a.tokens);
        this.total = this.costs.reduce((s, c) => s + c.tokens, 0);
        return true;
    }

    /**
     * Set the loaded skills (NOT tools). Skills are loaded into the
     * system prompt as text blocks (`systemPromptOptions.skills`) and
     * are never exposed as tools, so they cannot be inferred from the
     * tool list. The caller passes the Skill[] from
     * `before_agent_start`'s `event.systemPromptOptions.skills`. We
     * recompute only on name/description change.
     */
    setSkills(skills: { name: string; description: string }[]): void {
        const sig = JSON.stringify(skills.map(s => ({ n: s.name, d: s.description || "" })));
        if (sig === this.skillSignature) return;
        this.skillSignature = sig;
        this.skillCount = skills.length;
        this.skillToks = estimateTokens(
            JSON.stringify(skills.map(s => ({ name: s.name, description: s.description || "" }))),
        );
    }

    getCosts(): readonly ToolCost[] { return this.costs; }

    getTotal(): number { return this.total; }
    getSkillCount(): number { return this.skillCount; }
    getSkillToks(): number { return this.skillToks; }
    getCount(): number { return this.costs.length; }
}

// ---------------------------------------------------------------------------
// ShapeTracker — prefix-shape hashing + churn detection
// ---------------------------------------------------------------------------

class ShapeTracker {
    private lastShape: PrefixShape | null = null;
    private churn = "";

    /** Capture shape from a system prompt + tools. Stringify params once. */
    capture(systemPrompt: string, tools: ToolInfo[]): PrefixShape {
        const serialized = tools.map(t => ({ name: t.name, description: t.description || "", json: JSON.stringify((t as any).parameters || {}) }));
        const sorted = [...serialized].sort((a, b) => {
            if (a.name !== b.name) return a.name < b.name ? -1 : 1;
            if (a.description !== b.description) return a.description < b.description ? -1 : 1;
            return a.json < b.json ? -1 : 1;
        });
        const toolsJSON = JSON.stringify(sorted.map(s => ({ name: s.name, description: s.description, parameters: s.json })));
        return {
            systemHash: shortHash(systemPrompt),
            toolsHash: shortHash(toolsJSON),
            prefixHash: shortHash(JSON.stringify({ system: systemPrompt, tools: sorted })),
            toolSchemaTokens: estimateTokens(toolsJSON),
        };
    }

    /** Update against a new shape; returns churn reasons (empty if unchanged / first run). */
    update(systemPrompt: string, tools: ToolInfo[]): { changed: boolean; reasons: string[] } {
        const cur = this.capture(systemPrompt, tools);
        const reasons: string[] = [];
        if (this.lastShape) {
            if (this.lastShape.systemHash !== cur.systemHash) reasons.push("system");
            if (this.lastShape.toolsHash !== cur.toolsHash) reasons.push("tools");
            if (reasons.length === 0 && this.lastShape.prefixHash !== cur.prefixHash) reasons.push("unknown");
        }
        this.lastShape = cur;
        if (reasons.length > 0) this.churn = reasons.join("+");
        return { changed: reasons.length > 0, reasons };
    }

    reset(reason: string): void {
        this.lastShape = null;
        this.churn = reason;
    }

    getShape(): PrefixShape | null { return this.lastShape; }
    getChurn(): string { return this.churn; }

    /** Diff against an arbitrary shape (used by /cache-profile). */
    diff(other: PrefixShape): { changed: boolean; reasons: string[] } {
        const reasons: string[] = [];
        if (!this.lastShape) return { changed: false, reasons };
        if (this.lastShape.systemHash !== other.systemHash) reasons.push("system");
        if (this.lastShape.toolsHash !== other.toolsHash) reasons.push("tools");
        if (reasons.length === 0 && this.lastShape.prefixHash !== other.prefixHash) reasons.push("unknown");
        return { changed: reasons.length > 0, reasons };
    }
}

// ---------------------------------------------------------------------------
// createCore — the cache-diagnostics data module
//
// Owns the cache / timing / cost accumulators and prefix-shape tracker.
// Returns a FooterDataProvider that footer-widget.ts reads from.
// ---------------------------------------------------------------------------

export function createCore(pi: ExtensionAPI, turnRecorder: TurnRecorder, allowance: AllowanceProvider): FooterDataProvider {
    const RECENT_TURNS = 10;

    const acc: CacheAccumulator = {
        cacheRead: 0, cacheWrite: 0, input: 0, output: 0, cost: 0, turns: 0, userTurns: 0, aiTurns: 0,
        lastTurnCacheRead: 0, lastTurnCacheWrite: 0, lastTurnInput: 0, lastTurnOutput: 0, lastTurnCost: 0,
    };
    const recentHits: number[] = [];   // last N turn hit rates (0..1)

    // Prompt tracking: input.streamingBehavior tells whether a user
    // message was submitted while the agent was already streaming
    // (steer/followUp). The next assistant turn records that metadata,
    // and continuation turns share the same prompt index.
    const newSessionId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    let _sessionId = newSessionId();
    let _pendingUserTurn = false;
    let _pendingBasePrompt = false;
    let _pendingSubPrompt = false;
    let _pendingSteeringPrompt = false;
    let _pendingFollowupPrompt = false;
    let _pendingContinuationPrompt = false;
    let _pendingPromptKind = "auto";
    let _pendingStreamingBehavior: "steer" | "followUp" | undefined = undefined;
    let _currentPromptIndex = 0;
    let _pendingPromptIndex = 0;

    // Timing state — context-window clock + per-turn thinking/response times.
    let sessionStarted = false;                       // true after first user prompt of a context window
    let _sessionStartTime: number | null = null;      // wall-clock at first user prompt (in-memory only)
    let currentTurnStart: number | null = null;        // assistant message_start time
    let currentTurnFirstOutput: number | null = null;  // first text/tool-call in current turn
    let lastThinkingMs = 0;
    let lastResponseMs = 0;
    const thinkingTimes: number[] = [];
    const responseTimes: number[] = [];

    // Pi's own context-usage snapshot. Captured on every message_end
    // (after the new turn is added) and on every 1Hz ticker pulse so
    // the footer widget can show the same % that pi's native status
    // bar shows. Null until the first capture (before first LLM resp).
    let contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null = null;

    /**
     * Reset the per-prompt tracking flags + the in-progress turn
     * timing fields. Called from resetAccumulators on every session
     * start. Per-session only; nothing persisted.
     */
    function resetEphemeralState(): void {
        _pendingUserTurn = false;
        _pendingBasePrompt = false;
        _pendingSubPrompt = false;
        _pendingSteeringPrompt = false;
        _pendingFollowupPrompt = false;
        _pendingContinuationPrompt = false;
        _pendingPromptKind = "auto";
        _pendingStreamingBehavior = undefined;
        _currentPromptIndex = 0;
        _pendingPromptIndex = 0;
        currentTurnStart = null;
        currentTurnFirstOutput = null;
        // Skill-usage tracking is per-session: a fresh session starts
        // with nothing loaded/used. availableSkills is repopulated on
        // the first before_agent_start of the new session.
        usedSkills.clear();
        availableSkills = [];
    }

    /**
     * Reset EVERYTHING for a fresh session start. Called on every
     * session_start - accumulators are per-session and live only in
     * this closure; there is no per-session persistence anymore
     * (state.json holds only user preferences).
     */
    function resetAccumulators(): void {
        acc.cacheRead = acc.cacheWrite = acc.input = acc.output = acc.cost = acc.turns = acc.userTurns = acc.aiTurns = 0;
        acc.lastTurnCacheRead = acc.lastTurnCacheWrite = acc.lastTurnInput = acc.lastTurnOutput = acc.lastTurnCost = 0;
        recentHits.length = 0;
        shape.reset("");
        _sessionId = newSessionId();
        resetEphemeralState();
        resetTiming();
    }

    function resetTiming(): void {
        sessionStarted = false;
        _sessionStartTime = null;
        currentTurnStart = null;
        currentTurnFirstOutput = null;
        lastThinkingMs = 0;
        lastResponseMs = 0;
        thinkingTimes.length = 0;
        responseTimes.length = 0;
        cachedSession = null;
        // Re-prime the cache so the post-reset render doesn't wait up to
        // 1s for the next ticker tick.
        recomputeCachedSession();
    }

    // Cached session view, updated only on the 1Hz ticker (not on every
    // render). This is what the footer reads. Sampling at 1Hz keeps rates
    // stable while the user types and the TUI re-renders frequently.
    let cachedSession: CachedSession | null = null;

    function recomputeCachedSession(): void {
        // Wall-clock elapsed since the first user prompt of the session.
        // Set in `message_start` for user, cleared in `resetTiming`.
        // The footer ticker's only job is to call this on a 1Hz cadence
        // so the displayed Context Time and $/hr·$/min burn rates stay
        // current. No file I/O — this is per-session state, reset at
        // every session boundary.
        const sessionMs = _sessionStartTime !== null
            ? Math.max(0, Date.now() - _sessionStartTime)
            : 0;
        const elapsedMinutes = sessionMs / 60000;
        const costPerMinute = elapsedMinutes > 0 ? acc.cost / elapsedMinutes : 0;
        cachedSession = {
            sessionMs,
            sessionStr: fmtDurationLong(sessionMs),
            costPerHour: costPerMinute * 60,
            costPerMinute,
        };
    }

    // ------------------------------------------------------------------------
    // Timeframe stats (4th footer line) — aggregates from the SQLite
    // `turns` table for a configurable time window. Labels use the
    // same long form as the /aftc-footer-report-timeframe slash
    // command (Today, Last 3 Hours, Last 6 Hours, Last 24 Hours,
    // Last 2 Days, Last 3 Days, Last 7 Days, Last 28 Days) so the
    // footer matches what the user typed to set it. Cached and
    // refreshed on the 1Hz ticker, throttled to every 10s, OR
    // refreshed immediately on timeframe change. DB unavailable /
    // query failure → all zeros.
    // ------------------------------------------------------------------------
    type TimeframeKey = "today" | "3h" | "6h" | "24h" | "2d" | "3d" | "7d" | "28d";
    const TIMEFRAMES: Record<TimeframeKey, { label: string; cut: () => number }> = {
        today: { label: "Today",          cut: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); } },
        "3h":  { label: "Last 3 Hours",   cut: () => Date.now() - 3 * 3_600_000 },
        "6h":  { label: "Last 6 Hours",   cut: () => Date.now() - 6 * 3_600_000 },
        "24h": { label: "Last 24 Hours",  cut: () => Date.now() - 24 * 3_600_000 },
        "2d":  { label: "Last 2 Days",    cut: () => Date.now() - 2 * 86_400_000 },
        "3d":  { label: "Last 3 Days",    cut: () => Date.now() - 3 * 86_400_000 },
        "7d":  { label: "Last 7 Days",    cut: () => Date.now() - 7 * 86_400_000 },
        "28d": { label: "Last 28 Days",   cut: () => Date.now() - 28 * 86_400_000 },
    };
    let _timeframe: TimeframeKey = "3d";
    let cachedTimeframeStats: TimeframeStatsView = {
        timeframeLabel: "Last 3 Days",
        costUsd: 0,
        userPrompts: 0,
        totalTurns: 0,
        avgCacheHit: 0,
        avgThinkingMs: 0,
        avgResponseMs: 0,
    };
    let lastTimeframeStatsRefresh = 0;
    const TIMEFRAME_STATS_REFRESH_MS = 10_000;

    function refreshTimeframeStats(): void {
        const now = Date.now();
        if (now - lastTimeframeStatsRefresh < TIMEFRAME_STATS_REFRESH_MS) return;
        lastTimeframeStatsRefresh = now;

        const tf = TIMEFRAMES[_timeframe] ?? TIMEFRAMES.today;
        const since = tf.cut();
        const label = tf.label;

        const empty = {
            timeframeLabel: label,
            costUsd: 0,
            userPrompts: 0,
            totalTurns: 0,
            avgCacheHit: 0,
            avgThinkingMs: 0,
            avgResponseMs: 0,
        };

        const db = getDb();
        if (!db) {
            cachedTimeframeStats = empty;
            return;
        }

        try {
            const totals = db
                .prepare(
                    `SELECT
                        COALESCE(SUM(cost_usd), 0) AS total_cost,
                        COALESCE(SUM(user_prompt), 0) AS user_prompts,
                        COUNT(*) AS total_turns,
                        COALESCE(AVG(thinking_ms), 0) AS avg_thinking,
                        COALESCE(AVG(response_ms), 0) AS avg_response,
                        COALESCE(AVG(CAST(cache_read AS REAL) / NULLIF(cache_read + input_tokens, 0)), 0) AS avg_cache_hit
                    FROM turns
                    WHERE timestamp >= ?`,
                )
                .get(since) as
                    | {
                        total_cost: number;
                        user_prompts: number;
                        total_turns: number;
                        avg_thinking: number;
                        avg_response: number;
                        avg_cache_hit: number | null;
                    }
                    | undefined;

            cachedTimeframeStats = {
                timeframeLabel: label,
                costUsd: totals?.total_cost ?? 0,
                userPrompts: totals?.user_prompts ?? 0,
                totalTurns: totals?.total_turns ?? 0,
                avgCacheHit: totals?.avg_cache_hit ?? 0,
                avgThinkingMs: totals?.avg_thinking ?? 0,
                avgResponseMs: totals?.avg_response ?? 0,
            };
        } catch (err) {
            console.log(
                `[aftc-toolset] timeframe stats query error: ${(err as Error).message}`,
            );
            cachedTimeframeStats = empty;
        }
    }

    /**
     * Set the active timeframe. Updates both the in-memory _timeframe
     * cache AND state.json (via setPreference) so the user's choice
     * survives /new, /reload, and fresh pi startup.
     */
    function setTimeframe(key: string): boolean {
        if (!(key in TIMEFRAMES)) return false;
        if (_timeframe !== key) {
            _timeframe = key as TimeframeKey;
            lastTimeframeStatsRefresh = 0; // force refresh
            // Persist as a user preference (state.json) so the choice
            // survives across all session boundaries, not just resume.
            setPreference("footerTimeframe", key);
        }
        return true;
    }

    function avgMs(arr: number[]): number {
        return arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length;
    }

    const toolCache = new ToolCostCache();
    const shape = new ShapeTracker();
    let lastSysPrompt = "";
    const model: ModelInfo = { name: "", reasoning: false, contextWindow: 0, thinkingLevel: "" };

    // ---- Skill usage tracking (best-effort, per-session) ----
    // `availableSkills` is the Skill[] loaded into the system prompt
    // (captured each turn from before_agent_start.systemPromptOptions).
    // `usedSkills` accumulates the names of skills the agent/user has
    // actually pulled into context this session: a `/skill:name` user
    // command, or a `read` tool call whose target is a skill's
    // SKILL.md (or a file under its baseDir). Reset on session_start.
    let availableSkills: { name: string; filePath: string; baseDir: string }[] = [];
    const usedSkills = new Set<string>();

    function refreshToolCache(): void {
        // pi.getAllTools() returns EVERY configured tool, active or not.
        // The footer must reflect the *active* set (what is actually in
        // the system prompt), so intersect with pi.getActiveTools().
        // When nothing is filtered (active set empty / unavailable), fall
        // back to the full list so the count is never misleadingly zero.
        const active = new Set(pi.getActiveTools());
        const all = pi.getAllTools();
        const tools = active.size > 0 ? all.filter(t => active.has(t.name)) : all;
        toolCache.refresh(tools);
    }

    function recentAvg(): number {
        if (recentHits.length === 0) return NaN;
        return recentHits.reduce((s, x) => s + x, 0) / recentHits.length;
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    pi.on("session_start", async (_event, ctx) => {
        // USER PREFERENCES (state.json) are the ONLY persisted state.
        // They survive /new, /reload, fresh pi startup, and reboot.
        // Everything else (accumulators, timing, model info) is
        // per-session and lives only in this closure — reset on every
        // session_start. There is no per-session resumption state.

        // ---- 1. Load preferences ----
        const tf = getPreference("footerTimeframe", "today");
        if (tf && tf in TIMEFRAMES) {
            _timeframe = tf as TimeframeKey;
            lastTimeframeStatsRefresh = 0; // force fresh query on next read
        }

        // ---- 2. Reset per-session accumulators + timing ----
        resetAccumulators();
        resetTiming();

        // ---- 3. Refresh model info + tool cache ----
        lastSysPrompt = "";
        const m = (ctx as any).model;
        if (m) {
            model.name = m.name || m.id || "";
            model.reasoning = m.reasoning === true;
            model.contextWindow = m.contextWindow || 0;
        }
        // thinkingLevel is NOT on the Model object - it's separate agent
        // state. Seed it from pi.getThinkingLevel() so the level is known
        // from the first render, not only after the user changes it.
        // (rules.md §10)
        model.thinkingLevel = pi.getThinkingLevel();

        refreshToolCache();
    });

    pi.on("model_select", async (event, _ctx) => {
        const m = (event as any).model;
        if (m) {
            model.name = m.name || m.id || "";
            model.reasoning = m.reasoning === true;
            model.contextWindow = m.contextWindow || 0;
        }
        // Re-read on model change: a new model may clamp the level
        // (non-reasoning models always use "off"). See session_start note.
        model.thinkingLevel = pi.getThinkingLevel();
        // Do not reset context-window timing or accumulated cost on model
        // changes. A mixed-model context is still one user work window.
    });

    pi.on("thinking_level_select", async (event, _ctx) => {
        const lvl = (event as any).level;
        if (lvl) model.thinkingLevel = lvl;
    });

    pi.on("before_agent_start", async (event, _ctx) => {
        const sp = (event as any).systemPrompt || "";
        if (sp) lastSysPrompt = sp;
        // Tools can change between turns (setActiveTools, dynamic
        // registration). Refresh against the ACTIVE set only.
        refreshToolCache();
        // Skills are loaded into the system prompt as text blocks
        // (systemPromptOptions.skills), not as tools. Capture the real
        // Skill[] here so the footer's "Skills used/available"
        // reflects what is actually loaded, not a regex guess from tool
        // names. `availableSkills` is also used by the tool_result
        // handler below to detect when a skill body is read into context.
        const rawSkills = (event as any).systemPromptOptions?.skills ?? [];
        const skillsArr: { name: string; description: string; filePath: string; baseDir: string }[] =
            Array.isArray(rawSkills)
                ? rawSkills.map((s: any) => ({
                    name: s.name || "",
                    description: s.description || "",
                    filePath: s.filePath || "",
                    baseDir: s.baseDir || "",
                }))
                : [];
        toolCache.setSkills(skillsArr.map(s => ({ name: s.name, description: s.description })));
        availableSkills = skillsArr.filter(s => s.name);
    });

    pi.on("input", async (event, _ctx) => {
        // The docs expose input.streamingBehavior for mid-stream user
        // messages. These are still user prompts, but they are useful to
        // report separately as sub-prompts/steering/follow-up prompts.
        _pendingStreamingBehavior = event.streamingBehavior === "steer" || event.streamingBehavior === "followUp"
            ? event.streamingBehavior
            : undefined;
        // Detect `/skill:name` user commands (input fires BEFORE skill
        // expansion, so the raw text is visible here). Each is a skill
        // being explicitly pulled into context this session.
        const m = /(^|\s)\/skill:([^\s]+)/.exec((event as any).text || "");
        if (m && m[2]) {
            const name = m[2].toLowerCase();
            if (availableSkills.some(s => s.name.toLowerCase() === name)) {
                usedSkills.add(name);
            }
        }
        return { action: "continue" as const };
    });

    // Mark a skill "in use" when the agent successfully reads its
    // SKILL.md (or any file under its baseDir) via the `read` tool — that
    // loads the skill body into the active context. Uses tool_result
    // (not tool_call) so a failed read does not count. Cheap: only runs
    // for `read`, and the match is a small linear scan over
    // availableSkills.
    pi.on("tool_result", async (event, ctx) => {
        if ((event as any).toolName !== "read") return;
        if ((event as any).isError) return;
        const inputPath: string | undefined = (event as any).input?.path;
        if (!inputPath || availableSkills.length === 0) return;
        const resolved = path.resolve(ctx.cwd, inputPath);
        for (const s of availableSkills) {
            if (!s.name) continue;
            if (s.filePath && resolved === path.resolve(s.filePath)) {
                usedSkills.add(s.name.toLowerCase());
                return;
            }
            if (s.baseDir) {
                const base = path.resolve(s.baseDir);
                if (resolved === base || resolved.startsWith(base + path.sep)) {
                    usedSkills.add(s.name.toLowerCase());
                    return;
                }
            }
        }
    });

    pi.on("message_start", async (event, _ctx) => {
        const msg = (event as any).message;
        if (!msg) return;
        if (msg.role === "user") {
            // Every user message marks the start of a user-prompted
            // turn — the next assistant response is the direct reply.
            _pendingUserTurn = true;
            const isFirstPromptInGroup = _currentPromptIndex === 0;
            _currentPromptIndex++;
            _pendingPromptIndex = _currentPromptIndex;
            _pendingSteeringPrompt = _pendingStreamingBehavior === "steer";
            _pendingFollowupPrompt = _pendingStreamingBehavior === "followUp";
            _pendingBasePrompt = isFirstPromptInGroup && !_pendingSteeringPrompt && !_pendingFollowupPrompt;
            _pendingContinuationPrompt = !_pendingBasePrompt && !_pendingSteeringPrompt && !_pendingFollowupPrompt;
            _pendingSubPrompt = !_pendingBasePrompt;
            _pendingPromptKind = _pendingSteeringPrompt ? "steer"
                : _pendingFollowupPrompt ? "followup"
                : _pendingContinuationPrompt ? "continuation"
                : "base";
            if (!sessionStarted) {
                // First user message of this context window. _sessionStartTime
                // is null (resetTiming cleared it on session_start) - start
                // the context-window clock now. In-memory only; no file I/O.
                sessionStarted = true;
                if (_sessionStartTime === null) {
                    _sessionStartTime = Date.now();
                }
                // Prime the cache so the next render shows the new value
                // without waiting up to 1s for the ticker.
                recomputeCachedSession();
            }
        } else if (msg.role === "assistant") {
            // New assistant turn — start the per-turn clock.
            const now = Date.now();
            currentTurnStart = now;
            currentTurnFirstOutput = null;
        }
    });

    pi.on("message_update", async (event, _ctx) => {
        // First non-thinking output in this turn marks the end of "thinking".
        const inner = (event as any).assistantMessageEvent;
        if (!inner) return;
        if (currentTurnFirstOutput !== null) return;          // already captured
        if (currentTurnStart === null) return;                // no active turn
        if (inner.type === "text_start" || inner.type === "text_delta" || inner.type === "toolcall_start") {
            currentTurnFirstOutput = Date.now();
        }
    });

    pi.on("message_end", async (event, _ctx) => {
        const msg = (event as any).message;
        if (msg.role !== "assistant") return;

        // Per-turn timing — thinking (to first output) and response (total).
        // Done BEFORE the usage guard so aborted / empty / error turns still
        // contribute to the timing series (those turns also affect user-perceived
        // response time, and excluding them makes the avg misleadingly low).
        if (currentTurnStart !== null) {
            const rt = Math.max(0, Date.now() - currentTurnStart);
            lastResponseMs = rt;
            responseTimes.push(rt);
            if (responseTimes.length > RECENT_TURNS) responseTimes.shift();
            // If the model never produced visible output, attribute the whole
            // turn to "thinking" so the metric stays meaningful.
            const tt = currentTurnFirstOutput !== null
                ? Math.max(0, currentTurnFirstOutput - currentTurnStart)
                : rt;
            lastThinkingMs = tt;
            thinkingTimes.push(tt);
            if (thinkingTimes.length > RECENT_TURNS) thinkingTimes.shift();
            currentTurnStart = null;
            currentTurnFirstOutput = null;
        }

        // Accumulators (need usage data) — guarded separately so timing
        // updates above run even on empty / aborted / error turns.
        const usage = (msg as AssistantMessage).usage;
        if (!usage || usage.totalTokens === 0) return;

        // Accumulate session totals
        acc.cacheRead += usage.cacheRead;
        acc.cacheWrite += usage.cacheWrite;
        acc.input += usage.input;
        acc.output += usage.output;
        acc.cost += usage.cost.total;
        acc.turns++;
        const isUserPrompt = _pendingUserTurn;
        const isBasePrompt = isUserPrompt && _pendingBasePrompt;
        const isSubPrompt = isUserPrompt && _pendingSubPrompt;
        const isSteeringPrompt = isUserPrompt && _pendingSteeringPrompt;
        const isFollowupPrompt = isUserPrompt && _pendingFollowupPrompt;
        const isContinuationPrompt = isUserPrompt && _pendingContinuationPrompt;
        const promptKind = isUserPrompt ? _pendingPromptKind : "auto";
        const promptIndex = _pendingPromptIndex || _currentPromptIndex || 0;
        if (isUserPrompt) {
            acc.userTurns++;
            _pendingUserTurn = false;
            _pendingBasePrompt = false;
            _pendingSubPrompt = false;
            _pendingSteeringPrompt = false;
            _pendingFollowupPrompt = false;
            _pendingContinuationPrompt = false;
            _pendingPromptKind = "auto";
            _pendingStreamingBehavior = undefined;
        } else {
            // AI-initiated turn: the model decided to keep talking after
            // a tool returned (continuation). This is what makes the
            // footer "AI" counter go up; a single user prompt that
            // produces a final answer with no tool calls leaves it at 0.
            acc.aiTurns++;
        }

        // Snapshot last turn
        acc.lastTurnCacheRead = usage.cacheRead;
        acc.lastTurnCacheWrite = usage.cacheWrite;
        acc.lastTurnInput = usage.input;
        acc.lastTurnOutput = usage.output;
        acc.lastTurnCost = usage.cost.total;

        // Recent-hit trend window
        const r = hitRateNum(usage.cacheRead, usage.input);
        if (!Number.isNaN(r)) {
            recentHits.push(r);
            if (recentHits.length > RECENT_TURNS) recentHits.shift();
        }

        // Per-turn SQLite record. The thinking module is structurally
        // typed (TurnRecorder) and the call is a no-op if better-sqlite3
        // isn't installed or the DB can't be opened.
        turnRecorder.recordTurn({
            turn: acc.turns,
            timestamp: Date.now(),
            modelName: model.name || "",
            thinkingLevel: model.thinkingLevel || "",
            thinkingMs: lastThinkingMs,
            responseMs: lastResponseMs,
            costUsd: usage.cost.total,
            inputTokens: usage.input,
            outputTokens: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            isUserPrompt,
            sessionId: _sessionId,
            promptIndex,
            isBasePrompt,
            isSubPrompt,
            isSteeringPrompt,
            isFollowupPrompt,
            isContinuationPrompt,
            promptKind,
        });

        // Model fallback
        const m = (event as any).model;
        if (m) {
            model.name = model.name || m.name || m.id || "";
            model.reasoning = model.reasoning || m.reasoning === true;
            model.contextWindow = model.contextWindow || m.contextWindow || 0;
        }

        // Prefix shape churn detection (uses cached tool cost signature indirectly)
        const tools = pi.getAllTools();
        if (tools.length > 0) {
            const cmp = shape.update(lastSysPrompt, tools);
            if (cmp.changed) {
                console.log(`[aftc-toolset] prefix churn: ${cmp.reasons.join("+")}`);
                (_ctx as any)?.ui?.notify?.(`Cache prefix changed: ${cmp.reasons.join("+")}`, "warning");
            }
        }

        // Capture pi's own context-usage snapshot (same number shown in
        // the native status bar). The widget reads this via
        // data.getContextUsage() on the next render frame.
        const u = _ctx?.getContextUsage?.();
        if (u) contextUsage = { tokens: u.tokens, contextWindow: u.contextWindow, percent: u.percent };
    });

    pi.on("session_compact", async () => {
        shape.reset("compaction");
        console.log("[aftc-toolset] compaction — shape reset");
    });

    pi.on("agent_end", async (_event, ctx) => {
        if (acc.lastTurnInput === 0) return;
        // The cache-diagnostics footer widget already shows per-turn
        // token / cost / timing info, so we do NOT emit a UI toast here —
        // that would duplicate the line into the main output. Only emit a
        // stdout line in headless mode (no TUI), where the footer is absent.
        if (ctx?.hasUI) return;
        const cr = acc.lastTurnCacheRead;
        const fresh = Math.max(0, acc.lastTurnInput - cr);
        const total = acc.lastTurnInput + acc.lastTurnOutput;
        console.log(
            `[aftc-toolset] turn: ${fmt(total)} tok · in ${fmt(acc.lastTurnInput)} (${fmt(cr)} cached / ${fmt(fresh)} new) · out ${fmt(acc.lastTurnOutput)} · $${acc.cost.toFixed(4)} · think ${fmtDurationShort(lastThinkingMs)} · resp ${fmtDurationShort(lastResponseMs)}`
        );
    });

    // -----------------------------------------------------------------------
    // Commands
    // -----------------------------------------------------------------------

    pi.registerCommand("cache-profile", {
        description: "Per-tool token costs, prefix shape, churn analysis",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            refreshToolCache();
            const tools = pi.getAllTools();
            const activeCount = toolCache.getCount();
            const costs = [...toolCache.getCosts()];
            const total = toolCache.getTotal();
            const max = costs.length > 0 ? costs[0].tokens : 1;
            const lines: string[] = [];
            lines.push(`Tool schema costs (${activeCount} active / ${tools.length} configured, ~${fmt(total)} tok active total):`);
            lines.push("");
            for (const c of costs) {
                const bar = "█".repeat(Math.min(30, max > 0 ? Math.round((c.tokens / max) * 30) : 0));
                const pc = total > 0 ? ((c.tokens / total) * 100).toFixed(1) + "%" : "";
                lines.push(`  ${c.name.padEnd(22)} ~${String(c.tokens).padStart(4)} tok ${pc.padStart(6)} ${bar}`);
            }
            lines.push("");
            lines.push(`Skills loaded: ${toolCache.getSkillCount()} (~${fmt(toolCache.getSkillToks())} tok)`);
            lines.push("");
            lines.push("Cache prefix shape:");
            const sysPrompt = ctx.getSystemPrompt();
            const cur = shape.capture(sysPrompt, tools);
            lines.push(`  system hash:  ${cur.systemHash}  (${fmt(sysPrompt.length)} chars)`);
            lines.push(`  tools hash:   ${cur.toolsHash}  (~${cur.toolSchemaTokens} tok)`);
            lines.push(`  prefix hash:  ${cur.prefixHash}`);
            lines.push(`  est. prefix:  ~${fmt(sysPrompt.length / 4 + cur.toolSchemaTokens)} tok`);
            const diff = shape.diff(cur);
            if (diff.changed) {
                lines.push("");
                lines.push(`  CHANGED: prefix changed since last turn — ${diff.reasons.join("+")}`);
            }
            lines.push("");
            lines.push(`Turns: ${acc.turns} │ Cost: $${acc.cost.toFixed(6)}`);
            lines.push(`Aggregate hit: ${hitRate(acc.cacheRead, acc.input)}`);
            lines.push(`Last turn: ${fmt(acc.lastTurnInput)} in (${fmt(acc.lastTurnCacheRead)} cached / ${fmt(Math.max(0, acc.lastTurnInput - acc.lastTurnCacheRead))} new) / ${fmt(acc.lastTurnOutput)} out`);
            if (ctx.hasUI) await ctx.ui.select("Cache profile", lines, { timeout: 60000 });
        },
    });

    pi.registerCommand("cache-stats", {
        description: "Current-context cache diagnostics, cost rate, and cache-write ROI",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            const lines: string[] = [];
            const netSaved = acc.cacheRead - acc.cacheWrite;
            const writesPaidOff = acc.cacheWrite > 0 && netSaved > 0;
            const avgReadPerTurn = acc.turns > 0 ? acc.cacheRead / acc.turns : 0;
            // Turns of cache reads needed to amortize total cache writes.
            const paybackTurns = avgReadPerTurn > 0 ? acc.cacheWrite / avgReadPerTurn : 0;
            lines.push("Current context cache statistics");
            lines.push("═══════════════════════");
            lines.push(`  turns:              ${acc.turns}`);
            lines.push(`  total input:        ${fmt(acc.input)}`);
            lines.push(`  total output:       ${fmt(acc.output)}`);
            lines.push(`  total cache read:   ${fmt(acc.cacheRead)}`);
            lines.push(`  total cache write:  ${fmt(acc.cacheWrite)}`);
            lines.push(`  aggregate hit rate: ${hitRate(acc.cacheRead, acc.input)}`);
            lines.push(`  recent (${recentHits.length}/${RECENT_TURNS}) avg:    ${recentHits.length ? (recentAvg() * 100).toFixed(1) + "%" : "—"}`);
            lines.push("");
            lines.push(`  last turn input:    ${fmt(acc.lastTurnInput)}`);
            lines.push(`  last turn cached:   ${fmt(acc.lastTurnCacheRead)}`);
            lines.push(`  last turn hit rate: ${hitRate(acc.lastTurnCacheRead, acc.lastTurnInput)}`);
            lines.push("");
            lines.push("Cache write ROI");
            lines.push("───────────────");
            lines.push(`  net saved (read−write): ${fmt(netSaved)} tok ${writesPaidOff ? "✓ paid off" : "✗ not yet"}`);
            lines.push(`  payback: ${paybackTurns > 0 ? paybackTurns.toFixed(1) + " turns of cache reads" : "—"}`);
            lines.push("");
            lines.push(`  total cost:         $${acc.cost.toFixed(6)}`);
            lines.push("");

            // ---------- Current context cost rate ----------
            // Fast estimate only. Detailed historical/day/model reporting is
            // handled by /usage-report.
            recomputeCachedSession();
            const cs = cachedSession;
            lines.push("Current context cost rate");
            lines.push("─────────────────────────");
            lines.push(`  context time:       ${cs?.sessionStr ?? "0S"}`);
            lines.push(`  context cost:       $${acc.cost.toFixed(6)} (${acc.turns} turn${acc.turns === 1 ? "" : "s"})`);
            lines.push(`  burn rate:          $${(cs?.costPerHour ?? 0).toFixed(4)}/hr · $${(cs?.costPerMinute ?? 0).toFixed(4)}/min`);
            lines.push("  note:               quick footer estimate; use /usage-report for detailed usage.");

            const s = shape.getShape();
            if (s) {
                lines.push("");
                lines.push("Cache prefix shape");
                lines.push("──────────────────");
                lines.push(`  system hash:  ${s.systemHash}`);
                lines.push(`  tools hash:   ${s.toolsHash}`);
                lines.push(`  prefix hash:  ${s.prefixHash}`);
                lines.push(`  tool tokens:  ~${s.toolSchemaTokens}`);
            }
            const churn = shape.getChurn();
            if (churn) { lines.push(""); lines.push(`  last churn:   ${churn}`); }
            if (ctx.hasUI) await ctx.ui.select("Cache statistics", lines, { timeout: 60000 });
        },
    });

    pi.registerCommand("cache-reset", {
        description: "Reset current-context cache accumulators and footer timer (debugging)",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            resetAccumulators();
            resetTiming();
            ctx.ui.notify("Current-context cache accumulators and timer reset", "info");
        },
    });

    // Pick the time window the 4th footer line aggregates over.
    // Default is "Last 3 Days". The choice is persisted to state.json
    // (a USER PREFERENCE that survives /new, /reload, and fresh pi
    // startup). Registered under both /aftc-set-costs-timeframe
    // (preferred) and /aftc-footer-report-timeframe (legacy alias).
    async function handleCostsTimeframe(
        _a: string,
        ctx: ExtensionCommandContext,
    ): Promise<void> {
        const options = [
            "Today",
            "Last 3 Hours",
            "Last 6 Hours",
            "Last 24 Hours",
            "Last 2 Days",
            "Last 3 Days",
            "Last 7 Days",
            "Last 28 Days",
        ];
        const labelToKey: Record<string, string> = {
            "Today": "today",
            "Last 3 Hours": "3h",
            "Last 6 Hours": "6h",
            "Last 24 Hours": "24h",
            "Last 2 Days": "2d",
            "Last 3 Days": "3d",
            "Last 7 Days": "7d",
            "Last 28 Days": "28d",
        };
        const chosen = await ctx.ui.select(
            "Footer 4th-line timeframe",
            options,
            { timeout: 0 },
        );
        if (chosen === undefined) return;
        const key = labelToKey[chosen];
        if (!key || !setTimeframe(key)) {
            ctx.ui.notify?.("Invalid timeframe selection", "error");
            return;
        }
        // setTimeframe already calls setPreference internally, so
        // no separate save is needed here.
        const stats = getTimeframeStats();
        ctx.ui.notify?.(
            `Footer timeframe set to ${stats.timeframeLabel}` +
                ` (cost=$${stats.costUsd.toFixed(2)}, ${stats.totalTurns} turns)`,
            "info",
        );
    }

    pi.registerCommand("aftc-set-costs-timeframe", {
        description: "Set the time window the footer 4th line aggregates over (default: Last 3 Days)",
        handler: handleCostsTimeframe,
    });

    // Legacy alias — kept so muscle memory / old scripts keep working.
    pi.registerCommand("aftc-footer-report-timeframe", {
        description: "Alias for /aftc-set-costs-timeframe — same action, old name.",
        handler: handleCostsTimeframe,
    });

    // -- Miscellaneous commands -----------------------------------------------

    pi.registerCommand("cls", {
        description: "Clear the terminal screen",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            // ANSI: clear screen (2J) + move cursor to home (H). Works in
            // any TUI terminal that respects escape codes. Same effect as
            // the shell `cls` (Windows) / `clear` (Unix) commands.
            console.log("\x1b[2J\x1b[H");
            if (ctx.hasUI) ctx.ui.notify?.("Screen cleared", "info");
        },
    });

    console.log("[aftc-toolset] loaded — /cache-profile, /cache-stats, /cache-reset, /cls");

    // Return the data provider so the orchestrator (index.ts) can wire
    // it to footer-widget.ts. The widget reads from these getters on
    // every render; the underlying state is updated by the event
    // handlers above. View types live in types.ts (rules.md §1.5:
    // structural interfaces, no module imports).
    const accView: AccumulatorView = acc;
    const modelView: ModelView = model;
    const toolCacheView: ToolCacheView = toolCache;
    // Re-compute on every read so the displayed time is always fresh even
    // when the ticker is throttled (CPU load, system sleep, etc.). The
    // cost is just `Date.now() - _sessionStartTime` arithmetic — free.
    const getCachedSession = (): SessionView | null => {
        recomputeCachedSession();
        return cachedSession;
    };
    // Eagerly populate timeframe stats on the first call so the first
    // render has data, not a flashing 0s row.
    const getTimeframeStats = (): TimeframeStatsView => {
        refreshTimeframeStats();
        return cachedTimeframeStats;
    };

    // Combined ticker callback: refreshes the session clock/cost rates
    // every tick, and the timeframe-stats aggregate at most every 10s.
    // Context-usage snapshot is captured separately on message_end
    // (only event handlers have access to ctx.getContextUsage()).
    function onTickFull(): void {
        recomputeCachedSession();
        refreshTimeframeStats();
    }

    return {
        getAccumulator: () => accView,
        getRecentAvg: recentAvg,
        getModel: () => modelView,
        getToolCache: () => toolCacheView,
        getCachedSession,
        getTimeframeStats,
        getAllowance: () => allowance.getAllowance(),
        getUsedSkillCount: () => usedSkills.size,
        getLastThinkingMs: () => lastThinkingMs,
        getAvgThinkingMs: () => avgMs(thinkingTimes),
        getLastResponseMs: () => lastResponseMs,
        getAvgResponseMs: () => avgMs(responseTimes),
        onTick: onTickFull,
        getContextUsage: () => contextUsage,
    };
}
