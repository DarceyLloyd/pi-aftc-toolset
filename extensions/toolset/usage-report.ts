/**
 * pi-aftc-toolset — usage-report feature module.
 *
 * Reads the per-turn SQLite database (populated by usage-recording.ts)
 * and writes a self-contained HTML report to
 * <package-root>/.pi-aftc-toolset/data/report.html, then opens it in the
 * user's browser.
 *
 * The HTML is intentionally one file: embedded CSS, embedded JSON,
 * embedded JS — no external dependencies. The report includes
 * lifetime totals, model leaderboards, summary cards, trend chart,
 * per-model cost tables, model × thinking level breakdown, and cost
 * projections across multiple horizons.
 *
 * Per rules.md §1.5, this is a self-contained feature module: it owns
 * no shared state with other feature modules and is wired into pi by
 * the orchestrator in index.ts. It does not import core.ts or
 * usage-recording.ts (it only reads the DB they share).
 *
 * See `usage-report.readme.md` for the full report contents and the
 * projection math.
 */

import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getDb, isDbAvailable } from "./db";
import { getDataDir, getReportFile } from "./paths";

type PeriodName = "Today" | "Week" | "Month" | "Last 3 Hours" | "Last 6 Hours" | "Last 12 Hours";
type ProjectionHorizon = "6h" | "12h" | "1d" | "7d" | "30d";
type TrendGrain = "Hourly" | "Daily" | "Weekly" | "Monthly";

interface PeriodUsage {
    period: PeriodName;
    modelName: string | null;
    turnCount: number;
    userPromptCount: number;
    basePromptCount: number;
    subPromptCount: number;
    steeringPromptCount: number;
    followupPromptCount: number;
    continuationPromptCount: number;
    cost: number;
}

interface ModelProjection {
    horizon: ProjectionHorizon;
    horizonHours: number;
    predictedCost: number | null;
    turnsPerHour: number;
    promptsPerHour: number;
    windowTurns: number;
    windowUserPrompts: number;
    windowActiveHours: number;
    sufficientData: boolean;
    confidence: "low" | "medium" | "high";
    note: string;
}

interface ModelReport {
    modelName: string;
    periods: Array<{ period: PeriodName; totalCost: number; turnCount: number; userPromptCount: number; basePromptCount: number; subPromptCount: number; steeringPromptCount: number; followupPromptCount: number; continuationPromptCount: number }>;
    averages: {
        avgCost: number;
        avgCostPerUserPrompt: number;
        avgCostPerBasePrompt: number;
        avgThinkingMs: number;
        avgResponseMs: number;
        avgCacheRate: number;
        turnCount: number;
        userPromptCount: number;
        basePromptCount: number;
        subPromptCount: number;
        steeringPromptCount: number;
        followupPromptCount: number;
        continuationPromptCount: number;
        turnsPerUserPrompt: number;
        maxTurnsPerPrompt: number;
        avgTurnsPerBasePrompt: number;
        activeHours: number;
        totalCost: number;
    };
    periodStats: Array<{ period: string; turnCount: number; userPromptCount: number; basePromptCount: number; subPromptCount: number; cost: number; avgCostPerTurn: number; avgResponseMs: number; avgThinkingMs: number; avgCacheRate: number; }>;
    projections: ModelProjection[];
}

interface SummaryEntry {
    title: string;
    modelName: string | null;
    primary: string;
    secondary: string;
    severity: "good" | "warn" | "bad" | "info";
    metric: number;
    description: string;
}

interface TrendPoint {
    grain: TrendGrain;
    bucket: string;
    label: string;
    modelName: string;
    turns: number;
    userPrompts: number;
    basePrompts: number;
    subPrompts: number;
    steeringPrompts: number;
    followupPrompts: number;
    continuationPrompts: number;
    cost: number;
    avgCacheRate: number;
    avgCostPerTurn: number;
}

interface DailyStats {
    day: string;
    modelName: string;
    turns: number;
    userPrompts: number;
    basePrompts: number;
    subPrompts: number;
    steeringPrompts: number;
    followupPrompts: number;
    continuationPrompts: number;
    cost: number;
    firstTurnMs: number;
    lastTurnMs: number;
    activeHours: number;
    avgCacheRate: number;
    avgCostPerTurn: number;
}

interface ModelThinkingRow {
    modelName: string;
    thinkingLevel: string;
    turns: number;
    userPrompts: number;
    subPrompts: number;
    cost: number;
    avgCostPerTurn: number;
    avgCostPerUserPrompt: number;
    avgCacheRate: number;
    avgThinkingMs: number;
    avgResponseMs: number;
}

interface ReportData {
    generatedAt: number;
    mostUsed: PeriodUsage[];
    models: ModelReport[];
    summary: SummaryEntry[];
    daily: DailyStats[];
    trend: TrendPoint[];
    trendModels: string[];
    modelThinking: ModelThinkingRow[];
    totals: {
        turnCount: number;
        userPromptCount: number;
        basePromptCount: number;
        subPromptCount: number;
        steeringPromptCount: number;
        followupPromptCount: number;
        continuationPromptCount: number;
        automatedTurnCount: number;
        totalCost: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCacheRead: number;
        totalCacheWrite: number;
        avgCacheRate: number;
        firstTurnMs: number;
        lastTurnMs: number;
        activeHours: number;
        avgCostPerTurn: number;
        avgCostPerUserPrompt: number;
        turnsPerUserPrompt: number;
    };
}

const USER_PROMPT_SQL = `COALESCE(SUM(user_prompt), 0)`;
const BASE_PROMPT_SQL = `COALESCE(SUM(base_prompt), 0)`;
const SUB_PROMPT_SQL = `COALESCE(SUM(sub_prompt), 0)`;
const STEERING_PROMPT_SQL = `COALESCE(SUM(steering_prompt), 0)`;
const FOLLOWUP_PROMPT_SQL = `COALESCE(SUM(followup_prompt), 0)`;
const CONTINUATION_PROMPT_SQL = `COALESCE(SUM(continuation_prompt), 0)`;
const CACHE_RATE_SQL = `AVG(CAST(cache_read AS REAL) / NULLIF(cache_read + input_tokens, 0))`;

function num(v: unknown): number { return Number(v) || 0; }
function safeDiv(a: number, b: number): number { return b > 0 ? a / b : 0; }
/** Cost-rate breakdown for a model: $/hr, /day, /wk, /mo derived from total spend over active hours. */
function costRateBreakdown(m: ModelReport): string {
    const h = Math.max(0.5, m.averages.activeHours);
    const perH = m.averages.totalCost / h;
    return "$" + perH.toFixed(4) + "/hr · $" + (perH * 24).toFixed(4) + "/day · $" + (perH * 168).toFixed(2) + "/wk · $" + (perH * 720).toFixed(2) + "/mo";
}
function escHtml(s: string): string {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

class UsageModule {
    constructor(private pi: ExtensionAPI) {}

    attach(): void { this.registerCommands(); }

    private collectReportData(): ReportData | null {
        const db = getDb();
        if (!db) return null;

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const periods: Array<[PeriodName, number]> = [
            ["Today", todayStart.getTime()],
            ["Week", now - 7 * dayMs],
            ["Month", now - 30 * dayMs],
        ];
        // Leaderboard time windows. `until` is exclusive; unbounded windows use now+1.
        const lbPeriods: Array<{ name: string; since: number; until: number }> = [
            { name: "Last 3 Hours", since: now - 3 * 3600_000, until: now + 1 },
            { name: "Last 6 Hours", since: now - 6 * 3600_000, until: now + 1 },
            { name: "Last 12 Hours", since: now - 12 * 3600_000, until: now + 1 },
            { name: "Today", since: todayStart.getTime(), until: now + 1 },
            { name: "Yesterday", since: todayStart.getTime() - dayMs, until: todayStart.getTime() },
            { name: "Last 3 Days", since: now - 3 * dayMs, until: now + 1 },
            { name: "Week", since: now - 7 * dayMs, until: now + 1 },
            { name: "Month", since: now - 30 * dayMs, until: now + 1 },
        ];
        const mostUsedPeriods: Array<[PeriodName, number]> = [
            ["Today", todayStart.getTime()],
            ["Week", now - 7 * dayMs],
            ["Month", now - 30 * dayMs],
            ["Last 3 Hours", now - 3 * 3600_000],
            ["Last 6 Hours", now - 6 * 3600_000],
            ["Last 12 Hours", now - 12 * 3600_000],
        ];

        const mostUsedStmt = db.prepare(
            `SELECT model_name,
                    COUNT(*) AS turn_count,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${BASE_PROMPT_SQL} AS base_count,
                    ${SUB_PROMPT_SQL} AS sub_count,
                    ${STEERING_PROMPT_SQL} AS steering_count,
                    ${FOLLOWUP_PROMPT_SQL} AS followup_count,
                    ${CONTINUATION_PROMPT_SQL} AS continuation_count,
                    COALESCE(SUM(cost_usd), 0) AS cost
             FROM turns
             WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name
             ORDER BY user_count DESC, turn_count DESC, cost DESC
             LIMIT 1`,
        );
        const mostUsed: PeriodUsage[] = mostUsedPeriods.map(([period, since]) => {
            const row = mostUsedStmt.get(since) as { model_name: string; turn_count: number; user_count: number; base_count: number; sub_count: number; steering_count: number; followup_count: number; continuation_count: number; cost: number } | undefined;
            return row
                ? { period, modelName: row.model_name, turnCount: row.turn_count, userPromptCount: row.user_count, basePromptCount: row.base_count, subPromptCount: row.sub_count, steeringPromptCount: row.steering_count, followupPromptCount: row.followup_count, continuationPromptCount: row.continuation_count, cost: row.cost }
                : { period, modelName: null, turnCount: 0, userPromptCount: 0, basePromptCount: 0, subPromptCount: 0, steeringPromptCount: 0, followupPromptCount: 0, continuationPromptCount: 0, cost: 0 };
        });

        const models = (db.prepare(
            `SELECT DISTINCT model_name FROM turns WHERE model_name IS NOT NULL AND model_name != '' ORDER BY model_name`,
        ).all() as Array<{ model_name: string }>).map(r => r.model_name);

        const HORIZON_LABELS: ProjectionHorizon[] = ["6h", "12h", "1d", "7d", "30d"];
        const HORIZON_HOURS: Record<ProjectionHorizon, number> = { "6h": 6, "12h": 12, "1d": 24, "7d": 168, "30d": 720 };
        const HORIZON_MS = HORIZON_LABELS.map(h => HORIZON_HOURS[h] * 3600_000);

        interface WindowStats { turns: number; userPrompts: number; basePrompts: number; activeHours: number; calendarDays: number; confidence: "low" | "medium" | "high"; note: string }
        const windowStats: WindowStats[] = HORIZON_MS.map((windowMs, i) => {
            const since = now - windowMs;
            const row = db.prepare(
                `SELECT COUNT(*) AS turns,
                        ${USER_PROMPT_SQL} AS user_prompts,
                        ${BASE_PROMPT_SQL} AS base_prompts,
                        COALESCE(MIN(timestamp), 0) AS first_turn,
                        COALESCE(MAX(timestamp), 0) AS last_turn,
                        COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) AS calendar_days
                 FROM turns
                 WHERE timestamp >= ?`,
            ).get(since) as { turns: number; user_prompts: number; base_prompts: number; first_turn: number; last_turn: number; calendar_days: number };
            const spanMs = Math.max(0, num(row.last_turn) - num(row.first_turn));
            const activeHours = spanMs > 0 ? spanMs / 3600_000 : 0;
            const h = HORIZON_LABELS[i];
            const enoughTurns = num(row.turns) >= (h === "6h" ? 3 : h === "12h" ? 4 : h === "1d" ? 5 : 7);
            const enoughSpan = activeHours >= Math.min(3, HORIZON_HOURS[h] * 0.25);
            const confidence: "low" | "medium" | "high" = enoughTurns && enoughSpan
                ? (num(row.calendar_days) >= 3 ? "high" : "medium")
                : "low";
            return {
                turns: num(row.turns),
                userPrompts: num(row.user_prompts),
                basePrompts: num(row.base_prompts),
                activeHours,
                calendarDays: num(row.calendar_days),
                confidence,
                note: confidence === "low" ? "estimate from limited history" : confidence === "medium" ? "estimate from current history" : "estimate from multi-day history",
            };
        });

        const makeProjection = (horizonIdx: number, avgCostPerTurn: number, avgTurnsPerBasePrompt: number): ModelProjection => {
            const w = windowStats[horizonIdx];
            const horizon = HORIZON_LABELS[horizonIdx];
            const safeHours = Math.max(0.5, w.activeHours);
            // Projection is based on the user's base-prompt pace, not raw
            // model-call pace. Sub prompts are intentionally excluded from
            // the prompt rate because steering/follow-up prompts are reactive.
            const promptsPerHour = w.basePrompts > 0 ? w.basePrompts / safeHours : (w.userPrompts > 0 ? w.userPrompts / safeHours : 0);
            const turnsPerHour = promptsPerHour * Math.max(1, avgTurnsPerBasePrompt || 1);
            const horizonHours = HORIZON_HOURS[horizon];
            const hasEstimate = turnsPerHour > 0 && avgCostPerTurn > 0;
            return {
                horizon,
                horizonHours,
                predictedCost: hasEstimate ? turnsPerHour * avgCostPerTurn * horizonHours : null,
                turnsPerHour,
                promptsPerHour,
                windowTurns: w.turns,
                windowUserPrompts: w.basePrompts,
                windowActiveHours: w.activeHours,
                sufficientData: hasEstimate,
                confidence: w.confidence,
                note: w.note + "; based on base prompts × model calls per prompt",
            };
        };

        const basePromptStatsStmt = db.prepare(
            `SELECT COALESCE(AVG(turns_per_prompt), 0) AS avg_turns,
                    COALESCE(MAX(turns_per_prompt), 0) AS max_turns,
                    COUNT(*) AS base_prompts,
                    COALESCE(AVG(cost_per_prompt), 0) AS avg_cost_per_base_prompt
             FROM (
                 SELECT COALESCE(session_id, '') AS sid,
                        prompt_index,
                        COUNT(*) AS turns_per_prompt,
                        COALESCE(SUM(cost_usd), 0) AS cost_per_prompt,
                        MAX(CASE WHEN base_prompt = 1 THEN 1 ELSE 0 END) AS has_base_prompt
                 FROM turns
                 WHERE model_name = ? AND prompt_index > 0
                 GROUP BY COALESCE(session_id, ''), prompt_index
             )
             WHERE has_base_prompt = 1`,
        );

        const periodCostStmt = db.prepare(
            `SELECT COALESCE(SUM(cost_usd), 0) AS total_cost,
                    COUNT(*) AS turn_count,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${BASE_PROMPT_SQL} AS base_count,
                    ${SUB_PROMPT_SQL} AS sub_count,
                    ${STEERING_PROMPT_SQL} AS steering_count,
                    ${FOLLOWUP_PROMPT_SQL} AS followup_count,
                    ${CONTINUATION_PROMPT_SQL} AS continuation_count
             FROM turns
             WHERE model_name = ? AND timestamp >= ?`,
        );
        const averagesStmt = db.prepare(
            `SELECT COALESCE(SUM(cost_usd), 0) AS total_cost,
                    AVG(cost_usd) AS avg_cost,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    COUNT(*) AS turn_count,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${BASE_PROMPT_SQL} AS base_count,
                    ${SUB_PROMPT_SQL} AS sub_count,
                    ${STEERING_PROMPT_SQL} AS steering_count,
                    ${FOLLOWUP_PROMPT_SQL} AS followup_count,
                    ${CONTINUATION_PROMPT_SQL} AS continuation_count
             FROM turns
             WHERE model_name = ?`,
        );
        // Per-model stats for an arbitrary [since, until) window — drives the leaderboards.
        const periodStatsStmt = db.prepare(
            `SELECT COUNT(*) AS turn_count,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${BASE_PROMPT_SQL} AS base_count,
                    ${SUB_PROMPT_SQL} AS sub_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    AVG(cost_usd) AS avg_cost,
                    AVG(response_ms) AS avg_response,
                    AVG(thinking_ms) AS avg_thinking,
                    ${CACHE_RATE_SQL} AS avg_cache_rate
             FROM turns
             WHERE model_name = ? AND timestamp >= ? AND timestamp < ?`,
        );
        const activeHoursStmt = db.prepare(
            `SELECT COALESCE(MIN(timestamp), 0) AS first_turn,
                    COALESCE(MAX(timestamp), 0) AS last_turn
             FROM turns WHERE model_name = ?`,
        );

        const modelReports: ModelReport[] = models.map(modelName => {
            const periodRows = periods.map(([period, since]) => {
                const row = periodCostStmt.get(modelName, since) as { total_cost: number; turn_count: number; user_count: number; base_count: number; sub_count: number; steering_count: number; followup_count: number; continuation_count: number };
                return { period, totalCost: num(row.total_cost), turnCount: num(row.turn_count), userPromptCount: num(row.user_count), basePromptCount: num(row.base_count), subPromptCount: num(row.sub_count), steeringPromptCount: num(row.steering_count), followupPromptCount: num(row.followup_count), continuationPromptCount: num(row.continuation_count) };
            });
            const a = averagesStmt.get(modelName) as { total_cost: number; avg_cost: number | null; avg_thinking: number | null; avg_response: number | null; avg_cache_rate: number | null; turn_count: number; user_count: number; base_count: number; sub_count: number; steering_count: number; followup_count: number; continuation_count: number };
            const totalCost = num(a.total_cost);
            const turnCount = num(a.turn_count);
            const userPromptCount = num(a.user_count);
            const baseStats = basePromptStatsStmt.get(modelName) as { avg_turns: number; max_turns: number; base_prompts: number; avg_cost_per_base_prompt: number };
            const basePromptCount = num(baseStats.base_prompts);
            const avgTurnsPerBasePrompt = num(baseStats.avg_turns) || safeDiv(turnCount, userPromptCount);
            const maxTurnsPerPrompt = num(baseStats.max_turns) || safeDiv(turnCount, userPromptCount);
            const periodStats = lbPeriods.map(p => {
                const r = periodStatsStmt.get(modelName, p.since, p.until) as { turn_count: number; user_count: number; base_count: number; sub_count: number; cost: number; avg_cost: number | null; avg_response: number | null; avg_thinking: number | null; avg_cache_rate: number | null };
                return { period: p.name, turnCount: num(r.turn_count), userPromptCount: num(r.user_count), basePromptCount: num(r.base_count), subPromptCount: num(r.sub_count), cost: num(r.cost), avgCostPerTurn: num(r.avg_cost), avgResponseMs: num(r.avg_response), avgThinkingMs: num(r.avg_thinking), avgCacheRate: num(r.avg_cache_rate) };
            });
            const ahRow = activeHoursStmt.get(modelName) as { first_turn: number; last_turn: number };
            const activeHours = Math.max(0, (num(ahRow.last_turn) - num(ahRow.first_turn)) / 3600_000);
            return {
                modelName,
                periods: periodRows,
                averages: {
                    avgCost: num(a.avg_cost),
                    avgCostPerUserPrompt: safeDiv(totalCost, userPromptCount),
                    avgCostPerBasePrompt: num(baseStats.avg_cost_per_base_prompt) || safeDiv(totalCost, userPromptCount),
                    avgThinkingMs: num(a.avg_thinking),
                    avgResponseMs: num(a.avg_response),
                    avgCacheRate: num(a.avg_cache_rate),
                    turnCount,
                    userPromptCount,
                    basePromptCount: num(a.base_count),
                    subPromptCount: num(a.sub_count),
                    steeringPromptCount: num(a.steering_count),
                    followupPromptCount: num(a.followup_count),
                    continuationPromptCount: num(a.continuation_count),
                    turnsPerUserPrompt: safeDiv(turnCount, userPromptCount),
                    maxTurnsPerPrompt,
                    avgTurnsPerBasePrompt,
                    activeHours,
                    basePromptCount,
                    totalCost,
                },
                periodStats,
                projections: HORIZON_LABELS.map((_, i) => makeProjection(i, num(a.avg_cost), avgTurnsPerBasePrompt)),
            };
        });

        const eligible = modelReports.filter(m => m.averages.turnCount > 0);
        const byMin = (fn: (m: ModelReport) => number) => eligible.slice().sort((a, b) => fn(a) - fn(b))[0];
        const byMax = (fn: (m: ModelReport) => number) => eligible.slice().sort((a, b) => fn(b) - fn(a))[0];
        const summaryFor = (title: string, m: ModelReport | undefined, primary: string, secondary: string, severity: SummaryEntry["severity"], metric: number, description: string): SummaryEntry => ({
            title,
            modelName: m?.modelName ?? null,
            primary,
            secondary,
            severity,
            metric,
            description,
        });
        const cheapest = byMin(m => m.averages.avgCost);
        const expensive = byMax(m => m.averages.avgCost);
        const cacheBad = byMin(m => m.averages.avgCacheRate || 999);
        const turnBad = byMax(m => m.averages.maxTurnsPerPrompt);
        const spendy = byMax(m => m.averages.totalCost);
        const slowThink = byMax(m => m.averages.avgThinkingMs);
        const slowResp = byMax(m => m.averages.avgResponseMs);
        const mostUsedModel = byMax(m => m.averages.userPromptCount);
        const summary: SummaryEntry[] = [
            summaryFor("Cheapest", cheapest, cheapest ? "$" + cheapest.averages.avgCost.toFixed(4) + " / model call" : "—", cheapest ? costRateBreakdown(cheapest) : "No data", "good", cheapest?.averages.avgCost ?? 0, "Lowest average cost per assistant/model call. A model call is one assistant response with usage data. Rate breakdown uses total spend over the model's active hours."),
            summaryFor("Most expensive", expensive, expensive ? "$" + expensive.averages.avgCost.toFixed(4) + " / model call" : "—", expensive ? costRateBreakdown(expensive) : "No data", "bad", expensive?.averages.avgCost ?? 0, "Highest average cost per assistant/model call. Rate breakdown uses total spend over the model's active hours."),
            summaryFor("Most cache inefficient", cacheBad, cacheBad ? (cacheBad.averages.avgCacheRate * 100).toFixed(1) + "% cache" : "—", cacheBad ? cacheBad.averages.turnCount + " model calls sampled" : "No data", "warn", cacheBad?.averages.avgCacheRate ?? 0, "Lowest average cache hit rate. Lower cache usually means more fresh prompt tokens and higher cost risk."),
            summaryFor("Most turn inefficient", turnBad, turnBad ? turnBad.averages.maxTurnsPerPrompt.toFixed(0) + " model calls from one prompt" : "—", turnBad ? "avg " + turnBad.averages.turnsPerUserPrompt.toFixed(2) + " calls / prompt · " + turnBad.averages.subPromptCount + " sub prompts" : "No data", "warn", turnBad?.averages.maxTurnsPerPrompt ?? 0, "Highest number of assistant/model calls caused by a single user prompt. High values usually mean tool-call loops or many continuation rounds."),
            summaryFor("Highest total spend", spendy, spendy ? "$" + spendy.averages.totalCost.toFixed(4) : "—", spendy ? spendy.averages.turnCount + " model calls · " + spendy.averages.userPromptCount + " prompts" : "No data", "bad", spendy?.averages.totalCost ?? 0, "Model with the largest total recorded spend across all usage rows."),
            summaryFor("Most used", mostUsedModel, mostUsedModel ? mostUsedModel.averages.userPromptCount + " user prompts" : "—", mostUsedModel ? mostUsedModel.averages.turnCount + " model calls" : "No data", "info", mostUsedModel?.averages.userPromptCount ?? 0, "Model that received the most user prompts. Model calls may be higher because one prompt can trigger multiple assistant/tool continuation calls."),
            summaryFor("Slowest thinking", slowThink, slowThink ? Math.round(slowThink.averages.avgThinkingMs / 1000) + "s avg think" : "—", slowThink ? Math.round(slowThink.averages.avgResponseMs / 1000) + "s avg response" : "No data", "warn", slowThink?.averages.avgThinkingMs ?? 0, "Highest average time to first visible text or tool-call output."),
            summaryFor("Slowest response", slowResp, slowResp ? Math.round(slowResp.averages.avgResponseMs / 1000) + "s avg response" : "—", slowResp ? Math.round(slowResp.averages.avgThinkingMs / 1000) + "s avg think" : "No data", "warn", slowResp?.averages.avgResponseMs ?? 0, "Highest average total assistant response duration."),
        ];

        const trendRows = (db.prepare(
            `WITH b AS (
                SELECT 'Hourly' AS grain, strftime('%Y-%m-%d %H:00', timestamp / 1000, 'unixepoch', 'localtime') AS bucket,
                       strftime('%m-%d %H:00', timestamp / 1000, 'unixepoch', 'localtime') AS label,
                       model_name, timestamp, cost_usd, user_prompt, prompt_index, base_prompt, sub_prompt, steering_prompt, followup_prompt, continuation_prompt, prompt_kind, cache_read, input_tokens
                FROM turns WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
                UNION ALL
                SELECT 'Daily', date(timestamp / 1000, 'unixepoch', 'localtime'), date(timestamp / 1000, 'unixepoch', 'localtime'),
                       model_name, timestamp, cost_usd, user_prompt, prompt_index, base_prompt, sub_prompt, steering_prompt, followup_prompt, continuation_prompt, prompt_kind, cache_read, input_tokens
                FROM turns WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
                UNION ALL
                SELECT 'Weekly', strftime('%Y-W%W', timestamp / 1000, 'unixepoch', 'localtime'), strftime('%Y-W%W', timestamp / 1000, 'unixepoch', 'localtime'),
                       model_name, timestamp, cost_usd, user_prompt, prompt_index, base_prompt, sub_prompt, steering_prompt, followup_prompt, continuation_prompt, prompt_kind, cache_read, input_tokens
                FROM turns WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
                UNION ALL
                SELECT 'Monthly', strftime('%Y-%m', timestamp / 1000, 'unixepoch', 'localtime'), strftime('%Y-%m', timestamp / 1000, 'unixepoch', 'localtime'),
                       model_name, timestamp, cost_usd, user_prompt, prompt_index, base_prompt, sub_prompt, steering_prompt, followup_prompt, continuation_prompt, prompt_kind, cache_read, input_tokens
                FROM turns WHERE timestamp >= ? AND model_name IS NOT NULL AND model_name != ''
             )
             SELECT grain, bucket, label, model_name,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_prompts,
                    ${BASE_PROMPT_SQL} AS base_prompts,
                    ${SUB_PROMPT_SQL} AS sub_prompts,
                    ${STEERING_PROMPT_SQL} AS steering_prompts,
                    ${FOLLOWUP_PROMPT_SQL} AS followup_prompts,
                    ${CONTINUATION_PROMPT_SQL} AS continuation_prompts,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(cost_usd) AS avg_cost_per_turn
             FROM b
             GROUP BY grain, bucket, label, model_name
             ORDER BY grain, bucket, model_name`,
        ).all(now - 48 * 3600_000, now - 30 * dayMs, now - 180 * dayMs, now - 730 * dayMs) as Array<{ grain: TrendGrain; bucket: string; label: string; model_name: string; turns: number; user_prompts: number; base_prompts: number; sub_prompts: number; steering_prompts: number; followup_prompts: number; continuation_prompts: number; cost: number; avg_cache_rate: number; avg_cost_per_turn: number }>).map(r => ({
            grain: r.grain,
            bucket: r.bucket,
            label: r.label,
            modelName: r.model_name,
            turns: num(r.turns),
            userPrompts: num(r.user_prompts),
            basePrompts: num(r.base_prompts),
            subPrompts: num(r.sub_prompts),
            steeringPrompts: num(r.steering_prompts),
            followupPrompts: num(r.followup_prompts),
            continuationPrompts: num(r.continuation_prompts),
            cost: num(r.cost),
            avgCacheRate: num(r.avg_cache_rate),
            avgCostPerTurn: num(r.avg_cost_per_turn),
        }));
        const trendModels = Array.from(new Set(trendRows.map(r => r.modelName))).sort();

        const daily = (db.prepare(
            `SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day,
                    model_name,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_prompts,
                    ${BASE_PROMPT_SQL} AS base_prompts,
                    ${SUB_PROMPT_SQL} AS sub_prompts,
                    ${STEERING_PROMPT_SQL} AS steering_prompts,
                    ${FOLLOWUP_PROMPT_SQL} AS followup_prompts,
                    ${CONTINUATION_PROMPT_SQL} AS continuation_prompts,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COALESCE(MIN(timestamp), 0) AS first_turn,
                    COALESCE(MAX(timestamp), 0) AS last_turn,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(cost_usd) AS avg_cost_per_turn
             FROM turns
             WHERE model_name IS NOT NULL AND model_name != ''
             GROUP BY day, model_name
             ORDER BY day DESC, cost DESC
             LIMIT 300`,
        ).all() as Array<{ day: string; model_name: string; turns: number; user_prompts: number; base_prompts: number; sub_prompts: number; steering_prompts: number; followup_prompts: number; continuation_prompts: number; cost: number; first_turn: number; last_turn: number; avg_cache_rate: number; avg_cost_per_turn: number }>).map(r => ({
            day: r.day,
            modelName: r.model_name,
            turns: num(r.turns),
            userPrompts: num(r.user_prompts),
            basePrompts: num(r.base_prompts),
            subPrompts: num(r.sub_prompts),
            steeringPrompts: num(r.steering_prompts),
            followupPrompts: num(r.followup_prompts),
            continuationPrompts: num(r.continuation_prompts),
            cost: num(r.cost),
            firstTurnMs: num(r.first_turn),
            lastTurnMs: num(r.last_turn),
            activeHours: Math.max(0, (num(r.last_turn) - num(r.first_turn)) / 3600000),
            avgCacheRate: num(r.avg_cache_rate),
            avgCostPerTurn: num(r.avg_cost_per_turn),
        }));

        const modelThinking = (db.prepare(
            `SELECT model_name, thinking_level,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_prompts,
                    ${SUB_PROMPT_SQL} AS sub_prompts,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    AVG(cost_usd) AS avg_cost,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response
             FROM turns
             WHERE model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name, thinking_level
             ORDER BY model_name, thinking_level`,
        ).all() as Array<{ model_name: string; thinking_level: string; turns: number; user_prompts: number; sub_prompts: number; cost: number; avg_cost: number; avg_cache_rate: number; avg_thinking: number; avg_response: number }>).map(r => ({
            modelName: r.model_name,
            thinkingLevel: r.thinking_level || "(none)",
            turns: num(r.turns),
            userPrompts: num(r.user_prompts),
            subPrompts: num(r.sub_prompts),
            cost: num(r.cost),
            avgCostPerTurn: num(r.avg_cost),
            avgCostPerUserPrompt: safeDiv(num(r.cost), num(r.user_prompts)),
            avgCacheRate: num(r.avg_cache_rate),
            avgThinkingMs: num(r.avg_thinking),
            avgResponseMs: num(r.avg_response),
        }));

        const totalsRow = db.prepare(
            `SELECT COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_prompts,
                    ${BASE_PROMPT_SQL} AS base_prompts,
                    ${SUB_PROMPT_SQL} AS sub_prompts,
                    ${STEERING_PROMPT_SQL} AS steering_prompts,
                    ${FOLLOWUP_PROMPT_SQL} AS followup_prompts,
                    ${CONTINUATION_PROMPT_SQL} AS continuation_prompts,
                    COALESCE(SUM(cost_usd), 0) AS total_cost,
                    COALESCE(SUM(input_tokens), 0) AS total_input,
                    COALESCE(SUM(output_tokens), 0) AS total_output,
                    COALESCE(SUM(cache_read), 0) AS total_cache_read,
                    COALESCE(SUM(cache_write), 0) AS total_cache_write,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    COALESCE(MIN(timestamp), 0) AS first_turn,
                    COALESCE(MAX(timestamp), 0) AS last_turn
             FROM turns`,
        ).get() as { turns: number; user_prompts: number; base_prompts: number; sub_prompts: number; steering_prompts: number; followup_prompts: number; continuation_prompts: number; total_cost: number; total_input: number; total_output: number; total_cache_read: number; total_cache_write: number; avg_cache_rate: number; first_turn: number; last_turn: number };
        const turnCount = num(totalsRow.turns);
        const userPromptCount = num(totalsRow.user_prompts);
        const totalCost = num(totalsRow.total_cost);
        const firstTurn = num(totalsRow.first_turn);
        const lastTurn = num(totalsRow.last_turn);
        const totals = {
            turnCount,
            userPromptCount,
            basePromptCount: num(totalsRow.base_prompts),
            subPromptCount: num(totalsRow.sub_prompts),
            steeringPromptCount: num(totalsRow.steering_prompts),
            followupPromptCount: num(totalsRow.followup_prompts),
            continuationPromptCount: num(totalsRow.continuation_prompts),
            automatedTurnCount: Math.max(0, turnCount - userPromptCount),
            totalCost,
            totalInputTokens: num(totalsRow.total_input),
            totalOutputTokens: num(totalsRow.total_output),
            totalCacheRead: num(totalsRow.total_cache_read),
            totalCacheWrite: num(totalsRow.total_cache_write),
            avgCacheRate: num(totalsRow.avg_cache_rate),
            firstTurnMs: firstTurn,
            lastTurnMs: lastTurn,
            activeHours: Math.max(0, (lastTurn - firstTurn) / 3600000),
            avgCostPerTurn: safeDiv(totalCost, turnCount),
            avgCostPerUserPrompt: safeDiv(totalCost, userPromptCount),
            turnsPerUserPrompt: safeDiv(turnCount, userPromptCount),
        };

        return { generatedAt: now, mostUsed, models: modelReports, summary, daily, trend: trendRows, trendModels, modelThinking, totals };
    }

    private countTurns(): number {
        const db = getDb();
        if (!db) return 0;
        const row = db.prepare(`SELECT COUNT(*) AS n FROM turns`).get() as { n: number };
        return row.n;
    }

    private clearTurns(): number {
        const db = getDb();
        if (!db) return 0;
        const tx = db.transaction(() => {
            const result = db.prepare(`DELETE FROM turns`).run();
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'turns'`).run();
            return result.changes;
        });
        return tx();
    }

    private async runClear(ctx: ExtensionCommandContext): Promise<void> {
        const db = getDb();
        if (!db) {
            ctx.ui.notify?.("Cannot clear usage data: better-sqlite3 is not available. Run /aftc-install.", "error");
            return;
        }
        const count = this.countTurns();
        if (count === 0) {
            ctx.ui.notify?.("Usage database is already empty — nothing to clear.", "info");
            return;
        }
        if (ctx.hasUI) {
            const ok = await ctx.ui.confirm("Clear usage database", `Permanently delete all ${count} recorded turn${count === 1 ? "" : "s"} from the SQLite database?\n\nThis cannot be undone.`);
            if (!ok) return;
        }
        try {
            const deleted = this.clearTurns();
            ctx.ui.notify?.(`Cleared usage database — deleted ${deleted} turn${deleted === 1 ? "" : "s"}.`, "info");
        } catch (err) {
            ctx.ui.notify?.(`Failed to clear usage database: ${(err as Error).message}`, "error");
        }
    }

    private registerCommands(): void {
        this.pi.registerCommand("usage-report", {
            description: "Write an enhanced self-contained model usage report to the pi-aftc-toolset data folder and open it in your browser",
            handler: async (_a: string, ctx: ExtensionCommandContext) => this.runReport(ctx),
        });
        this.pi.registerCommand("usage-clear", {
            description: "Permanently clear all recorded turns from the SQLite database (asks for confirmation)",
            handler: async (_a: string, ctx: ExtensionCommandContext) => this.runClear(ctx),
        });
    }

    private reportDir(): string { return getDataDir(); }

    private generateReportHtml(data: ReportData): string {
        const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
        const titleEsc = "PI AFTC Toolset - Model Usage Report";
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleEsc}</title>
<style>
  :root { --bg:#0f1115; --panel:#161a22; --panel-2:#1d2230; --border:#2a3142; --text:#e6e9ef; --muted:#8b94a7; --accent:#6aa9ff; --good:#5ad19a; --warn:#f3b664; --bad:#ef6b6b; --bar:#4d8df6; --bar-2:#76e0c2; }
  @media (prefers-color-scheme: light) { :root { --bg:#f7f8fb; --panel:#fff; --panel-2:#f1f3f8; --border:#d8dde7; --text:#1a1d24; --muted:#5d667a; --accent:#2c6dd2; --good:#1f9d6c; --warn:#c47d20; --bad:#c43c3c; --bar:#2c6dd2; --bar-2:#1f9d6c; } }
  * { box-sizing:border-box; } html, body { margin:0; padding:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  main { max-width:1240px; margin:0 auto; padding:24px 20px 64px; } header { display:flex; flex-wrap:wrap; align-items:flex-start; gap:12px; margin-bottom:8px; }
  h1 { font-size:24px; margin:0; } h2 { font-size:16px; margin:28px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--border); } .meta { color:var(--muted); font-size:12px; display:block; margin-top:2px; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; margin:10px 0; } .grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; } .grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; } @media(max-width:900px){.grid-4,.grid-3{grid-template-columns:1fr}}
  .stat-label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; } .stat-value { font-size:16px; font-weight:700; margin-top:2px; word-break:break-word; } .stat-sub { color:var(--muted); font-size:12px; margin-top:2px; } .help { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; border-radius:50%; border:1px solid var(--border); color:var(--muted); font-size:10px; margin-left:5px; cursor:help; text-transform:none; letter-spacing:0; }
  .empty { color:var(--muted); font-style:italic; } table { width:100%; border-collapse:collapse; font-size:13px; } th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top; } th { font-weight:600; color:var(--muted); cursor:pointer; user-select:none; } th .arrow { color:var(--accent); margin-left:4px; opacity:.5; font-size:10px; } th.sorted .arrow { opacity:1; } tbody tr:hover { background:var(--panel-2); } td.num,th.num { text-align:center; font-variant-numeric:tabular-nums; }
  .period-tabs,.trend-tabs,.metric-tabs { display:inline-flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-left:auto; } .period-tabs button,.trend-tabs button,.metric-tabs button { background:transparent; color:var(--text); border:none; padding:6px 12px; cursor:pointer; font-size:12px; } button.active { background:var(--accent); color:#fff; } button:not(.active):hover { background:var(--panel-2); }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:700; } .pill.good{background:rgba(90,209,154,.15);color:var(--good)} .pill.warn{background:rgba(243,182,100,.15);color:var(--warn)} .pill.bad{background:rgba(239,107,107,.15);color:var(--bad)} .pill.info{background:rgba(106,169,255,.15);color:var(--accent)}
  .bar-cell { display:flex; align-items:flex-start; gap:8px; padding-top:6px; } .bar-track { flex:1; height:8px; background:var(--panel-2); border-radius:4px; overflow:hidden; } .bar-fill { height:100%; background:var(--bar); }
  .legend { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 0; } .legend-item { display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:12px; } .swatch { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .trend-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:10px; } .trend-svg { width:100%; height:260px; display:block; } .axis { stroke:var(--border); } .tick-label { fill:var(--muted); font-size:10px; } .tooltip { position:absolute; background:var(--panel-2); border:1px solid var(--border); padding:6px 8px; border-radius:6px; font-size:11px; pointer-events:none; z-index:10; }
  .lvl { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600; background:var(--panel-2); color:var(--muted); border:1px solid var(--border); } .lvl.high{background:rgba(106,169,255,.15);color:var(--accent);border-color:transparent}.lvl.medium{background:rgba(243,182,100,.15);color:var(--warn);border-color:transparent}.lvl.low{background:rgba(90,209,154,.15);color:var(--good);border-color:transparent}
  .proj-toolbar { display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; align-items:flex-start; margin-bottom:10px; } .proj-toolbar select { background:var(--panel-2); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:12px; } .proj-desc { color:var(--muted); font-size:12px; line-height:1.55; margin:0; max-width:850px; }
  .proj-grid { display:grid; grid-template-columns:2.2fr repeat(5,1fr); gap:0; font-size:13px; } .proj-cell { padding:8px 10px; border-bottom:1px solid var(--border); } .proj-cell.head { font-weight:600; color:var(--muted); background:var(--panel-2); cursor:pointer; user-select:none; } .proj-cell.head.sorted .arrow { color:var(--accent); font-weight:700; } .proj-cell .arrow { opacity:.5; font-size:10px; margin-left:4px; } .proj-cell .val { font-variant-numeric:tabular-nums; } .proj-cell .na { color:var(--muted); font-style:italic; font-weight:400; } .proj-cell .sub { color:var(--muted); font-size:10px; margin-top:1px; } .proj-cell.low { color:var(--warn); }
  .lb-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:10px; } .lb-controls select { background:var(--panel-2); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:12px; } .lb-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; } @media(max-width:900px){.lb-grid{grid-template-columns:1fr}} .lb-card { background:var(--panel-2); border:1px solid var(--border); border-radius:8px; padding:10px 12px; } .lb-card h3 { margin:0 0 6px; font-size:13px; color:var(--accent); } .lb-card table { font-size:12px; } .lb-card th, .lb-card td { padding:4px 6px; } .lb-card .rank { color:var(--muted); width:18px; } .lb-card .mname { font-weight:600; }
  footer { color:var(--muted); font-size:11px; margin:32px 0 18px; text-align:center; }
</style>
</head>
<body>
<main>
  <header><div><h1>${titleEsc}</h1><span class="meta" id="generated-at"></span></div><span class="period-tabs" id="period-tabs" role="tablist"><button data-period="Today" class="active">Today</button><button data-period="Week">Week</button><button data-period="Month">Month</button></span></header>
  <h2>Lifetime totals</h2><div class="grid-4" id="lifetime-totals"></div>
  <h2>Model leaderboards</h2><div class="panel" id="leaderboards-panel"><div class="lb-controls"><label class="stat-sub">Time window <select id="lb-period"><option>Last 3 Hours</option><option>Last 6 Hours</option><option>Last 12 Hours</option><option selected>Today</option><option>Yesterday</option><option>Last 3 Days</option><option>Week</option><option>Month</option></select></label><span class="stat-sub" id="lb-period-note"></span></div><div class="lb-grid" id="lb-grid"></div></div>
  <h2>Summary</h2><div class="grid-4" id="summary"></div>
  <h2>Trend</h2><div class="panel" id="daily-trend-panel"><div class="trend-controls"><span class="trend-tabs" id="trend-tabs"><button data-grain="Hourly" class="active">Hourly</button><button data-grain="Daily">Daily</button><button data-grain="Weekly">Weekly</button><button data-grain="Monthly">Monthly</button></span><span class="metric-tabs" id="metric-tabs"><button data-metric="cost" class="active">Cost</button><button data-metric="userPrompts">User prompts</button><button data-metric="turns">Turns</button></span></div><div id="daily-trend-chart"></div><div class="legend" id="trend-legend"></div><table id="daily-table"><thead><tr><th data-sort="day">Date <span class="arrow">↕</span></th><th data-sort="modelName">Model <span class="arrow">↕</span></th><th data-sort="turns" class="num">Turns <span class="arrow">↕</span></th><th data-sort="userPrompts" class="num">User prompts <span class="arrow">↕</span></th><th data-sort="basePrompts" class="num">Base <span class="arrow">↕</span></th><th data-sort="subPrompts" class="num">Sub <span class="arrow">↕</span></th><th data-sort="steeringPrompts" class="num">Steer <span class="arrow">↕</span></th><th data-sort="followupPrompts" class="num">Follow-up <span class="arrow">↕</span></th><th data-sort="continuationPrompts" class="num">Continuation <span class="arrow">↕</span></th><th data-sort="cost" class="num">Cost <span class="arrow">↕</span></th><th data-sort="avgCostPerTurn" class="num">Avg cost / turn <span class="arrow">↕</span></th><th data-sort="activeHours" class="num">Active hours <span class="arrow">↕</span></th><th data-sort="avgCacheRate" class="num">Avg cache <span class="arrow">↕</span></th></tr></thead><tbody id="daily-tbody"></tbody></table><div id="daily-empty" class="empty" style="display:none;">No trend data recorded yet.</div></div>
  <h2>Model × thinking level</h2><div class="panel"><table id="thinking-table"><thead><tr><th data-sort-mt="modelName">Model <span class="arrow">↕</span></th><th data-sort-mt="thinkingLevel">Thinking <span class="arrow">↕</span></th><th data-sort-mt="turns" class="num">Turns <span class="arrow">↕</span></th><th data-sort-mt="userPrompts" class="num">User prompts <span class="arrow">↕</span></th><th data-sort-mt="subPrompts" class="num">Sub prompts <span class="arrow">↕</span></th><th data-sort-mt="cost" class="num">Cost <span class="arrow">↕</span></th><th data-sort-mt="avgCostPerTurn" class="num">Avg cost / turn <span class="arrow">↕</span></th><th data-sort-mt="avgCostPerUserPrompt" class="num">Avg cost / prompt <span class="arrow">↕</span></th><th data-sort-mt="avgCacheRate" class="num">Avg cache <span class="arrow">↕</span></th><th data-sort-mt="avgThinkingMs" class="num">Avg think <span class="arrow">↕</span></th><th data-sort-mt="avgResponseMs" class="num">Avg response <span class="arrow">↕</span></th></tr></thead><tbody id="thinking-tbody"></tbody></table><div id="thinking-empty" class="empty" style="display:none;">No thinking-level data recorded yet.</div></div>
  <h2>Per-model cost report</h2><div class="panel"><table id="models-table"><thead><tr><th data-sort="modelName">Model <span class="arrow">↕</span></th><th data-sort="periodCost" class="num sorted desc">Period cost <span class="arrow">↓</span></th><th data-sort="turnCount" class="num">Turns <span class="arrow">↕</span></th><th data-sort="userPromptCount" class="num">User prompts <span class="arrow">↕</span></th><th data-sort="subPromptCount" class="num">Sub prompts <span class="arrow">↕</span></th><th data-sort="turnsPerUserPrompt" class="num" title="Average model calls caused by each user prompt. Lower is better; 1.0 means one prompt produced one model call.">Avg calls / prompt <span class="arrow">↕</span></th><th data-sort="maxTurnsPerPrompt" class="num" title="Worst single prompt for this model: the maximum model calls caused by one prompt.">Max calls / prompt <span class="arrow">↕</span></th><th data-sort="avgCost" class="num">Avg cost / turn <span class="arrow">↕</span></th><th data-sort="avgCostPerUserPrompt" class="num">Avg cost / prompt <span class="arrow">↕</span></th><th data-sort="avgCacheRate" class="num">Avg cache <span class="arrow">↕</span></th><th data-sort="avgThinkingMs" class="num">Avg think <span class="arrow">↕</span></th><th data-sort="avgResponseMs" class="num">Avg response <span class="arrow">↕</span></th></tr></thead><tbody id="models-tbody"></tbody></table><div id="models-empty" class="empty" style="display:none;">No per-model data recorded yet.</div></div>
  <h2>Cost projections</h2><div class="panel"><div class="proj-toolbar"><p class="proj-desc" id="proj-desc"></p><label class="stat-sub">Projection mode <select id="proj-mode"><option value="basePrompt">Recommended: base prompt pace</option><option value="basePromptCost">Average first/base prompt cost</option><option value="allUserPromptCost">Average all user prompt cost</option><option value="rawModelCall">Raw model-call velocity</option><option value="worstPrompt">Worst prompt loop risk</option></select></label></div><div class="proj-grid" id="proj-grid"><div class="proj-cell head" data-sort-p="modelName">Model <span class="arrow">↕</span></div><div class="proj-cell head" data-sort-p="h6">6 hours <span class="arrow">↕</span></div><div class="proj-cell head" data-sort-p="h12">12 hours <span class="arrow">↕</span></div><div class="proj-cell head" data-sort-p="d1">1 day <span class="arrow">↕</span></div><div class="proj-cell head" data-sort-p="d7">7 days <span class="arrow">↕</span></div><div class="proj-cell head sorted" data-sort-p="d30">30 days <span class="arrow">↓</span></div></div><div id="proj-empty" class="empty" style="display:none;">No per-model data recorded yet.</div></div>
</main>
<footer>Generated by pi-aftc-toolset &middot; /usage-report<br>Author Darcey.Lloyd@gmail.com</footer>
<script type="application/json" id="report-data">${json}</script>
<script type="module">
  const raw = document.getElementById("report-data").textContent || "{}";
  const data = JSON.parse(raw);
  const colors = ["#6aa9ff", "#76e0c2", "#f3b664", "#ef6b6b", "#b692ff", "#66d9ef", "#a6e22e", "#fd971f", "#f92672", "#8be9fd"];
  const fmtMoney = n => "$" + (Number(n) || 0).toFixed(4);
  const fmtPct = n => ((Number(n) || 0) * 100).toFixed(1) + "%";
  const fmtMs = ms => { ms = Number(ms) || 0; if (ms <= 0) return "0S"; const s = Math.floor(ms/1000); return s < 60 ? s + "S" : Math.floor(s/60) + "M " + (s%60) + "S"; };
  const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
  const modelColor = name => colors[Math.abs([...String(name)].reduce((a,c)=>a+c.charCodeAt(0),0)) % colors.length];
  document.getElementById("generated-at").textContent = "Generated " + new Date(data.generatedAt).toLocaleString();
  function pill(txt, cls){ return '<span class="pill ' + cls + '">' + txt + '</span>'; }
  function cachePill(rate){ const p=(Number(rate)||0)*100; return pill(p.toFixed(1)+"%", p>=60?"good":p>=30?"warn":"bad"); }
  function barCell(value,max,color){ const pct=max>0?Math.max(0,Math.min(100,(value/max)*100)):0; return '<div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + (color||'var(--bar)') + '"></div></div></div>'; }
  function sortRows(rows,key,dir){ const d=dir==='asc'?1:-1; return rows.sort((a,b)=>{ const av=a[key], bv=b[key]; if(typeof av==='string') return av.localeCompare(bv)*d; return ((av||0)-(bv||0))*d; }); }
  function updateArrows(sel, attr, key, dir){ document.querySelectorAll(sel).forEach(th=>{ const k=th.dataset[attr]; th.classList.toggle('sorted', k===key); const a=th.querySelector('.arrow'); if(a) a.textContent=k===key?(dir==='asc'?'↑':'↓'):'↕'; }); }
  function renderTotals(){ const t=data.totals||{}; const cards=[['Base prompts',(t.basePromptCount||0).toLocaleString(),'top-level prompts used for projection baseline'],['Sub prompts',(t.subPromptCount||0).toLocaleString(),(t.steeringPromptCount||0)+' steering · '+(t.followupPromptCount||0)+' follow-up · '+(t.continuationPromptCount||0)+' continuation'],['User prompts',(t.userPromptCount||0).toLocaleString(),'base + sub prompts submitted by you'],['Model calls',(t.turnCount||0).toLocaleString(),(t.automatedTurnCount||0)+' automated continuations'],['Total cost',fmtMoney(t.totalCost),'avg '+fmtMoney(t.avgCostPerUserPrompt)+' / user prompt'],['Avg cache',fmtPct(t.avgCacheRate),'cache read / total prompt'],['Model calls / prompt',(Number(t.turnsPerUserPrompt)||0).toFixed(2),'lower is better; 1.0 = direct response, high = tool-call loop'],['Cache read / write',(t.totalCacheRead||0).toLocaleString()+' / '+(t.totalCacheWrite||0).toLocaleString()+' tok','cached prefix activity']]; const root=document.getElementById('lifetime-totals'); root.innerHTML=''; for(const c of cards){ const el=document.createElement('div'); el.className='panel'; el.innerHTML='<div class="stat-label">'+esc(c[0])+'</div><div class="stat-value">'+esc(c[1])+'</div><div class="stat-sub">'+esc(c[2])+'</div>'; root.appendChild(el);} }
  let lbPeriod='Today'; const LB_DEFS=[ {title:'Most prompted',key:'userPromptCount',cols:[['Prompts','userPromptCount'],['Sub','subPromptCount'],['Turns','turnCount'],['Avg $/turn','avgCostPerTurn'],['Total $','cost']]}, {title:'Most model calls (turns)',key:'turnCount',cols:[['Turns','turnCount'],['Prompts','userPromptCount'],['Sub','subPromptCount'],['Avg $/turn','avgCostPerTurn'],['Total $','cost']]}, {title:'Longest avg response',key:'avgResponseMs',cols:[['Avg resp','avgResponseMs'],['Avg think','avgThinkingMs'],['Turns','turnCount'],['Avg $/turn','avgCostPerTurn']]}, {title:'Most cost per turn',key:'avgCostPerTurn',cols:[['Avg $/turn','avgCostPerTurn'],['Turns','turnCount'],['Cache','avgCacheRate'],['Total $','cost']]}, {title:'Most cost over period',key:'cost',cols:[['Total $','cost'],['Turns','turnCount'],['Prompts','userPromptCount'],['Avg $/turn','avgCostPerTurn']]}, {title:'Highest cache hit rate',key:'avgCacheRate',cols:[['Cache','avgCacheRate'],['Turns','turnCount'],['Avg $/turn','avgCostPerTurn'],['Total $','cost']]} ];
  function lbFmt(key,val){ if(val==null) return '—'; if(key==='cost'||key==='avgCostPerTurn') return fmtMoney(val); if(key==='avgCacheRate') return cachePill(val); if(key==='avgResponseMs'||key==='avgThinkingMs') return fmtMs(val); return Number(val).toLocaleString(); }
  function renderLeaderboards(){ const grid=document.getElementById('lb-grid'); grid.innerHTML=''; const rows=(data.models||[]).map(m=>{ const ps=((m.periodStats||[]).find(p=>p.period===lbPeriod)||{turnCount:0,userPromptCount:0,basePromptCount:0,subPromptCount:0,cost:0,avgCostPerTurn:0,avgResponseMs:0,avgThinkingMs:0,avgCacheRate:0}); return {modelName:m.modelName,turnCount:ps.turnCount,userPromptCount:ps.userPromptCount,basePromptCount:ps.basePromptCount,subPromptCount:ps.subPromptCount,cost:ps.cost,avgCostPerTurn:ps.avgCostPerTurn,avgResponseMs:ps.avgResponseMs,avgThinkingMs:ps.avgThinkingMs,avgCacheRate:ps.avgCacheRate}; }).filter(r=>r.turnCount>0||r.cost>0); const note=document.getElementById('lb-period-note'); note.textContent=rows.length+' model(s) active in '+lbPeriod; for(const def of LB_DEFS){ const sorted=rows.slice().sort((a,b)=>((b[def.key]||0)-(a[def.key]||0))).slice(0,5); const card=document.createElement('div'); card.className='lb-card'; let html='<h3>'+esc(def.title)+'</h3>'; if(!sorted.length){ html+='<div class="empty">No data in '+lbPeriod+'</div>'; } else { html+='<table><thead><tr><th class="rank">#</th><th>Model</th>'; for(const c of def.cols) html+='<th class="num">'+esc(c[0])+'</th>'; html+='</tr></thead><tbody>'; sorted.forEach((r,i)=>{ html+='<tr><td class="rank">'+(i+1)+'</td><td class="mname">'+esc(r.modelName)+'</td>'; for(const c of def.cols) html+='<td class="num">'+lbFmt(c[1],r[c[1]])+'</td>'; html+='</tr>'; }); html+='</tbody></table>'; } card.innerHTML=html; grid.appendChild(card); } }
  document.getElementById('lb-period').addEventListener('change',e=>{lbPeriod=e.target.value; renderLeaderboards();});
  function renderSummary(){ const root=document.getElementById('summary'); root.innerHTML=''; const label=s=>s.severity==='good'?'GOOD':s.severity==='bad'?'BAD':s.severity==='warn'?'OK':'METRIC'; for(const s of data.summary||[]){ const el=document.createElement('div'); el.className='panel'; el.title=s.description||''; el.innerHTML='<div class="stat-label">'+esc(s.title)+'<span class="help" title="'+esc(s.description||'')+'">?</span></div>'+(s.modelName?'<div class="stat-value">'+esc(s.modelName)+'</div><div class="stat-sub">'+esc(s.primary)+' · '+pill(label(s),s.severity)+'</div><div class="stat-sub">'+esc(s.secondary)+'</div>':'<div class="stat-value empty">(no data)</div>'); root.appendChild(el);} }
  let activePeriod='Today'; const tabBar=document.getElementById('period-tabs'); tabBar.addEventListener('click',e=>{const b=e.target.closest('button[data-period]'); if(!b)return; activePeriod=b.dataset.period; tabBar.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b)); renderModelsTable();});
  let sortKey='periodCost', sortDir='desc'; function rowForModel(m){ const p=(m.periods||[]).find(x=>x.period===activePeriod)||{totalCost:0,turnCount:0,userPromptCount:0,subPromptCount:0}; return {modelName:m.modelName, periodCost:p.totalCost, turnCount:p.turnCount, userPromptCount:p.userPromptCount, subPromptCount:p.subPromptCount, turnsPerUserPrompt:m.averages.turnsPerUserPrompt, maxTurnsPerPrompt:m.averages.maxTurnsPerPrompt, avgCost:m.averages.avgCost, avgCostPerUserPrompt:m.averages.avgCostPerUserPrompt, avgCacheRate:m.averages.avgCacheRate, avgThinkingMs:m.averages.avgThinkingMs, avgResponseMs:m.averages.avgResponseMs}; }
  function renderModelsTable(){ const tbody=document.getElementById('models-tbody'), empty=document.getElementById('models-empty'); tbody.innerHTML=''; const rows=(data.models||[]).map(rowForModel); if(!rows.length){empty.style.display='block';return;} empty.style.display='none'; const maxCost=Math.max(1,...rows.map(r=>r.periodCost)); sortRows(rows,sortKey,sortDir); for(const r of rows){ const tr=document.createElement('tr'); tr.innerHTML='<td>'+esc(r.modelName)+'</td><td class="num">'+barCell(r.periodCost,maxCost,modelColor(r.modelName))+'<span style="margin-left:8px">'+fmtMoney(r.periodCost)+'</span></td><td class="num">'+r.turnCount+'</td><td class="num">'+r.userPromptCount+'</td><td class="num">'+r.subPromptCount+'</td><td class="num">'+(Number(r.turnsPerUserPrompt)||0).toFixed(2)+'</td><td class="num">'+(Number(r.maxTurnsPerPrompt)||0).toFixed(0)+'</td><td class="num">'+fmtMoney(r.avgCost)+'</td><td class="num">'+fmtMoney(r.avgCostPerUserPrompt)+'</td><td class="num">'+cachePill(r.avgCacheRate)+'</td><td class="num">'+fmtMs(r.avgThinkingMs)+'</td><td class="num">'+fmtMs(r.avgResponseMs)+'</td>'; tbody.appendChild(tr);} updateArrows('#models-table thead th','sort',sortKey,sortDir); }
  document.querySelectorAll('#models-table thead th').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.sort; if(sortKey===k)sortDir=sortDir==='asc'?'desc':'asc'; else{sortKey=k; sortDir=k==='modelName'?'asc':'desc';} renderModelsTable();}));
  let dailySortKey='day', dailySortDir='desc'; let trendGrain='Hourly', trendMetric='cost'; function trendRows(){ return (data.trend||[]).filter(r=>r.grain===trendGrain); }
  function renderTrend(){ const host=document.getElementById('daily-trend-chart'); const rows=trendRows(); host.innerHTML=''; if(!rows.length){host.innerHTML='<div class="empty">No '+trendGrain.toLowerCase()+' data yet.</div>'; return;} const buckets=Array.from(new Set(rows.map(r=>r.bucket))).sort(); const models=Array.from(new Set(rows.map(r=>r.modelName))).sort(); const totals=buckets.map(b=>rows.filter(r=>r.bucket===b).reduce((s,r)=>s+(Number(r[trendMetric])||0),0)); const max=Math.max(0.0001,...totals); const W=980,H=240,L=48,R=12,T=14,B=36,innerW=W-L-R,innerH=H-T-B; const bw=Math.max(8,Math.min(32,innerW/buckets.length-3)); const gap=(innerW-bw*buckets.length)/Math.max(1,buckets.length-1); let svg=''; for(let i=0;i<=4;i++){const y=T+(innerH/4)*i; const v=max*(1-i/4); svg+='<line class="axis" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/><text class="tick-label" x="'+(L-5)+'" y="'+(y+3)+'" text-anchor="end">'+(trendMetric==='cost'?'$'+v.toFixed(2):Math.round(v))+'</text>'; } buckets.forEach((b,i)=>{let yBase=T+innerH; const x=L+i*(bw+gap); models.forEach(m=>{const r=rows.find(z=>z.bucket===b&&z.modelName===m); const val=r?(Number(r[trendMetric])||0):0; const h=(val/max)*innerH; if(h>0){ yBase-=h; svg+='<rect data-bucket="'+esc(b)+'" data-model="'+esc(m)+'" data-value="'+val.toFixed(4)+'" x="'+x+'" y="'+yBase+'" width="'+bw+'" height="'+h+'" fill="'+modelColor(m)+'" rx="2"/>'; }}); if(i%Math.max(1,Math.ceil(buckets.length/10))===0||i===buckets.length-1) svg+='<text class="tick-label" x="'+(x+bw/2)+'" y="'+(H-14)+'" text-anchor="middle">'+esc(String(b).slice(-8))+'</text>'; }); host.innerHTML='<svg class="trend-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">'+svg+'</svg>'; const svgEl=host.querySelector('svg'); let tip=null; svgEl.addEventListener('mousemove',e=>{const r=e.target.closest('rect'); if(!r){if(tip){tip.remove();tip=null;}return;} if(!tip){tip=document.createElement('div');tip.className='tooltip';host.appendChild(tip);} tip.textContent=r.dataset.bucket+' · '+r.dataset.model+' · '+(trendMetric==='cost'?'$':'')+r.dataset.value; const rect=host.getBoundingClientRect(); tip.style.left=(e.clientX-rect.left+12)+'px'; tip.style.top=(e.clientY-rect.top-28)+'px';}); svgEl.addEventListener('mouseleave',()=>{if(tip){tip.remove();tip=null;}}); renderLegend(models); }
  function renderLegend(models){ const root=document.getElementById('trend-legend'); root.innerHTML=''; for(const m of models){ const el=document.createElement('span'); el.className='legend-item'; el.innerHTML='<span class="swatch" style="background:'+modelColor(m)+'"></span>'+esc(m); root.appendChild(el);} }
  function renderDailyTable(){ const tbody=document.getElementById('daily-tbody'), empty=document.getElementById('daily-empty'); tbody.innerHTML=''; const rows=(trendGrain==='Daily'?data.daily:(data.trend||[]).filter(r=>r.grain===trendGrain).map(r=>({day:r.bucket,modelName:r.modelName,turns:r.turns,userPrompts:r.userPrompts,basePrompts:r.basePrompts,subPrompts:r.subPrompts,steeringPrompts:r.steeringPrompts,followupPrompts:r.followupPrompts,continuationPrompts:r.continuationPrompts,cost:r.cost,activeHours:0,avgCacheRate:r.avgCacheRate,avgCostPerTurn:r.avgCostPerTurn}))).slice(); if(!rows.length){empty.style.display='block';return;} empty.style.display='none'; sortRows(rows,dailySortKey,dailySortDir); for(const r of rows){const tr=document.createElement('tr'); tr.innerHTML='<td>'+esc(r.day)+'</td><td>'+esc(r.modelName)+'</td><td class="num">'+r.turns+'</td><td class="num">'+r.userPrompts+'</td><td class="num">'+(r.basePrompts||0)+'</td><td class="num">'+(r.subPrompts||0)+'</td><td class="num">'+(r.steeringPrompts||0)+'</td><td class="num">'+(r.followupPrompts||0)+'</td><td class="num">'+(r.continuationPrompts||0)+'</td><td class="num">'+fmtMoney(r.cost)+'</td><td class="num">'+fmtMoney(r.avgCostPerTurn)+'</td><td class="num">'+(Number(r.activeHours)||0).toFixed(1)+'h</td><td class="num">'+fmtPct(r.avgCacheRate)+'</td>'; tbody.appendChild(tr);} updateArrows('#daily-table thead th','sort',dailySortKey,dailySortDir); }
  document.getElementById('trend-tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-grain]'); if(!b)return; trendGrain=b.dataset.grain; document.querySelectorAll('#trend-tabs button').forEach(x=>x.classList.toggle('active',x===b)); renderTrend(); renderDailyTable();}); document.getElementById('metric-tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-metric]'); if(!b)return; trendMetric=b.dataset.metric; document.querySelectorAll('#metric-tabs button').forEach(x=>x.classList.toggle('active',x===b)); renderTrend();}); document.querySelectorAll('#daily-table thead th').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.sort; if(dailySortKey===k)dailySortDir=dailySortDir==='asc'?'desc':'asc'; else{dailySortKey=k; dailySortDir=k==='day'||k==='modelName'?'asc':'desc';} renderDailyTable();}));
  let mtSortKey='cost', mtSortDir='desc'; function thinkingPill(level){const l=String(level||'').toLowerCase(); let cls=''; if(l==='high'||l==='xhigh')cls=' high'; else if(l==='medium'||l==='med')cls=' medium'; else if(l==='low'||l==='off'||l==='minimal')cls=' low'; return '<span class="lvl'+cls+'">'+esc(level)+'</span>'; } function renderThinkingTable(){const tbody=document.getElementById('thinking-tbody'), empty=document.getElementById('thinking-empty'); tbody.innerHTML=''; const rows=(data.modelThinking||[]).slice(); if(!rows.length){empty.style.display='block';return;} empty.style.display='none'; sortRows(rows,mtSortKey,mtSortDir); for(const r of rows){const tr=document.createElement('tr'); tr.innerHTML='<td>'+esc(r.modelName)+'</td><td>'+thinkingPill(r.thinkingLevel)+'</td><td class="num">'+r.turns+'</td><td class="num">'+r.userPrompts+'</td><td class="num">'+r.subPrompts+'</td><td class="num">'+fmtMoney(r.cost)+'</td><td class="num">'+fmtMoney(r.avgCostPerTurn)+'</td><td class="num">'+fmtMoney(r.avgCostPerUserPrompt)+'</td><td class="num">'+fmtPct(r.avgCacheRate)+'</td><td class="num">'+fmtMs(r.avgThinkingMs)+'</td><td class="num">'+fmtMs(r.avgResponseMs)+'</td>'; tbody.appendChild(tr);} updateArrows('#thinking-table thead th','sortMt',mtSortKey,mtSortDir); } document.querySelectorAll('#thinking-table thead th').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.sortMt; if(mtSortKey===k)mtSortDir=mtSortDir==='asc'?'desc':'asc'; else{mtSortKey=k; mtSortDir=k==='modelName'||k==='thinkingLevel'?'asc':'desc';} renderThinkingTable();}));
  let projSortKey='d30', projSortDir='desc', projMode='basePrompt'; const labels={h6:'6h',h12:'12h',d1:'1d',d7:'7d',d30:'30d'}; const horizonHours={h6:6,h12:12,d1:24,d7:168,d30:720}; const modeText={basePrompt:'Recommended mode: base prompts/hour (sub prompts excluded) × model average calls/base prompt × average cost/model call. This preserves the current/default projection and is the best baseline for starting new work.',basePromptCost:'Average first/base prompt cost: base prompts/hour × average total cost of a base prompt group for that model. Useful when you care about whole prompt cost instead of per-call cost.',allUserPromptCost:'Average all user prompt cost: all user prompts/hour × average cost per user prompt. Includes sub/continuation prompts, so it is more reactive to conversational follow-ups.',rawModelCall:'Raw model-call velocity: recent model calls/hour × average cost/model call. Useful stress-test, but often overstates tool-heavy sessions.',worstPrompt:'Worst prompt loop risk: base prompts/hour × max model calls from one prompt × average cost/model call. Shows high-side risk if prompts hit the worst observed loop.'}; function baseProj(model,label){const p=(model.projections||[]).find(x=>x.horizon===label); return p&&p.predictedCost!=null?p:null;} function calcProj(model,k){const label=labels[k], p=baseProj(model,label); if(!p)return null; const h=horizonHours[k], a=model.averages||{}, totals=data.totals||{}; const activeH=Math.max(0.5, Number(totals.activeHours)||p.windowActiveHours||0.5); const userPromptRate=(Number(totals.userPromptCount)||0)/activeH; const rawCallRate=p.windowTurns/Math.max(0.5,p.windowActiveHours||0); let cost=p.predictedCost, sub='Confidence: '+p.confidence+' · Base prompts: '+p.windowUserPrompts+' · Model calls/hr: '+p.turnsPerHour.toFixed(1); if(projMode==='basePromptCost'){ cost=p.promptsPerHour*(a.avgCostPerBasePrompt||a.avgCostPerUserPrompt||0)*h; sub='Confidence: '+p.confidence+' · Base prompts/hr: '+p.promptsPerHour.toFixed(2)+' · Cost/base: '+fmtMoney(a.avgCostPerBasePrompt||0); } else if(projMode==='allUserPromptCost'){ cost=userPromptRate*(a.avgCostPerUserPrompt||0)*h; sub='All user prompts/hr: '+userPromptRate.toFixed(2)+' · Cost/prompt: '+fmtMoney(a.avgCostPerUserPrompt||0); } else if(projMode==='rawModelCall'){ cost=rawCallRate*(a.avgCost||0)*h; sub='Confidence: '+p.confidence+' · Raw model calls/hr: '+rawCallRate.toFixed(1); } else if(projMode==='worstPrompt'){ const calls=Math.max(1,a.maxTurnsPerPrompt||a.avgTurnsPerBasePrompt||1); cost=p.promptsPerHour*calls*(a.avgCost||0)*h; sub='Risk mode · Base prompts/hr: '+p.promptsPerHour.toFixed(2)+' × Max calls/prompt: '+calls.toFixed(0); } return {...p,predictedCost:cost,sub}; } function renderProjections(){document.getElementById('proj-desc').textContent=modeText[projMode]; const grid=document.getElementById('proj-grid'), empty=document.getElementById('proj-empty'); while(grid.children.length>6)grid.lastElementChild.remove(); const rows=(data.models||[]).map(m=>({modelName:m.modelName,model:m,h6:calcProj(m,'h6'),h12:calcProj(m,'h12'),d1:calcProj(m,'d1'),d7:calcProj(m,'d7'),d30:calcProj(m,'d30')})); if(!rows.length){empty.style.display='block';return;} empty.style.display='none'; rows.sort((a,b)=>{const d=projSortDir==='asc'?1:-1; const av=a[projSortKey],bv=b[projSortKey]; if(typeof av==='string')return av.localeCompare(bv)*d; const an=av?av.predictedCost:null,bn=bv?bv.predictedCost:null; if(an===null&&bn===null)return 0; if(an===null)return 1; if(bn===null)return -1; return (an-bn)*d;}); for(const row of rows){const nc=document.createElement('div'); nc.className='proj-cell'; nc.innerHTML='<div class="val">'+esc(row.modelName)+'</div>'; grid.appendChild(nc); for(const k of ['h6','h12','d1','d7','d30']){const p=row[k]; const c=document.createElement('div'); c.className='proj-cell'+(p&&p.confidence==='low'?' low':''); c.innerHTML=p?'<div class="val">'+fmtMoney(p.predictedCost)+'</div><div class="sub">'+esc(p.sub)+'</div>':'<div class="val na">N/A</div><div class="sub">no usage</div>'; grid.appendChild(c);}} document.querySelectorAll('#proj-grid .proj-cell.head').forEach(h=>{const k=h.dataset.sortP; h.classList.toggle('sorted',k===projSortKey); const a=h.querySelector('.arrow'); if(a)a.textContent=k===projSortKey?(projSortDir==='asc'?'↑':'↓'):'↕';}); } document.getElementById('proj-mode').addEventListener('change',e=>{projMode=e.target.value; renderProjections();}); document.querySelectorAll('#proj-grid .proj-cell.head').forEach(h=>h.addEventListener('click',()=>{const k=h.dataset.sortP; if(projSortKey===k)projSortDir=projSortDir==='asc'?'desc':'asc'; else{projSortKey=k; projSortDir=k==='modelName'?'asc':'desc';} renderProjections();}));
  renderTotals(); renderLeaderboards(); renderSummary(); renderModelsTable(); renderTrend(); renderDailyTable(); renderThinkingTable(); renderProjections();
</script>
</body>
</html>`;
    }

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

export { isDbAvailable };
