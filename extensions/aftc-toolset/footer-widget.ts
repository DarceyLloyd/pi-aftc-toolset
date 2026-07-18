/**
 * pi-aftc-toolset — cache diagnostics footer widget.
 *
 * Renders the cache-diagnostics bar as a widget below the editor:
 * lines 1-4 (model/cache, prompts/cost, timing/tools, timeframe
 * averages) plus a conditional line 5 (subscription allowance, hidden
 * for unsupported providers). Owns rendering, show/hide lifecycle, the
 * 1Hz ticker, and the /aftc-footer toggle command.
 *
 * Data comes from a FooterDataProvider passed in by the orchestrator
 * (index.ts); this file never imports core.ts. The provider is
 * implemented by core.ts and refreshed by core's pi.on("message_end",
 * ...) handler. All expensive computation (tool cost, etc.) is the
 * provider's responsibility — this file just reads it via cheap
 * getters on every render.
 *
 * Lines 1-4 are built by dedicated builder functions
 * (buildModelLine / buildCostLine / buildTimingLine /
 * buildAveragesLine). Each assembles small named fragments into a
 * parts array joined with single spaces: to move a segment, move its
 * entry in the array; to recolour a field, swap its c1/c2/c3 wrapper.
 * Optional clauses are plain if statements, not inline ternaries.
 * Line 5 is built by buildAllowanceLine (exported for unit tests).
 *
 * Per .dev/dev_guide.md section 7, setWidget composes alongside other
 * footer/status extensions (e.g. pi-bar) instead of replacing them.
 *
 * Performance: all expensive work happens in the provider; render()
 * only formats strings. A 1s ticker in this widget calls
 * `tui.requestRender()` so the context-window clock and cost rates
 * stay current.
 *
 * Hit-rate formula (matches OpenAI usage shape):
 *   hit% = cacheRead / (cacheRead + input)
 * where pi's `input` is *new* prompt tokens only and `cacheRead` is
 * the cached prefix. The true total prompt is their sum. Do not
 * divide by `input` alone.
 *
 * See `footer-widget.readme.md` for the full contract (component
 * lifecycle, ticker behaviour, /aftc-footer wiring).
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AllowanceView, FooterDataProvider, AllowanceWindow, ModelView } from "./types";
import { formatAdaptiveDuration } from "./allowance";
import { getPreference, setPreference } from "./config";

// ──────────────────────────────────────────────────────────────────────
// Formatting helpers (used only by the footer)
// ──────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    // K is the max unit scale — values >= 1M still render as K (rounded
    // down to whole thousands) to keep line 1 compact and consistent.
    if (n < 1000) return n.toString() + "t";
    if (n < 10000) return (n / 1000).toFixed(1) + "Kt";
    return Math.round(n / 1000) + "Kt";
}

/**
 * Split a formatted token value into digits + unit suffix.
 * "12K" -> { digits: "12", unit: "K" }, "0" -> { digits: "0", unit: "" },
 * "1.5K" -> { digits: "1.5", unit: "K" }. Lets the caller color the
 * digits (c1) and the unit (c2) independently.
 */
function splitUnit(s: string): { digits: string; unit: string } {
    const m = /^([0-9.]+)([A-Za-z]*)$/.exec(s);
    if (!m) return { digits: s, unit: "" };
    return { digits: m[1], unit: m[2] };
}

/** Like fmt() but allows M for large values (e.g. 1.0M CTX Window). */
function fmtLarge(n: number): string {
    if (n < 1000) return n.toString();
    if (n < 10000) return (n / 1000).toFixed(1) + "K";
    if (n < 1000000) return Math.round(n / 1000) + "K";
    return (n / 1000000).toFixed(1) + "M";
}

/** Short float duration: "1.5s". */
function fmtDurationShort(ms: number): string {
    if (ms <= 0) return "0.0s";
    return (ms / 1000).toFixed(1) + "s";
}

/** Long "Hh Mm Ss" duration, used for the timeframe average
 *  thinking/response times on line 4. Drops leading zero units:
 *  "0s" / "1m 30s" / "1h 2m 3s". */
function fmtDurationHMS(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/** hit% = cacheRead / (cacheRead + input). Returns formatted string. */
function hitRate(cached: number, input: number): string {
    const total = cached + input;
    if (total <= 0) return "—";
    return ((cached / total) * 100).toFixed(1) + "%";
}

/** Trend arrow: recent avg vs session avg. */
function trendArrow(recent: number, session: number): string {
    if (Number.isNaN(recent) || Number.isNaN(session)) return "";
    if (recent > session + 0.05) return "↑";
    if (recent < session - 0.05) return "↓";
    return "";
}

/** Cost display: values below a hundredth of a cent collapse to "0"
 *  instead of rendering as "0.0000". */
function formatCost(cost: number, decimalPlaces: number): string {
    if (cost < 0.0001) return "0";
    return cost.toFixed(decimalPlaces);
}

/** Thinking-level label for line 1 (uppercase), or "" when the model
 *  does not reason or thinking is switched off. */
function thinkingLabel(m: ModelView): string {
    if (!m.reasoning) return "";
    if (!m.thinkingLevel || m.thinkingLevel === "off") return "";
    return m.thinkingLevel.toUpperCase();
}

/** Pi's own context-usage estimate as a percent string (same number as
 *  the native status bar), or null before the first LLM response. */
function contextUsePercent(data: FooterDataProvider): string | null {
    const usage = data.getContextUsage();
    if (!usage) return null;
    if (usage.percent === null || !Number.isFinite(usage.percent)) return null;
    return usage.percent.toFixed(1) + "%";
}

// ──────────────────────────────────────────────────────────────────────
// Footer colour scheme (theme-aware)
//
// Three logical colours used across every footer line, each mapped to a
// theme token so the whole bar retones automatically when the user
// switches themes (e.g. aftc-orange-viz → cache-viz):
//   c1 — highlights: model name, thinking level, trend arrows   (accent)
//   c2 — words / labels / units                                  (text)
//   c3 — values / costs / dividers                               (dim)
//
// `Theme.fg` always closes with a foreground reset (\x1b[39m), so every
// span returns to the default foreground afterwards. We therefore wrap
// every segment explicitly instead of relying on the outer `line()` dim
// wrapper — otherwise a label's colour would depend on whether it sat
// before or after another coloured span. `truncateToWidth` is ANSI-aware,
// so loading the lines with escape codes is safe.
// ──────────────────────────────────────────────────────────────────────
function footerColors(theme: Theme) {
    return {
        c1: (s: string) => theme.fg("accent", theme.bold(s)),
        c2: (s: string) => theme.fg("text", s),
        c3: (s: string) => theme.fg("dim", s),
    };
}

type FooterColors = ReturnType<typeof footerColors>;

/** Colour a formatted token value: digits stay a value (c1), the unit
 *  suffix becomes a label (c2). "12K" → c1("12") + c2("K"). */
function coloredToken(formatted: string, c: FooterColors): string {
    const parts = splitUnit(formatted);
    return c.c1(parts.digits) + c.c2(parts.unit);
}

// ──────────────────────────────────────────────────────────────────────
// Line builders (lines 1-4)
//
// Each builder computes its values with plain if statements, assembles
// small named fragments into a parts array, and joins it with single
// spaces. To re-order segments, move their entries in the array; to
// recolour a field, swap its c1/c2/c3 wrapper. Every line starts with
// the "▏ " bar prefix and never ends with a trailing divider.
// ──────────────────────────────────────────────────────────────────────

/** Line 1 — model · thinking │ CTX Window (X%) │ Turn Cache % / Session Avg % │ Cached / New */
function buildModelLine(data: FooterDataProvider, c: FooterColors): string {
    const m = data.getModel();
    const a = data.getAccumulator();

    // ── Values ──────────────────────────────────────────────────────
    const modelName = m.name || "no model";
    const thinking = thinkingLabel(m);
    const hasTurns = a.turns > 0;
    let turnHit = "0";
    let avgHit = "0";
    let trend = "";
    if (hasTurns) {
        turnHit = hitRate(a.lastTurnCacheRead, a.lastTurnInput);
        avgHit = hitRate(a.cacheRead, a.input);
        trend = trendArrow(data.getRecentAvg(), a.cacheRead / Math.max(1, a.cacheRead + a.input));
    }
    const hasCtxWin = m.contextWindow > 0;
    let ctxTokens = "0";
    if (hasCtxWin) ctxTokens = fmtLarge(m.contextWindow);
    const ctxUsePct = contextUsePercent(data);

    // ── Fragments ───────────────────────────────────────────────────
    let modelSeg = c.c1(modelName);
    if (thinking) modelSeg += ` ${c.c3("·")} ${c.c1(thinking)}`;

    let ctxSeg = c.c1(ctxTokens);
    if (hasCtxWin) ctxSeg += ` ${c.c2("CTX Window")}`;
    if (ctxUsePct) ctxSeg += ` ${c.c2("(")}${c.c1(ctxUsePct)}${c.c2(")")}`;

    let cacheSeg = `${c.c2("Turn Cache")} ${c.c1(turnHit)} / ${c.c2("Session Avg")} ${c.c1(avgHit)}`;
    if (trend) cacheSeg += ` ${c.c2(trend)}`;

    const splitSeg = `${c.c2("Cached")} ${coloredToken(fmt(a.cacheRead), c)} / ${c.c2("New")} ${coloredToken(fmt(a.input), c)}`;

    return ["▏ " + modelSeg, c.c3("│"), ctxSeg, c.c3("│"), cacheSeg, c.c3("│"), splitSeg].join(" ");
}

/** Line 2 — Prompts User/AI | Turn cost │ Session Time │ Session Time Cost │ $/hr │ $/min */
function buildCostLine(data: FooterDataProvider, c: FooterColors): string {
    const a = data.getAccumulator();
    const cached = data.getCachedSession();

    // ── Values ──────────────────────────────────────────────────────
    const userTurns = String(a.userTurns);
    const aiTurns = String(a.aiTurns ?? Math.max(0, a.turns - a.userTurns));
    const turnCost = `$${formatCost(a.lastTurnCost, 4)}`;
    const ctxTotalCost = `$${formatCost(a.cost, 2)}`;
    let ctxTime = "0s";
    let perHour = "$0";
    let perMin = "$0";
    if (cached) {
        ctxTime = cached.sessionStr;
        perHour = `$${formatCost(cached.costPerHour, 2)}`;
        perMin = `$${formatCost(cached.costPerMinute, 2)}`;
    }

    // ── Fragments ───────────────────────────────────────────────────
    const promptsSeg = `${c.c2("Prompts:")} ${c.c2("User")} ${c.c1(userTurns)} / ${c.c2("AI")} ${c.c1(aiTurns)}`;
    const turnCostSeg = `${c.c2("Turn cost")} ${c.c1(turnCost)}`;
    const timeSeg = `${c.c2("Session Time")} ${c.c1(ctxTime)}`;
    const timeCostSeg = `${c.c2("Session Time Cost")} ${c.c1(ctxTotalCost)}`;
    const hourSeg = `${c.c1(perHour)}${c.c2("/hr")}`;
    const minSeg = `${c.c1(perMin)}${c.c2("/min")}`;

    return ["▏ " + promptsSeg, c.c3("|"), turnCostSeg, c.c3("│"), timeSeg, c.c3("│"), timeCostSeg, c.c3("│"), hourSeg, c.c3("│"), minSeg].join(" ");
}

/** Line 3 — Turn Time │ Turn Response Time │ Tools ~tokens (│ Skills used u/a) */
function buildTimingLine(data: FooterDataProvider, c: FooterColors): string {
    const cache = data.getToolCache();

    // ── Values ──────────────────────────────────────────────────────
    const thinkLast = fmtDurationShort(data.getLastThinkingMs());
    const thinkAvg = fmtDurationShort(data.getAvgThinkingMs());
    const respLast = fmtDurationShort(data.getLastResponseMs());
    const respAvg = fmtDurationShort(data.getAvgResponseMs());
    const toolCount = String(cache.getCount());
    const toolTokens = coloredToken(fmt(cache.getTotal()), c);
    const skillAvail = cache.getSkillCount();
    const usedSkillCount = data.getUsedSkillCount();
    const showSkills = skillAvail > 0 || usedSkillCount > 0;

    // ── Fragments ───────────────────────────────────────────────────
    const thinkSeg = `${c.c2("Turn Time")} ${c.c1(thinkLast)} / ${c.c2("Avg")} ${c.c1(thinkAvg)}`;
    const respSeg = `${c.c2("Turn Response Time")} ${c.c1(respLast)} / ${c.c2("Session Avg")} ${c.c1(respAvg)}`;
    const toolsSeg = `${c.c1(toolCount)} ${c.c2("Tools")} ~${toolTokens}`;

    const parts = ["▏ " + thinkSeg, c.c3("│"), respSeg, c.c3("│"), toolsSeg];
    if (showSkills) {
        const skillsSeg = `${c.c2("Skills used")} ${c.c1(String(usedSkillCount))}/${c.c1(String(skillAvail))}`;
        parts.push(c.c3("│"), skillsSeg);
    }
    return parts.join(" ");
}

/** Line 4 — Averages: Cost <timeframe> | Prompts | Cache | Think time | Response time */
function buildAveragesLine(data: FooterDataProvider, c: FooterColors): string {
    const tf = data.getTimeframeStats();

    // ── Values ──────────────────────────────────────────────────────
    const tfCost = `$${tf.costUsd.toFixed(2)}`;
    const tfPrompts = String(tf.userPrompts);
    const tfTurns = String(tf.totalTurns);
    const tfCacheHit = `${(tf.avgCacheHit * 100).toFixed(1)}%`;
    const tfThink = fmtDurationHMS(tf.avgThinkingMs);
    const tfResp = fmtDurationHMS(tf.avgResponseMs);

    // ── Fragments ───────────────────────────────────────────────────
    const costSeg = `${c.c1("Averages:")} ${c.c2(`Cost ${c.c1(tf.timeframeLabel)}:`)} ${c.c1(tfCost)}`;
    const promptsSeg = `${c.c2("Prompts: User")} ${c.c1(tfPrompts)} / ${c.c2("AI")} ${c.c1(tfTurns)}`;
    const cacheSeg = `${c.c2("Cache")} ${c.c1(tfCacheHit)}`;
    const thinkSeg = `${c.c2("Think time")} ${c.c1(tfThink)}`;
    const respSeg = `${c.c2("Response time")} ${c.c1(tfResp)}`;

    return ["▏ " + costSeg, c.c3("|"), promptsSeg, c.c3("|"), cacheSeg, c.c3("|"), thinkSeg, c.c3("|"), respSeg].join(" ");
}

// ──────────────────────────────────────────────────────────────────
// Line 5 — subscription allowance (5h + weekly)
// ──────────────────────────────────────────────────────────────────

/** Reset-countdown clause shared by the ChatGPT single-window line and the
 *  segmented GLM/Anthropic windows. Returns "" when the window is null or
 *  has no known / already-elapsed reset time.
 *
 *  Format matches `formatAdaptiveDuration` (same as every other allowance
 *  window on line 5): days are dropped when zero, and seconds are dropped
 *  once days are present — e.g. "05m 30s", "02h 15m", "04d 18h 30m". */
function resetClause(w: AllowanceWindow | null, c1: (s: string) => string): string {
    if (!w) return "";
    // Prefer the precomputed resetSeconds; fall back to deriving from
    // resetAt so the line ticks live even if the caller passed the raw
    // stored view (resetSeconds null) instead of the post-liveView one.
    let secs = w.resetSeconds;
    if ((secs === null || secs === undefined) && w.resetAt !== null && Number.isFinite(w.resetAt)) {
        secs = Math.max(0, Math.floor((w.resetAt - Date.now()) / 1000));
    }
    const dur = formatAdaptiveDuration(secs ?? -1);
    return dur ? ` Resets in: ${c1(dur)}` : "";
}

/** Build the 5th footer line from an allowance snapshot, or return null
 *  to signal "hide line 5" (unsupported provider, or no windows at all).
 *  Returned text already contains ANSI styling for the percentages; the
 *  caller passes it through `line()` which wraps it in the footer bg.
 *  Exported for unit testing (tests/allowance-check/). */
export function buildAllowanceLine(v: AllowanceView, theme: Theme): string | null {
    const { c1, c2, c3 } = footerColors(theme);
    const fmtPct = (n: number): string => {
        if (!Number.isFinite(n)) return "0";
        return n.toFixed(1).replace(/\.0$/, "");
    };

    // ChatGPT/Codex subscriptions are rendered as a single rolling-window
    // value. Prefer the short window when present, otherwise fall back to
    // weekly. The reset countdown is appended via the shared resetClause,
    // so it uses the same format as the GLM/Anthropic windows.
    if (/(chatgpt|codex|openai)/i.test(v.providerLabel)) {
        const rolling = v.fiveHour ?? v.weekly;
        if (!rolling) return null;
        let s = `${c1(`${fmtPct(rolling.usedPercent)}%`)} ${c2("Allowance used.")}`;
        s += resetClause(rolling, c1);
        return s;
    }

    const seg = (label: string, w: AllowanceWindow | null): string => {
        if (!w) return "";
        let s = `${label} allowance used: ${c1(`${fmtPct(w.usedPercent)}%`)}`;
        // Reset countdown shared with the ChatGPT branch via resetClause
        // (falls back to deriving resetSeconds from resetAt so the line
        // ticks live even for a raw stored view).
        s += resetClause(w, c1);
        return s;
    };
    const fiveHour = seg("5h", v.fiveHour);
    const weekly = seg("Weekly", v.weekly);
    if (!fiveHour && !weekly) return null; // nothing to show → hide line
    const label = c1(`${v.providerLabel}:`);
    // The 5h │ Weekly divider is colour 3 (a divider), like every other
    // separator on the bar.
    const parts = [fiveHour, weekly].filter(Boolean).join(` ${c3("│")} `);
    return `${label} ${parts}`;
}

// ──────────────────────────────────────────────────────────────────────
// Component factory
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the widget component. Called by the pi widget factory each time
 * the TUI needs to render, so the closure captures a fresh `tui` and
 * `theme` from pi. Returned object implements the pi-tui Component
 * interface.
 */
function createFooterComponent(
    data: FooterDataProvider,
    tui: { requestRender(): void },
    theme: Theme,
) {
    // 1Hz ticker: refreshes the cached context-window time + cost rates
    // (via data.onTick()), then requests a TUI re-render. Cleared in
    // dispose() when the widget is replaced. Wrapped in try/catch so a
    // single error doesn't kill the timer and spam the log.
    const ticker = setInterval(() => {
        try {
            data.onTick();
            tui.requestRender();
        } catch (err) {
            console.log(`[aftc-toolset] footer ticker error: ${(err as Error).message}`);
        }
    }, 1000);

    /** Wrap one content line in the footer background, truncated to width. */
    function line(text: string, width: number): string {
        // truncateToWidth with pad=true already pads to width visual columns.
        const truncated = truncateToWidth(text, width, "…", true);
        return theme.bg("customMessageBg", theme.fg("dim", truncated));
    }

    return {
        dispose() { clearInterval(ticker); },
        invalidate() {},
        render(width: number): string[] {
            try {
                const w = Math.max(1, width);
                const c = footerColors(theme);
                const lines = [
                    buildModelLine(data, c),
                    buildCostLine(data, c),
                    buildTimingLine(data, c),
                    buildAveragesLine(data, c),
                ];

                // Line 5 — subscription allowance (only for supported providers)
                const allowance = data.getAllowance();
                if (allowance) {
                    const allowanceLine = buildAllowanceLine(allowance, theme);
                    if (allowanceLine) lines.push(`▏ ${allowanceLine}`);
                }

                return lines.map((l) => line(l, w));
            } catch (err) {
                console.log(`[aftc-toolset] footer render error: ${(err as Error).message}`);
                return [
                    theme.bg("customMessageBg", theme.fg("error", ` Footer error: ${(err as Error).message}`.padEnd(width, " "))),
                ];
            }
        },
    };
}

// ──────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ──────────────────────────────────────────────────────────────────────

export function createFooterWidget(pi: ExtensionAPI, data: FooterDataProvider): void {
    // Toggle state. Loaded from state.json (a USER PREFERENCE that
    // persists across /reload, /new, and fresh pi startup). Falls
    // back to true (the historical default) if state.json is missing.
    let active = getPreference("footerEnabled", true);
    // Track the live component so /aftc-footer (hide) and widget
    // recreation can dispose the previous one and stop its ticker.
    // Without this, recreating the widget (theme change, /reload,
    // etc.) leaks 1Hz timers — one per recreation.
    let currentComponent: { dispose?: () => void } | null = null;

    function disposeCurrent(): void {
        if (currentComponent) {
            try { currentComponent.dispose?.(); } catch { /* ignore */ }
            currentComponent = null;
        }
    }

    function show(ctx: ExtensionContext): void {
        if (!ctx.hasUI) return;
        active = true;
        try {
            // Prime the cached session so the first render shows the latest
            // context time + cost rate instead of waiting up to 1s for the
            // ticker. data.onTick() is recomputeCachedSession from core.ts —
            // safe to call multiple times (pure in-memory computation).
            data.onTick();
            // Render as a widget below the editor instead of replacing pi's
            // footer. See the file header for the setFooter vs setWidget
            // trade-off (.dev/dev_guide.md section 7.1).
            ctx.ui.setWidget("aftc-cache", (tui, theme) => {
                // Dispose the previous component (if any) before creating
                // a new one — stops the old 1Hz timer.
                disposeCurrent();
                const component = createFooterComponent(data, tui, theme);
                currentComponent = component;
                return component;
            }, { placement: "belowEditor" });
        } catch (err) {
            console.log(`[aftc-toolset] footer show error: ${(err as Error).message}`);
        }
    }

    function hide(ctx: ExtensionContext): void {
        if (!ctx.hasUI) return;
        active = false;
        disposeCurrent();
        ctx.ui.setWidget("aftc-cache", undefined);
    }

    // /aftc-footer — toggle the widget on/off at runtime.
    pi.registerCommand("aftc-footer", {
        description: "Toggle the footer dashboard widget on/off",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            if (active) {
                hide(ctx);
                // Persist the new value as a user preference so the
                // widget stays hidden across /reload, /new, and
                // fresh pi startup.
                setPreference("footerEnabled", false);
                ctx.ui.notify?.("Footer dashboard widget hidden.", "info");
            } else {
                show(ctx);
                setPreference("footerEnabled", true);
                ctx.ui.notify?.("Footer dashboard widget shown.", "info");
            }
        },
    });

    // Show the widget on session_start (after the orchestrator has
    // wired core's data provider to us). The user's preference
    // (loaded above) is the source of truth for "should this be
    // visible right now".
    pi.on("session_start", async (_event, ctx) => {
        console.log(`[aftc-toolset] session_start — footer active=${active}, hasUI=${ctx.hasUI}`);
        if (active) show(ctx);
    });

    // Clean up the active component on shutdown.
    pi.on("session_shutdown", async () => {
        disposeCurrent();
    });
}
