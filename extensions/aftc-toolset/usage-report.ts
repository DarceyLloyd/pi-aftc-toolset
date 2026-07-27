/**
 * pi-aftc-toolset — usage-report feature module.
 *
 * Reads the per-turn SQLite database (populated by usage-recording.ts)
 * and writes a self-contained HTML report to
 * the persistent data dir (report.html; see paths.ts), then opens it in
 * the user's browser.
 *
 * The report is a single .html file: embedded CSS, embedded JSON,
 * embedded JS. The only external reference is the Chart.js CDN for the
 * graphs; when offline the page degrades gracefully (tables always
 * work). The report is organised into five tabs:
 *
 *   Overview      — headline stat cards (total cost, prompts, calls,
 *                   cache hit, active days), a daily-spend bar chart
 *                   (last 30 days), a cost-share doughnut, and three
 *                   period summary cards (24h / 7d / 28d). The per-model
 *                   scoreboard only lists models that cost something in
 *                   the window ($0 models never appear) and carries an
 *                   Avg Task Time row (from the tasks table).
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
 * Per .dev/dev_guide.md section 1.5, this is a self-contained feature module: it owns
 * no shared state with other feature modules and is wired into pi by
 * the orchestrator in index.ts. It does not import core.ts or
 * usage-recording.ts (it only reads the DB they share).
 *
 * See `usage-report.readme.md` for the full report contents.
 */

import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getDb, isDbAvailable } from "./db";
import { getDataDir, getReportFile } from "./paths";
import { showConfirm } from "./ui/aftcUi";

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

    private summarizePeriod(rows: ModelRow[], label: string, taskStats: { avgMs: number; count: number }): PeriodSummary {
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
                daily: this.summarizePeriod(dailyModels, "Last 24 hours", dailyTaskStats),
                weekly: this.summarizePeriod(weeklyModels, "Last 7 days", weeklyTaskStats),
                monthly: this.summarizePeriod(monthlyModels, "Last 28 days", monthlyTaskStats),
            },
            dailySeries: this.collectDailySeries(db, now),
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
            ctx.ui.notify?.("Cannot clear usage data: better-sqlite3 is not available. Run /aftc-install.", "error");
            return;
        }
        const turns = this.countRows("turns");
        const tasks = this.countRows("tasks");
        if (turns === 0 && tasks === 0) {
            ctx.ui.notify?.("Usage database is already empty — nothing to clear.", "info");
            return;
        }
        if (ctx.hasUI) {
            const ok = await showConfirm(ctx, { title: "Clear usage database", body: `Permanently delete all ${turns} recorded turn${turns === 1 ? "" : "s"} and ${tasks} task record${tasks === 1 ? "" : "s"} from the SQLite database?\n\nThis cannot be undone.` });
            if (!ok) return;
        }
        try {
            const deleted = this.clearUsage();
            ctx.ui.notify?.(`Cleared usage database — deleted ${deleted.turns} turn${deleted.turns === 1 ? "" : "s"} and ${deleted.tasks} task record${deleted.tasks === 1 ? "" : "s"}.`, "info");
        } catch (err) {
            ctx.ui.notify?.(`Failed to clear usage database: ${(err as Error).message}`, "error");
        }
    }

    private registerCommands(): void {
        this.pi.registerCommand("usage-report", {
            description: "Write a self-contained model usage report (tabs, charts, projections) to the pi-aftc-toolset data folder and open it in your browser",
            handler: async (_a: string, ctx: ExtensionCommandContext) => this.runReport(ctx),
        });
        this.pi.registerCommand("usage-clear", {
            description: "Permanently clear all recorded turns from the SQLite database (asks for confirmation)",
            handler: async (_a: string, ctx: ExtensionCommandContext) => this.runClear(ctx),
        });
    }

    private reportDir(): string { return getDataDir(); }

    // -------------------------------------------------------------------
    // HTML generation
    //
    // NOTE for maintainers: the client-side JS below lives inside a TS
    // template literal, so it must NOT use backticks or ${} — string
    // concatenation only. The only interpolations are ${title} and ${json}.
    // -------------------------------------------------------------------

    private generateReportHtml(data: any): string {
        const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
        const title = "PI AFTC Toolset - Model Usage Report";
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js" defer></script>
<style>
  :root {
    --bg:#0f1115; --panel:#161a22; --panel-2:#1d2230; --border:#2a3142;
    --text:#e6e9ef; --muted:#8b94a7; --sub-white:#aeb6c6;
    --accent:#6aa9ff; --good:#5ad19a; --warn:#f3b664; --bad:#ef6b6b;
    --bar:#4d8df6; --bar-2:#76e0c2;
    --orange:#fca02f; --orange-dim:#c97e1f;
  }
  * { box-sizing:border-box; }
  html, body { margin:0; padding:0; background:var(--bg); color:var(--text);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  body::before { content:""; display:block; height:3px;
    background:linear-gradient(90deg, var(--orange), rgba(252,160,47,0) 55%); }
  main { max-width:1180px; margin:0 auto; padding:26px 20px 64px; }
  header { margin-bottom:22px; }
  h1 { font-size:22px; margin:0; display:flex; align-items:center; gap:10px; }
  .title-mark { width:9px; height:22px; background:var(--orange); border-radius:2px; flex:none; }
  .brand-sub { color:var(--sub-white); font-size:13px; font-weight:600;
    letter-spacing:.14em; text-transform:uppercase; margin-top:6px; }
  .generated { color:var(--orange); font-size:12px; margin-top:3px;
    font-variant-numeric:tabular-nums; }
  h2 { font-size:14px; margin:26px 0 10px; }
  h2 .section-meta { color:var(--muted); font-size:11px; font-weight:400; margin-left:8px; }

  /* Tabs */
  .tabs { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:18px; }
  .tabs::after { content:""; flex:1; border-bottom:2px solid var(--border); }
  .tab { background:none; border:none; color:var(--muted); font:inherit;
    font-size:13px; font-weight:600; padding:10px 16px; cursor:pointer;
    border-bottom:2px solid var(--border); white-space:nowrap; }
  .tab:hover { color:var(--text); }
  .tab.active { color:var(--orange); border-bottom-color:var(--orange); }
  .tab:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .tab-panel.hidden { display:none; }

  /* Cards */
  .panel { background:var(--panel); border:1px solid var(--border);
    border-radius:10px; padding:14px 16px; }
  .stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(165px,1fr)); gap:10px; }
  .stat-label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .stat-value { font-size:20px; font-weight:700; margin-top:4px; font-variant-numeric:tabular-nums; }
  .stat-value.money { color:var(--orange); }
  .stat-sub { color:var(--muted); font-size:12px; margin-top:2px; }
  .period-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px; }
  .period-cost { font-size:22px; font-weight:700; color:var(--orange);
    margin-top:4px; font-variant-numeric:tabular-nums; }
  .period-score { margin-top:8px; border-top:1px solid var(--border); padding-top:6px; }
  .period-score-row { display:flex; justify-content:space-between; align-items:baseline;
    font-size:11px; line-height:1.7; gap:4px; }
  .period-score-label { color:var(--muted); white-space:nowrap; }
  .period-score-val { color:var(--text); font-weight:600; text-align:right;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .period-score-val .metric { color:var(--muted); font-weight:400; margin-left:4px; }
  .na-mark { color:var(--muted); font-style:italic; font-weight:600; }
  .period-score-val .col-hint { margin-left:6px; vertical-align:0; }
  .empty { color:var(--muted); font-style:italic; padding:12px 4px; }

  /* Charts */
  .chart-grid { display:grid; grid-template-columns:1.58fr 1fr; gap:10px; margin-top:10px; }
  @media(max-width:900px){ .chart-grid { grid-template-columns:1fr; } }
  /* Grid children must be able to shrink: without min-width:0 the canvas
     locks wide after a shrink/expand resize and overflows the viewport. */
  .chart-grid > .panel { min-width:0; }
  .chart-box { position:relative; height:250px; overflow:hidden; }
  .chart-box.sm { height:210px; }
  .panel-title { font-size:13px; font-weight:700; margin-bottom:10px; }
  .panel-sub { color:var(--muted); font-weight:400; font-size:11px; margin-left:6px; }
  .chart-fallback { color:var(--muted); font-size:12px; font-style:italic;
    padding:24px 8px; text-align:center; }

  /* Toolbar + selects */
  .toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center;
    justify-content:space-between; margin:0 0 10px; }
  .period-label { color:var(--muted); font-size:12px; display:flex; align-items:center; gap:8px; }
  select { background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:8px;
    padding:6px 12px; font-size:13px; font-family:inherit; cursor:pointer; }
  select:focus { outline:none; border-color:var(--orange); }
  select option { background:var(--panel-2); color:var(--text); }

  /* Tables */
  .table-panel { padding:6px 0 8px; }
  .table-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:780px; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--border); white-space:nowrap; }
  th { color:var(--muted); font-size:11px; text-transform:uppercase;
    letter-spacing:.05em; cursor:pointer; user-select:none; }
  th .arrow { color:var(--orange); margin-left:4px; opacity:0; font-size:10px; }
  th:hover .arrow { opacity:.45; }
  th.sorted .arrow { opacity:1; }
  .col-hint { display:inline-flex; align-items:center; margin-left:5px;
    color:var(--muted); vertical-align:-1px; cursor:help; }
  .col-hint:hover { color:var(--orange); }
  .col-tip { position:fixed; z-index:50; max-width:250px; background:var(--panel-2);
    border:1px solid var(--border); border-radius:8px; padding:8px 11px;
    font-size:12px; line-height:1.45; color:var(--text);
    box-shadow:0 8px 24px rgba(0,0,0,.5); pointer-events:none;
    opacity:0; transition:opacity .12s ease; }
  .col-tip.show { opacity:1; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:hover { background:var(--panel-2); }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .bar-cell { display:flex; align-items:center; gap:8px; min-width:150px; }
  .bar-track { flex:1; height:6px; background:var(--panel-2); border-radius:3px; overflow:hidden; min-width:56px; }
  .bar-fill { height:100%; border-radius:3px;
    background:linear-gradient(90deg, var(--orange-dim), var(--orange)); }

  /* Pills */
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .pill.good { background:rgba(90,209,154,.14); color:var(--good); }
  .pill.warn { background:rgba(243,182,100,.14); color:var(--warn); }
  .pill.bad { background:rgba(239,107,107,.14); color:var(--bad); }
  .lvl { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600;
    background:var(--panel-2); color:var(--muted); border:1px solid var(--border); }
  .lvl.high { background:rgba(106,169,255,.14); color:var(--accent); border-color:transparent; }
  .lvl.medium { background:rgba(243,182,100,.14); color:var(--warn); border-color:transparent; }
  .lvl.low { background:rgba(90,209,154,.14); color:var(--good); border-color:transparent; }
  .est { color:var(--warn); cursor:help; font-weight:700; margin-left:3px; }

  /* Timings */
  .duo-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; }
  @media(max-width:900px){ .duo-grid { grid-template-columns:1fr; } }
  .duo-grid > .panel { min-width:0; }
  .split-bar { display:flex; height:18px; border-radius:9px; overflow:hidden;
    background:var(--panel-2); margin:12px 0 10px; }
  .split-seg { height:100%; }
  .split-legend { display:flex; flex-wrap:wrap; gap:4px 18px; font-size:12px; color:var(--muted); }
  .split-legend .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .split-legend b { color:var(--text); font-weight:600; font-variant-numeric:tabular-nums; }
  .mini-table { min-width:0; }
  .mini-table th { cursor:default; }

  .note { color:var(--muted); font-size:12px; line-height:1.55; margin:10px 0; }
  .note.estimate { color:var(--warn); }
  footer { color:var(--muted); font-size:11px; margin:34px 0 18px; text-align:center; line-height:1.7; }
</style>
</head>
<body>
<main>
  <header>
    <h1><span class="title-mark"></span>${title}</h1>
    <div class="brand-sub">All For The Code</div>
    <div class="generated" id="generated-at"></div>
  </header>

  <nav class="tabs" role="tablist" aria-label="Report sections">
    <button class="tab active" data-tab="overview" role="tab" aria-selected="true">Overview</button>
    <button class="tab" data-tab="models" role="tab" aria-selected="false">Models</button>
    <button class="tab" data-tab="thinking" role="tab" aria-selected="false">Thinking levels</button>
    <button class="tab" data-tab="timings" role="tab" aria-selected="false">Timings</button>
    <button class="tab" data-tab="projections" role="tab" aria-selected="false">Projections</button>
  </nav>

  <!-- ======================= OVERVIEW ======================= -->
  <section class="tab-panel" id="panel-overview" role="tabpanel">
    <div class="stat-grid" id="stat-grid"></div>
    <p class="note" style="margin:6px 2px 0">Cost averages are based on paid turns only — free / $0 (subscription)
    models still count toward prompt, cache and timing figures.</p>

    <div class="chart-grid">
      <div class="panel">
        <div class="panel-title">Daily spend <span class="panel-sub">last 30 days</span></div>
        <div class="chart-box"><canvas id="chart-daily"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-title">Cost share by model <span class="panel-sub">all time</span></div>
        <div class="chart-box"><canvas id="chart-share"></canvas></div>
      </div>
    </div>

    <h2>Period summary</h2>
    <div class="period-grid" id="period-grid"></div>
  </section>

  <!-- ======================= MODELS ======================= -->
  <section class="tab-panel hidden" id="panel-models" role="tabpanel">
    <div class="toolbar">
      <div class="panel-title" style="margin:0">Per-model cost report</div>
      <label class="period-label">Period
        <select id="models-period">
          <option value="daily">Last 24 hours</option>
          <option value="weekly">Last 7 days</option>
          <option value="monthly">Last 28 days</option>
          <option value="all" selected>All time</option>
        </select>
      </label>
    </div>
    <div class="panel" style="margin-bottom:10px">
      <div class="panel-title">Cost by model <span class="panel-sub" id="models-chart-sub">all time</span></div>
      <div class="chart-box sm"><canvas id="chart-models"></canvas></div>
    </div>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table id="models-table"></table>
      </div>
      <div id="models-empty" class="empty" hidden>No data for this period.</div>
    </div>
  </section>

  <!-- ======================= THINKING ======================= -->
  <section class="tab-panel hidden" id="panel-thinking" role="tabpanel">
    <div class="toolbar">
      <div class="panel-title" style="margin:0">Per-model × thinking level</div>
      <label class="period-label">Period
        <select id="thinking-period">
          <option value="daily">Last 24 hours</option>
          <option value="weekly">Last 7 days</option>
          <option value="monthly">Last 28 days</option>
          <option value="all" selected>All time</option>
        </select>
      </label>
    </div>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table id="thinking-table"></table>
      </div>
      <div id="thinking-empty" class="empty" hidden>No data for this period.</div>
    </div>
  </section>

  <!-- ======================= TIMINGS ======================= -->
  <section class="tab-panel hidden" id="panel-timings" role="tabpanel">
    <div class="toolbar">
      <div class="panel-title" style="margin:0">Task Time &amp; turn timings</div>
      <label class="period-label">Period
        <select id="timings-period">
          <option value="daily">Last 24 hours</option>
          <option value="weekly">Last 7 days</option>
          <option value="monthly">Last 28 days</option>
          <option value="all" selected>All time</option>
        </select>
      </label>
    </div>
    <div class="stat-grid" id="timings-cards"></div>

    <div class="chart-grid">
      <div class="panel">
        <div class="panel-title">Avg Task Time by model <span class="panel-sub" id="task-model-sub">all time</span></div>
        <div class="chart-box sm"><canvas id="chart-task-model"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-title">Daily Avg Task Time <span class="panel-sub">last 30 days · completed tasks</span></div>
        <div class="chart-box sm"><canvas id="chart-task-daily"></canvas></div>
      </div>
    </div>

    <div class="duo-grid">
      <div class="panel">
        <div class="panel-title">Where the task time goes <span class="panel-sub">completed tasks</span></div>
        <div id="time-split"></div>
      </div>
      <div class="panel">
        <div class="panel-title">User-prompt vs AI turns <span class="panel-sub">per-turn timings</span></div>
        <div class="table-wrap"><table class="mini-table" id="turn-split"></table></div>
      </div>
    </div>

    <h2>Longest tasks <span class="section-meta">top 10 completed tasks in the selected period</span></h2>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table id="longest-table"></table>
      </div>
      <div id="longest-empty" class="empty" hidden>No completed tasks in this period.</div>
    </div>

    <p class="note"><b>Task Time</b> is the wall-clock time from when you press enter to when the AI fully
    returns control &mdash; one prompt's complete agent run, across all its tool-call turns (questions, steering,
    retries and compaction included). Averages and the longest-task list cover <b>completed</b> tasks only;
    failed runs (error / abort) are counted in the cards above but never averaged into Task Time. Think and
    response times come from the per-turn table.</p>
  </section>

  <!-- ======================= PROJECTIONS ======================= -->
  <section class="tab-panel hidden" id="panel-projections" role="tabpanel">
    <div class="stat-grid" id="proj-cards"></div>
    <p class="note" id="proj-note"></p>
    <div class="panel table-panel">
      <div class="table-wrap">
        <table id="proj-table"></table>
      </div>
      <div id="proj-empty" class="empty" hidden>No data recorded yet.</div>
    </div>
    <p class="note">Per-model figures assume each future day looks like your average <b>active day</b>
    with that model (spend ÷ active days). The overall burn rate divides all-time spend by every
    calendar day since recording began, including idle days. Rows marked <span class="est">~</span>
    are estimates from fewer than 7 active days. Models with zero total cost are excluded.</p>
  </section>

  <footer>Generated by pi-aftc-toolset &middot; /usage-report &middot; All For The Code<br>Author Darcey.Lloyd@gmail.com</footer>
</main>
<script type="application/json" id="report-data">${json}</script>
<script type="module">
  var data = JSON.parse(document.getElementById("report-data").textContent || "{}");

  // ---------- formatters ----------
  function fmtMoney(v){ v=Number(v)||0; var a=Math.abs(v); if(a===0) return "$0.00";
    var s; if(a<1) s=v.toFixed(4); else if(a<1000) s=v.toFixed(2);
    else s=String(Math.round(v));
    var parts=s.split("."); parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,",");
    return "$"+parts.join("."); }
  function fmtInt(v){ return (Number(v)||0).toLocaleString("en-US"); }
  function fmtTok(v){ v = Number(v)||0; if (v>=1e9) return (v/1e9).toFixed(1)+"B"; if (v>=1e6) return (v/1e6).toFixed(1)+"M"; if (v>=1e3) return (v/1e3).toFixed(1)+"K"; return String(Math.round(v)); }
  function fmtPct(v){ return ((Number(v)||0)*100).toFixed(1)+"%"; }
  function fmtMs(ms){ ms=Number(ms)||0; if(ms<=0) return "0s";
    var t=Math.round(ms/1000),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60,p=[];
    if(h>0) p.push(h+"h"); if(m>0) p.push(m+"m"); if(s>0||p.length===0) p.push(s+"s");
    return p.join(" "); }
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function cachePill(rate){ var p=(Number(rate)||0)*100; var cls = p>=60?"good":p>=30?"warn":"bad"; return '<span class="pill '+cls+'">'+p.toFixed(1)+"%</span>"; }
  function thinkingPill(level){
    var l = String(level||"").toLowerCase(); var cls = "";
    if (l==="high"||l==="xhigh") cls = " high";
    else if (l==="medium"||l==="med") cls = " medium";
    else if (l==="low"||l==="off"||l==="minimal") cls = " low";
    return '<span class="lvl'+cls+'">'+esc(level)+'</span>';
  }

  // ---------- column info hints ----------
  var INFO_SVG = '<svg class="info-i" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">'
    + '<circle cx="8" cy="8" r="6.8" fill="none" stroke="currentColor" stroke-width="1.4"/>'
    + '<circle cx="8" cy="5" r="1.1" fill="currentColor"/>'
    + '<rect x="7.1" y="7.2" width="1.8" height="4.6" rx="0.9" fill="currentColor"/></svg>';
  var HINT_AI_PER_USER = "Average number of AI (self-prompted) turns per user prompt - how many tool-call loops the model runs for each prompt you type. Lower is more efficient.";
  var HINT_AVG_PUP = "Average cost per user prompt: total cost ÷ user prompts on paid turns. Free / $0 (subscription) turns are excluded so they don't drag the average down.";
  var HINT_AVG_CACHE = "Average cache hit rate per turn: cached tokens ÷ (cached + new input tokens). Higher means cheaper, faster repeat context.";
  var HINT_TASK_TIME = "Task Time: This is how long the AI took to fully handle a prompt and return control.";
  // (N/A tooltip reasons come from the data — each na row carries its own.)
  var colTip = null;
  function showColTip(anchor, text){
    if (!colTip){ colTip = document.createElement("div"); colTip.className = "col-tip"; document.body.appendChild(colTip); }
    colTip.textContent = text;
    colTip.style.visibility = "hidden";
    colTip.classList.add("show");
    var r = anchor.getBoundingClientRect();
    var tw = colTip.offsetWidth, th = colTip.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width/2 - tw/2), window.innerWidth - tw - 8);
    var y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8);
    colTip.style.left = x+"px"; colTip.style.top = y+"px";
    colTip.style.visibility = "";
  }
  function hideColTip(){ if (colTip) colTip.classList.remove("show"); }
  function bindHints(scope){
    scope.querySelectorAll(".col-hint").forEach(function(el){
      el.addEventListener("mouseenter", function(){ showColTip(el, el.dataset.tip || ""); });
      el.addEventListener("mouseleave", hideColTip);
      el.addEventListener("click", function(e){ e.stopPropagation(); showColTip(el, el.dataset.tip || ""); });
    });
  }

  // ---------- header ----------
  (function(){
    var d = new Date(data.generatedAt || Date.now());
    function p(n){ return String(n).padStart(2,"0"); }
    document.getElementById("generated-at").textContent =
      "Generated on: " + String(d.getFullYear()).slice(2) + p(d.getMonth()+1) + p(d.getDate()) + " - " + p(d.getHours()) + ":" + p(d.getMinutes());
  })();

  // ---------- tabs ----------
  var TAB_IDS = ["overview","models","thinking","timings","projections"];
  function activateTab(id){
    document.querySelectorAll(".tab").forEach(function(b){
      var on = b.dataset.tab === id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach(function(p){
      p.classList.toggle("hidden", p.id !== "panel-"+id);
    });
    if (history.replaceState) history.replaceState(null, "", "#"+id);
    if (id === "models") ensureModelsChart();
    if (id === "timings") ensureTimingsCharts();
  }
  document.querySelectorAll(".tab").forEach(function(b){
    b.addEventListener("click", function(){ activateTab(b.dataset.tab); });
  });
  var initialTab = (location.hash || "").replace("#","");
  if (TAB_IDS.indexOf(initialTab) < 0) initialTab = "overview";

  // ---------- stat cards ----------
  function statCard(label, valueHtml, sub, money){
    return '<div class="panel stat"><div class="stat-label">'+esc(label)+'</div>'
      + '<div class="stat-value'+(money ? " money" : "")+'">'+valueHtml+'</div>'
      + (sub ? '<div class="stat-sub">'+esc(sub)+'</div>' : '') + '</div>';
  }
  function renderOverview(){
    var t = data.totals || {};
    var since = t.firstTurnMs
      ? new Date(t.firstTurnMs).toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" })
      : "";
    var html = "";
    html += statCard("Total cost", fmtMoney(t.totalCost), "avg "+fmtMoney(t.avgDailySpend)+" / day", true);
    html += statCard("User prompts", fmtInt(t.userPromptCount), fmtInt(t.basePromptCount)+" tasks · "+fmtInt(t.subPromptCount)+" follow-ups");
    html += statCard("AI prompts", fmtInt(t.automatedTurnCount), "self-prompting · "+((Number(t.automatedTurnCount)||0)/Math.max(1, Number(t.userPromptCount)||0)).toFixed(1)+" per user prompt");
    html += statCard("Avg cost / user prompt", fmtMoney(t.avgCostPerUserPrompt), fmtMoney(t.avgCostPerTurn)+" per turn (user + AI)");
    html += statCard("Avg cache hit", fmtPct(t.avgCacheRate), fmtTok(t.totalCacheRead)+" cache-read tokens");
    html += statCard("Active days", fmtInt(t.activeDays), since ? "recording since "+since : "");
    document.getElementById("stat-grid").innerHTML = html;

    var ph = "";
    ["daily","weekly","monthly"].forEach(function(key){
      var p = (data.periods || {})[key] || {};
      var scoreHtml = "";
      if (p.scoreboard && p.scoreboard.length) {
        scoreHtml = '<div class="period-score">';
        p.scoreboard.forEach(function(e){
          var valHtml = e.na
            ? '<span class="na-mark">N/A</span><span class="col-hint" data-tip="' + esc(e.na) + '">' + INFO_SVG + '</span>'
            : esc(e.model) + (e.value ? '<span class="metric">' + esc(e.value) + '</span>' : '');
          scoreHtml += '<div class="period-score-row">'
            + '<span class="period-score-label">' + esc(e.label) + '</span>'
            + '<span class="period-score-val">' + valHtml + '</span></div>';
        });
        scoreHtml += '</div>';
      }
      ph += '<div class="panel period-card"><div class="stat-label">'+esc(p.label || key)+'</div>'
        + '<div class="period-cost">'+fmtMoney(p.cost)+'</div>'
        + '<div class="stat-sub">Prompts: User '+fmtInt(p.prompts)+' / AI '+fmtInt(p.aiPrompts)+'</div>'
        + scoreHtml + '</div>';
    });
    document.getElementById("period-grid").innerHTML = ph;
    bindHints(document.getElementById("period-grid"));
  }

  // ---------- charts ----------
  var PALETTE = ["#fca02f","#4d8df6","#4ade80","#b388ff","#ef6b6b","#22d3ee","#facc15","#ff8fab","#2dd4bf","#94a3b8"];
  var chartsOk = typeof window.Chart !== "undefined";
  if (chartsOk){
    Chart.defaults.color = "#8b94a7";
    Chart.defaults.borderColor = "rgba(139,148,167,.12)";
    Chart.defaults.font.family = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
  }
  function chartFallback(canvasId, msg){
    var c = document.getElementById(canvasId);
    if (!c) return;
    var d = document.createElement("div");
    d.className = "chart-fallback";
    d.textContent = msg || "Charts need network access to load Chart.js from the CDN — all tables and cards still work.";
    c.parentNode.replaceChild(d, c);
  }
  var tooltipBase = { backgroundColor:"#1d2230", borderColor:"#2a3142", borderWidth:1, titleColor:"#e6e9ef", bodyColor:"#8b94a7", padding:10, displayColors:false };

  function renderDailyChart(){
    if (!chartsOk){ chartFallback("chart-daily"); return; }
    var series = data.dailySeries || [];
    var canvas = document.getElementById("chart-daily");
    if (!canvas) return;
    var lastIdx = series.length - 1;
    new Chart(canvas, {
      type: "bar",
      data: {
        labels: series.map(function(p){ return p.label; }),
        datasets: [{
          data: series.map(function(p){ return Number(p.cost)||0; }),
          backgroundColor: series.map(function(_,i){ return i === lastIdx ? "#fca02f" : "#4d8df6"; }),
          borderRadius: 3,
          maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltipBase, {
            callbacks: {
              label: function(item){
                var p = series[item.dataIndex] || {};
                return ["Cost: "+fmtMoney(p.cost), "User prompts: "+fmtInt(p.prompts), "AI prompts: "+fmtInt(Math.max(0,(p.calls||0)-(p.prompts||0)))];
              },
            },
          }),
        },
        scales: {
          x: { grid:{ display:false }, ticks:{ maxTicksLimit:10, maxRotation:0 } },
          y: { beginAtZero:true, ticks:{ maxTicksLimit:6, callback:function(v){ return fmtMoney(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
        },
      },
    });
  }

  function renderShareChart(){
    if (!chartsOk){ chartFallback("chart-share"); return; }
    var canvas = document.getElementById("chart-share");
    if (!canvas) return;
    var rows = ((data.modelsByPeriod || {}).all || []).slice().sort(function(a,b){ return b.cost - a.cost; });
    if (!rows.length){ chartFallback("chart-share", "No data recorded yet."); return; }
    var top = rows.slice(0, 7);
    var rest = rows.slice(7);
    var pairs = top.map(function(r){ return { label: r.modelName, cost: Number(r.cost) || 0 }; });
    if (rest.length){
      pairs.push({ label: "Other", cost: rest.reduce(function(s,r){ return s + (Number(r.cost) || 0); }, 0) });
    }
    // Drop slices that would format as 0.0% — invisible on the pie, legend clutter.
    var totalAll = pairs.reduce(function(s,p){ return s + p.cost; }, 0);
    if (totalAll > 0) pairs = pairs.filter(function(p){ return (p.cost / totalAll * 100) >= 0.05; });
    if (!pairs.length){ chartFallback("chart-share", "No cost data recorded yet."); return; }
    var labels = pairs.map(function(p){ return p.label; });
    var costs = pairs.map(function(p){ return p.cost; });
    var total = costs.reduce(function(s,v){ return s+v; }, 0);
    var centerTotal = {
      id: "centerTotal",
      afterDraw: function(chart){
        var meta = chart.getDatasetMeta(0);
        if (!meta.data[0]) return;
        var x = meta.data[0].x, y = meta.data[0].y;
        var c = chart.ctx;
        c.save();
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillStyle = "#e6e9ef";
        c.font = "700 16px " + Chart.defaults.font.family;
        c.fillText(fmtMoney(total), x, y - 8);
        c.fillStyle = "#8b94a7";
        c.font = "11px " + Chart.defaults.font.family;
        c.fillText("total", x, y + 10);
        c.restore();
      },
    };
    new Chart(canvas, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: costs, backgroundColor: PALETTE, borderColor: "#161a22", borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: {
          legend: { position: window.innerWidth >= 860 ? "right" : "bottom",
            labels: { color:"#e6e9ef", boxWidth:10, boxHeight:10, padding:10, usePointStyle:true,
              generateLabels: function(chart){
                var ds = chart.data.datasets[0];
                return chart.data.labels.map(function(lbl, i){
                  var v = Number(ds.data[i])||0;
                  var pct = total>0 ? (v/total*100).toFixed(1) : "0.0";
                  // fontColor is read off the item with NO global fallback —
                  // omit it and the legend text renders black (canvas default).
                  return { text: lbl+" ("+pct+"%)", fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i], pointStyle: "circle",
                    fontColor: "#e6e9ef", color: "#e6e9ef",
                    hidden: !chart.getDataVisibility(i), index: i };
                });
              } } },
          tooltip: Object.assign({}, tooltipBase, {
            displayColors: true,
            callbacks: { label: function(item){
              var v = Number(item.parsed)||0;
              return " "+fmtMoney(v)+" ("+(total>0 ? (v/total*100).toFixed(1) : "0")+"%)";
            } },
          }),
        },
      },
      plugins: [centerTotal],
    });
  }

  var modelsChart = null;
  function ensureModelsChart(){
    var canvas = document.getElementById("chart-models");
    if (!canvas) return;
    if (!chartsOk){ chartFallback("chart-models"); return; }
    var rows = ((data.modelsByPeriod || {})[modelsPeriod] || []).slice()
      .sort(function(a,b){ return b.cost - a.cost; }).slice(0, 8);
    var labels = rows.map(function(r){ return r.modelName; });
    var costs = rows.map(function(r){ return r.cost; });
    if (!modelsChart){
      modelsChart = new Chart(canvas, {
        type: "bar",
        data: { labels: labels, datasets: [{ data: costs, backgroundColor: "#fca02f", borderRadius: 3, maxBarThickness: 18 }] },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: Object.assign({}, tooltipBase, {
              callbacks: { label: function(item){ return " "+fmtMoney(item.parsed.x); } },
            }),
          },
          scales: {
            x: { beginAtZero:true, ticks:{ callback:function(v){ return fmtMoney(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
            y: { grid:{ display:false } },
          },
        },
      });
    } else {
      modelsChart.data.labels = labels;
      modelsChart.data.datasets[0].data = costs;
      modelsChart.update();
    }
  }

  // ---------- sortable table factory ----------
  function makeTable(opts){
    var state = { key: opts.defaultKey, dir: opts.defaultDir || "desc" };
    var table = document.getElementById(opts.tableId);
    table.innerHTML = "";
    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    opts.cols.forEach(function(c){
      var th = document.createElement("th");
      if (c.num) th.className = "num";
      th.dataset.key = c.key;
      th.innerHTML = esc(c.label)
        + (c.hint ? '<span class="col-hint" data-tip="'+esc(c.hint)+'">'+INFO_SVG+'</span>' : '')
        + '<span class="arrow">↓</span>';
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    table.appendChild(tbody);
    bindHints(table);

    function updateHead(){
      table.querySelectorAll("thead th").forEach(function(th){
        var on = th.dataset.key === state.key;
        th.classList.toggle("sorted", on);
        var a = th.querySelector(".arrow");
        if (a) a.textContent = on ? (state.dir === "asc" ? "↑" : "↓") : "↓";
      });
    }
    function render(){
      var rows = (opts.getRows() || []).slice();
      var empty = document.getElementById(opts.emptyId);
      if (!rows.length){ tbody.innerHTML = ""; empty.hidden = false; updateHead(); return; }
      empty.hidden = true;
      rows.sort(function(a,b){
        var av = a[state.key], bv = b[state.key];
        var d = state.dir === "asc" ? 1 : -1;
        if (typeof av === "string") return String(av).localeCompare(String(bv)) * d;
        return ((Number(av)||0) - (Number(bv)||0)) * d;
      });
      var html = "";
      rows.forEach(function(r){
        html += "<tr>";
        opts.cols.forEach(function(c){
          html += '<td class="'+(c.num ? "num" : "")+'">'+(c.render ? c.render(r) : esc(r[c.key]))+"</td>";
        });
        html += "</tr>";
      });
      tbody.innerHTML = html;
      updateHead();
    }
    table.querySelectorAll("thead th").forEach(function(th){
      th.addEventListener("click", function(){
        var k = th.dataset.key;
        if (state.key === k) state.dir = state.dir === "asc" ? "desc" : "asc";
        else { state.key = k; state.dir = th.classList.contains("num") ? "desc" : "asc"; }
        render();
      });
    });
    return { render: render };
  }

  // ---------- models table ----------
  var modelsPeriod = "all";
  var modelsMaxCost = 1;
  var modelsTable = makeTable({
    tableId: "models-table",
    emptyId: "models-empty",
    defaultKey: "cost",
    getRows: function(){
      var rows = (data.modelsByPeriod || {})[modelsPeriod] || [];
      modelsMaxCost = Math.max(1e-9, rows.reduce(function(s,r){ return Math.max(s, r.cost); }, 0));
      return rows;
    },
    cols: [
      { key:"modelName", label:"Model" },
      { key:"cost", label:"Cost", num:true, render:function(r){
          var pct = Math.max(r.cost > 0 ? 2 : 0, Math.min(100, r.cost / modelsMaxCost * 100));
          return '<div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:'+pct.toFixed(1)+'%"></div></div><span>'+fmtMoney(r.cost)+'</span></div>';
      } },
      { key:"userPrompts", label:"User prompts", num:true, render:function(r){ return fmtInt(r.userPrompts); } },
      { key:"aiPrompts", label:"AI prompts", num:true, render:function(r){ return fmtInt(r.aiPrompts); } },
      { key:"aiPerUserPrompt", label:"AI / user", num:true, hint:HINT_AI_PER_USER, render:function(r){ return (Number(r.aiPerUserPrompt)||0).toFixed(1); } },
      { key:"avgCostPerUserPrompt", label:"Avg $/Pup", num:true, hint:HINT_AVG_PUP, render:function(r){ return fmtMoney(r.avgCostPerUserPrompt); } },
      { key:"avgCacheRate", label:"Avg cache", num:true, hint:HINT_AVG_CACHE, render:function(r){ return cachePill(r.avgCacheRate); } },
      { key:"avgResponseMs", label:"Avg response", num:true, render:function(r){ return fmtMs(r.avgResponseMs); } },
      { key:"avgTaskMs", label:"Task time", num:true, hint:HINT_TASK_TIME, render:function(r){ return fmtMs(r.avgTaskMs); } },
    ],
  });
  document.getElementById("models-period").addEventListener("change", function(e){
    modelsPeriod = e.target.value;
    document.getElementById("models-chart-sub").textContent = e.target.options[e.target.selectedIndex].text.toLowerCase();
    modelsTable.render();
    ensureModelsChart();
  });

  // ---------- thinking table ----------
  var thinkingPeriod = "all";
  var thinkingTable = makeTable({
    tableId: "thinking-table",
    emptyId: "thinking-empty",
    defaultKey: "cost",
    getRows: function(){ return (data.modelThinkingByPeriod || {})[thinkingPeriod] || []; },
    cols: [
      { key:"modelName", label:"Model" },
      { key:"thinkingLevel", label:"Thinking", render:function(r){ return thinkingPill(r.thinkingLevel); } },
      { key:"cost", label:"Cost", num:true, render:function(r){ return fmtMoney(r.cost); } },
      { key:"userPrompts", label:"User prompts", num:true, render:function(r){ return fmtInt(r.userPrompts); } },
      { key:"aiPrompts", label:"AI prompts", num:true, render:function(r){ return fmtInt(r.aiPrompts); } },
      { key:"avgCostPerUserPrompt", label:"Avg $/Pup", num:true, hint:HINT_AVG_PUP, render:function(r){ return fmtMoney(r.avgCostPerUserPrompt); } },
      { key:"avgCacheRate", label:"Avg cache", num:true, hint:HINT_AVG_CACHE, render:function(r){ return cachePill(r.avgCacheRate); } },
      { key:"avgThinkingMs", label:"Avg think", num:true, render:function(r){ return fmtMs(r.avgThinkingMs); } },
      { key:"avgResponseMs", label:"Avg response", num:true, render:function(r){ return fmtMs(r.avgResponseMs); } },
      { key:"avgTaskMs", label:"Task time", num:true, hint:HINT_TASK_TIME, render:function(r){ return fmtMs(r.avgTaskMs); } },
    ],
  });
  document.getElementById("thinking-period").addEventListener("change", function(e){
    thinkingPeriod = e.target.value;
    thinkingTable.render();
  });

  // ---------- timings ----------
  var timingsPeriod = "all";
  function timingsWin(){ return (data.timings || {})[timingsPeriod] || {}; }
  var MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtWhen(ts){
    var d = new Date(Number(ts)||0);
    function p(n){ return String(n).padStart(2,"0"); }
    return d.getDate() + " " + MONTHS_SHORT[d.getMonth()] + ", " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function renderTimingsCards(){
    var w = timingsWin();
    var html = "";
    html += statCard("Avg Task Time", fmtMs(w.avgTaskMs), "over " + fmtInt(w.completed) + " completed tasks");
    html += statCard("Longest task", fmtMs(w.maxTaskMs), w.maxTaskModel || "no completed tasks");
    html += statCard("Avg turns / task", (Number(w.avgTurnsPerTask)||0).toFixed(1), "per completed task");
    html += statCard("Errors & aborts", fmtInt((Number(w.errors)||0) + (Number(w.aborted)||0)),
      fmtInt(w.errors) + " errors · " + fmtInt(w.aborted) + " aborts - counted, never averaged");
    document.getElementById("timings-cards").innerHTML = html;
  }
  function renderTimeSplit(){
    var w = timingsWin();
    var el = document.getElementById("time-split");
    var totalTask = Number(w.totalTaskMs)||0, think = Number(w.totalThinkMs)||0, resp = Number(w.totalRespMs)||0;
    if (totalTask <= 0){ el.innerHTML = '<div class="empty">No completed tasks in this period.</div>'; return; }
    var overhead = Math.max(0, totalTask - think - resp);
    function seg(ms, color, label){
      var pct = ms / totalTask * 100;
      return {
        bar: '<div class="split-seg" style="flex:' + (ms / totalTask) + ' 1 0%;background:' + color + '"></div>',
        legend: '<span><span class="dot" style="background:' + color + '"></span>' + label
          + ' <b>' + fmtMs(ms) + '</b> (' + pct.toFixed(1) + '%)</span>',
      };
    }
    var s1 = seg(think, "#b388ff", "Thinking");
    var s2 = seg(resp, "#4d8df6", "Responding");
    var s3 = seg(overhead, "#fca02f", "Tools & overhead");
    el.innerHTML = '<div class="split-bar">' + s1.bar + s2.bar + s3.bar + '</div>'
      + '<div class="split-legend">' + s1.legend + s2.legend + s3.legend + '</div>';
  }
  function renderTurnSplit(){
    var w = timingsWin();
    var rows = [
      ["User-prompt turns", Number(w.userTurns)||0, Number(w.userAvgThinkMs)||0, Number(w.userAvgRespMs)||0],
      ["AI (auto) turns", Number(w.aiTurns)||0, Number(w.aiAvgThinkMs)||0, Number(w.aiAvgRespMs)||0],
    ];
    var html = "<thead><tr><th>Turn kind</th><th class='num'>Turns</th><th class='num'>Avg think</th>"
      + "<th class='num'>Avg respond</th><th class='num'>Avg total</th></tr></thead><tbody>";
    rows.forEach(function(r){
      html += "<tr><td>" + esc(r[0]) + "</td><td class='num'>" + fmtInt(r[1]) + "</td><td class='num'>" + fmtMs(r[2])
        + "</td><td class='num'>" + fmtMs(r[3]) + "</td><td class='num'>" + fmtMs(r[2] + r[3]) + "</td></tr>";
    });
    document.getElementById("turn-split").innerHTML = html + "</tbody>";
  }
  var longestTable = makeTable({
    tableId: "longest-table",
    emptyId: "longest-empty",
    defaultKey: "taskMs",
    getRows: function(){ return timingsWin().longest || []; },
    cols: [
      { key:"timestamp", label:"When", render:function(r){ return fmtWhen(r.timestamp); } },
      { key:"modelName", label:"Model" },
      { key:"thinkingLevel", label:"Thinking", render:function(r){ return thinkingPill(r.thinkingLevel); } },
      { key:"turnCount", label:"Turns", num:true, render:function(r){ return fmtInt(r.turnCount); } },
      { key:"taskMs", label:"Task time", num:true, hint:HINT_TASK_TIME, render:function(r){ return fmtMs(r.taskMs); } },
    ],
  });
  var taskModelChart = null;
  var taskModelRows = [];
  var taskDailyChartDone = false;
  function ensureTimingsCharts(){
    var canvas = document.getElementById("chart-task-model");
    if (canvas){
      if (!chartsOk){ chartFallback("chart-task-model"); }
      else {
        taskModelRows = (timingsWin().taskByModel || []).slice()
          .sort(function(a,b){ return b.avgTaskMs - a.avgTaskMs; }).slice(0, 8);
        var labels = taskModelRows.map(function(r){ return r.modelName; });
        var vals = taskModelRows.map(function(r){ return r.avgTaskMs; });
        if (!taskModelChart){
          taskModelChart = new Chart(canvas, {
            type: "bar",
            data: { labels: labels, datasets: [{ data: vals, backgroundColor: "#fca02f", borderRadius: 3, maxBarThickness: 18 }] },
            options: {
              indexAxis: "y", responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: Object.assign({}, tooltipBase, {
                  callbacks: { label: function(item){
                    var r = taskModelRows[item.dataIndex] || {};
                    return " " + fmtMs(item.parsed.x) + " avg · " + fmtInt(r.tasks) + " task" + ((Number(r.tasks)||0) === 1 ? "" : "s");
                  } },
                }),
              },
              scales: {
                x: { beginAtZero:true, ticks:{ callback:function(v){ return fmtMs(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
                y: { grid:{ display:false } },
              },
            },
          });
        } else {
          taskModelChart.data.labels = labels;
          taskModelChart.data.datasets[0].data = vals;
          taskModelChart.update();
        }
      }
    }
    if (!taskDailyChartDone){ taskDailyChartDone = true; renderTaskDailyChart(); }
  }
  function renderTaskDailyChart(){
    if (!chartsOk){ chartFallback("chart-task-daily"); return; }
    var series = data.taskDailySeries || [];
    var canvas = document.getElementById("chart-task-daily");
    if (!canvas) return;
    var lastIdx = series.length - 1;
    new Chart(canvas, {
      type: "bar",
      data: {
        labels: series.map(function(p){ return p.label; }),
        datasets: [{
          data: series.map(function(p){ return Number(p.avgTaskMs)||0; }),
          backgroundColor: series.map(function(p, i){
            if ((Number(p.tasks)||0) === 0) return "rgba(139,148,167,.18)";
            return i === lastIdx ? "#fca02f" : "#4d8df6";
          }),
          borderRadius: 3,
          maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltipBase, {
            callbacks: { label: function(item){
              var p = series[item.dataIndex] || {};
              var n = Number(p.tasks)||0;
              return n === 0 ? " No completed tasks" : ["Avg Task Time: " + fmtMs(p.avgTaskMs), "Completed tasks: " + fmtInt(n)];
            } },
          }),
        },
        scales: {
          x: { grid:{ display:false }, ticks:{ maxTicksLimit:10, maxRotation:0 } },
          y: { beginAtZero:true, ticks:{ maxTicksLimit:6, callback:function(v){ return fmtMs(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
        },
      },
    });
  }
  function renderTimingsAll(){
    renderTimingsCards();
    renderTimeSplit();
    renderTurnSplit();
    longestTable.render();
    ensureTimingsCharts();
  }
  document.getElementById("timings-period").addEventListener("change", function(e){
    timingsPeriod = e.target.value;
    document.getElementById("task-model-sub").textContent = e.target.options[e.target.selectedIndex].text.toLowerCase();
    renderTimingsAll();
  });

  // ---------- projections ----------
  function estMark(r){
    return r.estimated ? '<span class="est" title="Fewer than 7 active days recorded — estimate">~</span>' : '';
  }
  function renderProjCards(){
    var p = data.projections || {};
    var html = "";
    html += statCard("Avg cost / day", fmtMoney(p.avgDailySpend), "all models · "+fmtInt(p.calendarDays)+" calendar days", true);
    html += statCard("Projected / month", fmtMoney(p.projectedMonth), "avg day × 30.4");
    html += statCard("Projected / year", fmtMoney(p.projectedYear), "avg day × 365");
    document.getElementById("proj-cards").innerHTML = html;
    var note = document.getElementById("proj-note");
    note.textContent = p.note || "";
    note.classList.toggle("estimate", !!p.estimated);
  }
  var projTable = makeTable({
    tableId: "proj-table",
    emptyId: "proj-empty",
    defaultKey: "costPerDay",
    getRows: function(){ return (data.projections || {}).rows || []; },
    cols: [
      { key:"modelName", label:"Model" },
      { key:"thinkingLevel", label:"Thinking", render:function(r){ return thinkingPill(r.thinkingLevel); } },
      { key:"activeDays", label:"Active days", num:true, render:function(r){ return fmtInt(r.activeDays); } },
      { key:"userPrompts", label:"Prompts (User / AI)", num:true, render:function(r){ return fmtInt(r.userPrompts)+' / '+fmtInt(r.aiPrompts); } },
      { key:"cost", label:"Total cost", num:true, render:function(r){ return fmtMoney(r.cost); } },
      { key:"costPerDay", label:"$ / day", num:true, render:function(r){ return fmtMoney(r.costPerDay)+estMark(r); } },
      { key:"costPerWeek", label:"$ / week", num:true, render:function(r){ return fmtMoney(r.costPerWeek)+estMark(r); } },
      { key:"costPerMonth", label:"$ / month", num:true, render:function(r){ return fmtMoney(r.costPerMonth)+estMark(r); } },
      { key:"costPerYear", label:"$ / year", num:true, render:function(r){ return fmtMoney(r.costPerYear)+estMark(r); } },
    ],
  });

  // ---------- boot ----------
  renderOverview();
  renderDailyChart();
  renderShareChart();
  modelsTable.render();
  thinkingTable.render();
  renderTimingsCards();
  renderTimeSplit();
  renderTurnSplit();
  longestTable.render();
  renderProjCards();
  projTable.render();
  activateTab(initialTab);
</script>
</body>
</html>`;
    }

    // -------------------------------------------------------------------
    // Writing & launching
    // -------------------------------------------------------------------

    private writeReportHtml(html: string): string {
        const dir = this.reportDir();
        fs.mkdirSync(dir, { recursive: true });
        const filePath = getReportFile();
        fs.writeFileSync(filePath, html, "utf-8");
        return filePath;
    }

    private async launchBrowser(filePath: string, ctx: ExtensionCommandContext): Promise<void> {
        let cmd: string; let args: string[];
        if (process.platform === "win32") { cmd = "cmd"; args = ["/c", "start", "", filePath]; }
        else if (process.platform === "darwin") { cmd = "open"; args = [filePath]; }
        else { cmd = "xdg-open"; args = [filePath]; }
        try { await this.pi.exec(cmd, args, { timeout: 10_000 }); }
        catch {
            try { await this.pi.exec("cmd", ["/c", "start", "", filePath], { timeout: 10_000 }); }
            catch (err2) { ctx.ui.notify?.(`Browser launch failed (${(err2 as Error).message}). File written to ${filePath} — open it manually.`, "error"); }
        }
    }

    private async runReport(ctx: ExtensionCommandContext): Promise<void> {
        const data = this.collectReportData();
        if (!data) { ctx.ui.notify?.("Cannot generate HTML report: better-sqlite3 is not available. Run /aftc-install.", "error"); return; }
        let reportPath: string;
        try { reportPath = this.writeReportHtml(this.generateReportHtml(data)); }
        catch (err) { ctx.ui.notify?.(`Failed to write report.html: ${(err as Error).message}`, "error"); return; }
        ctx.ui.notify?.(`Wrote ${reportPath}`, "info");
        if (!ctx.hasUI) { console.log(`[aftc-toolset] HTML report written: ${reportPath}`); return; }
        void this.launchBrowser(reportPath, ctx);
    }
}

export function createUsageModule(pi: ExtensionAPI): UsageModule {
    const m = new UsageModule(pi);
    m.attach();
    return m;
}

export { isDbAvailable, fmtMoneyServer };
