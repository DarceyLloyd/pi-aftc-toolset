/**
 * pi-aftc-toolset — core cache-diagnostics feature.
 *
 * Per rules.md §2.4, this extension uses the multi-file layout:
 *   - index.ts        — orchestrator
 *   - core.ts         — this file: cache diagnostics (footer + commands)
 *   - input-clear.ts  — Alt+C shortcut to clear the input editor
 *
 * Cache diagnostics footer for pi. Displays model, thinking level, dual
 * cache hit rates, absolute cache split, context window, tool costs,
 * prefix shape status, git branch, current context-window time + cost rate,
 * and thinking/response time per turn on a dark-background bar.
 *
 * Hit-rate formula (matches OpenAI usage shape):
 *   hit% = cacheRead / (cacheRead + input)
 * where pi's `input` is *new* prompt tokens only and `cacheRead` is the
 * cached prefix. The true total prompt is their sum. Do not divide by
 * `input` alone.
 *
 * Thinking time = request-sent → first text or tool-call output
 *                 (time to first visible output).
 * Response time = request-sent → message end (total turn duration).
 * These are tracked per turn and averaged over the recent window.
 *
 * Performance: all expensive work (tool cost computation, prefix-shape
 * hashing, git branch) is cached and refreshed from events — never inside
 * `render()`, which runs every TUI frame. A 1s ticker in the footer calls
 * `tui.requestRender()` so the context-window clock and cost rates stay
 * current. See rules.md Section 8.2.
 *
 * Context-window timer has two modes (set via /cost-timer-* commands):
 *   - "always-running"  (default): wall-clock from first user prompt in
 *     this context window.
 *   - "stop-when-idle": clock advances only while the model is actively
 *     processing a turn (between assistant message_start and message_end).
 *     During idle time (between turns, while the user reads/types) the
 *     clock is frozen. Cost rates then reflect cost per minute of model
 *     activity rather than wall-clock minutes.
 *
 * Model/thinking come from session_start + model_select events (ctx.model
 * can be undefined on early renders, so we capture from event contexts).
 *
 * Model and thinking-level changes update footer labels only; they do not
 * reset the context-window timer or accumulated cost.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { TurnRecorder } from "./types";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { getDataDir, getDataFile } from "./paths";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheAccumulator {
    cacheRead: number;
    cacheWrite: number;
    input: number;       // total new prompt tokens across the session
    output: number;      // total output tokens across the session
    cost: number;
    turns: number;       // total assistant turns (includes automated tool-call continuations)
    userTurns: number;   // user-prompted turns only (first assistant turn after each user message)
    lastTurnCacheRead: number;
    lastTurnCacheWrite: number;
    lastTurnInput: number;   // last turn only — total prompt tokens (new + cached)
    lastTurnOutput: number;  // last turn only
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
// divided by the current context-window timer. The durable usage DB and
// report still track all historical/today usage separately.
interface CachedSession {
    sessionMs: number;
    sessionStr: string;
    costPerHour: number;
    costPerMinute: number;
}

// ---------------------------------------------------------------------------
// Persistent data file (session state, future stats, etc.)
// ---------------------------------------------------------------------------
//
// Stored at <package-root>/.pi-aftc-toolset/data/data.json. This is
// extension-owned data, not project-local data: pi may be opened from any
// cwd, but usage/timer data must remain global to the installed package.
//
// The data file is sampled at 1Hz by the footer ticker (not on every
// render) so cost rates don't drift faster when the user types and the
// TUI re-renders frequently.

const DATA_DIR = getDataDir();
const DATA_FILE = getDataFile();

interface DataFile {
    version: number;
    session: {
        /** ms since epoch, or null if no session has started yet. */
        startTime: number | null;
    };
    // Future top-level fields can be added here without breaking the
    // version-1 readers below (they default-merge unknown fields).
}

const DEFAULT_DATA: DataFile = {
    version: 1,
    session: { startTime: null },
};

function readDataFile(): DataFile {
    try {
        if (!fs.existsSync(DATA_FILE)) return { ...DEFAULT_DATA };
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw) as Partial<DataFile>;
        if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_DATA };
        if (typeof parsed.version !== "number") return { ...DEFAULT_DATA };
        const session = (parsed as DataFile).session;
        const start = session?.startTime;
        if (start !== null && typeof start !== "number") {
            return { version: parsed.version, session: { startTime: null } };
        }
        return { version: parsed.version, session: { startTime: start ?? null } };
    } catch (err) {
        console.log(`[aftc-toolset] data.json read error: ${(err as Error).message} — using defaults`);
        return { ...DEFAULT_DATA };
    }
}

function writeDataFile(data: DataFile): void {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
        console.log(`[aftc-toolset] data.json write error: ${(err as Error).message}`);
    }
}

function startNewSession(): void {
    const data = readDataFile();
    writeDataFile({ ...data, session: { startTime: Date.now() } });
}

function clearSessionStart(): void {
    const data = readDataFile();
    writeDataFile({ ...data, session: { startTime: null } });
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

// Long-form duration for the context-window clock. Adaptive: omits the
// leading zero unit(s) so "0H 8M 3S" renders as "8M 3S", and "0H 0M 5S" as "5S".
function fmtDurationLong(ms: number): string {
    if (ms <= 0) return "0S";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}H ${m}M ${sec}S`;
    if (m > 0) return `${m}M ${sec}S`;
    return `${sec}S`;
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

// Trend arrow: recent avg vs session avg.
function trendArrow(recent: number, session: number): string {
    if (Number.isNaN(recent) || Number.isNaN(session)) return "";
    if (recent > session + 0.05) return "↑";
    if (recent < session - 0.05) return "↓";
    return "→";
}

// ---------------------------------------------------------------------------
// ToolCostCache — per-tool token cost, computed once, signature-invalidated
// ---------------------------------------------------------------------------

class ToolCostCache {
    private costs: ToolCost[] = [];
    private total = 0;
    private skillCount = 0;
    private skillToks = 0;
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
        const skills = this.costs.filter(c => /skill|memory/i.test(c.name));
        this.skillCount = skills.length;
        this.skillToks = skills.reduce((s, c) => s + c.tokens, 0);
        return true;
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
// Footer — 4 lines, dark background, rendered every TUI frame (must stay cheap)
// ---------------------------------------------------------------------------

function createFooter(
    pi: ExtensionAPI,
    tui: { requestRender(): void },
    _theme: Theme,
    footerData: { getGitBranch(): string | null; onBranchChange(cb: () => void): () => void },
    theme: Theme,
    getAcc: () => CacheAccumulator,
    getRecentAvg: () => number,
    getShape: () => ShapeTracker,
    getModel: () => ModelInfo,
    getToolCache: () => ToolCostCache,
    getCachedSession: () => CachedSession | null,
    getLastThinkingMs: () => number,
    getAvgThinkingMs: () => number,
    getLastResponseMs: () => number,
    getAvgResponseMs: () => number,
    onTick: () => void,
) {
    // Cache git branch; refresh reactively via onBranchChange (not per-frame).
    let branch: string | null = footerData.getGitBranch();
    const unsubscribe = footerData.onBranchChange(() => { branch = footerData.getGitBranch(); tui.requestRender(); });

    // 1Hz tick: refreshes the cached context-window time + cost rates, then
    // requests a TUI re-render. Cost rates are computed in the tick
    // callback, not in render(), so they only change once per second
    // regardless of how often the TUI re-renders (e.g. while the user
    // is typing). Cleared in dispose() when the footer is replaced.
    const ticker = setInterval(() => { onTick(); tui.requestRender(); }, 1000);

    function line(text: string, width: number): string {
        const truncated = truncateToWidth(text, width, "…", true);
        const padded = truncated + " ".repeat(Math.max(0, width - truncated.length));
        return theme.bg("customMessageBg", theme.fg("dim", padded));
    }

    return {
        dispose() { clearInterval(ticker); unsubscribe(); },
        invalidate() {},
        render(width: number): string[] {
            const w = Math.max(1, width);
            const a = getAcc();
            const m = getModel();
            const cache = getToolCache();
            const shape = getShape();

            const hasTurns = a.turns > 0;
            const turnHit = hasTurns ? hitRate(a.lastTurnCacheRead, a.lastTurnInput) : "—";
            const aggHit = hasTurns ? hitRate(a.cacheRead, a.input) : "—";
            const trend = hasTurns ? trendArrow(getRecentAvg(), hitRateNum(a.cacheRead, a.input)) : "";
            const modelName = m.name || "no model";
            const thinkSuffix = m.reasoning && m.thinkingLevel && m.thinkingLevel !== "off" ? ` · ${m.thinkingLevel}` : "";
            const ctxStr = m.contextWindow > 0 ? `${fmt(m.contextWindow)} window` : "—";

            const splitStr = a.lastTurnInput > 0
                ? `${fmt(a.lastTurnCacheRead)} cached / ${fmt(Math.max(0, a.lastTurnInput - a.lastTurnCacheRead))} new`
                : "no data";
            const costStr = a.cost > 0 ? `$${a.cost.toFixed(5)}` : "$0.00000";

            // Context-window clock + current-context cost rate. This is
            // intentionally simple and local to the footer context window:
            // current in-memory cost divided by the footer timer.
            const cached = getCachedSession();
            const projPart = cached
                ? `Ctx Time ${cached.sessionStr} │ $${cached.costPerHour.toFixed(2)}/hr · $${cached.costPerMinute.toFixed(3)}/min`
                : `Ctx Time 0S │ $0.00/hr · $0.000/min`;

            const skillInfo = cache.getSkillCount() > 0 ? ` │ Skills ${cache.getSkillCount()} ~${fmt(cache.getSkillToks())}t` : "";
            // Footer line 3 timing segments are always visible — they are
            // the most useful diagnostic data this extension surfaces
            // (turn latency → cache ROI). Visibility of the model's
            // <thinking> content blocks in the main output is handled by
            // pi (Ctrl+T / hideThinkingBlock setting), not by this footer.
            const thinkLast = fmtDurationShort(getLastThinkingMs());
            const thinkAvg = fmtDurationShort(getAvgThinkingMs());
            const respLast = fmtDurationShort(getLastResponseMs());
            const respAvg = fmtDurationShort(getAvgResponseMs());
            const timingInfo = ` │ Thinking time ${thinkLast} Last / ${thinkAvg} Avg │ Response time: ${respLast} Last / ${respAvg} Avg`;

            const churn = shape.getChurn();
            const shapeLabel = !hasTurns ? "OK" : churn ? `CHANGED: ${churn}` : "OK";
            const branchPart = branch ? ` │ Git Branch: ${branch}` : ` │ Git: Not Setup`;

            return [
                line(`▏ ${modelName}${thinkSuffix} │ Cache Turn ${turnHit} / AVG ${aggHit} ${trend} │ ${ctxStr}`, w),
                line(`▏ IO ↑${fmt(a.input)} ↓${fmt(a.output)} │ ${splitStr} │ ${costStr} (${a.turns} turns · ${a.userTurns} user) | ${projPart}`, w),
                line(`▏ ${cache.getCount()} Tools ~${fmt(cache.getTotal())}t${skillInfo}${timingInfo}`, w),
                line(`▏ STATUS: ${shapeLabel}${branchPart}`, w),
            ];
        },
    };
}

// ---------------------------------------------------------------------------
// createCore — the cache-diagnostics feature module
// ---------------------------------------------------------------------------

export function createCore(pi: ExtensionAPI, turnRecorder: TurnRecorder): void {
    const RECENT_TURNS = 10;

    const acc: CacheAccumulator = {
        cacheRead: 0, cacheWrite: 0, input: 0, output: 0, cost: 0, turns: 0, userTurns: 0,
        lastTurnCacheRead: 0, lastTurnCacheWrite: 0, lastTurnInput: 0, lastTurnOutput: 0,
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
    let currentTurnStart: number | null = null;        // assistant message_start time
    let currentTurnFirstOutput: number | null = null;  // first text/tool-call in current turn
    let lastThinkingMs = 0;
    let lastResponseMs = 0;
    const thinkingTimes: number[] = [];
    const responseTimes: number[] = [];

    // Timer mode (user preference, persists across session_start / model_select).
    // "always-running" = wall-clock from first user prompt in this context window.
    // "stop-when-idle" = active model-processing time only.
    let timerMode: "always-running" | "stop-when-idle" = "always-running";
    let activeStartTime: number | null = null;         // start of current active period (assistant message_start)
    let accumulatedActiveMs = 0;                       // total active time before current period

    function resetAccumulators(): void {
        acc.cacheRead = acc.cacheWrite = acc.input = acc.output = acc.cost = acc.turns = acc.userTurns = 0;
        acc.lastTurnCacheRead = acc.lastTurnCacheWrite = acc.lastTurnInput = acc.lastTurnOutput = 0;
        recentHits.length = 0;
        shape.reset("");
        _sessionId = newSessionId();
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
    }

    function resetTiming(): void {
        sessionStarted = false;
        currentTurnStart = null;
        currentTurnFirstOutput = null;
        lastThinkingMs = 0;
        lastResponseMs = 0;
        thinkingTimes.length = 0;
        responseTimes.length = 0;
        activeStartTime = null;
        accumulatedActiveMs = 0;
        cachedSession = null;
        // timerMode is intentionally NOT reset — it's a user preference.
        // Clear the persisted footer timer on runtime/context resets. The
        // next first user prompt records the new start time.
        clearSessionStart();
        // Re-prime the cache so the post-reset render doesn't wait up to
        // 1s for the next ticker tick.
        recomputeCachedSession();
    }

    // Cached session view, updated only on the 1Hz ticker (not on every
    // render). This is what the footer reads. Sampling at 1Hz keeps rates
    // stable while the user types and the TUI re-renders frequently.
    let cachedSession: CachedSession | null = null;

    function recomputeCachedSession(): void {
        let sessionMs = 0;
        if (timerMode === "always-running") {
            // Source of truth: data.json. It is cleared on context/runtime
            // reset and written only when the first user prompt arrives.
            const data = readDataFile();
            if (data.session.startTime !== null) {
                sessionMs = Math.max(0, Date.now() - data.session.startTime);
            }
        } else {
            // stop-when-idle: in-memory active model-processing time only.
            sessionMs = accumulatedActiveMs + (activeStartTime !== null ? Math.max(0, Date.now() - activeStartTime) : 0);
        }

        const elapsedMinutes = sessionMs / 60000;
        const costPerMinute = elapsedMinutes > 0 ? acc.cost / elapsedMinutes : 0;
        cachedSession = {
            sessionMs,
            sessionStr: fmtDurationLong(sessionMs),
            costPerHour: costPerMinute * 60,
            costPerMinute,
        };
    }

    function avgMs(arr: number[]): number {
        return arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length;
    }

    const toolCache = new ToolCostCache();
    const shape = new ShapeTracker();
    let active = true;
    let lastSysPrompt = "";
    const model: ModelInfo = { name: "", reasoning: false, contextWindow: 0, thinkingLevel: "" };

    function refreshToolCache(): void {
        toolCache.refresh(pi.getAllTools());
    }

    function recentAvg(): number {
        if (recentHits.length === 0) return NaN;
        return recentHits.reduce((s, x) => s + x, 0) / recentHits.length;
    }

    // -----------------------------------------------------------------------
    // Footer lifecycle
    // -----------------------------------------------------------------------

    function show(ctx: { hasUI: boolean; ui: { setFooter: Function } }) {
        if (!ctx.hasUI) return;
        active = true;
        // Prime the cache so the first render shows correct values without
        // waiting up to 1s for the first tick.
        recomputeCachedSession();
        ctx.ui.setFooter((tui: any, theme: Theme, footerData: any) => createFooter(
            pi, tui, theme, footerData, theme,
            () => acc, recentAvg, () => shape, () => model, () => toolCache,
            () => cachedSession,
            () => lastThinkingMs,
            () => avgMs(thinkingTimes),
            () => lastResponseMs,
            () => avgMs(responseTimes),
            recomputeCachedSession,
            ));
    }

    function hide(ctx: { hasUI: boolean; ui: { setFooter: Function } }) {
        if (!ctx.hasUI) return;
        active = false;
        ctx.ui.setFooter(undefined);
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    pi.on("session_start", async (_event, ctx) => {
        resetAccumulators();
        resetTiming();
        lastSysPrompt = "";

        const m = (ctx as any).model;
        if (m) {
            model.name = m.name || m.id || "";
            model.reasoning = m.reasoning === true;
            model.contextWindow = m.contextWindow || 0;
        }
        // thinkingLevel is NOT on the Model object — it's separate agent
        // state. Seed it from pi.getThinkingLevel() so the level is known
        // from the first render, not only after the user changes it.
        // (rules.md §11)
        model.thinkingLevel = pi.getThinkingLevel();

        refreshToolCache();
        show(ctx as any);
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
        // Tools can change between turns (setActiveTools, dynamic registration).
        refreshToolCache();
    });

    pi.on("input", async (event, _ctx) => {
        // The docs expose input.streamingBehavior for mid-stream user
        // messages. These are still user prompts, but they are useful to
        // report separately as sub-prompts/steering/follow-up prompts.
        _pendingStreamingBehavior = event.streamingBehavior === "steer" || event.streamingBehavior === "followUp"
            ? event.streamingBehavior
            : undefined;
        return { action: "continue" as const };
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
                // First user message of a new context window/startup — write
                // the context start time to data.json (source of truth) and
                // mark the in-memory flag so we don't write again until
                // resetTiming() runs (session_start or /cache-reset).
                sessionStarted = true;
                startNewSession();
                // Prime the cache so the next render shows the new value
                // without waiting up to 1s for the ticker.
                recomputeCachedSession();
            }
        } else if (msg.role === "assistant") {
            // New assistant turn — start the per-turn clock and the
            // active-period clock (used by stop-when-idle mode).
            const now = Date.now();
            currentTurnStart = now;
            currentTurnFirstOutput = null;
            activeStartTime = now;
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

        // Active-period timing (used by stop-when-idle mode).
        // Each assistant turn contributes its wall-clock duration to the
        // running total; turns may chain (tool-call rounds) and each one
        // is added independently.
        if (activeStartTime !== null) {
            accumulatedActiveMs += Math.max(0, Date.now() - activeStartTime);
            activeStartTime = null;
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
        }

        // Snapshot last turn
        acc.lastTurnCacheRead = usage.cacheRead;
        acc.lastTurnCacheWrite = usage.cacheWrite;
        acc.lastTurnInput = usage.input;
        acc.lastTurnOutput = usage.output;

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
    });

    pi.on("session_compact", async () => {
        shape.reset("compaction");
        console.log("[aftc-toolset] compaction — shape reset");
    });

    pi.on("agent_end", async (_event, ctx) => {
        if (acc.lastTurnInput === 0) return;
        const cr = acc.lastTurnCacheRead;
        const fresh = Math.max(0, acc.lastTurnInput - cr);
        const total = acc.lastTurnInput + acc.lastTurnOutput;
        console.log(
            `[aftc-toolset] turn: ${fmt(total)} tok · in ${fmt(acc.lastTurnInput)} (${fmt(cr)} cached / ${fmt(fresh)} new) · out ${fmt(acc.lastTurnOutput)} · $${acc.cost.toFixed(4)} · think ${fmtDurationShort(lastThinkingMs)} · resp ${fmtDurationShort(lastResponseMs)}`,
        );
        void ctx;
    });

    // -----------------------------------------------------------------------
    // Commands
    // -----------------------------------------------------------------------

    pi.registerCommand("aftc-footer", {
        description: "Toggle the cache footer bar on/off",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            if (active) { hide(ctx as any); ctx.ui.notify("Cache footer hidden.", "info"); }
            else { show(ctx as any); ctx.ui.notify("Cache footer shown.", "info"); }
        },
    });

    pi.registerCommand("cache-profile", {
        description: "Per-tool token costs, prefix shape, churn analysis",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            refreshToolCache();
            const tools = pi.getAllTools();
            const costs = [...toolCache.getCosts()];
            const total = toolCache.getTotal();
            const max = costs.length > 0 ? costs[0].tokens : 1;
            const lines: string[] = [];
            lines.push(`Tool schema costs (${tools.length} tools, ~${fmt(total)} tok total):`);
            lines.push("");
            for (const c of costs) {
                const bar = "█".repeat(Math.min(30, max > 0 ? Math.round((c.tokens / max) * 30) : 0));
                const pc = total > 0 ? ((c.tokens / total) * 100).toFixed(1) + "%" : "";
                lines.push(`  ${c.name.padEnd(22)} ~${String(c.tokens).padStart(4)} tok ${pc.padStart(6)} ${bar}`);
            }
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

    // -- Timer mode commands ------------------------------------------------
    // Mode is a user preference and persists across context resets and model
    // changes. Switching mode mid-context is safe; the displayed context time
    // will jump to reflect the new mode on the next render (1Hz tick or next
    // input event).

    pi.registerCommand("cost-timer-stop-when-idle", {
        description: "Use active model-processing time for the context cost rate",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            timerMode = "stop-when-idle";
            ctx.ui.notify("Timer mode: stop-when-idle (context clock freezes while idle, advances during active model processing)", "info");
        },
    });

    pi.registerCommand("cost-timer-always-running", {
        description: "Use wall-clock time for the context cost rate (default)",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            timerMode = "always-running";
            ctx.ui.notify("Timer mode: always-running (context wall-clock from first prompt)", "info");
        },
    });

    pi.registerCommand("cost-timer-info", {
        description: "Show the available timer modes and the current mode",
        handler: async (_a: string, ctx: ExtensionCommandContext) => {
            const lines = [
                "Context cost timer modes",
                "════════════════════════",
                "",
                `Current mode: ${timerMode}`,
                "",
                "/cost-timer-stop-when-idle",
                "  The context timer advances only while the model is actively",
                "  processing a turn (between assistant message_start and",
                "  message_end). It freezes during idle time while you read,",
                "  decide, or type the next prompt.",
                "",
                "  The footer rate then estimates cost per minute/hour of",
                "  active model work.",
                "",
                "/cost-timer-always-running",
                "  The context timer runs continuously from the first prompt",
                "  in the current context window. This is the default and is",
                "  best for quick while-you-code spend estimates.",
                "",
                "Footer line 2 shows:",
                '  Ctx Time XH YM ZS │ $X.XX/hr · $X.XXX/min',
                "",
                "The rate is just current-context cost divided by current",
                "context time. It is intentionally simple; use /usage-report",
                "for detailed historical/day/model usage.",
                "Model and thinking-level changes do not reset the context",
                "timer or accumulated context cost.",
            ];
            if (ctx.hasUI) await ctx.ui.select("Cache timer info", lines, { timeout: 60000 });
        },
    });

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

    console.log("[aftc-toolset] loaded — /cache-profile, /cache-stats, /cache-reset, /aftc-footer, /cost-timer-stop-when-idle, /cost-timer-always-running, /cost-timer-info, /cls");
}
