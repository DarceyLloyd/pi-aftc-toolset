/**
 * pi-aftc-toolset — usage-report feature module.
 *
 * Reads the per-turn SQLite database (populated by usage-recording.ts)
 * and writes a self-contained HTML report to
 * <package-root>/.pi-aftc-toolset/data/report.html, then opens it in
 * the user's browser.
 *
 * The HTML is intentionally one file: embedded CSS, embedded JSON,
 * embedded JS — no external dependencies. The report is organised into:
 *
 *   Section 1 — Daily totals (last 24h): most used / most inefficient /
 *               highest avg cost / lowest avg cost cards.
 *   Section 2 — Weekly totals (last 7d): same four cards, with a
 *               weekend toggle.
 *   Section 3 — Monthly totals (last 28d): same four cards, with a
 *               weekend toggle.
 *   Section 4 — Per-model cost report — sortable table with a period
 *               selector (Daily / Weekly / Monthly / All time).
 *   Section 5 — Per-model × thinking level — same shape as Section 4
 *               but keyed by model + thinking level.
 *   Section 6 — Cost projections — per model × thinking level:
 *               $/hr, $/day, $/wk, $/mo, $/yr derived from total cost
 *               over all recorded active hours. When data is thin
 *               (fewer than ~14 days of recorded activity), the figure
 *               is an estimate based on averages multiplied out, with a
 *               note explaining why.
 *
 * IMPORTANT — small datasets:
 *   Users may have only a few minutes or hours of recorded data. The
 *   projection math uses `max(0.5h, activeHours)` and applies a
 *   confidence threshold: if fewer than ~14 calendar days are present
 *   across all recorded data, projections are flagged as estimates with
 *   a note explaining why and how they were derived. This keeps the
 *   numbers sane on a fresh install without crashing on 1 row.
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
    turns: number;
    userPrompts: number;
    basePrompts: number;
    subPrompts: number;
    cost: number;
    avgCostPerTurn: number;
    avgCostPerUserPrompt: number;
    avgCostPerBasePrompt: number;
    turnsPerUserPrompt: number;
    turnsPerBasePrompt: number;
    maxTurnsPerPrompt: number;
    avgCacheRate: number;
    avgThinkingMs: number;
    avgResponseMs: number;
    activeHours: number;
};
type ModelThinkingRow = {
    modelName: string;
    thinkingLevel: string;
    turns: number;
    userPrompts: number;
    basePrompts: number;
    subPrompts: number;
    cost: number;
    avgCostPerTurn: number;
    avgCostPerUserPrompt: number;
    avgCacheRate: number;
    avgThinkingMs: number;
    avgResponseMs: number;
    activeHours: number;
    /** Projection fields derived from active hours. */
    costPerHour: number;
    costPerDay: number;
    costPerWeek: number;
    costPerMonth: number;
    costPerYear: number;
    estimated: boolean;
    estimateNote: string;
};
type ProjectionRow = {
    modelName: string;
    thinkingLevel: string;
    turns: number;
    cost: number;
    activeHours: number;
    costPerHour: number;
    costPerDay: number;
    costPerWeek: number;
    costPerMonth: number;
    costPerYear: number;
    estimated: boolean;
    estimateNote: string;
};
type SectionCard = {
    modelName: string;
    primary: string;
    secondary: string;
    metric: number;
    description: string;
};
type SectionData = {
    mostUsed: SectionCard[];
    mostInefficient: SectionCard[];
    highestAvgCost: SectionCard[];
    lowestAvgCost: SectionCard[];
};
type SectionKey = "daily" | "weekly" | "monthly";
type SummaryEntry = {
    modelName: string;
    metric: number;
    secondary: string;
};
type SummaryData = {
    mostUsed: SummaryEntry[];
    mostInefficient: SummaryEntry[];
    highestAvgCost: SummaryEntry[];
    lowestAvgCost: SummaryEntry[];
};
type SummaryBundle = {
    title: string;
    subtitle: string;
    cards: SectionCard[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number { return Number(v) || 0; }
function safeDiv(a: number, b: number): number { return b > 0 ? a / b : 0; }
function fmtMs(ms: number): string {
    const s = Math.floor((Number(ms) || 0) / 1000);
    if (s <= 0) return "0s";
    return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

const USER_PROMPT_SQL = `COALESCE(SUM(user_prompt), 0)`;
const BASE_PROMPT_SQL = `COALESCE(SUM(base_prompt), 0)`;
const SUB_PROMPT_SQL = `COALESCE(SUM(sub_prompt), 0)`;
const STEERING_PROMPT_SQL = `COALESCE(SUM(steering_prompt), 0)`;
const FOLLOWUP_PROMPT_SQL = `COALESCE(SUM(followup_prompt), 0)`;
const CONTINUATION_PROMPT_SQL = `COALESCE(SUM(continuation_prompt), 0)`;
const CACHE_RATE_SQL = `AVG(CAST(cache_read AS REAL) / NULLIF(cache_read + input_tokens, 0))`;

// ---------------------------------------------------------------------------
// UsageModule
// ---------------------------------------------------------------------------

class UsageModule {
    constructor(private pi: ExtensionAPI) {}

    attach(): void { this.registerCommands(); }

    // -------------------------------------------------------------------
    // SQL helpers shared across collectors
    // -------------------------------------------------------------------

    private weekendClause(exclude: boolean): string {
        return exclude
            ? `AND strftime('%w', timestamp / 1000, 'unixepoch', 'localtime') NOT IN ('0','6')`
            : ``;
    }

    private windowStatsForModel(db: any, modelName: string, since: number, excludeWeekends = false): ModelRow {
        const row = db.prepare(
            `SELECT COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${BASE_PROMPT_SQL} AS base_count,
                    ${SUB_PROMPT_SQL} AS sub_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    AVG(cost_usd) AS avg_cost,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response,
                    COALESCE(MIN(timestamp), 0) AS first_turn,
                    COALESCE(MAX(timestamp), 0) AS last_turn
             FROM turns
             WHERE model_name = ? AND timestamp >= ?
             ${this.weekendClause(excludeWeekends)}`,
        ).get(modelName, since) as any;
        return {
            modelName,
            turns: num(row.turns),
            userPrompts: num(row.user_count),
            basePrompts: num(row.base_count),
            subPrompts: num(row.sub_count),
            cost: num(row.cost),
            avgCostPerTurn: num(row.avg_cost),
            avgCostPerUserPrompt: safeDiv(num(row.cost), num(row.user_count)),
            avgCostPerBasePrompt: safeDiv(num(row.cost), num(row.base_count)),
            turnsPerUserPrompt: safeDiv(num(row.turns), num(row.user_count)),
            turnsPerBasePrompt: safeDiv(num(row.turns), num(row.base_count)),
            maxTurnsPerPrompt: 0,
            avgCacheRate: num(row.avg_cache_rate),
            avgThinkingMs: num(row.avg_thinking),
            avgResponseMs: num(row.avg_response),
            activeHours: Math.max(0.5, (num(row.last_turn) - num(row.first_turn)) / 3600_000),
        };
    }

    private maxTurnsForModel(db: any, modelName: string, since: number, excludeWeekends = false): number {
        const row = db.prepare(
            `SELECT COALESCE(MAX(turns_per_prompt), 0) AS max_turns FROM (
                 SELECT COUNT(*) AS turns_per_prompt
                 FROM turns
                 WHERE model_name = ? AND prompt_index > 0 AND timestamp >= ?
                 ${this.weekendClause(excludeWeekends)}
                 GROUP BY COALESCE(session_id, ''), prompt_index
             )`,
        ).get(modelName, since) as { max_turns: number };
        return num(row.max_turns);
    }

    private collectAllTimeModels(db: any): ModelRow[] {
        const models = (db.prepare(
            `SELECT DISTINCT model_name FROM turns WHERE model_name IS NOT NULL AND model_name != '' ORDER BY model_name`,
        ).all() as Array<{ model_name: string }>).map(r => r.model_name);
        return models.map(m => {
            const r = this.windowStatsForModel(db, m, 0);
            r.maxTurnsPerPrompt = this.maxTurnsForModel(db, m, 0);
            return r;
        });
    }

    private collectAllTimeModelThinking(db: any): ModelThinkingRow[] {
        const rows = (db.prepare(
            `SELECT model_name,
                    thinking_level,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${BASE_PROMPT_SQL} AS base_count,
                    ${SUB_PROMPT_SQL} AS sub_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    AVG(cost_usd) AS avg_cost,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response,
                    COALESCE(MIN(timestamp), 0) AS first_turn,
                    COALESCE(MAX(timestamp), 0) AS last_turn
             FROM turns
             WHERE model_name IS NOT NULL AND model_name != ''
             GROUP BY model_name, thinking_level
             ORDER BY model_name, thinking_level`,
        ).all() as any[]).map(r => {
            const cost = num(r.cost);
            const turns = num(r.turns);
            const userCount = num(r.user_count);
            const activeHours = Math.max(0.5, (num(r.last_turn) - num(r.first_turn)) / 3600_000);
            return {
                modelName: r.model_name,
                thinkingLevel: r.thinking_level || "(none)",
                turns,
                userPrompts: userCount,
                basePrompts: num(r.base_count),
                subPrompts: num(r.sub_count),
                cost,
                avgCostPerTurn: num(r.avg_cost),
                avgCostPerUserPrompt: safeDiv(cost, userCount),
                avgCacheRate: num(r.avg_cache_rate),
                avgThinkingMs: num(r.avg_thinking),
                avgResponseMs: num(r.avg_response),
                activeHours,
                costPerHour: 0,
                costPerDay: 0,
                costPerWeek: 0,
                costPerMonth: 0,
                costPerYear: 0,
                estimated: false,
                estimateNote: "",
            };
        });
        return rows;
    }

    /**
     * Collect per-model stats for a windowed table. Used by Section 4.
     * @param since - timestamp floor; 0 = all time
     */
    private collectWindowedModels(db: any, since: number, excludeWeekends = false): ModelRow[] {
        const models = (db.prepare(
            `SELECT DISTINCT model_name FROM turns WHERE model_name IS NOT NULL AND model_name != '' ORDER BY model_name`,
        ).all() as Array<{ model_name: string }>).map(r => r.model_name);
        return models.map(m => {
            const r = this.windowStatsForModel(db, m, since, excludeWeekends);
            r.maxTurnsPerPrompt = this.maxTurnsForModel(db, m, since, excludeWeekends);
            return r;
        });
    }

    /**
     * Collect per-model×thinking stats for a windowed table. Used by Section 5.
     */
    private collectWindowedModelThinking(db: any, since: number): ModelThinkingRow[] {
        const rows = (db.prepare(
            `SELECT model_name,
                    thinking_level,
                    COUNT(*) AS turns,
                    ${USER_PROMPT_SQL} AS user_count,
                    ${BASE_PROMPT_SQL} AS base_count,
                    ${SUB_PROMPT_SQL} AS sub_count,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    AVG(cost_usd) AS avg_cost,
                    ${CACHE_RATE_SQL} AS avg_cache_rate,
                    AVG(thinking_ms) AS avg_thinking,
                    AVG(response_ms) AS avg_response,
                    COALESCE(MIN(timestamp), 0) AS first_turn,
                    COALESCE(MAX(timestamp), 0) AS last_turn
             FROM turns
             WHERE model_name IS NOT NULL AND model_name != ''
             ${since > 0 ? "AND timestamp >= ?" : ""}
             GROUP BY model_name, thinking_level
             ORDER BY model_name, thinking_level`,
        ).all(...(since > 0 ? [since] : [])) as any[]).map(r => {
            const cost = num(r.cost);
            const turns = num(r.turns);
            const userCount = num(r.user_count);
            const activeHours = Math.max(0.5, (num(r.last_turn) - num(r.first_turn)) / 3600_000);
            return {
                modelName: r.model_name,
                thinkingLevel: r.thinking_level || "(none)",
                turns,
                userPrompts: userCount,
                basePrompts: num(r.base_count),
                subPrompts: num(r.sub_count),
                cost,
                avgCostPerTurn: num(r.avg_cost),
                avgCostPerUserPrompt: safeDiv(cost, userCount),
                avgCacheRate: num(r.avg_cache_rate),
                avgThinkingMs: num(r.avg_thinking),
                avgResponseMs: num(r.avg_response),
                activeHours,
                costPerHour: 0,
                costPerDay: 0,
                costPerWeek: 0,
                costPerMonth: 0,
                costPerYear: 0,
                estimated: false,
                estimateNote: "",
            };
        });
        return rows;
    }

    // -------------------------------------------------------------------
    // Projection math (Section 6)
    // -------------------------------------------------------------------

    /**
     * Compute per-model×thinking-level cost projections from total spend
     * over all recorded active hours. Returns $/hr, /day, /wk, /mo, /yr.
     *
     * Thin data handling:
     *   - If fewer than ~14 distinct calendar days are present across ALL
     *     data, projections are flagged as estimates ("not enough data
     *     available for calculation, averages have been used").
     *   - If a single model×thinking level has < 1 hour of activity, we
     *     still compute an hourly rate but flag it as an estimate.
     */
    private computeProjections(db: any): { rows: ProjectionRow[]; estimated: boolean; estimateNote: string } {
        const rows = this.collectAllTimeModelThinking(db);
        const calendarDays = num(db.prepare(
            `SELECT COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) AS n FROM turns`,
        ).get().n);
        const dataDays = Math.max(0.5, calendarDays);
        const enoughData = calendarDays >= 14;
        const globalNote = enoughData
            ? "Based on all-time recorded spend ÷ active hours."
            : "Not enough data available for calculation, averages have been used.";

        const projRows: ProjectionRow[] = rows.map(r => {
            const cost = r.cost;
            const perHr = safeDiv(cost, r.activeHours);
            const perDay = perHr * 24;
            const perWeek = perHr * 168;
            const perMonth = perHr * 720;
            const perYear = perHr * 8760;
            const localEstimated = !enoughData || r.activeHours < 1;
            const note = localEstimated
                ? (r.activeHours < 1
                    ? `Only ${r.activeHours.toFixed(2)}h of activity recorded for this model/thinking level — estimate.`
                    : globalNote)
                : globalNote;
            return {
                modelName: r.modelName,
                thinkingLevel: r.thinkingLevel,
                turns: r.turns,
                cost,
                activeHours: r.activeHours,
                costPerHour: perHr,
                costPerDay: perDay,
                costPerWeek: perWeek,
                costPerMonth: perMonth,
                costPerYear: perYear,
                estimated: localEstimated,
                estimateNote: note,
            };
        });

        // Also populate the projection fields on the model-thinking rows so
        // Section 5 can show them inline if desired.
        for (const r of rows) {
            const perHr = safeDiv(r.cost, r.activeHours);
            r.costPerHour = perHr;
            r.costPerDay = perHr * 24;
            r.costPerWeek = perHr * 168;
            r.costPerMonth = perHr * 720;
            r.costPerYear = perHr * 8760;
            r.estimated = !enoughData || r.activeHours < 1;
            r.estimateNote = r.estimated
                ? (r.activeHours < 1
                    ? `Only ${r.activeHours.toFixed(2)}h of activity recorded for this model/thinking level — estimate.`
                    : globalNote)
                : globalNote;
        }

        return { rows: projRows, estimated: !enoughData, estimateNote: globalNote };
    }

    // -------------------------------------------------------------------
    // Sections 1–3 summary cards
    // -------------------------------------------------------------------

    /**
     * Compute the four summary cards for a windowed period.
     *
     *  - most used: derived from base prompts (highest basePromptCount wins)
     *  - most inefficient: derived from highest turns/self-prompting
     *    (turns / basePrompt ratio, capped at 1 turn minimum)
     *  - highest avg cost: derived from base + sub prompts
     *    (avgCostPerUserPrompt highest)
     *  - lowest avg cost: derived from base + sub prompts
     *    (avgCostPerUserPrompt lowest)
     *
     * @param sinceMs - timestamp floor; 0 = all time
     */
    private computeSummary(db: any, sinceMs: number, excludeWeekends = false): SummaryData {
        const rows = this.collectWindowedModels(db, sinceMs, excludeWeekends).filter(r => r.turns > 0);
        const pick = (arr: ModelRow[], key: (r: ModelRow) => number, dir: "asc" | "desc") => {
            const sorted = arr.slice().sort((a, b) => {
                const d = key(a) - key(b);
                return dir === "asc" ? d : -d;
            });
            return sorted[0];
        };

        const makeEntry = (r: ModelRow | undefined): SummaryEntry => ({
            modelName: r?.modelName ?? "",
            metric: r?.turns ?? 0,
            secondary: "",
        });

        const mostUsed = makeEntry(pick(rows, r => r.basePrompts, "desc"));
        const inefficient = pick(rows, r => Math.max(0.1, r.turnsPerBasePrompt), "desc");
        const mostInefficient = makeEntry(inefficient);
        const highest = pick(rows, r => r.avgCostPerUserPrompt, "desc");
        const highestAvgCost = makeEntry(highest);
        const lowest = pick(rows, r => r.avgCostPerUserPrompt, "asc");
        const lowestAvgCost = makeEntry(lowest);

        // Attach metric context for each
        const byMostUsed = rows.find(r => r.modelName === mostUsed.modelName);
        const byInefficient = rows.find(r => r.modelName === mostInefficient.modelName);
        const byHighest = rows.find(r => r.modelName === highestAvgCost.modelName);
        const byLowest = rows.find(r => r.modelName === lowestAvgCost.modelName);

        return {
            mostUsed: [byMostUsed ? { ...mostUsed, metric: byMostUsed.basePrompts, secondary: `${byMostUsed.basePrompts} base prompts · ${byMostUsed.turns} model calls · $${byMostUsed.cost.toFixed(4)}` } : mostUsed],
            mostInefficient: [byInefficient ? { ...mostInefficient, metric: byInefficient.turnsPerBasePrompt, secondary: `${byInefficient.turnsPerBasePrompt.toFixed(2)} model calls per base prompt · ${byInefficient.maxTurnsPerPrompt} max calls/prompt · ${byInefficient.subPrompts} sub prompts` } : mostInefficient],
            highestAvgCost: [byHighest ? { ...highestAvgCost, metric: byHighest.avgCostPerUserPrompt, secondary: `$${byHighest.avgCostPerUserPrompt.toFixed(4)} avg cost/user prompt · ${byHighest.userPrompts} prompts · $${byHighest.cost.toFixed(4)} total` } : highestAvgCost],
            lowestAvgCost: [byLowest ? { ...lowestAvgCost, metric: byLowest.avgCostPerUserPrompt, secondary: `$${byLowest.avgCostPerUserPrompt.toFixed(4)} avg cost/user prompt · ${byLowest.userPrompts} prompts · $${byLowest.cost.toFixed(4)} total` } : lowestAvgCost],
        };
    }

    // -------------------------------------------------------------------
    // Master data collector
    // -------------------------------------------------------------------

    private collectReportData(): any | null {
        const db = getDb();
        if (!db) return null;

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // ---- Section 1: Daily totals (last 24h) ----
        const dailySince = now - dayMs;
        const daily = this.computeSummary(db, dailySince);

        // ---- Section 2: Weekly totals (last 7 days) ----
        // We collect BOTH weekend-included and weekend-excluded variants so the
        // toggle can flip without re-querying.
        const weeklySince = now - 7 * dayMs;
        const weekly = this.computeSummary(db, weeklySince, false);
        const weeklyExcl = this.computeSummary(db, weeklySince, true);

        // ---- Section 3: Monthly totals (last 28 days) ----
        const monthlySince = now - 28 * dayMs;
        const monthly = this.computeSummary(db, monthlySince, false);
        const monthlyExcl = this.computeSummary(db, monthlySince, true);

        // ---- Section 4: Per-model cost report (all variants precomputed) ----
        const modelsByPeriod: Record<TablePeriod, ModelRow[]> = {
            daily: this.collectWindowedModels(db, dailySince),
            weekly: this.collectWindowedModels(db, weeklySince),
            monthly: this.collectWindowedModels(db, monthlySince),
            all: this.collectAllTimeModels(db),
        };

        // ---- Section 5: Per-model × thinking level ----
        const modelThinkingByPeriod: Record<TablePeriod, ModelThinkingRow[]> = {
            daily: this.collectWindowedModelThinking(db, dailySince),
            weekly: this.collectWindowedModelThinking(db, weeklySince),
            monthly: this.collectWindowedModelThinking(db, monthlySince),
            all: this.collectAllTimeModelThinking(db),
        };

        // ---- Section 6: Cost projections ----
        const projections = this.computeProjections(db);

        // ---- Lifetime totals ----
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
        ).get() as any;
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
            activeHours: Math.max(0, (lastTurn - firstTurn) / 3600_000),
            avgCostPerTurn: safeDiv(totalCost, turnCount),
            avgCostPerUserPrompt: safeDiv(totalCost, userPromptCount),
            turnsPerUserPrompt: safeDiv(turnCount, userPromptCount),
        };

        // Build summary cards into a bundle keyed by section name.
        const makeBundle = (key: SectionKey, data: SummaryData): SummaryBundle => {
            const labels: Record<SectionKey, string> = {
                daily: "Daily totals",
                weekly: "Weekly totals",
                monthly: "Monthly totals",
            };
            const sub: Record<SectionKey, string> = {
                daily: "Last 24 hours",
                weekly: "Last 7 days",
                monthly: "Last 28 days",
            };
            const cards: SectionCard[] = [];
            const push = (title: string, entries: SummaryEntry[]) => {
                const e = entries[0];
                cards.push({
                    title,
                    primary: e.modelName,
                    secondary: e.secondary,
                    metric: e.metric,
                    description: e.secondary,
                });
            };
            push("Most used", data.mostUsed);
            push("Most inefficient", data.mostInefficient);
            push("Highest avg cost", data.highestAvgCost);
            push("Lowest avg cost", data.lowestAvgCost);
            return { title: labels[key], subtitle: sub[key], cards };
        };

        return {
            generatedAt: now,
            totals,
            sections: {
                daily: makeBundle("daily", daily),
                weekly: makeBundle("weekly", weekly),
                weeklyExcl: makeBundle("weekly", weeklyExcl),
                monthly: makeBundle("monthly", monthly),
                monthlyExcl: makeBundle("monthly", monthlyExcl),
            },
            modelsByPeriod,
            modelThinkingByPeriod,
            projections: {
                rows: projections.rows,
                estimated: projections.estimated,
                note: projections.estimateNote,
            },
        };
    }

    // -------------------------------------------------------------------
    // Clearing
    // -------------------------------------------------------------------

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
            const ok = await showConfirm(ctx, { title: "Clear usage database", body: `Permanently delete all ${count} recorded turn${count === 1 ? "" : "s"} from the SQLite database?\n\nThis cannot be undone.` });
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

    // -------------------------------------------------------------------
    // HTML generation
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
<style>
  :root {
    --bg:#0f1115; --panel:#161a22; --panel-2:#1d2230; --border:#2a3142;
    --text:#e6e9ef; --muted:#8b94a7; --accent:#6aa9ff; --good:#5ad19a;
    --warn:#f3b664; --bad:#ef6b6b; --bar:#4d8df6; --bar-2:#76e0c2;
    --card-bg:#1a1f2b;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg:#f7f8fb; --panel:#fff; --panel-2:#f1f3f8; --border:#d8dde7;
      --text:#1a1d24; --muted:#5d667a; --accent:#2c6dd2; --good:#1f9d6c;
      --warn:#c47d20; --bad:#c43c3c; --bar:#2c6dd2; --bar-2:#1f9d6c;
      --card-bg:#f4f6fb;
    }
  }
  * { box-sizing:border-box; }
  html, body { margin:0; padding:0; background:var(--bg); color:var(--text);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  main { max-width:1240px; margin:0 auto; padding:24px 20px 64px; }
  header { display:flex; flex-wrap:wrap; align-items:flex-start; gap:12px; margin-bottom:8px; }
  h1 { font-size:24px; margin:0; }
  h2 { font-size:18px; margin:28px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--border); }
  h2 .section-meta { color:var(--muted); font-size:12px; font-weight:400; margin-left:10px; }
  .meta { color:var(--muted); font-size:12px; display:block; margin-top:2px; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; margin:10px 0; }
  .grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  @media(max-width:1000px){.grid-4{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:600px){.grid-4{grid-template-columns:1fr}}
  .stat-label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .stat-value { font-size:15px; font-weight:700; margin-top:4px; word-break:break-word; }
  .stat-sub { color:var(--muted); font-size:12px; margin-top:3px; }
  .empty { color:var(--muted); font-style:italic; padding:10px 0; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { font-weight:600; color:var(--muted); cursor:pointer; user-select:none; white-space:nowrap; }
  th .arrow { color:var(--accent); margin-left:4px; opacity:.5; font-size:10px; }
  th.sorted .arrow { opacity:1; }
  tbody tr:hover { background:var(--panel-2); }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .pill { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; }
  .pill.good{background:rgba(90,209,154,.15);color:var(--good)}
  .pill.warn{background:rgba(243,182,100,.15);color:var(--warn)}
  .pill.bad{background:rgba(239,107,107,.15);color:var(--bad)}
  .pill.info{background:rgba(106,169,255,.15);color:var(--accent)}
  .lvl { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600;
    background:var(--panel-2); color:var(--muted); border:1px solid var(--border); }
  .lvl.high{background:rgba(106,169,255,.15);color:var(--accent);border-color:transparent}
  .lvl.medium{background:rgba(243,182,100,.15);color:var(--warn);border-color:transparent}
  .lvl.low{background:rgba(90,209,154,.15);color:var(--good);border-color:transparent}
  .bar-cell { display:flex; align-items:center; gap:8px; }
  .bar-track { flex:1; height:8px; background:var(--panel-2); border-radius:4px; overflow:hidden; }
  .bar-fill { height:100%; background:var(--bar); }
  /* Dropdowns */
  .toolbar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; margin:0 0 12px; }
  .toolbar-left { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
  .toolbar-right { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
  select {
    background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:8px;
    padding:6px 12px; font-size:13px; font-family:inherit;
    cursor:pointer;
  }
  select:focus { outline:none; border-color:var(--accent); }
  /* Make sure dropdown options are readable on Windows/Chrome */
  select option { background:var(--panel-2); color:var(--text); }
  .toggle-btn {
    background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:8px;
    padding:6px 12px; font-size:12px; cursor:pointer;
    font-family:inherit;
  }
  .toggle-btn.active { background:var(--accent); color:#fff; border-color:transparent; }
  .toggle-btn:not(.active):hover { background:var(--panel); }
  .note { color:var(--muted); font-size:12px; line-height:1.55; margin:8px 0 0; }
  .note.estimate { color:var(--warn); }
  .proj-grid { display:grid; grid-template-columns:2.2fr repeat(5,1fr); gap:0; font-size:13px; }
  .proj-cell { padding:8px 10px; border-bottom:1px solid var(--border); }
  .proj-cell.head { font-weight:600; color:var(--muted); background:var(--panel-2); cursor:pointer; user-select:none; white-space:nowrap; }
  .proj-cell.head.sorted .arrow { color:var(--accent); font-weight:700; }
  .proj-cell .arrow { opacity:.5; font-size:10px; margin-left:4px; }
  .proj-cell .val { font-variant-numeric:tabular-nums; }
  .proj-cell .sub { color:var(--muted); font-size:10px; margin-top:1px; }
  .proj-cell.estimate .val { color:var(--warn); }
  footer { color:var(--muted); font-size:11px; margin:32px 0 18px; text-align:center; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>${title}</h1>
      <span class="meta" id="generated-at"></span>
    </div>
  </header>

  <h2>Lifetime totals</h2>
  <div class="grid-4" id="lifetime-totals"></div>

  <!-- Section 1 -->
  <h2 id="sec-daily-title">Daily totals <span class="section-meta">Last 24 hours</span></h2>
  <div class="grid-4" id="sec-daily"></div>

  <!-- Section 2 -->
  <h2 id="sec-weekly-title">Weekly totals <span class="section-meta">Last 7 days</span></h2>
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="toggle-btn active" id="weekly-weekend-toggle" data-state="include">Include weekends</button>
    </div>
    <div class="toolbar-right">
      <span class="note" id="weekly-note"></span>
    </div>
  </div>
  <div class="grid-4" id="sec-weekly"></div>

  <!-- Section 3 -->
  <h2 id="sec-monthly-title">Monthly totals <span class="section-meta">Last 28 days</span></h2>
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="toggle-btn active" id="monthly-weekend-toggle" data-state="include">Include weekends</button>
    </div>
    <div class="toolbar-right">
      <span class="note" id="monthly-note"></span>
    </div>
  </div>
  <div class="grid-4" id="sec-monthly"></div>

  <!-- Section 4 -->
  <h2>Per-model cost report</h2>
  <div class="panel">
    <div class="toolbar">
      <div class="toolbar-left"></div>
      <div class="toolbar-right">
        <label class="stat-sub">Period
          <select id="models-period">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="all" selected>All time</option>
          </select>
        </label>
      </div>
    </div>
    <table id="models-table">
      <thead><tr>
        <th data-sort="modelName">Model <span class="arrow">↕</span></th>
        <th data-sort="cost" class="num sorted desc">Cost <span class="arrow">↓</span></th>
        <th data-sort="turns" class="num">Turns <span class="arrow">↕</span></th>
        <th data-sort="userPrompts" class="num">User prompts <span class="arrow">↕</span></th>
        <th data-sort="basePrompts" class="num">Base prompts <span class="arrow">↕</span></th>
        <th data-sort="subPrompts" class="num">Sub prompts <span class="arrow">↕</span></th>
        <th data-sort="turnsPerUserPrompt" class="num">Calls/prompt <span class="arrow">↕</span></th>
        <th data-sort="maxTurnsPerPrompt" class="num">Max calls/prompt <span class="arrow">↕</span></th>
        <th data-sort="avgCostPerTurn" class="num">Avg cost/turn <span class="arrow">↕</span></th>
        <th data-sort="avgCostPerUserPrompt" class="num">Avg cost/prompt <span class="arrow">↕</span></th>
        <th data-sort="avgCacheRate" class="num">Avg cache <span class="arrow">↕</span></th>
        <th data-sort="avgThinkingMs" class="num">Avg think <span class="arrow">↕</span></th>
        <th data-sort="avgResponseMs" class="num">Avg response <span class="arrow">↕</span></th>
      </tr></thead>
      <tbody id="models-tbody"></tbody>
    </table>
    <div id="models-empty" class="empty" style="display:none;">No data for this period.</div>
  </div>

  <!-- Section 5 -->
  <h2>Per-model × thinking level</h2>
  <div class="panel">
    <div class="toolbar">
      <div class="toolbar-left"></div>
      <div class="toolbar-right">
        <label class="stat-sub">Period
          <select id="thinking-period">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="all" selected>All time</option>
          </select>
        </label>
      </div>
    </div>
    <table id="thinking-table">
      <thead><tr>
        <th data-sort-t="modelName">Model <span class="arrow">↕</span></th>
        <th data-sort-t="thinkingLevel">Thinking <span class="arrow">↕</span></th>
        <th data-sort-t="turns" class="num">Turns <span class="arrow">↕</span></th>
        <th data-sort-t="userPrompts" class="num">User prompts <span class="arrow">↕</span></th>
        <th data-sort-t="basePrompts" class="num">Base prompts <span class="arrow">↕</span></th>
        <th data-sort-t="subPrompts" class="num">Sub prompts <span class="arrow">↕</span></th>
        <th data-sort-t="cost" class="num">Cost <span class="arrow">↕</span></th>
        <th data-sort-t="avgCostPerTurn" class="num">Avg cost/turn <span class="arrow">↕</span></th>
        <th data-sort-t="avgCostPerUserPrompt" class="num">Avg cost/prompt <span class="arrow">↕</span></th>
        <th data-sort-t="avgCacheRate" class="num">Avg cache <span class="arrow">↕</span></th>
        <th data-sort-t="avgThinkingMs" class="num">Avg think <span class="arrow">↕</span></th>
        <th data-sort-t="avgResponseMs" class="num">Avg response <span class="arrow">↕</span></th>
      </tr></thead>
      <tbody id="thinking-tbody"></tbody>
    </table>
    <div id="thinking-empty" class="empty" style="display:none;">No data for this period.</div>
  </div>

  <!-- Section 6 -->
  <h2>Cost projections</h2>
  <div class="panel">
    <div class="toolbar">
      <div class="toolbar-left">
        <p class="note" id="proj-note"></p>
      </div>
      <div class="toolbar-right"></div>
    </div>
    <div class="proj-grid" id="proj-grid">
      <div class="proj-cell head" data-sort-p="modelName">Model <span class="arrow">↕</span></div>
      <div class="proj-cell head" data-sort-p="thinkingLevel">Thinking <span class="arrow">↕</span></div>
      <div class="proj-cell head sorted" data-sort-p="costPerHour">$/hr <span class="arrow">↓</span></div>
      <div class="proj-cell head" data-sort-p="costPerDay">$/day <span class="arrow">↕</span></div>
      <div class="proj-cell head" data-sort-p="costPerWeek">$/week <span class="arrow">↕</span></div>
      <div class="proj-cell head" data-sort-p="costPerMonth">$/month <span class="arrow">↕</span></div>
      <div class="proj-cell head" data-sort-p="costPerYear">$/year <span class="arrow">↕</span></div>
    </div>
    <div id="proj-empty" class="empty" style="display:none;">No data recorded yet.</div>
  </div>

  <footer>Generated by pi-aftc-toolset &middot; /usage-report<br>Author Darcey.Lloyd@gmail.com</footer>
</main>
<script type="application/json" id="report-data">${json}</script>
<script type="module">
  const raw = document.getElementById("report-data").textContent || "{}";
  const data = JSON.parse(raw);
  const fmtMoney = n => "$" + (Number(n) || 0).toFixed(4);
  const fmtMoney2 = n => "$" + (Number(n) || 0).toFixed(2);
  const fmtPct = n => ((Number(n) || 0) * 100).toFixed(1) + "%";
  const fmtMs = ms => { ms = Number(ms) || 0; if (ms <= 0) return "0s"; const s = Math.floor(ms/1000); return s < 60 ? s+"s" : Math.floor(s/60)+"m "+(s%60)+"s"; };
  const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  function cachePill(rate){ const p=(Number(rate)||0)*100; return '<span class="pill '+(p>=60?"good":p>=30?"warn":"bad")+'">'+p.toFixed(1)+"%</span>"; }
  function thinkingPill(level){ const l=String(level||"").toLowerCase(); let cls=""; if(l==="high"||l==="xhigh")cls=" high"; else if(l==="medium"||l==="med")cls=" medium"; else if(l==="low"||l==="off"||l==="minimal")cls=" low"; return '<span class="lvl'+cls+'">'+esc(level)+'</span>'; }
  function sortRows(rows,key,dir){ const d=dir==='asc'?1:-1; return rows.sort((a,b)=>{ const av=a[key], bv=b[key]; if(typeof av==='string') return av.localeCompare(bv)*d; return ((av||0)-(bv||0))*d; }); }
  function updateArrows(sel, attr, key, dir){ document.querySelectorAll(sel).forEach(th=>{ const k=th.dataset[attr]; th.classList.toggle('sorted', k===key); const a=th.querySelector('.arrow'); if(a) a.textContent=k===key?(dir==='asc'?'↑':'↓'):'↕'; }); }

  document.getElementById("generated-at").textContent = "Generated " + new Date(data.generatedAt).toLocaleString();

  // ---- Lifetime totals ----
  function renderTotals(){
    const t = data.totals || {};
    const cards = [
      ["Total cost", fmtMoney(t.totalCost), "avg "+fmtMoney(t.avgCostPerUserPrompt)+" / user prompt"],
      ["Model calls", (t.turnCount||0).toLocaleString(), (t.automatedTurnCount||0)+" automated continuations"],
      ["User prompts", (t.userPromptCount||0).toLocaleString(), "base + sub prompts submitted by you"],
      ["Base prompts", (t.basePromptCount||0).toLocaleString(), "top-level prompts (projection baseline)"],
      ["Sub prompts", (t.subPromptCount||0).toLocaleString(), (t.steeringPromptCount||0)+" steer · "+(t.followupPromptCount||0)+" follow-up · "+(t.continuationPromptCount||0)+" continuation"],
      ["Avg cost / turn", fmtMoney(t.avgCostPerTurn), "avg cost per assistant/model call"],
      ["Avg cache", fmtPct(t.avgCacheRate), "cache read / total prompt tokens"],
      ["Cache read / write", (t.totalCacheRead||0).toLocaleString()+" / "+(t.totalCacheWrite||0).toLocaleString()+" tok", "cached prefix activity"],
      ["Active hours", (t.activeHours||0).toFixed(1)+"h", "first → last recorded turn"],
      ["Calls / prompt", (Number(t.turnsPerUserPrompt)||0).toFixed(2), "lower is better; high = tool-call loop"],
    ];
    const root = document.getElementById("lifetime-totals");
    root.innerHTML = "";
    for (const [label, value, sub] of cards){
      const el = document.createElement("div");
      el.className = "panel";
      el.innerHTML = '<div class="stat-label">'+esc(label)+'</div><div class="stat-value">'+esc(value)+'</div><div class="stat-sub">'+esc(sub)+'</div>';
      root.appendChild(el);
    }
  }

  // ---- Section 1–3 cards ----
  function renderSectionCards(sectionId, sectionKey){
    const root = document.getElementById(sectionId);
    if (!root) return;
    const section = data.sections[sectionKey];
    if (!section) { root.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const titles = ["Most used", "Most inefficient", "Highest avg cost", "Lowest avg cost"];
    const pills = ["info", "warn", "bad", "good"];
    const pillLabels = ["USED", "INEFFICIENT", "HIGH COST", "LOW COST"];
    root.innerHTML = "";
    const cards = section.cards || [];
    for (let i = 0; i < titles.length; i++){
      const card = cards[i];
      const el = document.createElement("div");
      el.className = "panel";
      const hasData = card && card.primary && card.primary !== "";
      if (!hasData){
        el.innerHTML = '<div class="stat-label">'+esc(titles[i])+'</div><div class="stat-value empty">No data</div>';
      } else {
        el.innerHTML = '<div class="stat-label">'+esc(titles[i])+' <span class="pill '+pills[i]+'">'+pillLabels[i]+'</span></div>'
          + '<div class="stat-value">'+esc(card.primary)+'</div>'
          + '<div class="stat-sub">'+esc(card.secondary)+'</div>';
      }
      root.appendChild(el);
    }
  }

  function renderSections(){
    renderSectionCards("sec-daily", "daily");
    renderSectionCards("sec-weekly", "weekly");
    renderSectionCards("sec-monthly", "monthly");
  }

  // ---- Weekday toggle (weekly/monthly) ----
  function renderNotes(){
    const wNote = document.getElementById("weekly-note");
    const mNote = document.getElementById("monthly-note");
    if (wNote) wNote.textContent = "Weekend toggle filters out Sat/Sun data from the last 7 days.";
    if (mNote) mNote.textContent = "Weekend toggle filters out Sat/Sun data from the last 28 days.";
  }

  function setupWeekendToggle(btnId, sectionKeyIncl, sectionKeyExcl){
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const isInclude = btn.dataset.state === "include";
      const newState = isInclude ? "exclude" : "include";
      btn.dataset.state = newState;
      btn.classList.toggle("active", newState === "include");
      btn.textContent = newState === "include" ? "Include weekends" : "Exclude weekends";
      const key = newState === "include" ? sectionKeyIncl : sectionKeyExcl;
      const sectionId = sectionKeyIncl === "weekly" || sectionKeyExcl === "weekly" ? "sec-weekly" : "sec-monthly";
      renderSectionCards(sectionId, key);
    });
  }

  // ---- Section 4: Per-model table ----
  let modelsPeriod = "all";
  let modelsSortKey = "cost";
  let modelsSortDir = "desc";
  function renderModelsTable(){
    const tbody = document.getElementById("models-tbody");
    const empty = document.getElementById("models-empty");
    const rows = (data.modelsByPeriod || {})[modelsPeriod] || [];
    tbody.innerHTML = "";
    if (!rows.length){ empty.style.display = "block"; return; }
    empty.style.display = "none";
    const sorted = sortRows(rows.slice(), modelsSortKey, modelsSortDir);
    const maxCost = Math.max(1, ...rows.map(r => r.cost));
    for (const r of sorted){
      const tr = document.createElement("tr");
      const pct = Math.max(0, Math.min(100, (r.cost / maxCost) * 100));
      tr.innerHTML = '<td>'+esc(r.modelName)+'</td>'
        + '<td class="num"><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:'+pct.toFixed(1)+'%"></div></div><span>'+fmtMoney(r.cost)+'</span></div></td>'
        + '<td class="num">'+r.turns+'</td>'
        + '<td class="num">'+r.userPrompts+'</td>'
        + '<td class="num">'+r.basePrompts+'</td>'
        + '<td class="num">'+r.subPrompts+'</td>'
        + '<td class="num">'+(Number(r.turnsPerUserPrompt)||0).toFixed(2)+'</td>'
        + '<td class="num">'+(Number(r.maxTurnsPerPrompt)||0)+'</td>'
        + '<td class="num">'+fmtMoney(r.avgCostPerTurn)+'</td>'
        + '<td class="num">'+fmtMoney(r.avgCostPerUserPrompt)+'</td>'
        + '<td class="num">'+cachePill(r.avgCacheRate)+'</td>'
        + '<td class="num">'+fmtMs(r.avgThinkingMs)+'</td>'
        + '<td class="num">'+fmtMs(r.avgResponseMs)+'</td>';
      tbody.appendChild(tr);
    }
    updateArrows('#models-table thead th','sort',modelsSortKey,modelsSortDir);
  }
  function setupModelsTable(){
    const sel = document.getElementById("models-period");
    if (sel) sel.addEventListener("change", e => { modelsPeriod = e.target.value; renderModelsTable(); });
    document.querySelectorAll('#models-table thead th').forEach(th => {
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (modelsSortKey === k) modelsSortDir = modelsSortDir === 'asc' ? 'desc' : 'asc';
        else { modelsSortKey = k; modelsSortDir = k === 'modelName' ? 'asc' : 'desc'; }
        renderModelsTable();
      });
    });
  }

  // ---- Section 5: Per-model × thinking level table ----
  let thinkingPeriod = "all";
  let thinkingSortKey = "cost";
  let thinkingSortDir = "desc";
  function renderThinkingTable(){
    const tbody = document.getElementById("thinking-tbody");
    const empty = document.getElementById("thinking-empty");
    const rows = (data.modelThinkingByPeriod || {})[thinkingPeriod] || [];
    tbody.innerHTML = "";
    if (!rows.length){ empty.style.display = "block"; return; }
    empty.style.display = "none";
    const sorted = sortRows(rows.slice(), thinkingSortKey, thinkingSortDir);
    for (const r of sorted){
      const tr = document.createElement("tr");
      tr.innerHTML = '<td>'+esc(r.modelName)+'</td>'
        + '<td>'+thinkingPill(r.thinkingLevel)+'</td>'
        + '<td class="num">'+r.turns+'</td>'
        + '<td class="num">'+r.userPrompts+'</td>'
        + '<td class="num">'+r.basePrompts+'</td>'
        + '<td class="num">'+r.subPrompts+'</td>'
        + '<td class="num">'+fmtMoney(r.cost)+'</td>'
        + '<td class="num">'+fmtMoney(r.avgCostPerTurn)+'</td>'
        + '<td class="num">'+fmtMoney(r.avgCostPerUserPrompt)+'</td>'
        + '<td class="num">'+cachePill(r.avgCacheRate)+'</td>'
        + '<td class="num">'+fmtMs(r.avgThinkingMs)+'</td>'
        + '<td class="num">'+fmtMs(r.avgResponseMs)+'</td>';
      tbody.appendChild(tr);
    }
    updateArrows('#thinking-table thead th','sortT',thinkingSortKey,thinkingSortDir);
  }
  function setupThinkingTable(){
    const sel = document.getElementById("thinking-period");
    if (sel) sel.addEventListener("change", e => { thinkingPeriod = e.target.value; renderThinkingTable(); });
    document.querySelectorAll('#thinking-table thead th').forEach(th => {
      th.addEventListener("click", () => {
        const k = th.dataset.sortT;
        if (thinkingSortKey === k) thinkingSortDir = thinkingSortDir === 'asc' ? 'desc' : 'asc';
        else { thinkingSortKey = k; thinkingSortDir = k === 'modelName' || k === 'thinkingLevel' ? 'asc' : 'desc'; }
        renderThinkingTable();
      });
    });
  }

  // ---- Section 6: Cost projections ----
  let projSortKey = "costPerHour";
  let projSortDir = "desc";
  function renderProjections(){
    const noteEl = document.getElementById("proj-note");
    if (noteEl){
      const p = data.projections || {};
      noteEl.textContent = p.note || "";
      noteEl.classList.toggle("estimate", !!p.estimated);
    }
    const grid = document.getElementById("proj-grid");
    const empty = document.getElementById("proj-empty");
    const rows = (data.projections || {}).rows || [];
    // Remove all rows after the header row
    while (grid.children.length > 7) grid.removeChild(grid.lastElementChild);
    if (!rows.length){ empty.style.display = "block"; return; }
    empty.style.display = "none";
    const sorted = sortRows(rows.slice(), projSortKey, projSortDir);
    for (const r of sorted){
      const cells = [
        { v: r.modelName, sub: "" },
        { v: r.thinkingLevel, sub: "" },
        { v: fmtMoney(r.costPerHour), sub: "" },
        { v: fmtMoney(r.costPerDay), sub: "" },
        { v: fmtMoney(r.costPerWeek), sub: "" },
        { v: fmtMoney(r.costPerMonth), sub: "" },
        { v: fmtMoney(r.costPerYear), sub: "" },
      ];
      const cls = r.estimated ? " estimate" : "";
      for (let i = 0; i < cells.length; i++){
        const c = document.createElement("div");
        c.className = "proj-cell" + cls;
        const title = r.estimated ? ' title="'+esc(r.estimateNote)+'"' : '';
        c.innerHTML = '<div class="val"'+title+'>'+esc(cells[i].v)+'</div>';
        grid.appendChild(c);
      }
    }
    document.querySelectorAll('#proj-grid .proj-cell.head').forEach(h => {
      const k = h.dataset.sortP;
      h.classList.toggle('sorted', k === projSortKey);
      const a = h.querySelector('.arrow');
      if (a) a.textContent = k === projSortKey ? (projSortDir === 'asc' ? '↑' : '↓') : '↕';
    });
  }
  function setupProjections(){
    document.querySelectorAll('#proj-grid .proj-cell.head').forEach(h => {
      h.addEventListener("click", () => {
        const k = h.dataset.sortP;
        if (projSortKey === k) projSortDir = projSortDir === 'asc' ? 'desc' : 'asc';
        else { projSortKey = k; projSortDir = k === 'modelName' || k === 'thinkingLevel' ? 'asc' : 'desc'; }
        renderProjections();
      });
    });
  }

  // ---- Boot ----
  renderTotals();
  renderNotes();
  renderSections();
  setupWeekendToggle("weekly-weekend-toggle", "weekly", "weeklyExcl");
  setupWeekendToggle("monthly-weekend-toggle", "monthly", "monthlyExcl");
  setupModelsTable();
  renderModelsTable();
  setupThinkingTable();
  renderThinkingTable();
  setupProjections();
  renderProjections();
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

export { isDbAvailable };
