/**
 * pi-aftc-toolset — usage-report feature module.
 *
 * Reads the per-turn SQLite database (populated by usage-recording.ts)
 * and serves an interactive HTML report from a small local web server.
 *
 * The report UI ships as a seed website (data/usage-report/: index.html,
 * styles.css, ES-module JS per tab, a bundled Chart.js build, favicon).
 * /usage-report copies the seed into the persistent data dir
 * (<dataDir>/usage-report/, version-stamped), writes a fresh data.json
 * from the DB, and starts the bundled zero-dependency server (server.js)
 * in its own terminal window — the server opens the browser, prints its
 * info, and self-terminates when the window closes or after 30 minutes
 * idle. No internet is needed: Chart.js ships locally. The report is
 * organised into seven tabs:
 *
 *   Overview      — headline stat cards (total cost, cost per completed
 *                   task, prompts, user/AI ratio, worst token burner,
 *                   cache hit), a daily-spend bar chart (last 30 days), a
 *                   cost-share doughnut with a window selector (24h
 *                   rolling / 1 Day ... 1 Year / All Time), and three
 *                   period summary cards (24h / 7d / 28d). The per-model
 *                   scoreboard always shows every row — cost rows only
 *                   list models that cost something ($0 models never
 *                   appear), usage / cache / timing rows include them —
 *                   and carries Avg / Longest / Shortest Task Time rows,
 *                   $ per completed task, the AI-per-user-prompt ratio
 *                   and context-window use.
 *   Models        — the hero / shame ranking: per-model sortable table
 *                   with a period selector (cost, $/turn, $/task,
 *                   prompts, AI/user ratio, cache, context use, errors,
 *                   task time) and verdict badges calling out the best
 *                   and worst of each metric.
 *   Thinking      — per-model × thinking-level sortable table with a
 *                   period selector and a Task Time column.
 *   Timings       — Task Time analysis from the tasks table: headline
 *                   cards (avg / longest task, turns per task, error &
 *                   abort counts), task-time-by-model and daily avg
 *                   task-time charts, a think / respond / tools-and-
 *                   overhead split, user- vs AI-turn timings, and the
 *                   top-10 longest completed tasks.
 *   Projections   — usage-rate cost projections: per-model $/turn,
 *                   $/completed task, tasks/day and projected 7/30/90/365
 *                   day spend built from YOUR pace (tasks per active day
 *                   × cost per task). Period selector. $0 models excluded.
 *   Context & Allowance — context-window pressure per model × thinking
 *                   (avg context at task start / end, % of window, growth
 *                   per task, tasks until the window fills, 5h token burn
 *                   in window equivalents, 1M-window feasibility flags)
 *                   plus provider-reported 5h / weekly allowance consumed
 *                   per task and tasks-until-full projections.
 *   Errors        — failed calls per model × error type (rate limit,
 *                   overloaded, not found, auth, timeout, network) with a
 *                   fair error rate (errors ÷ completed tasks). User
 *                   aborts are NOT errors — they are a stat on Timings.
 *
 * Projection math:
 *   per model: costPerTurn = cost ÷ turns, costPerTask = completed-task
 *   cost ÷ completed tasks, tasksPerDay = completed tasks ÷ active days.
 *   Projections = tasksPerDay × costPerTask × N days. Rows with fewer
 *   than 7 active days are flagged as estimates.
 *   overall: the same math over all paid-cost models; spendPerDay (all
 *   spend ÷ calendar days) is kept as the reference burn rate that
 *   includes idle days. Flagged as an estimate below 14 calendar days.
 *
 * Context / allowance math:
 *   contextStart/End = pi's getContextUsage() tokens at task start
 *   (message_start of the user prompt) and task end (last message_end),
 *   recorded into the tasks table by core.ts. Old rows (0) fall back to
 *   turn-derived values (first turn's cache_read + input, last turn's +
 *   output). % window = end ÷ the model's declared contextWindow.
 *   tasksUntilFull = (window − avgEnd) ÷ avgGrowth. The 1M flag fires
 *   when a model's 5-hour token burn ≥ 1,000,000.
 *   Allowance: core.ts snapshots the provider-reported 5h / weekly
 *   used-% before and after each task; avg % per task and tasks-until-
 *   100% are derived here. Providers without an allowance endpoint
 *   (most) leave the columns NULL and the tab shows N/A.
 *
 * Recording (v1.21.x): turns gain context_window/context_tokens; tasks
 * gain context start/end + allowance snapshots; a new errors table holds
 * one row per failed LLM call (stopReason "error", classified). Old DBs
 * migrate in place via db.ts MIGRATIONS.
 *
 * Per AGENTS.md, this is a self-contained feature module: it owns
 * no shared state with other feature modules and is wired into pi by
 * the orchestrator in index.ts. It does not import core.ts or
 * usage-recording.ts (it only reads the DB they share).
 *
 * See `usage-report-readme.md` for the full report contents.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getDb, isDbAvailable } from "./db";
import { getDataDir, getPackageRoot } from "./paths";
import { showConfirm } from "./ui/aftc-ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TablePeriod = "daily" | "weekly" | "monthly" | "all";

type ModelRow = {
    modelName: string;
    /** Provider id (deepseek, qwencloud, kimi-coding, ...) — distinguishes
     *  same-named models across providers; '' when unknown/legacy. */
    provider: string;
    cost: number;
    turns: number;
    userPrompts: number;
    /** Self-prompted turns: total turns minus user-prompt turns. */
    aiPrompts: number;
    /** AI (self-prompted) turns per user prompt. */
    aiPerUserPrompt: number;
    /** Total cost ÷ total turns (0 for $0 subscription models). */
    costPerTurn: number;
    avgCostPerUserPrompt: number;
    avgCacheRate: number;
    avgThinkingMs: number;
    avgResponseMs: number;
    /** Avg completed-task time (tasks table) for this model in the window. */
    avgTaskMs: number;
    /** Avg cost per COMPLETED task (task cost from the turns join ÷ completed
     *  task count). 0 when the model has no completed tasks in the window. */
    costPerTask: number;
    /** Completed-task count in the window. */
    completedTasks: number;
    /** Failed LLM calls for this model in the window (errors table). */
    errorCount: number;
    /** Errors ÷ completed tasks (null when the model has no completed tasks). */
    errorRate: number | null;
    /** Avg context used at task end ÷ the model's context window (0..1;
     *  null when no context data was recorded for this model). */
    contextEndPct: number | null;
};

type ModelThinkingRow = ModelRow & { thinkingLevel: string };

type ScoreboardEntry = { label: string; model: string; value: string; /** When set, the row renders N/A with this tooltip reason. */ na?: string; /** When set, an info-icon tooltip explains the metric (hover). */ hint?: string };

type PeriodSummary = {
    label: string;
    cost: number;
    calls: number;
    prompts: number;
    aiPrompts: number;
    /** Best-per-metric rows (the "Best AI Models" pane section). */
    best: ScoreboardEntry[];
    /** Worst-per-metric rows (the "Worst AI Models" pane section). */
    worst: ScoreboardEntry[];
};

type DayPoint = { day: string; label: string; cost: number; calls: number; prompts: number;
    /** Tooltip extras: most costly / cheapest model of the day (paid usage only) and the
     *  longest COMPLETED task of the day (empty string / 0 when not applicable). */
    mostCostlyModel: string; mostCostlyCost: number;
    cheapestModel: string; cheapestCost: number;
    longestTaskModel: string; longestTaskMs: number; };

type TaskModelPoint = { modelName: string; avgTaskMs: number; tasks: number };

type LongestTask = { timestamp: number; modelName: string; thinkingLevel: string; turnCount: number; taskMs: number };

type TimingsWindow = {
    /** All recorded tasks in the window (any outcome). */
    taskCount: number;
    completed: number;
    errors: number;
    aborted: number;
    /** Completed-task timing figures — failed durations are never averaged in. */
    avgTaskMs: number;
    maxTaskMs: number;
    maxTaskModel: string;
    avgTurnsPerTask: number;
    totalTaskMs: number;
    userTurns: number;
    userAvgThinkMs: number;
    userAvgRespMs: number;
    aiTurns: number;
    aiAvgThinkMs: number;
    aiAvgRespMs: number;
    totalThinkMs: number;
    totalRespMs: number;
    taskByModel: TaskModelPoint[];
    longest: LongestTask[];
};

type TaskDayPoint = { day: string; label: string; avgTaskMs: number; tasks: number };

type ContextRow = {
    modelName: string;
    thinkingLevel: string;
    /** Tasks with context data in the window. */
    tasks: number;
    /** Model's declared context window (tokens; 0 = unknown). */
    contextWindow: number;
    /** Avg context at task start (tokens; null = no data). */
    avgStartTokens: number | null;
    /** Avg context at task end (tokens; null = no data). */
    avgEndTokens: number | null;
    /** Avg end ÷ window (0..1; null when window or end unknown). */
    avgEndPct: number | null;
    /** Avg context growth per task (max(0, end - start); null = no data). */
    avgGrowth: number | null;
    /** Estimated completed tasks until the context window fills
     *  ((window - avgEnd) / avgGrowth; null when not computable). */
    tasksUntilFull: number | null;
    /** True when this model ACTUALLY reported a 5h / weekly allowance
     *  window in the period (subscription plans only — Codex, Claude,
     *  MiniMax, Z.ai GLM, Kimi). The allowance-window metrics below
     *  (5h / window, 1M flag) only apply when true; API providers
     *  (DeepSeek etc.) have no such windows and are never flagged. */
    allowanceReported: boolean;
    /** Tokens burned (input + output + cache-read) in the last 5 hours. */
    fiveHourBurn: number;
    /** Tokens burned in the last 7 days. */
    weeklyBurn: number;
    /** Context-window equivalents burned per 5 hours (null = window unknown). */
    fiveHourWindows: number | null;
    /** True when the 5-hour burn already exceeds 1,000,000 tokens — a 1M
     *  context window cannot be sustained at this burn rate. Only
     *  meaningful for models that report an allowance window. */
    millionFlag: boolean;
};

type AllowanceRow = {
    /** Provider label of the allowance snapshot (eg "ChatGPT Plus"). */
    provider: string;
    /** Tasks that carried an allowance snapshot. */
    tasks: number;
    /** Avg 5-hour allowance % consumed per task (null = no snapshot pairs). */
    avg5hPerTask: number | null;
    /** Avg weekly allowance % consumed per task (null = no snapshot pairs). */
    avgWeeklyPerTask: number | null;
    /** Avg 5-hour used % at task end across the window. */
    avg5hEnd: number | null;
    /** Avg weekly used % at task end across the window. */
    avgWeeklyEnd: number | null;
    /** Tasks where the 5h window reset mid-task (end < start). */
    fiveHourResets: number;
    /** Tasks until the 5h window reaches 100% at the current rate. */
    tasksUntil5hFull: number | null;
    /** Tasks until the weekly window reaches 100% at the current rate. */
    tasksUntilWeeklyFull: number | null;
};

type AllowanceLatest = {
    provider: string;
    fiveHourUsed: number | null;
    weeklyUsed: number | null;
    at: number;
};

type ErrorTypeCount = { type: string; count: number };

type ErrorModelRow = { modelName: string; errorType: string; count: number; lastTs: number };

type ErrorModelRate = { modelName: string; errors: number; completedTasks: number; rate: number | null };

type ErrorStats = {
    total: number;
    byType: ErrorTypeCount[];
    byModel: ErrorModelRow[];
    modelRates: ErrorModelRate[];
};

type ErrorDayPoint = { day: string; label: string; count: number };

type ProjectionRow = {
    modelName: string;
    activeDays: number;
    turns: number;
    userPrompts: number;
    /** Completed tasks in the window. */
    completedTasks: number;
    cost: number;
    costPerTurn: number;
    /** Avg cost per completed task (null = no completed tasks). */
    costPerTask: number | null;
    /** Cost ÷ active days. */
    spendPerDay: number;
    /** Completed tasks ÷ active days. */
    tasksPerDay: number;
    /** Turns ÷ active days. */
    turnsPerDay: number;
    /** Usage-rate projections: tasksPerDay × costPerTask × N days. */
    projected7d: number | null;
    projected30d: number | null;
    projected90d: number | null;
    projected365d: number | null;
    /** True when fewer than ESTIMATE_MIN_ACTIVE_DAYS active days. */
    estimated: boolean;
};

type ProjectionSummary = {
    rows: ProjectionRow[];
    totalCost: number;
    avgCostPerTurn: number;
    avgCostPerTask: number | null;
    completedTasks: number;
    activeDays: number;
    calendarDays: number;
    tasksPerDay: number;
    spendPerDay: number;
    projected7d: number | null;
    projected30d: number | null;
    projected90d: number | null;
    projected365d: number | null;
    estimated: boolean;
    note: string;
};

type ReportTotals = {
    totalCost: number;
    turnCount: number;
    userPromptCount: number;
    basePromptCount: number;
    subPromptCount: number;
    automatedTurnCount: number;
    paidTurnCount: number;
    paidUserPromptCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheRead: number;
    avgCacheRate: number;
    avgCostPerTurn: number;
    avgCostPerUserPrompt: number;
    turnsPerUserPrompt: number;
    activeDays: number;
    calendarDays: number;
    avgDailySpend: number;
    firstTurnMs: number;
    /** Completed tasks (stop_reason='complete') across all time. */
    completedTasks: number;
    /** Total completed-task cost (turns join) ÷ completed tasks. */
    avgCostPerTask: number | null;
    /** Tokens burned (input + output + cache-read) in the last 5 hours / 7 days. */
    fiveHourBurn: number;
    sevenDayBurn: number;
    /** The single model that burned the most tokens EVER (all time;
     *  empty string when there is no usage) — the Overview "worst token
     *  burner" card. Tie broken alphabetically for determinism. */
    worstBurnModel: string;
    worstBurnTokens: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SERIES_DAYS = 30;
const DAYS_PER_MONTH = 30.44;
const ESTIMATE_MIN_ACTIVE_DAYS = 7;
const ESTIMATE_MIN_CALENDAR_DAYS = 14;
/** A 1M-token context window cannot be sustained when a model burns more
 *  than this many tokens per 5-hour window. */
const MILLION = 1_000_000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Scoreboard N/A tooltip reasons (a row stays visible as N/A whenever its
// metric is uncomputable for the window, with the reason on an info icon).
const NA_COST = "Not available - no model in this period has a recorded cost. Subscription providers often don't give a per-turn price, so cost averages can't be calculated.";
const NA_NO_TURNS = "Not available - no turns were recorded in this period.";
const NA_NO_PROMPTS = "Not available - no user-prompt turns were recorded in this period.";
const NA_NO_TASKS = "Not available - no completed tasks were recorded in this period.";
const NA_COST_TASK = "Not available - no completed-task cost in this period (only models with a real cost per completed task qualify).";
const NA_NO_CONTEXT = "Not available - no context-window data in this period (recorded from pi's context estimate; rows recorded before this feature lack it).";

function num(v: unknown): number { return Number(v) || 0; }
function safeDiv(a: number, b: number): number { return b > 0 ? a / b : 0; }
function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** Server-side duration formatter: Xh Ym Zs, no padding, omit zero units. */
function fmtMsServer(ms: number): string {
    const totalSec = Math.round((ms || 0) / 1000);
    if (totalSec <= 0) return "0s";
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(h + "h");
    if (m > 0) parts.push(m + "m");
    if (s > 0 || parts.length === 0) parts.push(s + "s");
    return parts.join(" ");
}

/** Server-side percentage formatter for cache hit rate. */
function fmtPctServer(rate: number): string { return ((rate || 0) * 100).toFixed(1) + "%"; }

/** Server-side money formatter — MUST mirror the client fmtMoney tiers:
 *  $0 → $0.00 · <$1 → 4dp · $1–<$1,000 → 2dp · ≥$1,000 → whole number
 *  (rounded) · thousands separators at every magnitude. */
function fmtMoneyServer(v: number): string {
    v = Number(v) || 0;
    const a = Math.abs(v);
    if (a === 0) return "$0.00";
    let s: string;
    if (a < 1) s = v.toFixed(4);
    else if (a < 1000) s = v.toFixed(2);
    else s = String(Math.round(v));
    const parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "$" + parts.join(".");
}

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

const USER_PROMPT_SQL = `COALESCE(SUM(user_prompt), 0)`;
const BASE_PROMPT_SQL = `COALESCE(SUM(base_prompt), 0)`;
const SUB_PROMPT_SQL = `COALESCE(SUM(sub_prompt), 0)`;
const CACHE_RATE_SQL = `AVG(CAST(cache_read AS REAL) / NULLIF(cache_read + input_tokens, 0))`;
// Paid-only denominators: free / $0 (subscription) turns are recorded
// for their prompt counts and timing data, but must not drag cost
// averages down.
const PAID_TURNS_SQL = `COALESCE(SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END), 0)`;
const PAID_USER_PROMPT_SQL = `COALESCE(SUM(CASE WHEN cost_usd > 0 THEN user_prompt ELSE 0 END), 0)`;

/** WHERE fragment + params for a bounded time window (calendar periods
 *  like "Last Week (Mon-Sun)" need an upper bound; `col` lets callers
 *  alias the timestamp column, eg "t.timestamp"). */
function windowWhere(since: number, until?: number, col = "timestamp"): { where: string; params: number[] } {
    const params = [since];
    let where = `${col} >= ?`;
    if (until && until > since) { where += ` AND ${col} < ?`; params.push(until); }
    return { where, params };
}

// ---------------------------------------------------------------------------
// UsageModule
// ---------------------------------------------------------------------------

class UsageModule {
    constructor(private pi: ExtensionAPI) {}

    attach(): void { this.registerCommands(); }

    // -------------------------------------------------------------------
    // Collectors
    // -------------------------------------------------------------------

    private windowStatsForModel(db: any, modelName: string, since: number, until?: number): ModelRow {
        const w = windowWhere(since, until);
        const row = db.prepare(
            `SELECT COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${PAID_USER_PROMPT_SQL} AS paid_user_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COALESCE(MAX(provider), '') AS provider,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response
             FROM turns
             WHERE model_name = ? AND ${w.where}`,
        ).get(modelName, ...w.params) as any;
        const turns = num(row.turns);
        const userPrompts = num(row.user_count);
        const paidUserPrompts = num(row.paid_user_count);
        const cost = num(row.cost);
        return {
            modelName,
            provider: String(row.provider || ""),
            cost,
            turns,
            userPrompts,
            aiPrompts: Math.max(0, turns - userPrompts),
            aiPerUserPrompt: safeDiv(turns - userPrompts, userPrompts),
            avgCostPerUserPrompt: safeDiv(cost, paidUserPrompts),
            costPerTurn: safeDiv(cost, turns),
            avgCacheRate: num(row.avg_cache_rate),
            avgThinkingMs: num(row.avg_thinking),
            avgResponseMs: num(row.avg_response),
            avgTaskMs: 0,
            costPerTask: 0,
            completedTasks: 0,
            errorCount: 0,
            errorRate: null,
            contextEndPct: null,
        };
    }

    /** Per-model rows for a time window. Models with no turns in the window are omitted. */
    private collectWindowedModels(db: any, since: number, until?: number): ModelRow[] {
        const models = (db.prepare(
            `SELECT DISTINCT model_name FROM turns WHERE model_name IS NOT NULL AND model_name != '' ORDER BY model_name`,
        ).all() as Array<{ model_name: string }>).map(r => r.model_name);
        const taskTimes = this.taskTimeByModel(db, since, until);
        const taskCost = this.taskCostByModel(db, since, until);
        const ctxEnd = this.contextEndPctByModel(db, since, until);
        const errStats = this.errorStatsByModel(db, since, until);
        return models
            .map(m => this.windowStatsForModel(db, m, since, until))
            .filter(r => r.turns > 0)
            .map(r => {
                const tc = taskCost.get(r.modelName);
                const es = errStats.get(r.modelName);
                return {
                    ...r,
                    avgTaskMs: taskTimes.get(r.modelName) || 0,
                    costPerTask: tc && tc.tasks > 0 ? tc.cost / tc.tasks : 0,
                    completedTasks: tc?.tasks || 0,
                    errorCount: es?.errors || 0,
                    errorRate: es?.rate ?? null,
                    contextEndPct: ctxEnd.get(r.modelName) ?? null,
                };
            });
    }

    /** Per-model × thinking-level rows for a time window. */
    private collectWindowedModelThinking(db: any, since: number): ModelThinkingRow[] {
        const rows = db.prepare(
            `SELECT model_name,
                    thinking_level,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${PAID_USER_PROMPT_SQL} AS paid_user_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COALESCE(MAX(provider), '') AS provider,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response
             FROM turns
             WHERE model_name IS NOT NULL AND model_name != ''
             ${since > 0 ? "AND timestamp >= ?" : ""}
             GROUP BY model_name, thinking_level
             ORDER BY cost DESC`,
        ).all(...(since > 0 ? [since] : [])) as any[];
        const taskTimes = this.taskTimeByModelThinking(db, since);
        const taskCost = this.taskCostByModel(db, since);
        const ctxEnd = this.contextEndPctByModel(db, since);
        return rows.map(r => {
            const turns = num(r.turns);
            const userPrompts = num(r.user_count);
            const paidUserPrompts = num(r.paid_user_count);
            const cost = num(r.cost);
            const level = r.thinking_level || "(none)";
            const tc = taskCost.get(r.model_name);
            return {
                modelName: r.model_name,
                provider: String(r.provider || ""),
                thinkingLevel: level,
                cost,
                turns,
                userPrompts,
                aiPrompts: Math.max(0, turns - userPrompts),
                aiPerUserPrompt: safeDiv(turns - userPrompts, userPrompts),
                avgCostPerUserPrompt: safeDiv(cost, paidUserPrompts),
                costPerTurn: safeDiv(cost, turns),
                avgCacheRate: num(r.avg_cache_rate),
                avgThinkingMs: num(r.avg_thinking),
                avgResponseMs: num(r.avg_response),
                avgTaskMs: taskTimes.get(`${r.model_name}|${level}`) || 0,
                costPerTask: tc && tc.tasks > 0 ? tc.cost / tc.tasks : 0,
                completedTasks: tc?.tasks || 0,
                errorCount: 0,
                errorRate: null,
                contextEndPct: ctxEnd.get(r.model_name) ?? null,
            };
        });
    }

    /** Zero-filled per-day cost/calls/prompts for the last SERIES_DAYS local days. */
    private collectDailySeries(db: any, now: number): DayPoint[] {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (SERIES_DAYS - 1));
        const rows = db.prepare(
            `SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COUNT(*) AS calls,
                    ${USER_PROMPT_SQL} AS prompts
             FROM turns
             WHERE timestamp >= ?
             GROUP BY day`,
        ).all(start.getTime()) as any[];
        const byDay = new Map<string, any>(rows.map(r => [String(r.day), r]));
        // Per-day per-model cost — powers the daily-chart tooltip's "most
        // costly / cheapest" lines (paid usage only).
        const modelCosts = db.prepare(
            `SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day, model_name AS model,
                    COALESCE(SUM(cost_usd), 0) AS cost
             FROM turns
             WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
             GROUP BY day, model_name`,
        ).all(start.getTime()) as any[];
        const dayModels = new Map<string, Array<{ model: string; cost: number }>>();
        for (const r of modelCosts) {
            const day = String(r.day);
            if (!dayModels.has(day)) dayModels.set(day, []);
            dayModels.get(day)!.push({ model: String(r.model), cost: num(r.cost) });
        }
        // Per-day longest COMPLETED task — the tooltip's "longest task" line.
        const longestTasks = db.prepare(
            `SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day, model_name AS model, MAX(task_ms) AS max_task
             FROM tasks
             WHERE timestamp >= ? AND stop_reason = 'complete'
                   AND model_name IS NOT NULL AND model_name != ''
             GROUP BY day`,
        ).all(start.getTime()) as any[];
        const dayLongest = new Map<string, { model: string; taskMs: number }>();
        for (const r of longestTasks) {
            dayLongest.set(String(r.day), { model: String(r.model), taskMs: num(r.max_task) });
        }
        const out: DayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            const row = byDay.get(key);
            const models = dayModels.get(key) || [];
            const paid = models.filter(m => m.cost > 0);
            let mostCostlyModel = "", mostCostlyCost = 0, cheapestModel = "", cheapestCost = 0;
            if (paid.length > 0) {
                paid.sort((a, b) => b.cost - a.cost);
                mostCostlyModel = paid[0].model;
                mostCostlyCost = paid[0].cost;
                const cheapest = models.slice().sort((a, b) => a.cost - b.cost)[0];
                cheapestModel = cheapest.model;
                cheapestCost = cheapest.cost;
            }
            const lt = dayLongest.get(key);
            out.push({
                day: key,
                label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`,
                cost: num(row?.cost),
                calls: num(row?.calls),
                prompts: num(row?.prompts),
                mostCostlyModel,
                mostCostlyCost,
                cheapestModel,
                cheapestCost,
                longestTaskModel: lt?.model || "",
                longestTaskMs: lt?.taskMs || 0,
            });
        }
        return out;
    }

    /** One Period summary pane: totals + a Best / Worst split of the key
     *  metrics. Cost rows (cheapest / most costly, $ per task) only consider
     *  models that cost something; usage / cache / timing / ratio rows
     *  consider ALL models. Every row is always shown; an uncomputable
     *  metric renders N/A with a reason tooltip. */
    private summarizePeriod(rows: ModelRow[], label: string): PeriodSummary {
        const cost = rows.reduce((s, r) => s + r.cost, 0);
        const calls = rows.reduce((s, r) => s + r.turns, 0);
        const prompts = rows.reduce((s, r) => s + r.userPrompts, 0);

        const best: ScoreboardEntry[] = [];
        const worst: ScoreboardEntry[] = [];
        const naRow = (list: ScoreboardEntry[], rowLabel: string, reason: string): void => {
            list.push({ label: rowLabel, model: "", value: "", na: reason });
        };

        // Cost per turn — paid models only, N/A when none.
        const paid = rows.filter(r => r.cost > 0);
        if (paid.length > 0) {
            const byCpt = paid.slice().sort((a, b) => safeDiv(a.cost, a.turns) - safeDiv(b.cost, b.turns));
            best.push({ label: "Cheapest model", model: byCpt[0].modelName, value: fmtMoneyServer(safeDiv(byCpt[0].cost, byCpt[0].turns)) });
            worst.push({ label: "Most costly model", model: byCpt[byCpt.length - 1].modelName, value: fmtMoneyServer(safeDiv(byCpt[byCpt.length - 1].cost, byCpt[byCpt.length - 1].turns)) });
        } else {
            naRow(best, "Cheapest model", NA_COST);
            naRow(worst, "Most costly model", NA_COST);
        }

        // Cost per completed task — paid task-cost rows only (a $0
        // subscription model has no task cost to compare).
        const withTaskCost = rows.filter(r => r.costPerTask > 0 && r.completedTasks > 0);
        if (withTaskCost.length > 0) {
            const byTc = withTaskCost.slice().sort((a, b) => a.costPerTask - b.costPerTask);
            best.push({ label: "Best value per task", model: byTc[0].modelName, value: fmtMoneyServer(byTc[0].costPerTask) });
            worst.push({ label: "Most costly per task", model: byTc[byTc.length - 1].modelName, value: fmtMoneyServer(byTc[byTc.length - 1].costPerTask) });
        } else {
            naRow(best, "Best value per task", NA_COST_TASK);
            naRow(worst, "Most costly per task", NA_COST_TASK);
        }

        // Task time — fastest / longest avg completed-task time. All models
        // (a slow $0 model is still slow).
        const withT = rows.filter(r => r.avgTaskMs > 0);
        if (withT.length > 0) {
            const byT = withT.slice().sort((a, b) => a.avgTaskMs - b.avgTaskMs);
            best.push({ label: "Fastest tasks", model: byT[0].modelName, value: fmtMsServer(byT[0].avgTaskMs) });
            worst.push({ label: "Longest task time", model: byT[byT.length - 1].modelName, value: fmtMsServer(byT[byT.length - 1].avgTaskMs) });
        } else {
            naRow(best, "Fastest tasks", NA_NO_TASKS);
            naRow(worst, "Longest task time", NA_NO_TASKS);
        }

        // AI (self-prompted) turns per user prompt — efficiency. Lower is
        // better: fewer tool-call loops per prompt you type. All models.
        const withUp = rows.filter(r => r.userPrompts > 0);
        if (withUp.length > 0) {
            const byRatio = withUp.slice().sort((a, b) => a.aiPerUserPrompt - b.aiPerUserPrompt);
            best.push({ label: "Most efficient prompting", model: byRatio[0].modelName, value: byRatio[0].aiPerUserPrompt.toFixed(1) });
            worst.push({
                label: "Auto-prompt hog",
                model: byRatio[byRatio.length - 1].modelName,
                value: byRatio[byRatio.length - 1].aiPerUserPrompt.toFixed(1),
                hint: "How many AI (self-prompted) turns each of your prompts triggers. A high number means the model keeps looping through tool calls on its own before it finishes - more time and tokens per prompt.",
            });
        } else {
            naRow(best, "Most efficient prompting", NA_NO_PROMPTS);
            naRow(worst, "Auto-prompt hog", NA_NO_PROMPTS);
        }

        // Cache hit — best = highest %, worst = lowest %. All models.
        if (rows.length > 0) {
            const byCache = rows.slice().sort((a, b) => b.avgCacheRate - a.avgCacheRate);
            best.push({ label: "Best cache hit", model: byCache[0].modelName, value: fmtPctServer(byCache[0].avgCacheRate) });
            worst.push({ label: "Worst cache hit", model: byCache[byCache.length - 1].modelName, value: fmtPctServer(byCache[byCache.length - 1].avgCacheRate) });
        } else {
            naRow(best, "Best cache hit", NA_NO_TURNS);
            naRow(worst, "Worst cache hit", NA_NO_TURNS);
        }

        return {
            label,
            cost,
            calls,
            prompts,
            aiPrompts: Math.max(0, calls - prompts),
            best,
            worst,
        };
    }

    // Task-time collectors (tasks table)
    // -------------------------------------------------------------------

    /** Avg completed-task time per model in a window (tasks table). */
    private taskTimeByModel(db: any, since: number, until?: number): Map<string, number> {
        const w = windowWhere(since, until);
        const rows = db.prepare(
            `SELECT model_name, AVG(task_ms) AS avg_task
             FROM tasks
             WHERE ${w.where} AND stop_reason = 'complete'
                   AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name`,
        ).all(...w.params) as any[];
        return new Map(rows.map(r => [String(r.model_name), num(r.avg_task)]));
    }

    /** Avg completed-task time per model × thinking level in a window. */
    private taskTimeByModelThinking(db: any, since: number): Map<string, number> {
        const rows = db.prepare(
            `SELECT model_name, thinking_level, AVG(task_ms) AS avg_task
             FROM tasks
             WHERE timestamp >= ? AND stop_reason = 'complete'
                   AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name, thinking_level`,
        ).all(since) as any[];
        return new Map(rows.map(r => [`${r.model_name}|${r.thinking_level || "(none)"}`, num(r.avg_task)]));
    }

    /** Cost-by-model slices for the Overview cost-share chart, one entry
     *  per selectable window (rolling 24h first, calendar-anchored after,
     *  matching the footer timeframe semantics; 0 = all time). */
    private collectShareWindows(db: any, now: number): Array<{ key: string; label: string; models: Array<{ name: string; cost: number }> }> {
        const d = new Date(now);
        const startOfDayLocal = (daysBack: number): number =>
            new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
        const startOfMonthLocal = (monthsBack: number): number =>
            new Date(d.getFullYear(), d.getMonth() - monthsBack, 1).getTime();
        const windows = [
            { key: "24h", label: "Last 24 Hours (rolling)", since: now - DAY_MS },
            { key: "1d", label: "1 Day", since: startOfDayLocal(0) },
            { key: "3d", label: "3 Days", since: startOfDayLocal(2) },
            { key: "5d", label: "5 Days", since: startOfDayLocal(4) },
            { key: "1w", label: "1 Week", since: startOfDayLocal(6) },
            { key: "1m", label: "1 Month", since: startOfMonthLocal(0) },
            { key: "3m", label: "3 Months", since: startOfMonthLocal(2) },
            { key: "6m", label: "6 Months", since: startOfMonthLocal(5) },
            { key: "1y", label: "1 Year", since: new Date(d.getFullYear(), 0, 1).getTime() },
            { key: "all", label: "All Time", since: 0 },
        ];
        return windows.map(w => ({
            key: w.key,
            label: w.label,
            models: (db.prepare(
                `SELECT model_name, COALESCE(SUM(cost_usd), 0) AS cost
                 FROM turns
                 WHERE timestamp >= ? AND cost_usd > 0
                       AND model_name IS NOT NULL AND model_name != ''
                 GROUP BY model_name ORDER BY cost DESC`,
            ).all(w.since) as any[]).map(r => ({ name: String(r.model_name), cost: num(r.cost) })),
        }));
    }

    /** Everything the Timings tab needs for one period window. */
    private collectTimingsWindow(db: any, since: number): TimingsWindow {
        const t = db.prepare(
            `SELECT COUNT(*) AS tasks,
                    COALESCE(SUM(CASE WHEN stop_reason = 'complete' THEN 1 ELSE 0 END), 0) AS completed,
                    COALESCE(SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END), 0) AS errors,
                    COALESCE(SUM(CASE WHEN stop_reason = 'aborted' THEN 1 ELSE 0 END), 0) AS aborted,
                    AVG(CASE WHEN stop_reason = 'complete' THEN task_ms END) AS avg_task,
                    MAX(CASE WHEN stop_reason = 'complete' THEN task_ms END) AS max_task,
                    AVG(CASE WHEN stop_reason = 'complete' THEN turn_count END) AS avg_turns,
                    COALESCE(SUM(CASE WHEN stop_reason = 'complete' THEN task_ms ELSE 0 END), 0) AS total_task_ms
             FROM tasks WHERE timestamp >= ?`,
        ).get(since) as any;

        const longestRow = db.prepare(
            `SELECT model_name FROM tasks
             WHERE timestamp >= ? AND stop_reason = 'complete'
             ORDER BY task_ms DESC LIMIT 1`,
        ).get(since) as any;

        const turns = db.prepare(
            `SELECT COALESCE(SUM(user_prompt), 0) AS user_turns,
                    COUNT(*) AS all_turns,
                    AVG(CASE WHEN user_prompt = 1 THEN thinking_ms END) AS user_think,
                    AVG(CASE WHEN user_prompt = 1 THEN response_ms END) AS user_resp,
                    AVG(CASE WHEN user_prompt = 0 THEN thinking_ms END) AS ai_think,
                    AVG(CASE WHEN user_prompt = 0 THEN response_ms END) AS ai_resp,
                    COALESCE(SUM(thinking_ms), 0) AS total_think,
                    COALESCE(SUM(response_ms), 0) AS total_resp
             FROM turns WHERE timestamp >= ?`,
        ).get(since) as any;

        const taskByModel = (db.prepare(
            `SELECT model_name, COUNT(*) AS tasks, AVG(task_ms) AS avg_task
             FROM tasks
             WHERE timestamp >= ? AND stop_reason = 'complete'
                   AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name ORDER BY avg_task DESC`,
        ).all(since) as any[]).map(r => ({
            modelName: String(r.model_name),
            avgTaskMs: num(r.avg_task),
            tasks: num(r.tasks),
        }));

        const longest = (db.prepare(
            `SELECT timestamp, model_name, thinking_level, turn_count, task_ms
             FROM tasks
             WHERE timestamp >= ? AND stop_reason = 'complete'
             ORDER BY task_ms DESC LIMIT 10`,
        ).all(since) as any[]).map(r => ({
            timestamp: num(r.timestamp),
            modelName: String(r.model_name || ""),
            thinkingLevel: String(r.thinking_level || "(none)"),
            turnCount: num(r.turn_count),
            taskMs: num(r.task_ms),
        }));

        const userTurns = num(turns.user_turns);
        return {
            taskCount: num(t.tasks),
            completed: num(t.completed),
            errors: num(t.errors),
            aborted: num(t.aborted),
            avgTaskMs: num(t.avg_task),
            maxTaskMs: num(t.max_task),
            maxTaskModel: longestRow ? String(longestRow.model_name || "") : "",
            avgTurnsPerTask: num(t.avg_turns),
            totalTaskMs: num(t.total_task_ms),
            userTurns,
            userAvgThinkMs: num(turns.user_think),
            userAvgRespMs: num(turns.user_resp),
            aiTurns: Math.max(0, num(turns.all_turns) - userTurns),
            aiAvgThinkMs: num(turns.ai_think),
            aiAvgRespMs: num(turns.ai_resp),
            totalThinkMs: num(turns.total_think),
            totalRespMs: num(turns.total_resp),
            taskByModel,
            longest,
        };
    }

    /** Zero-filled per-day avg task time for the last SERIES_DAYS local days. */
    private collectTaskDailySeries(db: any, now: number): TaskDayPoint[] {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (SERIES_DAYS - 1));
        const rows = db.prepare(
            `SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day,
                    AVG(task_ms) AS avg_task,
                    COUNT(*) AS tasks
             FROM tasks
             WHERE timestamp >= ? AND stop_reason = 'complete'
             GROUP BY day`,
        ).all(start.getTime()) as any[];
        const byDay = new Map<string, any>(rows.map(r => [String(r.day), r]));
        const out: TaskDayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            const row = byDay.get(key);
            out.push({
                day: key,
                label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`,
                avgTaskMs: num(row?.avg_task),
                tasks: num(row?.tasks),
            });
        }
        return out;
    }

    private collectTotals(db: any, now: number): ReportTotals {
        const row = db.prepare(
            `SELECT COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_prompts,
                    ${BASE_PROMPT_SQL} AS base_prompts,
                    ${SUB_PROMPT_SQL} AS sub_prompts,
                    ${PAID_TURNS_SQL} AS paid_turns,
                    ${PAID_USER_PROMPT_SQL} AS paid_user_prompts,
                    COALESCE(SUM(cost_usd), 0) AS total_cost,
                    COALESCE(SUM(input_tokens), 0) AS total_input,
                    COALESCE(SUM(output_tokens), 0) AS total_output,
                    COALESCE(SUM(cache_read), 0) AS total_cache_read,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    COALESCE(MIN(timestamp), 0) AS first_turn
             FROM turns`,
        ).get() as any;
        const turns = num(row.turns);
        const userPrompts = num(row.user_prompts);
        const paidTurns = num(row.paid_turns);
        const paidUserPrompts = num(row.paid_user_prompts);
        const totalCost = num(row.total_cost);
        const firstTurn = num(row.first_turn);
        const activeDays = num(db.prepare(
            `SELECT COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) AS n FROM turns`,
        ).get().n);
        const calendarDays = firstTurn > 0 ? Math.max(1, Math.ceil((now - firstTurn) / DAY_MS)) : 0;
        // Completed-task unit economics + token burn (v1.21.x).
        const taskRow = db.prepare(
            `SELECT COUNT(*) AS completed, COALESCE(SUM(tu.cost), 0) AS task_cost
             FROM tasks t
             LEFT JOIN (
                 SELECT session_id, prompt_index, SUM(cost_usd) AS cost
                 FROM turns GROUP BY session_id, prompt_index
             ) tu ON tu.session_id = t.session_id AND tu.prompt_index = t.prompt_index
             WHERE t.stop_reason = 'complete'`,
        ).get() as any;
        const completedTasks = num(taskRow.completed);
        const taskCost = num(taskRow.task_cost);
        const burn = (since: number): number => num(db.prepare(
            `SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read), 0) AS burn
             FROM turns WHERE timestamp >= ?`,
        ).get(since).burn);
        const worstBurn = db.prepare(
            `SELECT model_name AS model, COALESCE(SUM(input_tokens + output_tokens + cache_read), 0) AS burn
             FROM turns WHERE model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name ORDER BY burn DESC, model_name ASC LIMIT 1`,
        ).get() as any;
        return {
            totalCost,
            turnCount: turns,
            userPromptCount: userPrompts,
            basePromptCount: num(row.base_prompts),
            subPromptCount: num(row.sub_prompts),
            automatedTurnCount: Math.max(0, turns - userPrompts),
            paidTurnCount: paidTurns,
            paidUserPromptCount: paidUserPrompts,
            totalInputTokens: num(row.total_input),
            totalOutputTokens: num(row.total_output),
            totalCacheRead: num(row.total_cache_read),
            avgCacheRate: num(row.avg_cache_rate),
            avgCostPerTurn: safeDiv(totalCost, paidTurns),
            avgCostPerUserPrompt: safeDiv(totalCost, paidUserPrompts),
            turnsPerUserPrompt: safeDiv(turns, userPrompts),
            activeDays,
            calendarDays,
            avgDailySpend: calendarDays > 0 ? totalCost / calendarDays : 0,
            firstTurnMs: firstTurn,
            completedTasks,
            avgCostPerTask: completedTasks > 0 ? taskCost / completedTasks : null,
            fiveHourBurn: burn(now - FIVE_HOUR_MS),
            sevenDayBurn: burn(now - WEEK_MS),
            worstBurnModel: String(worstBurn?.model || ""),
            worstBurnTokens: num(worstBurn?.burn),
        };
    }

    // -------------------------------------------------------------------
    // Task-cost / context / allowance / error collectors (v1.21.x)
    // -------------------------------------------------------------------

    /** Completed-task cost per model: task cost (turns join) ÷ completed
     *  task count, for the window. Failed tasks never contribute. */
    private taskCostByModel(db: any, since: number, until?: number): Map<string, { tasks: number; cost: number }> {
        const w = windowWhere(since, until, "t.timestamp");
        const rows = db.prepare(
            `SELECT t.model_name AS model,
                    COUNT(*) AS tasks,
                    COALESCE(SUM(tu.cost), 0) AS cost
             FROM tasks t
             LEFT JOIN (
                 SELECT session_id, prompt_index, SUM(cost_usd) AS cost
                 FROM turns GROUP BY session_id, prompt_index
             ) tu ON tu.session_id = t.session_id AND tu.prompt_index = t.prompt_index
             WHERE ${w.where} AND t.stop_reason = 'complete'
                   AND t.model_name IS NOT NULL AND t.model_name != ''
             GROUP BY t.model_name`,
        ).all(...w.params) as any[];
        return new Map(rows.map(r => [String(r.model), { tasks: num(r.tasks), cost: num(r.cost) }]));
    }

    /** Avg context-at-task-end ÷ window per model (0..1) for the model rows. */
    private contextEndPctByModel(db: any, since: number, until?: number): Map<string, number | null> {
        const w = windowWhere(since, until);
        const rows = db.prepare(
            `SELECT model_name AS model, context_window AS win, AVG(context_end_tokens) AS avg_end
             FROM tasks WHERE ${w.where} AND model_name IS NOT NULL AND model_name != ''
                   AND context_window > 0 AND context_end_tokens > 0
             GROUP BY model_name`,
        ).all(...w.params) as any[];
        const m = new Map<string, number | null>();
        for (const r of rows) {
            const win = num(r.win);
            const end = num(r.avg_end);
            m.set(String(r.model), win > 0 && end > 0 ? Math.min(1, end / win) : null);
        }
        return m;
    }

    /** Error count + rate (errors ÷ completed tasks) per model for the window. */
    private errorStatsByModel(db: any, since: number, until?: number): Map<string, { errors: number; rate: number | null }> {
        const w = windowWhere(since, until, "e.timestamp");
        const wT = windowWhere(since, until, "t.timestamp");
        const rows = db.prepare(
            `SELECT e.model_name AS model, COUNT(*) AS errors,
                    (SELECT COUNT(*) FROM tasks t
                     WHERE t.model_name = e.model_name AND t.stop_reason = 'complete' AND ${wT.where}) AS completed
             FROM errors e WHERE ${w.where} AND e.model_name IS NOT NULL AND e.model_name != ''
             GROUP BY e.model_name`,
        ).all(...wT.params, ...w.params) as any[];
        const m = new Map<string, { errors: number; rate: number | null }>();
        for (const r of rows) {
            const completed = num(r.completed);
            const errors = num(r.errors);
            m.set(String(r.model), { errors, rate: completed > 0 ? errors / completed : null });
        }
        return m;
    }

    /** Everything the Errors tab needs for one period window. */
    private collectErrorStats(db: any, since: number): ErrorStats {
        const total = num(db.prepare(`SELECT COUNT(*) AS n FROM errors WHERE timestamp >= ?`).get(since).n);
        const byType = (db.prepare(
            `SELECT error_type AS type, COUNT(*) AS count FROM errors WHERE timestamp >= ? GROUP BY error_type ORDER BY count DESC`,
        ).all(since) as any[]).map(r => ({ type: String(r.type), count: num(r.count) }));
        const byModel = (db.prepare(
            `SELECT model_name AS model, error_type AS type, COUNT(*) AS count, MAX(timestamp) AS last_ts
             FROM errors WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name, error_type ORDER BY count DESC`,
        ).all(since) as any[]).map(r => ({
            modelName: String(r.model),
            errorType: String(r.type),
            count: num(r.count),
            lastTs: num(r.last_ts),
        }));
        const modelRates = (db.prepare(
            `SELECT e.model_name AS model, COUNT(*) AS errors,
                    (SELECT COUNT(*) FROM tasks t
                     WHERE t.model_name = e.model_name AND t.stop_reason = 'complete' AND t.timestamp >= ?) AS completed
             FROM errors e WHERE e.timestamp >= ? AND e.model_name IS NOT NULL AND e.model_name != ''
             GROUP BY e.model_name`,
        ).all(since, since) as any[]).map(r => {
            const completed = num(r.completed);
            const errors = num(r.errors);
            return { modelName: String(r.model), errors, completedTasks: completed, rate: completed > 0 ? errors / completed : null };
        });
        return { total, byType, byModel, modelRates };
    }

    /** Zero-filled per-day error counts for the last SERIES_DAYS local days. */
    private collectErrorDailySeries(db: any, now: number): ErrorDayPoint[] {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (SERIES_DAYS - 1));
        const rows = db.prepare(
            `SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
             FROM errors WHERE timestamp >= ? GROUP BY day`,
        ).all(start.getTime()) as any[];
        const byDay = new Map<string, any>(rows.map(r => [String(r.day), r]));
        const out: ErrorDayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            const row = byDay.get(key);
            out.push({ day: key, label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`, count: num(row?.count) });
        }
        return out;
    }

    /** Tokens burned (input + output + cache-read) per model since a time. */
    private tokenBurnByModel(db: any, since: number): Map<string, number> {
        const rows = db.prepare(
            `SELECT model_name AS model, COALESCE(SUM(input_tokens + output_tokens + cache_read), 0) AS burn
             FROM turns WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name`,
        ).all(since) as any[];
        return new Map(rows.map(r => [String(r.model), num(r.burn)]));
    }

    /** Per model × thinking level context-pressure rows for one period.
     *  Uses the task context columns when present, falls back to
     *  turn-derived values for rows recorded before this feature. */
    private collectContextStats(db: any, since: number, now: number): ContextRow[] {
        const taskRows = db.prepare(
            `SELECT model_name AS model, thinking_level AS lvl,
                    COUNT(*) AS tasks, MAX(context_window) AS win,
                    AVG(CASE WHEN context_start_tokens > 0 THEN context_start_tokens END) AS avg_start,
                    AVG(CASE WHEN context_end_tokens > 0 THEN context_end_tokens END) AS avg_end
             FROM tasks
             WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name, thinking_level`,
        ).all(since) as any[];
        const fbRows = db.prepare(
            `SELECT t.model_name AS model, t.thinking_level AS lvl,
                    AVG(f.start_ctx) AS avg_start, AVG(f.end_ctx) AS avg_end
             FROM tasks t
             LEFT JOIN (
                 SELECT session_id, prompt_index,
                        MIN(cache_read + input_tokens) AS start_ctx,
                        MAX(cache_read + input_tokens + output_tokens) AS end_ctx
                 FROM turns WHERE timestamp >= ?
                 GROUP BY session_id, prompt_index
             ) f ON f.session_id = t.session_id AND f.prompt_index = t.prompt_index
             WHERE t.timestamp >= ? AND t.model_name IS NOT NULL AND t.model_name != ''
             GROUP BY t.model_name, t.thinking_level`,
        ).all(since, since) as any[];
        const fb = new Map(fbRows.map(r => [`${r.model}|${r.lvl || "(none)"}`, r]));
        // Which models actually reported a 5h / weekly allowance window in
        // this period (subscription plans). New rows carry the explicit
        // allowance_reported flag; legacy rows fall back to allow_provider.
        const allowRows = db.prepare(
            `SELECT model_name AS model, MAX(CASE WHEN allowance_reported = 1 OR allow_provider != '' THEN 1 ELSE 0 END) AS reported
             FROM tasks WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name`,
        ).all(since) as any[];
        const allowReported = new Map(allowRows.map(r => [String(r.model), num(r.reported) === 1]));
        const burn5h = this.tokenBurnByModel(db, now - FIVE_HOUR_MS);
        const burn7d = this.tokenBurnByModel(db, now - WEEK_MS);
        return taskRows.map(r => {
            const key = `${r.model}|${r.lvl || "(none)"}`;
            const f = fb.get(key);
            const win = num(r.win);
            const avgStart = r.avg_start != null ? num(r.avg_start) : (f ? num(f.avg_start) : null);
            const avgEnd = r.avg_end != null ? num(r.avg_end) : (f ? num(f.avg_end) : null);
            const avgEndPct = win > 0 && avgEnd != null ? avgEnd / win : null;
            const avgGrowth = avgStart != null && avgEnd != null ? Math.max(0, avgEnd - avgStart) : null;
            const tasksUntilFull = (win > 0 && avgGrowth != null && avgGrowth > 0 && avgEnd != null)
                ? Math.max(0, (win - avgEnd) / avgGrowth)
                : null;
            const fiveHourBurn = burn5h.get(String(r.model)) || 0;
            const reported = allowReported.get(String(r.model)) === true;
            return {
                modelName: String(r.model),
                thinkingLevel: String(r.lvl || "(none)"),
                tasks: num(r.tasks),
                contextWindow: win,
                avgStartTokens: avgStart != null ? Math.round(avgStart) : null,
                avgEndTokens: avgEnd != null ? Math.round(avgEnd) : null,
                avgEndPct,
                avgGrowth: avgGrowth != null ? Math.round(avgGrowth) : null,
                tasksUntilFull,
                allowanceReported: reported,
                fiveHourBurn,
                weeklyBurn: burn7d.get(String(r.model)) || 0,
                fiveHourWindows: win > 0 ? fiveHourBurn / win : null,
                millionFlag: reported && fiveHourBurn >= MILLION,
            };
        });
    }

    /** Per-provider allowance consumption rows for one period window. */
    private collectAllowanceStats(db: any, since: number): AllowanceRow[] {
        const rows = db.prepare(
            `SELECT allow_provider AS provider, COUNT(*) AS tasks,
                    AVG(CASE WHEN allow_5h_start IS NOT NULL AND allow_5h_end IS NOT NULL
                             AND allow_5h_end >= allow_5h_start THEN allow_5h_end - allow_5h_start END) AS avg5h,
                    AVG(CASE WHEN allow_weekly_start IS NOT NULL AND allow_weekly_end IS NOT NULL
                             AND allow_weekly_end >= allow_weekly_start THEN allow_weekly_end - allow_weekly_start END) AS avg_weekly,
                    AVG(allow_5h_end) AS avg5h_end,
                    AVG(allow_weekly_end) AS avg_weekly_end,
                    COALESCE(SUM(CASE WHEN allow_5h_end IS NOT NULL AND allow_5h_start IS NOT NULL
                                 AND allow_5h_end < allow_5h_start THEN 1 ELSE 0 END), 0) AS five_resets
             FROM tasks
             WHERE timestamp >= ? AND allow_provider != ''
             GROUP BY allow_provider`,
        ).all(since) as any[];
        return rows.map(r => {
            const avg5h = r.avg5h != null ? num(r.avg5h) : null;
            const avgWeekly = r.avg_weekly != null ? num(r.avg_weekly) : null;
            const avg5hEnd = r.avg5h_end != null ? num(r.avg5h_end) : null;
            const avgWeeklyEnd = r.avg_weekly_end != null ? num(r.avg_weekly_end) : null;
            return {
                provider: String(r.provider),
                tasks: num(r.tasks),
                avg5hPerTask: avg5h,
                avgWeeklyPerTask: avgWeekly,
                avg5hEnd,
                avgWeeklyEnd,
                fiveHourResets: num(r.five_resets),
                tasksUntil5hFull: avg5h != null && avg5h > 0 && avg5hEnd != null ? Math.max(0, (100 - avg5hEnd) / avg5h) : null,
                tasksUntilWeeklyFull: avgWeekly != null && avgWeekly > 0 && avgWeeklyEnd != null ? Math.max(0, (100 - avgWeeklyEnd) / avgWeekly) : null,
            };
        });
    }

    /** Latest allowance snapshot across all tasks (for the context cards). */
    private latestAllowance(db: any): AllowanceLatest | null {
        const r = db.prepare(
            `SELECT allow_provider AS provider, allow_5h_end AS five, allow_weekly_end AS weekly, timestamp AS at
             FROM tasks WHERE allow_5h_end IS NOT NULL OR allow_weekly_end IS NOT NULL
             ORDER BY timestamp DESC LIMIT 1`,
        ).get() as any;
        if (!r) return null;
        return {
            provider: String(r.provider || ""),
            fiveHourUsed: r.five != null ? num(r.five) : null,
            weeklyUsed: r.weekly != null ? num(r.weekly) : null,
            at: num(r.at),
        };
    }

    /**
     * Cost projections — based on YOUR usage rate and average unit costs.
     *
     * Per model: costPerTurn = cost ÷ turns, costPerTask = completed-task
     * cost ÷ completed tasks, tasksPerDay = completed tasks ÷ active days.
     * Projections = tasksPerDay × costPerTask × N days (the unit economics
     * of what one task actually costs, scaled by how many tasks you run per
     * day). Rows with fewer than ESTIMATE_MIN_ACTIVE_DAYS active days are
     * flagged as estimates. Zero-cost models are excluded — a $0 model has
     * nothing to project.
     *
     * Overall: the same math over all paid-cost models; spendPerDay (all
     * spend ÷ calendar days) is kept as the reference burn rate that
     * includes idle days. Flagged as an estimate below
     * ESTIMATE_MIN_CALENDAR_DAYS calendar days.
     */
    private computeProjections(db: any, totals: ReportTotals, since: number): ProjectionSummary {
        const turnsRows = db.prepare(
            `SELECT model_name AS model,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) AS active_days
             FROM turns
             WHERE model_name IS NOT NULL AND model_name != ''
             ${since > 0 ? "AND timestamp >= ?" : ""}
             GROUP BY model_name
             ORDER BY cost DESC`,
        ).all(...(since > 0 ? [since] : [])) as any[];
        const taskCost = this.taskCostByModel(db, since);

        const projRows: ProjectionRow[] = turnsRows.map(r => {
            const cost = num(r.cost);
            const turns = num(r.turns);
            const userPrompts = num(r.user_count);
            const activeDays = Math.max(1, num(r.active_days));
            const tc = taskCost.get(String(r.model));
            const completedTasks = tc?.tasks || 0;
            const costPerTask = tc && tc.tasks > 0 ? tc.cost / tc.tasks : null;
            const costPerTurn = turns > 0 ? cost / turns : 0;
            const tasksPerDay = completedTasks / activeDays;
            const turnsPerDay = turns / activeDays;
            const spendPerDay = cost / activeDays;
            const proj = (d: number): number | null => (costPerTask != null ? tasksPerDay * costPerTask * d : null);
            return {
                modelName: String(r.model),
                activeDays,
                turns,
                userPrompts,
                completedTasks,
                cost,
                costPerTurn,
                costPerTask,
                spendPerDay,
                tasksPerDay,
                turnsPerDay,
                projected7d: proj(7),
                projected30d: proj(30),
                projected90d: proj(90),
                projected365d: proj(365),
                estimated: activeDays < ESTIMATE_MIN_ACTIVE_DAYS,
            };
        }).filter(r => r.cost > 0);

        const totalCost = projRows.reduce((s, r) => s + r.cost, 0);
        const completedTasks = projRows.reduce((s, r) => s + r.completedTasks, 0);
        const totalTurns = projRows.reduce((s, r) => s + r.turns, 0);
        const avgCostPerTurn = totalTurns > 0 ? totalCost / totalTurns : 0;
        const avgCostPerTask = completedTasks > 0 ? totalCost / completedTasks : null;
        const activeDays = totals.activeDays > 0 ? totals.activeDays : 1;
        const tasksPerDay = completedTasks / activeDays;
        const days = Math.max(1, totals.calendarDays);
        const spendPerDay = totalCost / days;
        const proj = (d: number): number | null => (avgCostPerTask != null ? tasksPerDay * avgCostPerTask * d : null);
        const noData = totals.turnCount === 0;
        const enough = totals.calendarDays >= ESTIMATE_MIN_CALENDAR_DAYS;
        return {
            rows: projRows,
            totalCost,
            avgCostPerTurn,
            avgCostPerTask,
            completedTasks,
            activeDays: totals.activeDays,
            calendarDays: totals.calendarDays,
            tasksPerDay,
            spendPerDay,
            projected7d: proj(7),
            projected30d: proj(30),
            projected90d: proj(90),
            projected365d: proj(365),
            estimated: !noData && !enough,
            note: noData
                ? "No usage recorded yet — projections will appear after some activity."
                : enough
                    ? `Based on your pace: ${completedTasks} completed tasks across ${activeDays} active days (${tasksPerDay.toFixed(1)} tasks/day) at an average $${avgCostPerTask != null ? avgCostPerTask.toFixed(4) : "n/a"} per completed task. Idle days are not counted in the pace.`
                    : `Only ${days} day${days === 1 ? "" : "s"} of history so far — projections become more accurate over time.`,
        };
    }

    // -------------------------------------------------------------------
    // Master data collector
    // -------------------------------------------------------------------

    private collectReportData(): any | null {
        const db = getDb();
        if (!db) return null;

        const now = Date.now();
        const dailySince = now - DAY_MS;
        const weeklySince = now - 7 * DAY_MS;
        const monthlySince = now - 28 * DAY_MS;

        const dailyModels = this.collectWindowedModels(db, dailySince);
        const weeklyModels = this.collectWindowedModels(db, weeklySince);
        const monthlyModels = this.collectWindowedModels(db, monthlySince);
        const allModels = this.collectWindowedModels(db, 0);

        const totals = this.collectTotals(db, now);

        // Overview "Period summary": 6 panes in a 2x3 grid — one rolling
        // (24h) and five calendar periods. Calendar periods anchor to local
        // midnight / Monday / 1st of month (footer timeframe semantics);
        // lastWeek/lastMonth are bounded so this week/this month never
        // leaks into them.
        const d = new Date(now);
        const startOfDayLocal = (daysBack: number): number =>
            new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
        const startOfWeekLocal = (weeksBack: number): number => {
            const daysSinceMonday = (d.getDay() + 6) % 7;   // Mon=0
            const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday);
            return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - weeksBack * 7).getTime();
        };
        const startOfMonthLocal = (monthsBack: number): number =>
            new Date(d.getFullYear(), d.getMonth() - monthsBack, 1).getTime();
        const periodDefs: Array<{ key: string; label: string; since: number; until?: number }> = [
            { key: "24h", label: "Last 24 hours (rolling window)", since: now - DAY_MS },
            { key: "3d", label: "Last 3 days", since: startOfDayLocal(2) },
            { key: "lastWeek", label: "Last Week (Mon to Sun)", since: startOfWeekLocal(1), until: startOfWeekLocal(0) },
            { key: "thisWeek", label: "This Week (Mon to Sun)", since: startOfWeekLocal(0) },
            { key: "thisMonth", label: "This Month", since: startOfMonthLocal(0) },
            { key: "lastMonth", label: "Last Month", since: startOfMonthLocal(1), until: startOfMonthLocal(0) },
        ];
        const periods: Record<string, PeriodSummary> = {};
        for (const p of periodDefs) {
            periods[p.key] = this.summarizePeriod(this.collectWindowedModels(db, p.since, p.until), p.label);
        }

        // v1.21.x: context / allowance / error / projection stats are
        // collected per period so every tab shares the same period selectors.
        const ctxBy = (since: number) => this.collectContextStats(db, since, now);
        const allowBy = (since: number) => this.collectAllowanceStats(db, since);
        const errBy = (since: number) => this.collectErrorStats(db, since);
        const projBy = (since: number) => this.computeProjections(db, totals, since);

        return {
            generatedAt: now,
            totals,
            periods,
            dailySeries: this.collectDailySeries(db, now),
            shareWindows: this.collectShareWindows(db, now),
            modelsByPeriod: {
                daily: dailyModels,
                weekly: weeklyModels,
                monthly: monthlyModels,
                all: allModels,
            },
            modelThinkingByPeriod: {
                daily: this.collectWindowedModelThinking(db, dailySince),
                weekly: this.collectWindowedModelThinking(db, weeklySince),
                monthly: this.collectWindowedModelThinking(db, monthlySince),
                all: this.collectWindowedModelThinking(db, 0),
            },
            timings: {
                daily: this.collectTimingsWindow(db, dailySince),
                weekly: this.collectTimingsWindow(db, weeklySince),
                monthly: this.collectTimingsWindow(db, monthlySince),
                all: this.collectTimingsWindow(db, 0),
            },
            taskDailySeries: this.collectTaskDailySeries(db, now),
            contextStats: {
                daily: ctxBy(dailySince),
                weekly: ctxBy(weeklySince),
                monthly: ctxBy(monthlySince),
                all: ctxBy(0),
            },
            allowanceStats: {
                daily: allowBy(dailySince),
                weekly: allowBy(weeklySince),
                monthly: allowBy(monthlySince),
                all: allowBy(0),
            },
            allowanceLatest: this.latestAllowance(db),
            errorStats: {
                daily: errBy(dailySince),
                weekly: errBy(weeklySince),
                monthly: errBy(monthlySince),
                all: errBy(0),
            },
            errorDailySeries: this.collectErrorDailySeries(db, now),
            projections: {
                daily: projBy(dailySince),
                weekly: projBy(weeklySince),
                monthly: projBy(monthlySince),
                all: projBy(0),
            },
        };
    }

    // -------------------------------------------------------------------
    // Clearing
    // -------------------------------------------------------------------

    private countRows(table: string): number {
        const db = getDb();
        if (!db) return 0;
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        return row.n;
    }

    /** Deletes ALL tables (turns + tasks + errors) in one transaction. */
    private clearUsage(): { turns: number; tasks: number; errors: number } {
        const db = getDb();
        if (!db) return { turns: 0, tasks: 0, errors: 0 };
        const tx = db.transaction(() => {
            const turns = db.prepare(`DELETE FROM turns`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'turns'`).run();
            const tasks = db.prepare(`DELETE FROM tasks`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'tasks'`).run();
            const errors = db.prepare(`DELETE FROM errors`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'errors'`).run();
            return { turns, tasks, errors };
        });
        return tx();
    }

    private async runClear(ctx: ExtensionCommandContext): Promise<void> {
        const db = getDb();
        if (!db) {
            aftcConsole.error(ctx, "Cannot clear usage data: better-sqlite3 is not available. Run /aftc-install.");
            return;
        }
        const turns = this.countRows("turns");
        const tasks = this.countRows("tasks");
        const errors = this.countRows("errors");
        if (turns === 0 && tasks === 0 && errors === 0) {
            aftcConsole.emphasis(ctx, "Usage database is already empty — nothing to clear.");
            return;
        }
        if (ctx.hasUI) {
            const ok = await showConfirm(ctx, { title: "Clear usage database", body: `Permanently delete all ${turns} recorded turn${turns === 1 ? "" : "s"}, ${tasks} task record${tasks === 1 ? "" : "s"} and ${errors} error record${errors === 1 ? "" : "s"} from the SQLite database?\n\nThis cannot be undone.` });
            if (!ok) return;
        }
        try {
            const deleted = this.clearUsage();
            aftcConsole.emphasis(ctx, `Cleared usage database — deleted ${deleted.turns} turn${deleted.turns === 1 ? "" : "s"}, ${deleted.tasks} task record${deleted.tasks === 1 ? "" : "s"} and ${deleted.errors} error record${deleted.errors === 1 ? "" : "s"}.`);
        } catch (err) {
            aftcConsole.error(ctx, `Failed to clear usage database: ${(err as Error).message}`);
        }
    }

    private registerCommands(): void {
        registerHelpEntry({
            command: "usage-report",
            description: "Open the usage report (local server)",
            category: "Usage report",
        });

        this.pi.registerCommand("usage-report", {
            description: "Generate the usage report data, seed the report app into your data folder and start its local server (opens in your browser)",
            handler: async (_a: string, ctx: ExtensionCommandContext) => this.runReport(ctx),
        });
        registerHelpEntry({
            command: "usage-clear",
            description: "Delete all recorded usage rows",
            category: "Usage report",
        });

        this.pi.registerCommand("usage-clear", {
            description: "Permanently clear all recorded turns from the SQLite database (asks for confirmation)",
            handler: async (_a: string, ctx: ExtensionCommandContext) => this.runClear(ctx),
        });
    }

    // -------------------------------------------------------------------
    // Report app — seed, data.json and the local server
    //
    // The report UI ships as a small website (seed: data/usage-report/).
    // /usage-report copies the seed into the live data dir (version
    // stamped, refreshed when the shipped version bumps), writes a fresh
    // data.json from the DB, and starts the bundled zero-dependency
    // server (server.js) in its own terminal window — the server opens
    // the browser, shows its info, and self-terminates on idle/close.
    // -------------------------------------------------------------------

    /** Shipped report app (pristine seed, never edited). */
    private reportSeedDir(): string {
        return path.join(getPackageRoot(), "extensions", "aftc-toolset", "data", "usage-report");
    }

    /** Live report app: <dataDir>/usage-report. */
    private reportLiveDir(): string {
        return path.join(getDataDir(), "usage-report");
    }

    /** Shipped report-app version (data/extension-config.json). */
    private shippedReportVersion(): number {
        try {
            const file = path.join(getPackageRoot(), "extensions", "aftc-toolset", "data", "extension-config.json");
            const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { usageReportVersion?: unknown };
            return typeof parsed.usageReportVersion === "number" ? parsed.usageReportVersion : 0;
        } catch {
            return 0;
        }
    }

    private liveReportVersion(): number {
        try {
            const raw = fs.readFileSync(path.join(this.reportLiveDir(), ".usage-report-version"), "utf8").trim();
            const n = Number(raw);
            return Number.isFinite(n) ? n : 0;
        } catch {
            return 0;
        }
    }

    /** Recursive copy of the seed into the live dir (overwrites the
     *  app files — they are program files, not user data; data.json is
     *  skipped and regenerated by the caller). */
    private copyDir(src: string, dest: string): void {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            if (entry.name === "data.json") continue; // regenerated fresh
            const s = path.join(src, entry.name);
            const d = path.join(dest, entry.name);
            if (entry.isDirectory()) this.copyDir(s, d);
            else fs.copyFileSync(s, d);
        }
    }

    /** Seed -> live when missing or when the shipped version is newer. */
    private ensureReportFiles(): void {
        const live = this.reportLiveDir();
        const shipped = this.shippedReportVersion();
        if (fs.existsSync(live) && this.liveReportVersion() >= shipped && shipped > 0) return;
        this.copyDir(this.reportSeedDir(), live);
        fs.writeFileSync(path.join(live, ".usage-report-version"), String(shipped), "utf8");
    }

    /** Test seam: run the seed->live sync directly (tests point
     *  AFTC_TOOLSET_DATA_ROOT at a scratch dir). */
    syncUsageReportFiles(): void { this.ensureReportFiles(); }

    /** Write the fresh report payload the app fetches. */
    private writeReportJson(data: any): string {
        const live = this.reportLiveDir();
        fs.mkdirSync(live, { recursive: true });
        const filePath = path.join(live, "data.json");
        fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
        return filePath;
    }

    /** Start the bundled server in its own terminal window (win32) or
     *  detached (elsewhere). The server opens the browser itself. */
    private spawnReportServer(): void {
        const live = this.reportLiveDir();
        let child: import("node:child_process").ChildProcess;
        if (process.platform === "win32") {
            child = spawn("cmd.exe",
                ["/c", "start", "pi usage report", "/D", live, "start.bat"],
                { detached: true, stdio: "ignore" });
        } else {
            child = spawn("node", ["server.js"],
                { cwd: live, detached: true, stdio: "ignore" });
        }
        child.unref();
    }

    private async runReport(ctx: ExtensionCommandContext): Promise<void> {
        const data = this.collectReportData();
        if (!data) { aftcConsole.error(ctx, "Cannot generate the usage report: better-sqlite3 is not available. Run /aftc-install."); return; }
        try {
            this.ensureReportFiles();
            this.writeReportJson(data);
            this.spawnReportServer();
        } catch (err) {
            aftcConsole.error(ctx, `Failed to start the usage report: ${(err as Error).message}`);
            return;
        }
        aftcConsole.emphasis(ctx, "Usage report server starting — your browser will open.");
        aftcConsole.info(ctx, `Report app: ${this.reportLiveDir()} — close the server window to stop it (auto-stops after 30 minutes idle).`);
    }
}

export function createUsageModule(pi: ExtensionAPI): UsageModule {
    const m = new UsageModule(pi);
    m.attach();
    return m;
}

export { isDbAvailable, fmtMoneyServer };
