/**
 * pi-aftc-toolset — usage-report feature module.
 *
 * Reads the usage data from the local SQLite turns.db (see db.ts) and
 * serves an interactive HTML report from a small local web server.
 *
 * The report UI ships as a seed website (data/usage-report/: index.html,
 * styles.css, ES-module JS per tab, a bundled Chart.js build, favicon).
 * /usage-report collects the data, writes a fresh data.json, and starts
 * the bundled zero-dependency server (server.js) in its own terminal
 * window — the server opens the browser, prints its info, and
 * self-terminates when the window closes or after 30 minutes idle. No
 * internet is needed: Chart.js ships locally. The report is organised
 * into seven tabs:
 *
 *   Overview      — headline stat cards (total cost, cost per completed
 *                   task, prompts, user/AI ratio, worst token burner,
 *                   cache hit), a daily-spend bar chart (last 30 days), a
 *                   cost-share doughnut with a window selector, and six
 *                   period summary cards with Best / Worst AI model rows.
 *   Models        — the hero / shame ranking: per-model sortable table
 *                   with a period selector (cost, $/turn, $/task,
 *                   prompts, AI/user ratio, cache, context use, errors,
 *                   task time) and verdict badges.
 *   Thinking      — per-model × thinking-level sortable table.
 *   Timings       — Task Time analysis from the tasks table: headline
 *                   cards, task-time-by-model and daily avg task-time
 *                   charts, think / respond split, user- vs AI-turn
 *                   timings, top-10 longest completed tasks.
 *   Projections   — usage-rate cost projections from YOUR pace.
 *   Context & Allowance — context-window pressure per model × thinking
 *                   plus provider-reported 5h / weekly allowance
 *                   consumption, 5h/weekly used-up counts.
 *   Errors        — provider reliability: failed calls per provider ×
 *                   error type (with HTTP codes and affected models) and
 *                   a per-provider error rate. User aborts are NOT
 *                   errors — they are a stat on Timings.
 *
 * MODEL IDENTITY: (model_name, provider, thinking_level). The same model
 * at a different provider OR thinking level is a SEPARATE row everywhere
 * — each costs and behaves differently. Every per-model average is
 * computed per (model, provider, level); overall totals remain a true sum.
 *
 * AGGREGATION: ALL collectors run in JS over an in-memory dataset
 * ({ turns, tasks, errors } rows) read from the local SQLite turns.db
 * with SELECT * — the same aggregation engine feeds every tab.
 *
 * Per AGENTS.md, this is a self-contained feature module: it owns
 * no shared state with other feature modules and is wired into pi by
 * the orchestrator in index.ts.
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

/** One row of turns / tasks / errors (snake_case column keys). */
type UsageRow = {
    [column: string]: unknown;
};

/** The full dataset the report aggregates: all turns, tasks and errors. */
type UsageDataset = {
    turns: UsageRow[];
    tasks: UsageRow[];
    errors: UsageRow[];
    toolErrors: UsageRow[];
};

/** Local dataset snapshot: all rows from the three tables (fresh read —
 *  never cached; the report is generated on demand). Returns null when
 *  better-sqlite3 is unavailable. */
function fetchUsageDataset(): UsageDataset | null {
    const db = getDb();
    if (!db) return null;
    const rows = (table: string): UsageRow[] => db.prepare(`SELECT * FROM ${table}`).all() as UsageRow[];
    return { turns: rows("turns"), tasks: rows("tasks"), errors: rows("errors"), toolErrors: rows("tool_errors") };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TablePeriod = "daily" | "weekly" | "monthly" | "all";

type ModelRow = {
    modelName: string;
    /** Provider id (deepseek, qwencloud, kimi-coding, ...) — distinguishes
     *  same-named models across providers; '' when unknown/legacy. */
    provider: string;
    /** Thinking level of this row ('' / "(none)" = not recorded) — the same
     *  model at a different thinking level is a separate row. */
    thinkingLevel: string;
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

type ModelThinkingRow = ModelRow;

type ScoreboardEntry = { label: string; model: string; value: string; /** Provider id of the model ('' = unknown) — shown under the name. */ provider?: string; /** Thinking level ('' = unknown) — shown with the provider. */ level?: string; /** When set, the row renders N/A with this tooltip reason. */ na?: string; /** When set, an info-icon tooltip explains the metric (hover). */ hint?: string };

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
    mostCostlyModel: string; mostCostlyProvider: string; mostCostlyLevel: string; mostCostlyCost: number;
    cheapestModel: string; cheapestProvider: string; cheapestLevel: string; cheapestCost: number;
    longestTaskModel: string; longestTaskProvider: string; longestTaskLevel: string; longestTaskMs: number; };

type TaskModelPoint = { modelName: string; provider: string; thinkingLevel: string; avgTaskMs: number; tasks: number };

type LongestTask = { timestamp: number; modelName: string; provider: string; thinkingLevel: string; turnCount: number; taskMs: number };

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
    /** Provider id of the longest-task model ('' = unknown). */
    maxTaskProvider: string;
    /** Thinking level of the longest-task model ('' = unknown). */
    maxTaskLevel: string;
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
    /** Provider id of the model ('' = unknown). */
    provider: string;
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
    /** Tasks that ENDED with the 5-hour allowance at ~100% — the quota was
     *  used up, so the provider refused further requests until it reset. */
    fiveHourExhausted: number;
    /** Tasks that ended with the weekly allowance at ~100%. */
    weeklyExhausted: number;
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

type ErrorProviderRow = { provider: string; errorType: string; count: number; lastTs: number; /** Distinct HTTP status codes seen ("" = none). */ codes: string; /** Distinct model names affected (comma-joined). */ models: string };

type ProviderRate = { provider: string; errors: number; completedTasks: number; rate: number | null };

type ErrorModelRow = { model: string; provider: string; count: number };

type ErrorStats = {
    total: number;
    byType: ErrorTypeCount[];
    /** Per provider × error type: count, last seen, the HTTP codes seen and
     *  the distinct model names affected — a provider outage hits every
     *  model on it. */
    byProvider: ErrorProviderRow[];
    /** Per-provider reliability: provider errors ÷ provider completed
     *  tasks. Errors are PROVIDER issues (outages, rate limits, network) —
     *  they hit every model on the provider, so the fair comparison is
     *  per provider, never per model. */
    providerRates: ProviderRate[];
    /** Per model × provider: failed-call count, for the "failed calls by
     *  model" chart. Thinking levels are MERGED — a failed call is a
     *  provider issue, the level does not matter here. Counts only -
     *  reliability stays a per-provider rate (an outage hits every model
     *  on a provider). */
    byModel: ErrorModelRow[];
};

type ErrorDayPoint = { day: string; label: string; count: number };

type ToolErrorToolRow = {
    tool: string;
    errorKind: string;
    count: number;
    /** Highest repeat count of one normalised signature within this bucket. */
    repeat: number;
    lastTs: number;
    /** Distinct model names affected (comma-joined). */
    models: string;
    /** Representative (most common) error message — sanitized: first line
     *  only, no URLs, no file paths, capped at 100 chars. User project
     *  content (code, paths, URLs) must never reach the report. */
    example: string;
};

type ToolErrorStats = {
    total: number;
    distinctTools: number;
    byTool: ToolErrorToolRow[];
    byToolChart: { tool: string; count: number }[];
    byKind: { kind: string; count: number }[];
    /** The single most-repeated exact mistake (repeat > 1). */
    topRepeat: { tool: string; errorKind: string; example: string; repeat: number } | null;
};

type ProjectionRow = {
    modelName: string;
    /** Provider id of the model ('' = unknown). */
    provider: string;
    /** Thinking level of this row ('' = unknown). */
    thinkingLevel: string;
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
    worstBurnProvider: string;
    worstBurnLevel: string;
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

/** Model identity: model + provider + thinking level (same-named models
 *  from different providers, or the same model at different thinking
 *  levels, are separate rows — each costs and behaves differently). */
function modelKey(model: string, provider: string, level?: string): string {
    return model + "|" + (provider || "") + "|" + (level || "(none)");
}

// --- dataset row helpers (snake_case columns, matching the SQLite schema
// and the live mirror's pull rows; missing columns default safely) ---
function str(v: unknown): string { const x = String(v ?? ""); return x === "null" ? "" : x; }
function lvlOf(r: UsageRow): string { const l = str(r.thinking_level); return l === "" ? "(none)" : l; }
function provOf(r: UsageRow): string { return str(r.provider); }
/** Example text for the tool-error table. PRIVACY: never leaks user
 *  project content — URLs and file paths become placeholders, only the
 *  first line is kept (multi-line dumps are data, not an error summary),
 *  whitespace is collapsed and the result is capped at 100 chars so the
 *  column word-wraps instead of forcing horizontal scroll. */
function sanitizeToolErrorExample(raw: string): string {
    let s = str(raw);
    if (!s) return "";
    // First line only.
    s = s.split(/\r?\n/)[0];
    // URLs -> [url] (scheme://... and bare www....).
    s = s.replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g, "[url]");
    s = s.replace(/\bwww\.\S+/g, "[url]");
    // Windows drive paths (C:\... or C:/...) and UNC (\\...) -> [path].
    s = s.replace(/\b[A-Za-z]:[\\/]\S+/g, "[path]");
    s = s.replace(/\\\\\S+/g, "[path]");
    // Single-backslash continuation segments left after a space
    // ("S:\\Sorting Scripts\\src\\x.py" -> "[path] Scripts\\src\\x.py") -> [path].
    s = s.replace(/\\\S+/g, "[path]");
    // Unix absolute paths with at least one further segment -> [path].
    s = s.replace(/(?<![\w.])\/(?:[\w.-]+\/)+[\w.-]+/g, "[path]");
    // Space-containing Windows paths split into "[path] Word[path]" by the
    // passes above — merge the fragments back into one placeholder.
    let prev: string;
    do {
        prev = s;
        s = s.replace(/\[path\] [\w.#()@-]+\[path\]/g, "[path]");
        s = s.replace(/[\w.#()@-]+\[path\]/g, "[path]");
    } while (s !== prev);
    // Collapse leftover whitespace runs.
    s = s.replace(/\s+/g, " ").trim();
    // Cap at 100 visible chars.
    if (s.length > 100) s = s.slice(0, 97).trimEnd() + "...";
    return s;
}
function inWin(ts: number, since: number, until?: number): boolean {
    return ts >= since && (!until || until <= since || ts < until);
}
/** Local-day key (YYYY-MM-DD) for a ms timestamp — mirrors SQLite's
 *  date(timestamp / 1000, 'unixepoch', 'localtime'). */
function dayKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** AVG of per-turn cache rates, skipping zero denominators — mirrors the
 *  SQL `AVG(cache_read / NULLIF(cache_read + input_tokens, 0))`. */
function avgCacheRateOf(turns: UsageRow[]): number {
    let sum = 0, n = 0;
    for (const t of turns) {
        const den = num(t.cache_read) + num(t.input_tokens);
        if (den > 0) { sum += num(t.cache_read) / den; n++; }
    }
    return n > 0 ? sum / n : 0;
}

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
// UsageModule
// ---------------------------------------------------------------------------

class UsageModule {
    constructor(private pi: ExtensionAPI) {}

    attach(): void { this.registerCommands(); }

    // -------------------------------------------------------------------
    // Collectors — ALL run in JS over the in-memory dataset so local
    // (SQLite) and live (MySQL mirror) modes produce identical results.
    // -------------------------------------------------------------------

    /** Per-model stats for one (model, provider, level) in a window. */
    private windowStatsForModel(ds: UsageDataset, modelName: string, providerId: string, level: string, since: number, until?: number): ModelRow {
        const turns = ds.turns.filter(t =>
            str(t.model_name) === modelName && provOf(t) === providerId && lvlOf(t) === level
            && inWin(num(t.timestamp), since, until));
        let cost = 0, userPrompts = 0, paidUserPrompts = 0, thinkSum = 0, respSum = 0;
        for (const t of turns) {
            const c = num(t.cost_usd);
            cost += c;
            if (num(t.user_prompt) > 0) userPrompts++;
            if (c > 0 && num(t.user_prompt) > 0) paidUserPrompts++;
            thinkSum += num(t.thinking_ms);
            respSum += num(t.response_ms);
        }
        const turnsN = turns.length;
        return {
            modelName,
            provider: providerId,
            thinkingLevel: level,
            cost,
            turns: turnsN,
            userPrompts,
            aiPrompts: Math.max(0, turnsN - userPrompts),
            aiPerUserPrompt: safeDiv(turnsN - userPrompts, userPrompts),
            avgCostPerUserPrompt: safeDiv(cost, paidUserPrompts),
            costPerTurn: safeDiv(cost, turnsN),
            avgCacheRate: avgCacheRateOf(turns),
            avgThinkingMs: turnsN > 0 ? thinkSum / turnsN : 0,
            avgResponseMs: turnsN > 0 ? respSum / turnsN : 0,
            avgTaskMs: 0,
            costPerTask: 0,
            completedTasks: 0,
            errorCount: 0,
            errorRate: null,
            contextEndPct: null,
        };
    }

    /** Per-model rows for a time window. Models with no turns in the window are omitted. */
    private collectWindowedModels(ds: UsageDataset, since: number, until?: number): ModelRow[] {
        const keys = new Map<string, { model: string; provider: string; level: string }>();
        for (const t of ds.turns) {
            if (!inWin(num(t.timestamp), since, until)) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const p = provOf(t), l = lvlOf(t);
            keys.set(modelKey(m, p, l), { model: m, provider: p, level: l });
        }
        const taskTimes = this.taskTimeByModel(ds, since, until);
        const taskCost = this.taskCostByModel(ds, since, until);
        const ctxEnd = this.contextEndPctByModel(ds, since, until);
        const errStats = this.errorStatsByModel(ds, since, until);
        return Array.from(keys.values())
            .map(k => this.windowStatsForModel(ds, k.model, k.provider, k.level, since, until))
            .filter(r => r.turns > 0)
            .map(r => {
                const k = modelKey(r.modelName, r.provider, r.thinkingLevel);
                const tc = taskCost.get(k);
                const es = errStats.get(k);
                return {
                    ...r,
                    avgTaskMs: taskTimes.get(k) || 0,
                    costPerTask: tc && tc.tasks > 0 ? tc.cost / tc.tasks : 0,
                    completedTasks: tc?.tasks || 0,
                    errorCount: es?.errors || 0,
                    errorRate: es?.rate ?? null,
                    contextEndPct: ctxEnd.get(k) ?? null,
                };
            });
    }

    /** Per-model × thinking-level rows for a time window. */
    private collectWindowedModelThinking(ds: UsageDataset, since: number): ModelThinkingRow[] {
        const groups = new Map<string, { model: string; provider: string; level: string; turns: UsageRow[] }>();
        for (const t of ds.turns) {
            if (since > 0 && num(t.timestamp) < since) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const p = provOf(t), l = lvlOf(t);
            const k = modelKey(m, p, l);
            if (!groups.has(k)) groups.set(k, { model: m, provider: p, level: l, turns: [] });
            groups.get(k)!.turns.push(t);
        }
        const taskTimes = this.taskTimeByModelThinking(ds, since);
        const taskCost = this.taskCostByModel(ds, since);
        const ctxEnd = this.contextEndPctByModel(ds, since);
        return Array.from(groups.values()).map(g => {
            const turns = g.turns;
            let cost = 0, userPrompts = 0, paidUserPrompts = 0, thinkSum = 0, respSum = 0;
            for (const t of turns) {
                const c = num(t.cost_usd);
                cost += c;
                if (num(t.user_prompt) > 0) userPrompts++;
                if (c > 0 && num(t.user_prompt) > 0) paidUserPrompts++;
                thinkSum += num(t.thinking_ms);
                respSum += num(t.response_ms);
            }
            const turnsN = turns.length;
            const k = modelKey(g.model, g.provider, g.level);
            const tc = taskCost.get(k);
            return {
                modelName: g.model,
                provider: g.provider,
                thinkingLevel: g.level,
                cost,
                turns: turnsN,
                userPrompts,
                aiPrompts: Math.max(0, turnsN - userPrompts),
                aiPerUserPrompt: safeDiv(turnsN - userPrompts, userPrompts),
                avgCostPerUserPrompt: safeDiv(cost, paidUserPrompts),
                costPerTurn: safeDiv(cost, turnsN),
                avgCacheRate: avgCacheRateOf(turns),
                avgThinkingMs: turnsN > 0 ? thinkSum / turnsN : 0,
                avgResponseMs: turnsN > 0 ? respSum / turnsN : 0,
                avgTaskMs: taskTimes.get(k) || 0,
                costPerTask: tc && tc.tasks > 0 ? tc.cost / tc.tasks : 0,
                completedTasks: tc?.tasks || 0,
                errorCount: 0,
                errorRate: null,
                contextEndPct: ctxEnd.get(k) ?? null,
            };
        }).sort((a, b) => b.cost - a.cost);
    }

    /** Zero-filled per-day cost/calls/prompts for the last SERIES_DAYS local days. */
    private collectDailySeries(ds: UsageDataset, now: number): DayPoint[] {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (SERIES_DAYS - 1));
        const startMs = start.getTime();
        const byDay = new Map<string, { cost: number; calls: number; prompts: number }>();
        const dayModels = new Map<string, Array<{ model: string; provider: string; level: string; cost: number }>>();
        const dayModelAgg = new Map<string, { model: string; provider: string; level: string; cost: number }>();
        for (const t of ds.turns) {
            const ts = num(t.timestamp);
            if (ts < startMs) continue;
            const day = dayKey(ts);
            const d = byDay.get(day) || { cost: 0, calls: 0, prompts: 0 };
            d.cost += num(t.cost_usd);
            d.calls++;
            if (num(t.user_prompt) > 0) d.prompts++;
            byDay.set(day, d);
            const m = str(t.model_name);
            if (!m) continue;
            const p = provOf(t), l = lvlOf(t);
            const mk = `${day}\u0000${modelKey(m, p, l)}`;
            const agg = dayModelAgg.get(mk) || { model: m, provider: p, level: l, cost: 0 };
            agg.cost += num(t.cost_usd);
            dayModelAgg.set(mk, agg);
        }
        for (const [mk, agg] of dayModelAgg) {
            const day = mk.split("\u0000")[0];
            const list = dayModels.get(day) || [];
            list.push(agg);
            dayModels.set(day, list);
        }
        // Per-day longest COMPLETED task — the tooltip's "longest task" line.
        const dayLongest = new Map<string, { model: string; provider: string; level: string; taskMs: number }>();
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            const ts = num(t.timestamp);
            if (ts < startMs) continue;
            const day = dayKey(ts);
            const cur = dayLongest.get(day);
            const ms = num(t.task_ms);
            if (!cur || ms > cur.taskMs) {
                dayLongest.set(day, { model: str(t.model_name), provider: provOf(t), level: lvlOf(t), taskMs: ms });
            }
        }
        const out: DayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = dayKey(d.getTime());
            const row = byDay.get(key);
            const models = dayModels.get(key) || [];
            const paid = models.filter(m => m.cost > 0);
            let mostCostlyModel = "", mostCostlyProvider = "", mostCostlyLevel = "", mostCostlyCost = 0, cheapestModel = "", cheapestProvider = "", cheapestLevel = "", cheapestCost = 0;
            if (paid.length > 0) {
                paid.sort((a, b) => b.cost - a.cost);
                mostCostlyModel = paid[0].model;
                mostCostlyProvider = paid[0].provider;
                mostCostlyLevel = paid[0].level;
                mostCostlyCost = paid[0].cost;
                const cheapest = models.slice().sort((a, b) => a.cost - b.cost)[0];
                cheapestModel = cheapest.model;
                cheapestProvider = cheapest.provider;
                cheapestLevel = cheapest.level;
                cheapestCost = cheapest.cost;
            }
            const lt = dayLongest.get(key);
            out.push({
                day: key,
                label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`,
                cost: row?.cost || 0,
                calls: row?.calls || 0,
                prompts: row?.prompts || 0,
                mostCostlyModel,
                mostCostlyProvider,
                mostCostlyLevel,
                mostCostlyCost,
                cheapestModel,
                cheapestProvider,
                cheapestLevel,
                cheapestCost,
                longestTaskModel: lt?.model || "",
                longestTaskProvider: lt?.provider || "",
                longestTaskLevel: lt?.level || "",
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
            best.push({ label: "Cheapest model", model: byCpt[0].modelName, provider: byCpt[0].provider, level: byCpt[0].thinkingLevel, value: fmtMoneyServer(safeDiv(byCpt[0].cost, byCpt[0].turns)) });
            worst.push({ label: "Most costly model", model: byCpt[byCpt.length - 1].modelName, provider: byCpt[byCpt.length - 1].provider, level: byCpt[byCpt.length - 1].thinkingLevel, value: fmtMoneyServer(safeDiv(byCpt[byCpt.length - 1].cost, byCpt[byCpt.length - 1].turns)) });
        } else {
            naRow(best, "Cheapest model", NA_COST);
            naRow(worst, "Most costly model", NA_COST);
        }

        // Cost per completed task — paid task-cost rows only (a $0
        // subscription model has no task cost to compare).
        const withTaskCost = rows.filter(r => r.costPerTask > 0 && r.completedTasks > 0);
        if (withTaskCost.length > 0) {
            const byTc = withTaskCost.slice().sort((a, b) => a.costPerTask - b.costPerTask);
            best.push({ label: "Best value per task", model: byTc[0].modelName, provider: byTc[0].provider, level: byTc[0].thinkingLevel, value: fmtMoneyServer(byTc[0].costPerTask) });
            worst.push({ label: "Most costly per task", model: byTc[byTc.length - 1].modelName, provider: byTc[byTc.length - 1].provider, level: byTc[byTc.length - 1].thinkingLevel, value: fmtMoneyServer(byTc[byTc.length - 1].costPerTask) });
        } else {
            naRow(best, "Best value per task", NA_COST_TASK);
            naRow(worst, "Most costly per task", NA_COST_TASK);
        }

        // Task time — fastest / longest avg completed-task time. All models
        // (a slow $0 model is still slow).
        const withT = rows.filter(r => r.avgTaskMs > 0);
        if (withT.length > 0) {
            const byT = withT.slice().sort((a, b) => a.avgTaskMs - b.avgTaskMs);
            best.push({ label: "Fastest tasks", model: byT[0].modelName, provider: byT[0].provider, level: byT[0].thinkingLevel, value: fmtMsServer(byT[0].avgTaskMs) });
            worst.push({ label: "Longest task time", model: byT[byT.length - 1].modelName, provider: byT[byT.length - 1].provider, level: byT[byT.length - 1].thinkingLevel, value: fmtMsServer(byT[byT.length - 1].avgTaskMs) });
        } else {
            naRow(best, "Fastest tasks", NA_NO_TASKS);
            naRow(worst, "Longest task time", NA_NO_TASKS);
        }

        // AI (self-prompted) turns per user prompt — efficiency. Lower is
        // better: fewer tool-call loops per prompt you type. All models.
        const withUp = rows.filter(r => r.userPrompts > 0);
        if (withUp.length > 0) {
            const byRatio = withUp.slice().sort((a, b) => a.aiPerUserPrompt - b.aiPerUserPrompt);
            best.push({ label: "Most efficient prompting", model: byRatio[0].modelName, provider: byRatio[0].provider, level: byRatio[0].thinkingLevel, value: byRatio[0].aiPerUserPrompt.toFixed(1) });
            worst.push({
                label: "Auto-prompt hog",
                model: byRatio[byRatio.length - 1].modelName,
                provider: byRatio[byRatio.length - 1].provider,
                level: byRatio[byRatio.length - 1].thinkingLevel,
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
            best.push({ label: "Best cache hit", model: byCache[0].modelName, provider: byCache[0].provider, level: byCache[0].thinkingLevel, value: fmtPctServer(byCache[0].avgCacheRate) });
            worst.push({ label: "Worst cache hit", model: byCache[byCache.length - 1].modelName, provider: byCache[byCache.length - 1].provider, level: byCache[byCache.length - 1].thinkingLevel, value: fmtPctServer(byCache[byCache.length - 1].avgCacheRate) });
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

    /** Avg completed-task time per (model, provider, level) in a window. */
    private taskTimeByModel(ds: UsageDataset, since: number, until?: number): Map<string, number> {
        const sums = new Map<string, { sum: number; n: number }>();
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            if (!inWin(num(t.timestamp), since, until)) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const k = modelKey(m, provOf(t), lvlOf(t));
            const s = sums.get(k) || { sum: 0, n: 0 };
            s.sum += num(t.task_ms);
            s.n++;
            sums.set(k, s);
        }
        return new Map(Array.from(sums.entries()).map(([k, s]) => [k, s.n > 0 ? s.sum / s.n : 0]));
    }

    /** Avg completed-task time per model × thinking level in a window. */
    private taskTimeByModelThinking(ds: UsageDataset, since: number): Map<string, number> {
        const sums = new Map<string, { sum: number; n: number }>();
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            if (since > 0 && num(t.timestamp) < since) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const k = modelKey(m, provOf(t), lvlOf(t));
            const s = sums.get(k) || { sum: 0, n: 0 };
            s.sum += num(t.task_ms);
            s.n++;
            sums.set(k, s);
        }
        return new Map(Array.from(sums.entries()).map(([k, s]) => [k, s.n > 0 ? s.sum / s.n : 0]));
    }

    /** Cost-by-model slices for the Overview cost-share chart, one entry
     *  per selectable window (rolling 24h first, calendar-anchored after,
     *  matching the footer timeframe semantics; 0 = all time). */
    private collectShareWindows(ds: UsageDataset, now: number): Array<{ key: string; label: string; models: Array<{ name: string; provider: string; level: string; cost: number }> }> {
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
        return windows.map(w => {
            const costs = new Map<string, { name: string; provider: string; level: string; cost: number }>();
            for (const t of ds.turns) {
                if (num(t.timestamp) < w.since) continue;
                if (num(t.cost_usd) <= 0) continue;
                const m = str(t.model_name);
                if (!m) continue;
                const p = provOf(t), l = lvlOf(t);
                const k = modelKey(m, p, l);
                const cur = costs.get(k) || { name: m, provider: p, level: l, cost: 0 };
                cur.cost += num(t.cost_usd);
                costs.set(k, cur);
            }
            return {
                key: w.key,
                label: w.label,
                models: Array.from(costs.values()).sort((a, b) => b.cost - a.cost),
            };
        });
    }

    /** Everything the Timings tab needs for one period window. */
    private collectTimingsWindow(ds: UsageDataset, since: number): TimingsWindow {
        const tasks = ds.tasks.filter(t => num(t.timestamp) >= since);
        let taskCount = 0, completed = 0, errors = 0, aborted = 0;
        let avgSum = 0, maxTaskMs = 0, totalTaskMs = 0, avgTurnsSum = 0;
        let maxTaskModel = "", maxTaskProvider = "", maxTaskLevel = "";
        const taskByModelSums = new Map<string, { model: string; provider: string; level: string; sum: number; n: number }>();
        const longest: LongestTask[] = [];
        for (const t of tasks) {
            taskCount++;
            const sr = str(t.stop_reason);
            const ms = num(t.task_ms);
            const turnsN = num(t.turn_count);
            const m = str(t.model_name);
            const p = provOf(t), l = lvlOf(t);
            if (sr === "complete") {
                completed++;
                avgSum += ms;
                totalTaskMs += ms;
                avgTurnsSum += turnsN;
                if (ms > maxTaskMs) {
                    maxTaskMs = ms;
                    maxTaskModel = m;
                    maxTaskProvider = p;
                    maxTaskLevel = l;
                }
                if (m) {
                    const k = modelKey(m, p, l);
                    const s = taskByModelSums.get(k) || { model: m, provider: p, level: l, sum: 0, n: 0 };
                    s.sum += ms;
                    s.n++;
                    taskByModelSums.set(k, s);
                }
                longest.push({ timestamp: num(t.timestamp), modelName: m, provider: p, thinkingLevel: l, turnCount: turnsN, taskMs: ms });
            } else if (sr === "error") errors++;
            else if (sr === "aborted") aborted++;
        }
        longest.sort((a, b) => b.taskMs - a.taskMs);
        const turns = ds.turns.filter(t => num(t.timestamp) >= since);
        let userTurns = 0, userThinkSum = 0, userRespSum = 0, aiThinkSum = 0, aiRespSum = 0, totalThink = 0, totalResp = 0;
        for (const t of turns) {
            const isUser = num(t.user_prompt) > 0;
            const th = num(t.thinking_ms), rp = num(t.response_ms);
            totalThink += th;
            totalResp += rp;
            if (isUser) { userTurns++; userThinkSum += th; userRespSum += rp; }
            else { aiThinkSum += th; aiRespSum += rp; }
        }
        const taskByModel = Array.from(taskByModelSums.values())
            .map(s => ({ modelName: s.model, provider: s.provider, thinkingLevel: s.level, avgTaskMs: s.n > 0 ? s.sum / s.n : 0, tasks: s.n }))
            .sort((a, b) => b.avgTaskMs - a.avgTaskMs);
        const aiTurnsN = Math.max(0, turns.length - userTurns);
        return {
            taskCount,
            completed,
            errors,
            aborted,
            avgTaskMs: completed > 0 ? avgSum / completed : 0,
            maxTaskMs,
            maxTaskModel,
            maxTaskProvider,
            maxTaskLevel,
            avgTurnsPerTask: completed > 0 ? avgTurnsSum / completed : 0,
            totalTaskMs,
            userTurns,
            userAvgThinkMs: userTurns > 0 ? userThinkSum / userTurns : 0,
            userAvgRespMs: userTurns > 0 ? userRespSum / userTurns : 0,
            aiTurns: aiTurnsN,
            aiAvgThinkMs: aiTurnsN > 0 ? aiThinkSum / aiTurnsN : 0,
            aiAvgRespMs: aiTurnsN > 0 ? aiRespSum / aiTurnsN : 0,
            totalThinkMs: totalThink,
            totalRespMs: totalResp,
            taskByModel,
            longest: longest.slice(0, 10),
        };
    }

    /** Zero-filled per-day avg task time for the last SERIES_DAYS local days. */
    private collectTaskDailySeries(ds: UsageDataset, now: number): TaskDayPoint[] {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (SERIES_DAYS - 1));
        const startMs = start.getTime();
        const byDay = new Map<string, { sum: number; n: number }>();
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            const ts = num(t.timestamp);
            if (ts < startMs) continue;
            const day = dayKey(ts);
            const s = byDay.get(day) || { sum: 0, n: 0 };
            s.sum += num(t.task_ms);
            s.n++;
            byDay.set(day, s);
        }
        const out: TaskDayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = dayKey(d.getTime());
            const row = byDay.get(key);
            out.push({
                day: key,
                label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`,
                avgTaskMs: row && row.n > 0 ? row.sum / row.n : 0,
                tasks: row?.n || 0,
            });
        }
        return out;
    }

    private collectTotals(ds: UsageDataset, now: number): ReportTotals {
        let turnsN = 0, userPrompts = 0, basePrompts = 0, subPrompts = 0, paidTurns = 0, paidUserPrompts = 0;
        let totalCost = 0, totalInput = 0, totalOutput = 0, totalCache = 0;
        let firstTurn = 0;
        const activeDays = new Set<string>();
        const cacheRatios: number[] = [];
        for (const t of ds.turns) {
            const ts = num(t.timestamp);
            turnsN++;
            if (num(t.user_prompt) > 0) userPrompts++;
            if (num(t.base_prompt) > 0) basePrompts++;
            if (num(t.sub_prompt) > 0) subPrompts++;
            const c = num(t.cost_usd);
            totalCost += c;
            if (c > 0) { paidTurns++; if (num(t.user_prompt) > 0) paidUserPrompts++; }
            totalInput += num(t.input_tokens);
            totalOutput += num(t.output_tokens);
            totalCache += num(t.cache_read);
            const den = num(t.cache_read) + num(t.input_tokens);
            if (den > 0) cacheRatios.push(num(t.cache_read) / den);
            if (firstTurn === 0 || ts < firstTurn) firstTurn = ts;
            if (ts > 0) activeDays.add(dayKey(ts));
        }
        // Completed-task unit economics: task cost = turns joined by
        // (session_id, prompt_index), completed tasks only.
        const turnCost = new Map<string, number>();
        for (const t of ds.turns) {
            const k = str(t.session_id) + "|" + str(t.prompt_index);
            turnCost.set(k, (turnCost.get(k) || 0) + num(t.cost_usd));
        }
        let completedTasks = 0, taskCostTotal = 0;
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            completedTasks++;
            taskCostTotal += turnCost.get(str(t.session_id) + "|" + str(t.prompt_index)) || 0;
        }
        const burn = (since: number): number => {
            let s = 0;
            for (const t of ds.turns) {
                if (num(t.timestamp) >= since) s += num(t.input_tokens) + num(t.output_tokens) + num(t.cache_read);
            }
            return s;
        };
        const worstBurn = new Map<string, { model: string; provider: string; level: string; burn: number }>();
        for (const t of ds.turns) {
            const m = str(t.model_name);
            if (!m) continue;
            const k = modelKey(m, provOf(t), lvlOf(t));
            const w = worstBurn.get(k) || { model: m, provider: provOf(t), level: lvlOf(t), burn: 0 };
            w.burn += num(t.input_tokens) + num(t.output_tokens) + num(t.cache_read);
            worstBurn.set(k, w);
        }
        const worst = Array.from(worstBurn.values()).sort((a, b) => b.burn - a.burn || a.model.localeCompare(b.model))[0];
        const calendarDays = firstTurn > 0 ? Math.max(1, Math.ceil((now - firstTurn) / DAY_MS)) : 0;
        return {
            totalCost,
            turnCount: turnsN,
            userPromptCount: userPrompts,
            basePromptCount: basePrompts,
            subPromptCount: subPrompts,
            automatedTurnCount: Math.max(0, turnsN - userPrompts),
            paidTurnCount: paidTurns,
            paidUserPromptCount: paidUserPrompts,
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            totalCacheRead: totalCache,
            avgCacheRate: cacheRatios.length > 0 ? cacheRatios.reduce((a, b) => a + b, 0) / cacheRatios.length : 0,
            avgCostPerTurn: safeDiv(totalCost, paidTurns),
            avgCostPerUserPrompt: safeDiv(totalCost, paidUserPrompts),
            turnsPerUserPrompt: safeDiv(turnsN, userPrompts),
            activeDays: activeDays.size,
            calendarDays,
            avgDailySpend: calendarDays > 0 ? totalCost / calendarDays : 0,
            firstTurnMs: firstTurn,
            completedTasks,
            avgCostPerTask: completedTasks > 0 ? taskCostTotal / completedTasks : null,
            fiveHourBurn: burn(now - FIVE_HOUR_MS),
            sevenDayBurn: burn(now - WEEK_MS),
            worstBurnModel: worst?.model || "",
            worstBurnProvider: worst?.provider || "",
            worstBurnLevel: worst?.level || "(none)",
            worstBurnTokens: worst?.burn || 0,
        };
    }

    // -------------------------------------------------------------------
    // Task-cost / context / allowance / error collectors (v1.21.x)
    // -------------------------------------------------------------------

    /** Completed-task cost per (model, provider, level): task cost (turns
     *  join) ÷ completed task count, for the window. Failed tasks never
     *  contribute. */
    private taskCostByModel(ds: UsageDataset, since: number, until?: number): Map<string, { tasks: number; cost: number }> {
        const turnCost = new Map<string, number>();
        for (const t of ds.turns) {
            const k = str(t.session_id) + "|" + str(t.prompt_index);
            turnCost.set(k, (turnCost.get(k) || 0) + num(t.cost_usd));
        }
        const out = new Map<string, { tasks: number; cost: number }>();
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            if (!inWin(num(t.timestamp), since, until)) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const k = modelKey(m, provOf(t), lvlOf(t));
            const cur = out.get(k) || { tasks: 0, cost: 0 };
            cur.tasks++;
            cur.cost += turnCost.get(str(t.session_id) + "|" + str(t.prompt_index)) || 0;
            out.set(k, cur);
        }
        return out;
    }

    /** Avg context-at-task-end ÷ window per (model, provider, level) (0..1). */
    private contextEndPctByModel(ds: UsageDataset, since: number, until?: number): Map<string, number | null> {
        const groups = new Map<string, { win: number; endSum: number; n: number }>();
        for (const t of ds.tasks) {
            if (!inWin(num(t.timestamp), since, until)) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const win = num(t.context_window), end = num(t.context_end_tokens);
            if (win <= 0 || end <= 0) continue;
            const k = modelKey(m, provOf(t), lvlOf(t));
            const g = groups.get(k) || { win: 0, endSum: 0, n: 0 };
            g.win = Math.max(g.win, win);
            g.endSum += end;
            g.n++;
            groups.set(k, g);
        }
        const m = new Map<string, number | null>();
        for (const [k, g] of groups) {
            m.set(k, g.win > 0 && g.n > 0 ? Math.min(1, (g.endSum / g.n) / g.win) : null);
        }
        return m;
    }

    /** Error count + rate (errors ÷ completed tasks) per (model, provider, level). */
    private errorStatsByModel(ds: UsageDataset, since: number, until?: number): Map<string, { errors: number; rate: number | null }> {
        const errCounts = new Map<string, number>();
        const completedCounts = new Map<string, number>();
        for (const e of ds.errors) {
            if (!inWin(num(e.timestamp), since, until)) continue;
            const m = str(e.model_name);
            if (!m) continue;
            const k = modelKey(m, provOf(e), lvlOf(e));
            errCounts.set(k, (errCounts.get(k) || 0) + 1);
        }
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            if (!inWin(num(t.timestamp), since, until)) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const k = modelKey(m, provOf(t), lvlOf(t));
            completedCounts.set(k, (completedCounts.get(k) || 0) + 1);
        }
        const out = new Map<string, { errors: number; rate: number | null }>();
        for (const [k, errors] of errCounts) {
            const completed = completedCounts.get(k) || 0;
            out.set(k, { errors, rate: completed > 0 ? errors / completed : null });
        }
        return out;
    }

    /** Everything the Errors tab needs for one period window. */
    private collectErrorStats(ds: UsageDataset, since: number): ErrorStats {
        const rows = ds.errors.filter(e => num(e.timestamp) >= since);
        const byType = new Map<string, number>();
        const byProvider = new Map<string, { provider: string; errorType: string; count: number; lastTs: number; codes: Set<string>; models: Set<string> }>();
        const provErr = new Map<string, number>();
        const provCompleted = new Map<string, number>();
        const byModel = new Map<string, { model: string; provider: string; count: number }>();
        for (const e of rows) {
            const m = str(e.model_name);
            if (!m) continue;
            const type = str(e.error_type) || "other";
            byType.set(type, (byType.get(type) || 0) + 1);
            const p = provOf(e);
            const pk = `${p}\u0000${type}`;
            const pr = byProvider.get(pk) || { provider: p, errorType: type, count: 0, lastTs: 0, codes: new Set<string>(), models: new Set<string>() };
            pr.count++;
            pr.lastTs = Math.max(pr.lastTs, num(e.timestamp));
            const code = str(e.error_code);
            if (code && code !== "0" && code !== "null") pr.codes.add(code);
            pr.models.add(m);
            byProvider.set(pk, pr);
            provErr.set(p, (provErr.get(p) || 0) + 1);
            const mk = `${m}\u0000${p}`;
            const bm = byModel.get(mk) || { model: m, provider: p, count: 0 };
            bm.count++;
            byModel.set(mk, bm);
        }
        for (const t of ds.tasks) {
            if (str(t.stop_reason) !== "complete") continue;
            if (num(t.timestamp) < since) continue;
            const p = provOf(t);
            provCompleted.set(p, (provCompleted.get(p) || 0) + 1);
        }
        const providerRates = Array.from(provErr.entries()).map(([p, errors]) => {
            const completed = provCompleted.get(p) || 0;
            return { provider: p, errors, completedTasks: completed, rate: completed > 0 ? errors / completed : null };
        });
        return {
            total: rows.length,
            byType: Array.from(byType.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
            byProvider: Array.from(byProvider.values()).map(r => ({
                provider: r.provider,
                errorType: r.errorType,
                count: r.count,
                lastTs: r.lastTs,
                codes: Array.from(r.codes).sort().join(","),
                models: Array.from(r.models).sort().join(", "),
            })).sort((a, b) => b.count - a.count),
            providerRates,
            byModel: Array.from(byModel.values()).map(r => ({
                model: r.model,
                provider: r.provider,
                count: r.count,
            })).sort((a, b) => b.count - a.count),
        };
    }

    /** Zero-filled per-day error counts for the last SERIES_DAYS local days. */
    private collectErrorDailySeries(ds: UsageDataset, now: number): ErrorDayPoint[] {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (SERIES_DAYS - 1));
        const startMs = start.getTime();
        const byDay = new Map<string, number>();
        for (const e of ds.errors) {
            const ts = num(e.timestamp);
            if (ts < startMs) continue;
            const day = dayKey(ts);
            byDay.set(day, (byDay.get(day) || 0) + 1);
        }
        const out: ErrorDayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = dayKey(d.getTime());
            out.push({ day: key, label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`, count: byDay.get(key) || 0 });
        }
        return out;
    }

    /** Everything the tool-errors section needs for one period window. */
    private collectToolErrorStats(ds: UsageDataset, since: number): ToolErrorStats {
        const rows = ds.toolErrors.filter((e) => num(e.timestamp) >= since);
        const buckets = new Map<string, { tool: string; errorKind: string; count: number; lastTs: number; models: Set<string>; sigs: Map<string, { count: number; example: string }> }>();
        for (const e of rows) {
            const tool = str(e.tool_name) || "(unknown)";
            const kind = str(e.error_kind) || "other";
            const key = `${tool}\u0000${kind}`;
            const b = buckets.get(key) || { tool, errorKind: kind, count: 0, lastTs: 0, models: new Set<string>(), sigs: new Map() };
            b.count++;
            b.lastTs = Math.max(b.lastTs, num(e.timestamp));
            const m = str(e.model_name);
            if (m) b.models.add(m);
            const sig = str(e.error_signature) || "other";
            const s = b.sigs.get(sig) || { count: 0, example: sanitizeToolErrorExample(str(e.error_message)) };
            s.count++;
            b.sigs.set(sig, s);
            buckets.set(key, b);
        }
        const byTool: ToolErrorToolRow[] = Array.from(buckets.values()).map((b) => {
            let repeat = 0;
            for (const s of b.sigs.values()) repeat = Math.max(repeat, s.count);
            const mostCommon = Array.from(b.sigs.values()).sort((a, c) => c.count - a.count)[0];
            return {
                tool: b.tool,
                errorKind: b.errorKind,
                count: b.count,
                repeat,
                lastTs: b.lastTs,
                models: Array.from(b.models).sort().join(", "),
                example: mostCommon?.example || "",
            };
        }).sort((a, b) => b.count - a.count);

        const toolAgg = new Map<string, number>();
        for (const r of byTool) toolAgg.set(r.tool, (toolAgg.get(r.tool) || 0) + r.count);
        const byToolChart = Array.from(toolAgg.entries())
            .map(([tool, count]) => ({ tool, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);

        const kindAgg = new Map<string, number>();
        for (const e of rows) {
            const k = str(e.error_kind) || "other";
            kindAgg.set(k, (kindAgg.get(k) || 0) + 1);
        }
        const byKind = Array.from(kindAgg.entries())
            .map(([kind, count]) => ({ kind, count }))
            .sort((a, b) => b.count - a.count);

        let topRepeat: ToolErrorStats["topRepeat"] = null;
        for (const b of buckets.values()) {
            for (const s of b.sigs.values()) {
                if (s.count > 1 && (!topRepeat || s.count > topRepeat.repeat)) {
                    topRepeat = { tool: b.tool, errorKind: b.errorKind, example: s.example, repeat: s.count };
                }
            }
        }

        return { total: rows.length, distinctTools: toolAgg.size, byTool, byToolChart, byKind, topRepeat };
    }

    /** Zero-filled per-day tool-error counts for the last SERIES_DAYS local days. */
    private collectToolErrorDailySeries(ds: UsageDataset, now: number): ErrorDayPoint[] {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (SERIES_DAYS - 1));
        const startMs = start.getTime();
        const byDay = new Map<string, number>();
        for (const e of ds.toolErrors) {
            const ts = num(e.timestamp);
            if (ts < startMs) continue;
            const key = dayKey(ts);
            byDay.set(key, (byDay.get(key) || 0) + 1);
        }
        const out: ErrorDayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = dayKey(d.getTime());
            out.push({ day: key, label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`, count: byDay.get(key) || 0 });
        }
        return out;
    }

    /** Tokens burned (input + output + cache-read) per (model, provider, level) since a time. */
    private tokenBurnByModel(ds: UsageDataset, since: number): Map<string, number> {
        const out = new Map<string, number>();
        for (const t of ds.turns) {
            if (num(t.timestamp) < since) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const k = modelKey(m, provOf(t), lvlOf(t));
            out.set(k, (out.get(k) || 0) + num(t.input_tokens) + num(t.output_tokens) + num(t.cache_read));
        }
        return out;
    }

    /** Per model × thinking level context-pressure rows for one period.
     *  Uses the task context columns when present, falls back to
     *  turn-derived values for rows recorded before this feature. */
    private collectContextStats(ds: UsageDataset, since: number, now: number): ContextRow[] {
        const groups = new Map<string, { model: string; provider: string; level: string; tasks: number; win: number; startSum: number; startN: number; endSum: number; endN: number; reported: number }>();
        // Fallback turn-derived context per (model, provider, level): the
        // per-task (session, prompt) turn min/max, averaged — used when a
        // task's own context columns are 0 (rows recorded pre-feature).
        const fbAgg = new Map<string, { startSum: number; startN: number; endSum: number; endN: number }>();
        const taskFb = new Map<string, { start: number; end: number }>();
        for (const t of ds.turns) {
            if (num(t.timestamp) < since) continue;
            const k = str(t.session_id) + "|" + str(t.prompt_index);
            const start = num(t.cache_read) + num(t.input_tokens);
            const end = num(t.cache_read) + num(t.input_tokens) + num(t.output_tokens);
            const cur = taskFb.get(k) || { start: Infinity, end: 0 };
            cur.start = Math.min(cur.start, start);
            cur.end = Math.max(cur.end, end);
            taskFb.set(k, cur);
        }
        for (const t of ds.tasks) {
            if (num(t.timestamp) < since) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const p = provOf(t), l = lvlOf(t);
            const k = modelKey(m, p, l);
            const g = groups.get(k) || { model: m, provider: p, level: l, tasks: 0, win: 0, startSum: 0, startN: 0, endSum: 0, endN: 0, reported: 0 };
            g.tasks++;
            g.win = Math.max(g.win, num(t.context_window));
            const st = num(t.context_start_tokens), en = num(t.context_end_tokens);
            if (st > 0) { g.startSum += st; g.startN++; }
            if (en > 0) { g.endSum += en; g.endN++; }
            if (num(t.allowance_reported) > 0 || str(t.allow_provider) !== "") g.reported = 1;
            groups.set(k, g);
            // Task-level turn-derived fallback values for THIS task.
            const f = taskFb.get(str(t.session_id) + "|" + str(t.prompt_index));
            if (f && (st <= 0 || en <= 0)) {
                const a = fbAgg.get(k) || { startSum: 0, startN: 0, endSum: 0, endN: 0 };
                if (st <= 0) { a.startSum += f.start; a.startN++; }
                if (en <= 0) { a.endSum += f.end; a.endN++; }
                fbAgg.set(k, a);
            }
        }
        const burn5h = this.tokenBurnByModel(ds, now - FIVE_HOUR_MS);
        const burn7d = this.tokenBurnByModel(ds, now - WEEK_MS);
        return Array.from(groups.values()).map(g => {
            const k = modelKey(g.model, g.provider, g.level);
            const fb = fbAgg.get(k);
            // Task context columns win; turn-derived fallback fills gaps.
            const avgStart = g.startN > 0 ? g.startSum / g.startN : (fb && fb.startN > 0 ? fb.startSum / fb.startN : null);
            const avgEnd = g.endN > 0 ? g.endSum / g.endN : (fb && fb.endN > 0 ? fb.endSum / fb.endN : null);
            const win = g.win;
            const avgEndPct = win > 0 && avgEnd != null ? avgEnd / win : null;
            const avgGrowth = avgStart != null && avgEnd != null ? Math.max(0, avgEnd - avgStart) : null;
            const tasksUntilFull = (win > 0 && avgGrowth != null && avgGrowth > 0 && avgEnd != null)
                ? Math.max(0, (win - avgEnd) / avgGrowth)
                : null;
            const fiveHourBurn = burn5h.get(k) || 0;
            const reported = g.reported === 1;
            return {
                modelName: g.model,
                provider: g.provider,
                thinkingLevel: g.level,
                tasks: g.tasks,
                contextWindow: win,
                avgStartTokens: avgStart != null ? Math.round(avgStart) : null,
                avgEndTokens: avgEnd != null ? Math.round(avgEnd) : null,
                avgEndPct,
                avgGrowth: avgGrowth != null ? Math.round(avgGrowth) : null,
                tasksUntilFull,
                allowanceReported: reported,
                fiveHourBurn,
                weeklyBurn: burn7d.get(k) || 0,
                fiveHourWindows: win > 0 ? fiveHourBurn / win : null,
                millionFlag: reported && fiveHourBurn >= MILLION,
            };
        });
    }

    /** Per-provider allowance consumption rows for one period window. */
    private collectAllowanceStats(ds: UsageDataset, since: number): AllowanceRow[] {
        const groups = new Map<string, { provider: string; tasks: number; avg5hSum: number; avg5hN: number; avgWeeklySum: number; avgWeeklyN: number; end5hSum: number; end5hN: number; endWeeklySum: number; endWeeklyN: number; resets: number; fiveExhausted: number; weeklyExhausted: number }>();
        for (const t of ds.tasks) {
            if (num(t.timestamp) < since) continue;
            const p = str(t.allow_provider);
            if (!p) continue;
            const g = groups.get(p) || { provider: p, tasks: 0, avg5hSum: 0, avg5hN: 0, avgWeeklySum: 0, avgWeeklyN: 0, end5hSum: 0, end5hN: 0, endWeeklySum: 0, endWeeklyN: 0, resets: 0, fiveExhausted: 0, weeklyExhausted: 0 };
            g.tasks++;
            const s5 = num(t.allow_5h_start), e5 = num(t.allow_5h_end);
            const sw = num(t.allow_weekly_start), ew = num(t.allow_weekly_end);
            // NULL semantics match the SQL: values may legitimately be 0.
            if (t.allow_5h_start != null && t.allow_5h_end != null && e5 >= s5) { g.avg5hSum += e5 - s5; g.avg5hN++; }
            if (t.allow_weekly_start != null && t.allow_weekly_end != null && ew >= sw) { g.avgWeeklySum += ew - sw; g.avgWeeklyN++; }
            if (t.allow_5h_end != null) { g.end5hSum += e5; g.end5hN++; }
            if (t.allow_weekly_end != null) { g.endWeeklySum += ew; g.endWeeklyN++; }
            if (t.allow_5h_start != null && t.allow_5h_end != null && e5 < s5) g.resets++;
            if (t.allow_5h_end != null && e5 >= 99.5) g.fiveExhausted++;
            if (t.allow_weekly_end != null && ew >= 99.5) g.weeklyExhausted++;
            groups.set(p, g);
        }
        return Array.from(groups.values()).map(g => {
            const avg5h = g.avg5hN > 0 ? g.avg5hSum / g.avg5hN : null;
            const avgWeekly = g.avgWeeklyN > 0 ? g.avgWeeklySum / g.avgWeeklyN : null;
            const avg5hEnd = g.end5hN > 0 ? g.end5hSum / g.end5hN : null;
            const avgWeeklyEnd = g.endWeeklyN > 0 ? g.endWeeklySum / g.endWeeklyN : null;
            return {
                provider: g.provider,
                tasks: g.tasks,
                avg5hPerTask: avg5h,
                avgWeeklyPerTask: avgWeekly,
                avg5hEnd,
                avgWeeklyEnd,
                fiveHourResets: g.resets,
                fiveHourExhausted: g.fiveExhausted,
                weeklyExhausted: g.weeklyExhausted,
                tasksUntil5hFull: avg5h != null && avg5h > 0 && avg5hEnd != null ? Math.max(0, (100 - avg5hEnd) / avg5h) : null,
                tasksUntilWeeklyFull: avgWeekly != null && avgWeekly > 0 && avgWeeklyEnd != null ? Math.max(0, (100 - avgWeeklyEnd) / avgWeekly) : null,
            };
        });
    }

    /** Latest allowance snapshot across all tasks (for the context cards). */
    private latestAllowance(ds: UsageDataset): AllowanceLatest | null {
        let best: AllowanceLatest | null = null;
        for (const t of ds.tasks) {
            const e5 = num(t.allow_5h_end), ew = num(t.allow_weekly_end);
            if (e5 <= 0 && ew <= 0) continue;
            const ts = num(t.timestamp);
            if (best && ts <= best.at) continue;
            best = {
                provider: str(t.allow_provider),
                fiveHourUsed: e5 > 0 ? e5 : null,
                weeklyUsed: ew > 0 ? ew : null,
                at: ts,
            };
        }
        return best;
    }

    /**
     * Cost projections — based on YOUR usage rate and average unit costs.
     * Per (model, provider, level): costPerTurn = cost ÷ turns,
     * costPerTask = completed-task cost ÷ completed tasks, tasksPerDay =
     * completed tasks ÷ active days. Projections = tasksPerDay ×
     * costPerTask × N days. Rows with fewer than ESTIMATE_MIN_ACTIVE_DAYS
     * active days are flagged as estimates. Zero-cost models are excluded.
     */
    private computeProjections(ds: UsageDataset, totals: ReportTotals, since: number): ProjectionSummary {
        const groups = new Map<string, { model: string; provider: string; level: string; turns: number; userCount: number; cost: number; days: Set<string> }>();
        for (const t of ds.turns) {
            if (since > 0 && num(t.timestamp) < since) continue;
            const m = str(t.model_name);
            if (!m) continue;
            const p = provOf(t), l = lvlOf(t);
            const k = modelKey(m, p, l);
            const g = groups.get(k) || { model: m, provider: p, level: l, turns: 0, userCount: 0, cost: 0, days: new Set<string>() };
            g.turns++;
            if (num(t.user_prompt) > 0) g.userCount++;
            g.cost += num(t.cost_usd);
            const ts = num(t.timestamp);
            if (ts > 0) g.days.add(dayKey(ts));
            groups.set(k, g);
        }
        const taskCost = this.taskCostByModel(ds, since);
        const projRows: ProjectionRow[] = Array.from(groups.values()).map(g => {
            const cost = g.cost;
            const turns = g.turns;
            const activeDays = Math.max(1, g.days.size);
            const tc = taskCost.get(modelKey(g.model, g.provider, g.level));
            const completedTasks = tc?.tasks || 0;
            const costPerTask = tc && tc.tasks > 0 ? tc.cost / tc.tasks : null;
            const costPerTurn = turns > 0 ? cost / turns : 0;
            const tasksPerDay = completedTasks / activeDays;
            const turnsPerDay = turns / activeDays;
            const spendPerDay = cost / activeDays;
            const proj = (d: number): number | null => (costPerTask != null ? tasksPerDay * costPerTask * d : null);
            return {
                modelName: g.model,
                provider: g.provider,
                thinkingLevel: g.level,
                activeDays,
                turns,
                userPrompts: g.userCount,
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
        const ds = fetchUsageDataset();
        if (!ds) return null;

        const now = Date.now();
        const dailySince = now - DAY_MS;
        const weeklySince = now - 7 * DAY_MS;
        const monthlySince = now - 28 * DAY_MS;

        const dailyModels = this.collectWindowedModels(ds, dailySince);
        const weeklyModels = this.collectWindowedModels(ds, weeklySince);
        const monthlyModels = this.collectWindowedModels(ds, monthlySince);
        const allModels = this.collectWindowedModels(ds, 0);

        const totals = this.collectTotals(ds, now);

        // Overview "Period summary": 6 panes in a 2x3 grid — one rolling
        // (24h) and five calendar periods.
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
            { key: "lastMonth", label: "Last Month", since: startOfMonthLocal(1), until: startOfMonthLocal(0) },
            { key: "thisMonth", label: "This Month", since: startOfMonthLocal(0) },
        ];
        const periods: Record<string, PeriodSummary> = {};
        for (const p of periodDefs) {
            periods[p.key] = this.summarizePeriod(this.collectWindowedModels(ds, p.since, p.until), p.label);
        }

        const ctxBy = (since: number) => this.collectContextStats(ds, since, now);
        const allowBy = (since: number) => this.collectAllowanceStats(ds, since);
        const errBy = (since: number) => this.collectErrorStats(ds, since);
        const projBy = (since: number) => this.computeProjections(ds, totals, since);

        return {
            generatedAt: now,
            totals,
            periods,
            dailySeries: this.collectDailySeries(ds, now),
            shareWindows: this.collectShareWindows(ds, now),
            modelsByPeriod: {
                daily: dailyModels,
                weekly: weeklyModels,
                monthly: monthlyModels,
                all: allModels,
            },
            modelThinkingByPeriod: {
                daily: this.collectWindowedModelThinking(ds, dailySince),
                weekly: this.collectWindowedModelThinking(ds, weeklySince),
                monthly: this.collectWindowedModelThinking(ds, monthlySince),
                all: this.collectWindowedModelThinking(ds, 0),
            },
            timings: {
                daily: this.collectTimingsWindow(ds, dailySince),
                weekly: this.collectTimingsWindow(ds, weeklySince),
                monthly: this.collectTimingsWindow(ds, monthlySince),
                all: this.collectTimingsWindow(ds, 0),
            },
            taskDailySeries: this.collectTaskDailySeries(ds, now),
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
            allowanceLatest: this.latestAllowance(ds),
            errorStats: {
                daily: errBy(dailySince),
                weekly: errBy(weeklySince),
                monthly: errBy(monthlySince),
                all: errBy(0),
            },
            errorDailySeries: this.collectErrorDailySeries(ds, now),
            toolErrorStats: {
                daily: this.collectToolErrorStats(ds, dailySince),
                weekly: this.collectToolErrorStats(ds, weeklySince),
                monthly: this.collectToolErrorStats(ds, monthlySince),
                all: this.collectToolErrorStats(ds, 0),
            },
            toolErrorDailySeries: this.collectToolErrorDailySeries(ds, now),
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

    /** Deletes ALL tables (turns + tasks + errors + tool_errors) in one transaction. */
    private clearUsage(): { turns: number; tasks: number; errors: number; toolErrors: number } {
        const db = getDb();
        if (!db) return { turns: 0, tasks: 0, errors: 0, toolErrors: 0 };
        const tx = db.transaction(() => {
            const turns = db.prepare(`DELETE FROM turns`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'turns'`).run();
            const tasks = db.prepare(`DELETE FROM tasks`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'tasks'`).run();
            const errors = db.prepare(`DELETE FROM errors`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'errors'`).run();
            const toolErrors = db.prepare(`DELETE FROM tool_errors`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'tool_errors'`).run();
            return { turns, tasks, errors, toolErrors };
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
        const toolErrors = this.countRows("tool_errors");
        if (turns === 0 && tasks === 0 && errors === 0 && toolErrors === 0) {
            aftcConsole.emphasis(ctx, "Usage database is already empty — nothing to clear.");
            return;
        }
        if (ctx.hasUI) {
            const ok = await showConfirm(ctx, { title: "Clear usage database", body: `Permanently delete all ${turns} recorded turn${turns === 1 ? "" : "s"}, ${tasks} task record${tasks === 1 ? "" : "s"}, ${errors} error record${errors === 1 ? "" : "s"} and ${toolErrors} tool-error record${toolErrors === 1 ? "" : "s"} from the SQLite database?\n\nThis cannot be undone.` });
            if (!ok) return;
        }
        try {
            const deleted = this.clearUsage();
            aftcConsole.emphasis(ctx, `Cleared usage database — deleted ${deleted.turns} turn${deleted.turns === 1 ? "" : "s"}, ${deleted.tasks} task record${deleted.tasks === 1 ? "" : "s"}, ${deleted.errors} error record${deleted.errors === 1 ? "" : "s"} and ${deleted.toolErrors} tool-error record${deleted.toolErrors === 1 ? "" : "s"}.`);
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

    private runReport(ctx: ExtensionCommandContext): void {
        const data = this.collectReportData();
        if (!data) {
            aftcConsole.error(ctx, "Cannot generate the usage report: better-sqlite3 is not available. Run /aftc-install.");
            return;
        }
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
