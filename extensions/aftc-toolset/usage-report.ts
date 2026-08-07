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
 * organised into five tabs:
 *
 *   Overview      — headline stat cards (total cost, prompts, calls,
 *                   cache hit, active days), a daily-spend bar chart
 *                   (last 30 days), a cost-share doughnut with a window
 *                   selector (24h rolling / 1 Day ... 1 Year / All Time),
 *                   and three period summary cards (24h / 7d / 28d). The
 *                   per-model scoreboard only lists models that cost
 *                   something in the window ($0 models never appear) and
 *                   carries Avg / Longest / Shortest Task Time rows (from
 *                   the tasks table, by model × thinking level).
 *   Models        — per-model sortable table with a period selector,
 *                   a cost-by-model bar chart and a Task Time column.
 *   Thinking      — per-model × thinking-level sortable table with a
 *                   period selector and a Task Time column.
 *   Timings       — Task Time analysis from the tasks table: headline
 *                   cards (avg / longest task, turns per task, error &
 *                   abort counts), task-time-by-model and daily avg
 *                   task-time charts, a think / respond / tools-and-
 *                   overhead split, user- vs AI-turn timings, and the
 *                   top-10 longest completed tasks.
 *   Projections   — overall burn rate (avg $/day, projected month and
 *                   year from calendar days) plus per-model × thinking
 *                   $/day, $/week, $/month, $/year derived from
 *                   spend ÷ ACTIVE days (not active hours — the old
 *                   hourly scaling produced absurd figures). Zero-cost
 *                   model rows are excluded.
 *
 * Projection math:
 *   per model×thinking: costPerDay = totalCost / activeDays, where
 *   activeDays = distinct calendar days with at least one turn. Week =
 *   ×7, month = ×30.44, year = ×365. Rows with fewer than 7 active
 *   days are flagged as estimates.
 *   overall: avgDailySpend = totalCost / calendarDays since the first
 *   recorded turn. Flagged as an estimate below 14 calendar days.
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
    cost: number;
    turns: number;
    userPrompts: number;
    /** Self-prompted turns: total turns minus user-prompt turns. */
    aiPrompts: number;
    /** AI (self-prompted) turns per user prompt. */
    aiPerUserPrompt: number;
    avgCostPerUserPrompt: number;
    avgCacheRate: number;
    avgThinkingMs: number;
    avgResponseMs: number;
    /** Avg completed-task time (tasks table) for this model in the window. */
    avgTaskMs: number;
};

type ModelThinkingRow = ModelRow & { thinkingLevel: string };

type ScoreboardEntry = { label: string; model: string; value: string; /** When set, the row renders N/A with this tooltip reason. */ na?: string };

type PeriodSummary = {
    label: string;
    cost: number;
    calls: number;
    prompts: number;
    aiPrompts: number;
    scoreboard: ScoreboardEntry[];
};

type DayPoint = { day: string; label: string; cost: number; calls: number; prompts: number };

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

type ProjectionRow = {
    modelName: string;
    thinkingLevel: string;
    activeDays: number;
    turns: number;
    userPrompts: number;
    aiPrompts: number;
    cost: number;
    costPerDay: number;
    costPerWeek: number;
    costPerMonth: number;
    costPerYear: number;
    estimated: boolean;
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const SERIES_DAYS = 30;
const DAYS_PER_MONTH = 30.44;
const ESTIMATE_MIN_ACTIVE_DAYS = 7;
const ESTIMATE_MIN_CALENDAR_DAYS = 14;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Scoreboard N/A tooltip reasons (a row stays visible as N/A whenever its
// metric is uncomputable for the window, with the reason on an info icon).
const NA_COST = "Not available - no model in this period has a recorded cost. Subscription providers often don't give a per-turn price, so cost averages can't be calculated.";
const NA_NO_TURNS = "Not available - no turns were recorded in this period.";
const NA_NO_PROMPTS = "Not available - no user-prompt turns were recorded in this period.";
const NA_ONE_MODEL = "Not available - only one model had user-prompt turns in this period.";
const NA_NO_TASKS = "Not available - no completed tasks were recorded in this period.";
const NA_NO_RESPONSE = "Not available - no response-time data was recorded in this period.";
const NA_NO_THINK = "Not available - no thinking-time data in this period (non-reasoning models record no think time).";

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

// ---------------------------------------------------------------------------
// UsageModule
// ---------------------------------------------------------------------------

class UsageModule {
    constructor(private pi: ExtensionAPI) {}

    attach(): void { this.registerCommands(); }

    // -------------------------------------------------------------------
    // Collectors
    // -------------------------------------------------------------------

    private windowStatsForModel(db: any, modelName: string, since: number): ModelRow {
        const row = db.prepare(
            `SELECT COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${PAID_USER_PROMPT_SQL} AS paid_user_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response
             FROM turns
             WHERE model_name = ? AND timestamp >= ?`,
        ).get(modelName, since) as any;
        const turns = num(row.turns);
        const userPrompts = num(row.user_count);
        const paidUserPrompts = num(row.paid_user_count);
        const cost = num(row.cost);
        return {
            modelName,
            cost,
            turns,
            userPrompts,
            aiPrompts: Math.max(0, turns - userPrompts),
            aiPerUserPrompt: safeDiv(turns - userPrompts, userPrompts),
            avgCostPerUserPrompt: safeDiv(cost, paidUserPrompts),
            avgCacheRate: num(row.avg_cache_rate),
            avgThinkingMs: num(row.avg_thinking),
            avgResponseMs: num(row.avg_response),
            avgTaskMs: 0,
        };
    }

    /** Per-model rows for a time window. Models with no turns in the window are omitted. */
    private collectWindowedModels(db: any, since: number): ModelRow[] {
        const models = (db.prepare(
            `SELECT DISTINCT model_name FROM turns WHERE model_name IS NOT NULL AND model_name != '' ORDER BY model_name`,
        ).all() as Array<{ model_name: string }>).map(r => r.model_name);
        const taskTimes = this.taskTimeByModel(db, since);
        return models
            .map(m => this.windowStatsForModel(db, m, since))
            .filter(r => r.turns > 0)
            .map(r => ({ ...r, avgTaskMs: taskTimes.get(r.modelName) || 0 }));
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
        return rows.map(r => {
            const turns = num(r.turns);
            const userPrompts = num(r.user_count);
            const paidUserPrompts = num(r.paid_user_count);
            const cost = num(r.cost);
            const level = r.thinking_level || "(none)";
            return {
                modelName: r.model_name,
                thinkingLevel: level,
                cost,
                turns,
                userPrompts,
                aiPrompts: Math.max(0, turns - userPrompts),
                aiPerUserPrompt: safeDiv(turns - userPrompts, userPrompts),
                avgCostPerUserPrompt: safeDiv(cost, paidUserPrompts),
                avgCacheRate: num(r.avg_cache_rate),
                avgThinkingMs: num(r.avg_thinking),
                avgResponseMs: num(r.avg_response),
                avgTaskMs: taskTimes.get(`${r.model_name}|${level}`) || 0,
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
        const out: DayPoint[] = [];
        for (let i = SERIES_DAYS - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            const row = byDay.get(key);
            out.push({
                day: key,
                label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`,
                cost: num(row?.cost),
                calls: num(row?.calls),
                prompts: num(row?.prompts),
            });
        }
        return out;
    }

    private summarizePeriod(rows: ModelRow[], label: string, taskStats: { avgMs: number; count: number }, taskTimes: Map<string, number>): PeriodSummary {
        const cost = rows.reduce((s, r) => s + r.cost, 0);
        const calls = rows.reduce((s, r) => s + r.turns, 0);
        const prompts = rows.reduce((s, r) => s + r.userPrompts, 0);

        // Cost rows (cheapest / most costly) only consider models that
        // COST something — a cost average over $0 (subscription) models is
        // meaningless. Usage / cache / timing rows consider ALL models:
        // those metrics exist for subscription models too. EVERY row is
        // always shown; an uncomputable metric renders N/A + a tooltip
        // giving the reason (it never silently disappears).
        const paid = rows.filter(r => r.cost > 0);

        const scoreboard: ScoreboardEntry[] = [];
        const naRow = (rowLabel: string, reason: string): void => {
            scoreboard.push({ label: rowLabel, model: "", value: "", na: reason });
        };

        // Cheapest / most costly — paid models only, N/A when none.
        if (paid.length > 0) {
            const byCpt = paid.slice().sort((a, b) => safeDiv(a.cost, a.turns) - safeDiv(b.cost, b.turns));
            scoreboard.push({ label: "Cheapest model", model: byCpt[0].modelName, value: fmtMoneyServer(safeDiv(byCpt[0].cost, byCpt[0].turns)) });
            scoreboard.push({ label: "Most costly model", model: byCpt[byCpt.length - 1].modelName, value: fmtMoneyServer(safeDiv(byCpt[byCpt.length - 1].cost, byCpt[byCpt.length - 1].turns)) });
        } else {
            naRow("Cheapest model", NA_COST);
            naRow("Most costly model", NA_COST);
        }

        // Most / least used by user-prompt count — all models.
        const withUp = rows.filter(r => r.userPrompts > 0);
        if (withUp.length > 0) {
            const byUp = withUp.slice().sort((a, b) => b.userPrompts - a.userPrompts);
            scoreboard.push({ label: "Most used model", model: byUp[0].modelName, value: byUp[0].userPrompts.toLocaleString("en-US") });
            if (byUp.length > 1)
                scoreboard.push({ label: "Least used model", model: byUp[byUp.length - 1].modelName, value: byUp[byUp.length - 1].userPrompts.toLocaleString("en-US") });
            else
                naRow("Least used model", NA_ONE_MODEL);
        } else {
            naRow("Most used model", NA_NO_PROMPTS);
            naRow("Least used model", NA_NO_PROMPTS);
        }

        // Task Time — avg wall-clock time from user prompt to the agent
        // settling, over the window's completed tasks (tasks table). Sits
        // under the used-model rows; independent of model cost.
        if (taskStats.count > 0) {
            scoreboard.push({
                label: "Avg Task Time",
                model: fmtMsServer(taskStats.avgMs),
                value: `${taskStats.count} task${taskStats.count === 1 ? "" : "s"}`,
            });
        } else {
            naRow("Avg Task Time", NA_NO_TASKS);
        }

        // Longest / shortest avg task time by model x thinking level
        // (tasks table, completed tasks only). Row keys are
        // "model|thinking" (taskTimeByModelThinking format).
        const taskEntries = Array.from(taskTimes.entries())
            .filter(([, avgMs]) => avgMs > 0)
            .sort((a, b) => b[1] - a[1]);
        if (taskEntries.length > 0) {
            const pushTaskRow = (rowLabel: string, entry: [string, number]): void => {
                const sep = entry[0].indexOf("|");
                const modelName = entry[0].slice(0, sep);
                const thinkingLevel = entry[0].slice(sep + 1);
                scoreboard.push({
                    label: rowLabel,
                    model: modelName,
                    value: `${thinkingLevel} · ${fmtMsServer(entry[1])}`,
                });
            };
            pushTaskRow("Longest Avg Task Time", taskEntries[0]);
            pushTaskRow("Shortest Avg Task Time", taskEntries[taskEntries.length - 1]);
        } else {
            naRow("Longest Avg Task Time", NA_NO_TASKS);
            naRow("Shortest Avg Task Time", NA_NO_TASKS);
        }

        // Cache hit rate — all models; best = highest %, worst = lowest %.
        if (rows.length > 0) {
            const byCache = rows.slice().sort((a, b) => b.avgCacheRate - a.avgCacheRate);
            scoreboard.push({ label: "Best cache hit", model: byCache[0].modelName, value: fmtPctServer(byCache[0].avgCacheRate) });
            scoreboard.push({ label: "Worst cache hit", model: byCache[byCache.length - 1].modelName, value: fmtPctServer(byCache[byCache.length - 1].avgCacheRate) });
        } else {
            naRow("Best cache hit", NA_NO_TURNS);
            naRow("Worst cache hit", NA_NO_TURNS);
        }

        // Response time — all models; best = lowest avg (0 = no data).
        const withRt = rows.filter(r => r.avgResponseMs > 0);
        if (withRt.length > 0) {
            const byRt = withRt.slice().sort((a, b) => a.avgResponseMs - b.avgResponseMs);
            scoreboard.push({ label: "Best response time", model: byRt[0].modelName, value: fmtMsServer(byRt[0].avgResponseMs) });
            scoreboard.push({ label: "Worst response time", model: byRt[byRt.length - 1].modelName, value: fmtMsServer(byRt[byRt.length - 1].avgResponseMs) });
        } else {
            naRow("Best response time", NA_NO_RESPONSE);
            naRow("Worst response time", NA_NO_RESPONSE);
        }

        // Think time — all models; best = lowest avg (0 = non-reasoning).
        const withTt = rows.filter(r => r.avgThinkingMs > 0);
        if (withTt.length > 0) {
            const byTt = withTt.slice().sort((a, b) => a.avgThinkingMs - b.avgThinkingMs);
            scoreboard.push({ label: "Best think time", model: byTt[0].modelName, value: fmtMsServer(byTt[0].avgThinkingMs) });
            scoreboard.push({ label: "Worst think time", model: byTt[byTt.length - 1].modelName, value: fmtMsServer(byTt[byTt.length - 1].avgThinkingMs) });
        } else {
            naRow("Best think time", NA_NO_THINK);
            naRow("Worst think time", NA_NO_THINK);
        }

        return {
            label,
            cost,
            calls,
            prompts,
            aiPrompts: Math.max(0, calls - prompts),
            scoreboard,
        };
    }

    // -------------------------------------------------------------------
    // Task-time collectors (tasks table)
    // -------------------------------------------------------------------

    /** Avg completed-task time per model in a window (tasks table). */
    private taskTimeByModel(db: any, since: number): Map<string, number> {
        const rows = db.prepare(
            `SELECT model_name, AVG(task_ms) AS avg_task
             FROM tasks
             WHERE timestamp >= ? AND stop_reason = 'complete'
                   AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name`,
        ).all(since) as any[];
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

    /** Completed-task stats for a window (feeds the period summaries). */
    private windowTaskStats(db: any, since: number): { avgMs: number; count: number } {
        const row = db.prepare(
            `SELECT COUNT(*) AS n, COALESCE(AVG(task_ms), 0) AS avg_ms
             FROM tasks WHERE timestamp >= ? AND stop_reason = 'complete'`,
        ).get(since) as any;
        return { avgMs: num(row.avg_ms), count: num(row.n) };
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
        };
    }

    /**
     * Cost projections.
     *
     * Per model × thinking level: costPerDay = totalCost / activeDays
     * (distinct local calendar days with at least one turn), scaled to
     * week (×7), month (×30.44) and year (×365). Rows with fewer than
     * ESTIMATE_MIN_ACTIVE_DAYS active days are flagged as estimates.
     * Model × thinking rows with zero total cost are excluded — a $0
     * model has nothing to project.
     *
     * Overall: avgDailySpend = totalCost / calendarDays since the first
     * recorded turn — the true burn rate, including idle days. Flagged
     * as an estimate below ESTIMATE_MIN_CALENDAR_DAYS calendar days.
     */
    private computeProjections(db: any, totals: ReportTotals): any {
        const rows = db.prepare(
            `SELECT model_name,
                    thinking_level,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) AS active_days
             FROM turns
             WHERE model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name, thinking_level
             ORDER BY cost DESC`,
        ).all() as any[];

        const projRows: ProjectionRow[] = rows.map(r => {
            const cost = num(r.cost);
            const turns = num(r.turns);
            const userPrompts = num(r.user_count);
            const activeDays = Math.max(1, num(r.active_days));
            const perDay = safeDiv(cost, activeDays);
            return {
                modelName: r.model_name,
                thinkingLevel: r.thinking_level || "(none)",
                activeDays,
                turns,
                userPrompts,
                aiPrompts: Math.max(0, turns - userPrompts),
                cost,
                costPerDay: perDay,
                costPerWeek: perDay * 7,
                costPerMonth: perDay * DAYS_PER_MONTH,
                costPerYear: perDay * 365,
                estimated: activeDays < ESTIMATE_MIN_ACTIVE_DAYS,
            };
        }).filter(r => r.cost > 0);

        const days = Math.max(1, totals.calendarDays);
        const avgDaily = safeDiv(totals.totalCost, days);
        const noData = totals.turnCount === 0;
        const enough = totals.calendarDays >= ESTIMATE_MIN_CALENDAR_DAYS;
        return {
            rows: projRows,
            avgDailySpend: avgDaily,
            projectedWeek: avgDaily * 7,
            projectedMonth: avgDaily * DAYS_PER_MONTH,
            projectedYear: avgDaily * 365,
            calendarDays: totals.calendarDays,
            estimated: !noData && !enough,
            note: noData
                ? "No usage recorded yet — projections will appear after some activity."
                : enough
                    ? `Overall burn rate: all-time spend ÷ ${days} calendar days since recording began.`
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

        const dailyTaskStats = this.windowTaskStats(db, dailySince);
        const weeklyTaskStats = this.windowTaskStats(db, weeklySince);
        const monthlyTaskStats = this.windowTaskStats(db, monthlySince);

        return {
            generatedAt: now,
            totals,
            periods: {
                daily: this.summarizePeriod(dailyModels, "Last 24 hours", dailyTaskStats, this.taskTimeByModelThinking(db, dailySince)),
                weekly: this.summarizePeriod(weeklyModels, "Last 7 days", weeklyTaskStats, this.taskTimeByModelThinking(db, weeklySince)),
                monthly: this.summarizePeriod(monthlyModels, "Last 28 days", monthlyTaskStats, this.taskTimeByModelThinking(db, monthlySince)),
            },
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
            projections: this.computeProjections(db, totals),
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

    /** Deletes BOTH tables (turns + tasks) in one transaction. */
    private clearUsage(): { turns: number; tasks: number } {
        const db = getDb();
        if (!db) return { turns: 0, tasks: 0 };
        const tx = db.transaction(() => {
            const turns = db.prepare(`DELETE FROM turns`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'turns'`).run();
            const tasks = db.prepare(`DELETE FROM tasks`).run().changes;
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'tasks'`).run();
            return { turns, tasks };
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
        if (turns === 0 && tasks === 0) {
            aftcConsole.emphasis(ctx, "Usage database is already empty — nothing to clear.");
            return;
        }
        if (ctx.hasUI) {
            const ok = await showConfirm(ctx, { title: "Clear usage database", body: `Permanently delete all ${turns} recorded turn${turns === 1 ? "" : "s"} and ${tasks} task record${tasks === 1 ? "" : "s"} from the SQLite database?\n\nThis cannot be undone.` });
            if (!ok) return;
        }
        try {
            const deleted = this.clearUsage();
            aftcConsole.emphasis(ctx, `Cleared usage database — deleted ${deleted.turns} turn${deleted.turns === 1 ? "" : "s"} and ${deleted.tasks} task record${deleted.tasks === 1 ? "" : "s"}.`);
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
