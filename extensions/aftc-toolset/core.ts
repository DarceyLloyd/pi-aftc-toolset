/**
 * pi-aftc-toolset — cache-diagnostics data module.
 *
 * Owns the cache / timing / cost accumulators, the per-tool token cost
 * cache, the prefix-shape tracker, and the context-window clock.
 *
 * Rendering lives in footer-widget.ts; this file never imports it and
 * never calls `ctx.ui.setWidget`. The orchestrator (index.ts) wires
 * this module's returned `FooterDataProvider` to the widget so the
 * footer reads the latest data via cheap getters (never block in
 * render).
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
 * Layout (per AGENTS.md):
 *   - index.ts          — orchestrator
 *   - core.ts           — this file: data + events + commands
 *   - footer-widget.ts  — widget rendering + /aftc-footer toggle
 *   - input-clear.ts    — Alt+C shortcut to clear the input editor
 *
 * See `core-readme.md` for the full contract (events, commands,
 * public factory signature, closure state).
 */

import type { ExtensionAPI, ExtensionCommandContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";
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
import { showViewer } from "./ui/aftc-ui";
import {
    getPreference,
    setPreference,
} from "./config";

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
// Footer line-4 timeframes (module scope — exported for tests)
//
// Two families:
//   - ROLLING ("Last ..." options): the window slides with the clock —
//     cut = now - N hours. Every DB row with timestamp >= cut is in.
//   - DATE-BASED (1 Day, 2 Days, ..., Month, 3 Months, 6 Months,
//     1 Year): anchored to LOCAL calendar boundaries, NOT rolling —
//     "1 Day" = since today's midnight, "7 Days" = since the midnight
//     that opened the 7th calendar day counting today, "Month" = since
//     the 1st of the current month, "1 Year" = since January 1st.
// ---------------------------------------------------------------------------

export interface FooterTimeframeDef {
    key: string;
    /** Menu text, eg "Last 3 hours" / "3 Days" / "Month". */
    label: string;
    /** Rolling-window hint shown next to "Last" options; "" for
     *  date-based options. */
    description: string;
    /** Footer line-4 prefix, eg "3 Hour" / "Today" / "This Month". */
    short: string;
    rolling: boolean;
    /** Window start (ms epoch) for the DB query, given the current time. */
    cut: (now: number) => number;
}

/** Local-time midnight of the day containing `ts`. */
export function startOfDay(ts: number): number {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local-time midnight `days` calendar days before the day containing
 *  `now` (0 = today's midnight). JS Date normalises day overflow across
 *  month and year boundaries automatically. */
export function startOfDayNDaysAgo(now: number, days: number): number {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days).getTime();
}

/** Local-time midnight on the 1st of the month `months` months before
 *  the month containing `now` (0 = the current month). JS Date
 *  normalises negative months across year boundaries automatically. */
export function startOfMonthNMonthsAgo(now: number, months: number): number {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() - months, 1).getTime();
}

/** Local-time January 1st of the year containing `ts`. */
export function startOfYear(ts: number): number {
    const d = new Date(ts);
    return new Date(d.getFullYear(), 0, 1).getTime();
}

const rollingHours = (h: number) => (now: number) => now - h * 3_600_000;

export const FOOTER_TIMEFRAMES: FooterTimeframeDef[] = [
    // Rolling windows — "Last" options slide with the current time.
    { key: "1h",  label: "Last 1 hour",   description: "1 hour rolling window",  short: "1 Hour",  rolling: true, cut: rollingHours(1) },
    { key: "2h",  label: "Last 2 hours",  description: "2 hour rolling window",  short: "2 Hour",  rolling: true, cut: rollingHours(2) },
    { key: "3h",  label: "Last 3 hours",  description: "3 hour rolling window",  short: "3 Hour",  rolling: true, cut: rollingHours(3) },
    { key: "4h",  label: "Last 4 hours",  description: "4 hour rolling window",  short: "4 Hour",  rolling: true, cut: rollingHours(4) },
    { key: "5h",  label: "Last 5 hours",  description: "5 hour rolling window",  short: "5 Hour",  rolling: true, cut: rollingHours(5) },
    { key: "6h",  label: "Last 6 hours",  description: "6 hour rolling window",  short: "6 Hour",  rolling: true, cut: rollingHours(6) },
    { key: "12h", label: "Last 12 hours", description: "1/2 day rolling window", short: "12 Hour", rolling: true, cut: rollingHours(12) },
    { key: "24h", label: "Last 24 hours", description: "1 day rolling window",   short: "24 Hour", rolling: true, cut: rollingHours(24) },
    { key: "48h", label: "Last 48 hours", description: "2 day rolling window",   short: "48 Hour", rolling: true, cut: rollingHours(48) },
    { key: "72h", label: "Last 72 hours", description: "3 day rolling window",   short: "72 Hour", rolling: true, cut: rollingHours(72) },
    // Date-based windows — anchored to local calendar boundaries.
    { key: "1d",    label: "1 Day",    description: "", short: "Today",      rolling: false, cut: (now) => startOfDayNDaysAgo(now, 0) },
    { key: "2d",    label: "2 Days",   description: "", short: "2 Day",      rolling: false, cut: (now) => startOfDayNDaysAgo(now, 1) },
    { key: "3d",    label: "3 Days",   description: "", short: "3 Day",      rolling: false, cut: (now) => startOfDayNDaysAgo(now, 2) },
    { key: "5d",    label: "5 Days",   description: "", short: "5 Day",      rolling: false, cut: (now) => startOfDayNDaysAgo(now, 4) },
    { key: "7d",    label: "7 Days",   description: "", short: "7 Day",      rolling: false, cut: (now) => startOfDayNDaysAgo(now, 6) },
    { key: "month", label: "Month",    description: "", short: "This Month", rolling: false, cut: (now) => startOfMonthNMonthsAgo(now, 0) },
    { key: "3m",    label: "3 Months", description: "", short: "3 Month",    rolling: false, cut: (now) => startOfMonthNMonthsAgo(now, 2) },
    { key: "6m",    label: "6 Months", description: "", short: "6 Month",    rolling: false, cut: (now) => startOfMonthNMonthsAgo(now, 5) },
    { key: "1y",    label: "1 Year",   description: "", short: "This Year",  rolling: false, cut: (now) => startOfYear(now) },
];

export const DEFAULT_FOOTER_TIMEFRAME = "3d";

/** Map pre-rework footerTimeframe preference values onto the new keys. */
const LEGACY_FOOTER_TIMEFRAME_MAP: Record<string, string> = {
    today: "1d",
    "3h": "3h",
    "6h": "6h",
    "24h": "24h",
    "2d": "2d",
    "3d": "3d",
    "7d": "7d",
    "28d": "month",
};

/** Resolve a stored footerTimeframe preference to a valid key: accept
 *  current keys, translate legacy keys, fall back to the default. */
export function resolveFooterTimeframeKey(value: unknown): string {
    if (typeof value === "string") {
        if (FOOTER_TIMEFRAMES.some((t) => t.key === value)) return value;
        const mapped = LEGACY_FOOTER_TIMEFRAME_MAP[value];
        if (mapped) return mapped;
    }
    return DEFAULT_FOOTER_TIMEFRAME;
}

/** Look up a timeframe definition by key (falls back to the default). */
export function getFooterTimeframeDef(key: string): FooterTimeframeDef {
    return (
        FOOTER_TIMEFRAMES.find((t) => t.key === key) ??
        FOOTER_TIMEFRAMES.find((t) => t.key === DEFAULT_FOOTER_TIMEFRAME)!
    );
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

/** Classify a provider error message into a shameable category for the
 *  usage report's Errors tab. User aborts never reach this (stopReason
 *  "aborted" is a separate stat, not an error). Order matters: 5xx beats
 *  timeout/network (a 503 gateway timeout is a server problem, not a
 *  client one). Unknown messages fall back to "other". */
function classifyError(message: string): string {
    const m = message || "";
    if (/(^|\D)429(\D|$)/.test(m) || /rate\s*limit/i.test(m)) return "rate-limit";
    if (/(^|\D)5\d\d(\D|$)/.test(m) || /overload|service unavailable|temporarily/i.test(m)) return "overloaded";
    if (/(^|\D)404(\D|$)/.test(m) || /not\s*found/i.test(m)) return "not-found";
    if (/(^|\D)(401|403)(\D|$)/.test(m) || /unauthori[sz]ed|forbidden|invalid\s*api\s*key|authentication/i.test(m)) return "auth";
    if (/(^|\D)408(\D|$)/.test(m) || /timeout|timed?\s*out|deadline/i.test(m)) return "timeout";
    if (/fetch\s*failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|EPIPE|socket|connection|disconnect|offline|tunnel/i.test(m)) return "network";
    return "other";
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
    // User prompt text length (chars) captured at message_start, recorded on
    // the next assistant turn's recordTurn.
    let _pendingPromptChars = 0;
    let _pendingBasePrompt = false;
    let _pendingSubPrompt = false;
    let _pendingSteeringPrompt = false;
    let _pendingFollowupPrompt = false;
    let _pendingContinuationPrompt = false;
    let _pendingPromptKind = "auto";
    let _pendingStreamingBehavior: "steer" | "followUp" | undefined = undefined;
    let _currentPromptIndex = 0;
    // The prompt index being processed right now (set on the input
    // event, read by the next assistant message_end). Renamed from
    // _pendingPromptIndex for clarity — "active" is what the next
    // assistant turn is associated with; "_currentPromptIndex" is
    // the monotonically increasing counter.
    let _activePromptIndex = 0;

    // Timing state — context-window clock + per-turn thinking/response times.
    let sessionStarted = false;                       // true after first user prompt of a context window
    let _sessionStartTime: number | null = null;      // wall-clock at first user prompt (in-memory only)
    let currentTurnStart: number | null = null;        // assistant message_start time
    let currentTurnFirstOutput: number | null = null;  // first text/tool-call in current turn
    let lastThinkingMs = 0;
    let lastResponseMs = 0;
    const thinkingTimes: number[] = [];
    const responseTimes: number[] = [];
    // Task timer — wall-clock from the user pressing enter (first agent_start)
    // to the agent returning control (agent_settled: complete/error/abort).
    // Spans every turn of one user prompt's run; runs THROUGH questions
    // (ask_user_question doesn't settle the agent) and retries/compaction.
    let taskStartMs = 0;            // 0 = idle; else wall-clock at first agent_start
    let taskTurnCount = 0;          // assistant turns seen during the current task
    let lastTaskMs = 0;             // last completed task duration
    let lastTaskStopReason = "";    // "" | "complete" | "error" | "aborted"
    let lastAssistantStopReason: string | undefined;  // last assistant message stopReason

    // Task context + allowance snapshots (v1.21.x). Captured at task start
    // (message_start / agent_start) and task end (message_end / agent_settled)
    // so the usage report can show context-window pressure and how much of a
    // 5h / weekly allowance each completed task consumed.
    let taskContextStartTokens = 0;   // pi context estimate at task start
    let taskContextEndTokens = 0;     // pi context estimate after the final turn
    let taskContextWindow = 0;        // model context window at task time
    let taskAllowCaptured = false;    // allowance-start snapshotted once per task
    let taskAllowStart: { provider: string; five: number | null; weekly: number | null } | null = null;

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
        _pendingPromptChars = 0;
        _pendingStreamingBehavior = undefined;
        _currentPromptIndex = 0;
        _activePromptIndex = 0;
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
        taskStartMs = 0;
        taskTurnCount = 0;
        lastTaskMs = 0;
        lastTaskStopReason = "";
        lastAssistantStopReason = undefined;
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
    // `turns` + `tasks` tables for the active time window. Window
    // definitions live at module scope (FOOTER_TIMEFRAMES); the choice
    // is a user preference set via the /aftc-footer menu. Cached and
    // refreshed on the 1Hz ticker, throttled to every 10s, OR refreshed
    // immediately on timeframe change. DB unavailable / query failure
    // → all zeros.
    // ------------------------------------------------------------------------
    let _timeframe: string = DEFAULT_FOOTER_TIMEFRAME;
    let cachedTimeframeStats: TimeframeStatsView = {
        timeframeLabel: "3 Days",
        timeframeShort: "3 Day",
        costUsd: 0,
        userPrompts: 0,
        totalTurns: 0,
        avgCacheHit: 0,
        avgTaskMs: 0,
    };
    let lastTimeframeStatsRefresh = 0;
    const TIMEFRAME_STATS_REFRESH_MS = 10_000;

    function refreshTimeframeStats(): void {
        const now = Date.now();
        if (now - lastTimeframeStatsRefresh < TIMEFRAME_STATS_REFRESH_MS) return;
        lastTimeframeStatsRefresh = now;

        const tf = getFooterTimeframeDef(_timeframe);
        const since = tf.cut(now);
        const label = tf.label;

        const empty = {
            timeframeLabel: label,
            timeframeShort: tf.short,
            costUsd: 0,
            userPrompts: 0,
            totalTurns: 0,
            avgCacheHit: 0,
            avgTaskMs: 0,
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
                        COALESCE(AVG(CAST(cache_read AS REAL) / NULLIF(cache_read + input_tokens, 0)), 0) AS avg_cache_hit
                    FROM turns
                    WHERE timestamp >= ?`,
                )
                .get(since) as
                    | {
                        total_cost: number;
                        user_prompts: number;
                        total_turns: number;
                        avg_cache_hit: number | null;
                    }
                    | undefined;

            // Avg task time follows the usage-report rule (docs/usage-report-rules.md):
            // failed tasks (error/abort) are recorded but NEVER averaged into
            // Task Time — stop_reason = 'complete' rows only.
            const taskTotals = db
                .prepare(
                    `SELECT COALESCE(AVG(task_ms), 0) AS avg_task_ms
                    FROM tasks
                    WHERE timestamp >= ? AND stop_reason = 'complete'`,
                )
                .get(since) as { avg_task_ms: number } | undefined;

            cachedTimeframeStats = {
                timeframeLabel: label,
                timeframeShort: tf.short,
                costUsd: totals?.total_cost ?? 0,
                userPrompts: totals?.user_prompts ?? 0,
                totalTurns: totals?.total_turns ?? 0,
                avgCacheHit: totals?.avg_cache_hit ?? 0,
                avgTaskMs: taskTotals?.avg_task_ms ?? 0,
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
     * cache AND config.json (via setPreference) so the user's choice
     * survives /new, /reload, and fresh pi startup.
     */
    function setTimeframe(key: string): boolean {
        if (!FOOTER_TIMEFRAMES.some((t) => t.key === key)) return false;
        if (_timeframe !== key) {
            _timeframe = key;
            lastTimeframeStatsRefresh = 0; // force refresh
            // Persist as a user preference so the choice survives
            // across all session boundaries, not just resume.
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
    // Provider id of the active model (deepseek, qwencloud, kimi-coding, ...)
    // — captured from model events, refreshed per turn from the assistant
    // message. Lets the report distinguish same-named models across providers.
    let modelProvider = "";

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
        const tfRaw = getPreference("footerTimeframe", DEFAULT_FOOTER_TIMEFRAME);
        const tfResolved = resolveFooterTimeframeKey(tfRaw);
        if (tfResolved !== tfRaw) {
            // One-time migration: rewrite a legacy key (today/28d/...)
            // on disk so later loads see the current key.
            setPreference("footerTimeframe", tfResolved);
        }
        _timeframe = tfResolved;
        lastTimeframeStatsRefresh = 0; // force fresh query on next read

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
        modelProvider = String((m as any).provider || modelProvider || "");
        // thinkingLevel is NOT on the Model object - it's separate agent
        // state. Seed it from pi.getThinkingLevel() so the level is known
        // from the first render, not only after the user changes it.
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
        modelProvider = String((m as any).provider || modelProvider || "");
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

    // Task timer START is in the message_start(user) handler below: it starts on
    // a new user prompt (base/continuation/follow-up) but NOT on a steering prompt.
    // Retries, compaction and steering don't settle the agent (pi's run loop drains
    // them before the single agent_settled), so the timer spans them automatically.

    // Allowance start snapshot: captured at the task's first agent_start
    // (once per task; steers / retries / compaction runs fire agent_start
    // too, but taskAllowCaptured guards against overwriting the true start).
    // The allowance view is provider-level and only exists when the active
    // provider reports a 5h / weekly window (Codex, Claude, MiniMax, ZAI,
    // Kimi) — otherwise it stays null and the report shows N/A.
    pi.on("agent_start", async () => {
        if (taskStartMs === 0 || taskAllowCaptured) return;
        taskAllowCaptured = true;
        const v = allowance?.getAllowance?.();
        taskAllowStart = v
            ? { provider: v.providerLabel || "", five: v.fiveHour?.usedPercent ?? null, weekly: v.weekly?.usedPercent ?? null }
            : null;
    });

    // Task timer: stop + record on agent_settled — the ONLY "truly returned to
    // user" hook. Covers complete / error / abort (via the last assistant
    // stopReason). Questions do NOT settle the agent (ask_user_question blocks
    // waiting for the answer), so the timer naturally runs through them.
    pi.on("agent_settled", async () => {
        if (taskStartMs === 0) return;
        const taskMs = Math.max(0, Date.now() - taskStartMs);
        // Allowance end snapshot for this task (fresh read at settle).
        const v = allowance?.getAllowance?.();
        const allowEnd = v
            ? { provider: v.providerLabel || "", five: v.fiveHour?.usedPercent ?? null, weekly: v.weekly?.usedPercent ?? null }
            : null;
        const raw = lastAssistantStopReason;
        // Only finish the task when the last assistant turn ended with a
        // known final stopReason. per AGENTS.md: pi stopReason values are
        // "stop" (done), "error" (provider failure), "aborted" (user
        // cancelled), "toolUse" (calling tools — a MID-flow state). If the
        // agent "settled" but the last assistant turn was "toolUse" that
        // means a non-standard settle path (e.g. a tool that completes the
        // task without a final assistant turn) — we record the duration
        // but DO NOT report it as "complete" (the report's Timings tab only
        // averages stop_reason='complete' rows, so mis-tagging would pollute
        // the Task Time metric).
        const stopReason = raw === "error" ? "error"
            : raw === "aborted" ? "aborted"
            : raw === "stop" ? "complete"
            : raw === "toolUse" ? "toolUse"
            : "complete"; // unknown / unset — record so the user still sees a duration
        // Show the last task's duration in the footer whatever its outcome, so a
        // failed task still displays how long the user waited before the error/abort.
        lastTaskMs = taskMs;
        lastTaskStopReason = stopReason;
        // Record EVERY settled task — completed tasks feed the Task Time
        // averages; error/abort rows are kept (duration = time-to-failure) so
        // the usage report's Timings tab can count failures. The report only
        // averages stop_reason='complete' rows, so failed durations never
        // pollute the Task Time metric.
        turnRecorder.recordTask({
            sessionId: _sessionId,
            promptIndex: _currentPromptIndex || 0,
            timestamp: taskStartMs,
            taskMs,
            stopReason,
            modelName: model.name || "",
            thinkingLevel: model.thinkingLevel || "",
            turnCount: taskTurnCount,
            contextWindow: taskContextWindow || model.contextWindow || 0,
            contextStartTokens: taskContextStartTokens,
            contextEndTokens: taskContextEndTokens,
            allowProvider: taskAllowStart?.provider || allowEnd?.provider || "",
            allow5hStart: taskAllowStart?.five ?? null,
            allow5hEnd: allowEnd?.five ?? null,
            allowWeeklyStart: taskAllowStart?.weekly ?? null,
            allowWeeklyEnd: allowEnd?.weekly ?? null,
            // True when the provider actually reported an allowance window at
            // task start or end (footer line-5 semantics — subscription
            // plans only; API providers record false).
            allowanceReported: !!(taskAllowStart || allowEnd),
            provider: modelProvider || "",
        });
        taskStartMs = 0;
        taskTurnCount = 0;
        taskContextStartTokens = 0;
        taskContextEndTokens = 0;
        taskContextWindow = 0;
        taskAllowCaptured = false;
        taskAllowStart = null;
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
            _pendingPromptChars = Array.isArray(msg.content)
                ? msg.content.filter((p: any) => p && p.type === "text" && p.text).reduce((s: number, p: any) => s + String(p.text).length, 0)
                : 0;
            const isFirstPromptInGroup = _currentPromptIndex === 0;
            _currentPromptIndex++;
            _activePromptIndex = _currentPromptIndex;
            _pendingSteeringPrompt = _pendingStreamingBehavior === "steer";
            _pendingFollowupPrompt = _pendingStreamingBehavior === "followUp";
            _pendingBasePrompt = isFirstPromptInGroup && !_pendingSteeringPrompt && !_pendingFollowupPrompt;
            _pendingContinuationPrompt = !_pendingBasePrompt && !_pendingSteeringPrompt && !_pendingFollowupPrompt;
            _pendingSubPrompt = !_pendingBasePrompt;
            _pendingPromptKind = _pendingSteeringPrompt ? "steer"
                : _pendingFollowupPrompt ? "followup"
                : _pendingContinuationPrompt ? "continuation"
                : "base";
            // Task timer: start on a new user prompt (the user pressing enter).
            // Self-healing — if a timer is already running (a previous task that didn't
            // settle), reset + restart it. Skip steering prompts: those are sent mid-task
            // and must not discard the ongoing task's elapsed time (steering doesn't
            // settle the agent, so the timer keeps running through it).
            if (_pendingStreamingBehavior !== "steer") {
                taskStartMs = Date.now();
                taskTurnCount = 0;
                lastAssistantStopReason = undefined;
                // Context + allowance start of the new task.
                taskAllowCaptured = false;
                taskAllowStart = null;
                const cu = (_ctx as any)?.getContextUsage?.();
                taskContextStartTokens = cu?.tokens || 0;
                taskContextEndTokens = 0;
                taskContextWindow = cu?.contextWindow || 0;
            }
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
        // Task timer: track the last assistant stopReason (for the agent_settled
        // complete/error/abort classification) and count this turn into the task.
        lastAssistantStopReason = (msg as any).stopReason;
        if (taskStartMs !== 0) taskTurnCount++;

        // Capture pi's context-usage snapshot for the footer AND the task's
        // context-end estimate. Done BEFORE the usage guard so aborted /
        // empty / error turns still contribute.
        const cu = (_ctx as any)?.getContextUsage?.();
        if (cu) contextUsage = { tokens: cu.tokens, contextWindow: cu.contextWindow, percent: cu.percent };
        if (taskStartMs !== 0) {
            taskContextEndTokens = cu?.tokens || 0;
            taskContextWindow = taskContextWindow || cu?.contextWindow || 0;
        }
        // Model fallback (before the guard — error turns skip the guarded
        // section and must still learn the model + its context window).
        const m = (event as any).model;
        if (m) {
            model.name = model.name || m.name || m.id || "";
            model.reasoning = model.reasoning || m.reasoning === true;
            model.contextWindow = model.contextWindow || m.contextWindow || 0;
        }
        // Provider + per-turn size metrics (v1.21.x). provider comes from the
        // assistant message (pi exposes it per turn); tool calls and response
        // length come from the message content parts.
        const prov = String((msg as any).provider || modelProvider || "");
        if (prov) modelProvider = prov;
        const parts: any[] = Array.isArray(msg.content) ? msg.content : [];
        const toolCalls = parts.filter(p => p && p.type === "toolCall").length;
        const responseChars = parts.filter(p => p && p.type === "text" && p.text).reduce((s, p) => s + String(p.text).length, 0);

        // Failed LLM call — record it (a user abort is NOT an error; it is
        // counted as a stat from the tasks table). Classified into
        // shameable categories for the report's Errors tab.
        if ((msg as any).stopReason === "error") {
            const errMsg = String((msg as any).errorMessage || "");
            // Defensive ?. — older mocks / minimal recorders may not implement
            // recordError yet; the conforming TurnRecorder does.
            turnRecorder.recordError?.({
                sessionId: _sessionId,
                promptIndex: _activePromptIndex || _currentPromptIndex || 0,
                timestamp: Date.now(),
                modelName: model.name || "",
                thinkingLevel: model.thinkingLevel || "",
                errorType: classifyError(errMsg),
                errorMessage: errMsg,
            });
        }

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
        const promptIndex = _activePromptIndex || _currentPromptIndex || 0;
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
            provider: prov,
            toolCalls,
            responseChars,
            promptChars: _pendingPromptChars,
            thinkingMs: lastThinkingMs,
            responseMs: lastResponseMs,
            costUsd: usage.cost.total,
            inputTokens: usage.input,
            outputTokens: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            contextTokens: contextUsage?.tokens || 0,
            contextWindow: contextUsage?.contextWindow || model.contextWindow || 0,
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

        // Prefix shape churn detection (uses cached tool cost signature indirectly)
        const tools = pi.getAllTools();
        if (tools.length > 0) {
            const cmp = shape.update(lastSysPrompt, tools);
            if (cmp.changed) {
                aftcConsole.log(`prefix churn: ${cmp.reasons.join("+")}`);
                aftcConsole.warn(_ctx, `Cache prefix changed: ${cmp.reasons.join("+")}`);
            }
        }
    });

    pi.on("session_compact", async () => {
        shape.reset("compaction");
        aftcConsole.log("compaction — shape reset");
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
    });

    // -----------------------------------------------------------------------
    // Commands
    // -----------------------------------------------------------------------

    registerHelpEntry({
        command: "cache-profile",
        description: "Per-tool token costs + prefix churn analysis",
        category: "Footer / cache / timing",
    });

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
            if (ctx.hasUI) await showViewer(ctx, { title: "Cache profile", lines });
        },
    });

    registerHelpEntry({
        command: "cache-stats",
        description: "Session cache stats + spend",
        category: "Footer / cache / timing",
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
            if (ctx.hasUI) await showViewer(ctx, { title: "Cache statistics", lines });
        },
    });

    registerHelpEntry({
        command: "cache-reset",
        description: "Zero accumulators (debugging)",
        category: "Footer / cache / timing",
    });

    pi.registerCommand("cache-reset", {
        description: "Reset current-context cache accumulators and footer timer (debugging)",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            resetAccumulators();
            resetTiming();
            aftcConsole.emphasis(ctx, "Current-context cache accumulators and timer reset");
        },
    });

    // -- Miscellaneous commands -----------------------------------------------

    registerHelpEntry({
        command: "cls",
        description: "Clear the terminal screen",
        category: "General",
    });

    pi.registerCommand("cls", {
        description: "Clear the terminal screen",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            // ANSI: clear screen (2J) + move cursor to home (H). Works in
            // any TUI terminal that respects escape codes. Same effect as
            // the shell `cls` (Windows) / `clear` (Unix) commands.
            console.log("\x1b[2J\x1b[H");
            // if (ctx.hasUI) aftcConsole.emphasis(ctx, "Screen cleared");
        },
    });

    aftcConsole.log("loaded — /cache-profile, /cache-stats, /cache-reset, /cls");

    // Return the data provider so the orchestrator (index.ts) can wire
    // it to footer-widget.ts. The widget reads from these getters on
    // every render; the underlying state is updated by the event
    // handlers above. View types live in types.ts (AGENTS.md:
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
        getTimeframeOptions: () =>
            FOOTER_TIMEFRAMES.map((t) => ({ key: t.key, label: t.label, description: t.description, rolling: t.rolling })),
        getTimeframeKey: () => _timeframe,
        setTimeframe,
        getAllowance: () => allowance.getAllowance(),
        getUsedSkillCount: () => usedSkills.size,
        getLastThinkingMs: () => lastThinkingMs,
        getAvgThinkingMs: () => avgMs(thinkingTimes),
        getLastResponseMs: () => lastResponseMs,
        getAvgResponseMs: () => avgMs(responseTimes),
        onTick: onTickFull,
        getContextUsage: () => contextUsage,
        getTaskTime: () => ({
            running: taskStartMs !== 0,
            elapsedMs: taskStartMs !== 0 ? Math.max(0, Date.now() - taskStartMs) : lastTaskMs,
            lastMs: lastTaskMs,
            lastStopReason: lastTaskStopReason,
        }),
    };
}
