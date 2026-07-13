/**
 * pi-aftc-toolset — cache diagnostics footer widget.
 *
 * Renders the four-line cache-diagnostics bar as a widget below the
 * editor. Owns rendering, show/hide lifecycle, the 1Hz ticker, and the
 * /aftc-footer toggle command.
 *
 * Data comes from a FooterDataProvider passed in by the orchestrator
 * (index.ts); this file never imports core.ts. The provider is
 * implemented by core.ts and refreshed by core's pi.on("message_end",
 * ...) handler. All expensive computation (tool cost, etc.) is the
 * provider's responsibility — this file just reads it via cheap
 * getters on every render.
 *
 * Per rules.md §7, setWidget composes alongside other footer/status
 * extensions (e.g. pi-bar) instead of replacing them.
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
import type { AllowanceView, FooterDataProvider, AllowanceWindow } from "./types";
import { formatAdaptiveDuration } from "./allowance";
import { getPreference, setPreference } from "./state";

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

// ──────────────────────────────────────────────────────────────────
// Line 5 — subscription allowance (5h + weekly)
// ──────────────────────────────────────────────────────────────────

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

/** Build the 5th footer line from an allowance snapshot, or return null
 *  to signal "hide line 5" (unsupported provider, or no windows at all).
 *  Returned text already contains ANSI styling for the percentages; the
 *  caller passes it through `line()` which wraps it in the footer bg.
 *  Exported for unit testing (tests/allowance-check/). */
export function buildAllowanceLine(v: AllowanceView, theme: Theme): string | null {
    const { c1, c3 } = footerColors(theme);
    const seg = (label: string, w: AllowanceWindow | null): string => {
        if (!w) return "";
        let s = `${label} Allowance used: ${c1(`${w.usedPercent}%`)}`;
        // Prefer the precomputed resetSeconds; fall back to deriving from
        // resetAt so the line ticks live even if the caller passed the raw
        // stored view (resetSeconds null) instead of the post-liveView one.
        let secs = w.resetSeconds;
        if ((secs === null || secs === undefined) && w.resetAt !== null && Number.isFinite(w.resetAt)) {
            secs = Math.max(0, Math.floor((w.resetAt - Date.now()) / 1000));
        }
        const dur = formatAdaptiveDuration(secs ?? -1);
        if (dur) s += ` Resets in: ${c1(dur)}`;
        return s;
    };
    const fiveHour = seg("5h", v.fiveHour);
    const weekly = seg("Weekly", v.weekly);
    if (!fiveHour && !weekly) return null; // nothing to show → hide line
    const label = c1(`${v.providerLabel}:`);
    // The 5h │ Weekly divider is colour 3 (a divider), like every other
    // separator on the bar.
    const parts = [fiveHour, weekly].filter(Boolean).join(` ${c3("\u2502")} `);
    return `${label} ${parts}`;
}

// ──────────────────────────────────────────────────────────────────────
// Component factory
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the four-line widget component. Called by the pi widget factory
 * each time the TUI needs to render, so the closure captures a fresh
 * `tui` and `theme` from pi. Returned object implements the pi-tui
 * Component interface.
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

    function line(text: string, width: number): string {
        // truncateToWidth with pad=true already pads to width visual columns.
        const truncated = truncateToWidth(text, width, "\u2026", true);
        return theme.bg("customMessageBg", theme.fg("dim", truncated));
    }

    function formatCost(cost:number,decimalPlaces: number): string {
        if (cost < 0.0001) {
            return `0`;
        }   else {
            return `${cost.toFixed(decimalPlaces)}`;
        }
    }

    return {
        dispose() { clearInterval(ticker); },
        invalidate() {},
        render(width: number): string[] {
            try {
                const w = Math.max(1, width);
                const a = data.getAccumulator();
                const m = data.getModel();
                const cache = data.getToolCache();

            // ═══ Footer colour scheme ══════════════════════════════
            // Three logical colours, each mapped to a theme token (see
            // footerColors()). Switching themes retones the whole bar.
            //   c1 = highlights (accent): model, thinking, ↑/↓, trend
            //   c2 = words / labels / units          (text  = white)
            //   c3 = values / costs / dividers        (dim   = gray)
            const { c1, c2, c3 } = footerColors(theme);

            // ──────────────────────────────────────────────────────────
            // VALUES — plain strings, no styling.
            // Edit numbers / labels / formatting here.
            // ──────────────────────────────────────────────────────────
            const cached = data.getCachedSession();
            const tf = data.getTimeframeStats();

            const hasTurns = a.turns > 0;

            // line 1 — model · thinking | CTX Window | Turn Cache % / Avg % | Cached / New | Tk ↑ Tk ↓
            const modelName = m.name || "no model";
            const thinking = (m.reasoning && m.thinkingLevel && m.thinkingLevel !== "off") ? m.thinkingLevel : "";
            const turnHit = hasTurns ? hitRate(a.lastTurnCacheRead, a.lastTurnInput) : "0";
            const avgHit = hasTurns ? hitRate(a.cacheRead, a.input) : "0";
            const trend = hasTurns ? trendArrow(data.getRecentAvg(), a.cacheRead / Math.max(1, a.cacheRead + a.input)) : "";
            const hasCtxWin = m.contextWindow > 0;
            const ctxTokens = hasCtxWin ? fmtLarge(m.contextWindow) : "0";
            // Pi's own context-usage snapshot. Same number as the
            // native status bar's "X%/Y" segment. Null before the first
            // LLM response or after compaction with no new turn yet.
            const ctxUse = data.getContextUsage();
            const ctxUsePct = ctxUse && ctxUse.percent !== null && Number.isFinite(ctxUse.percent)
                ? ctxUse.percent.toFixed(1) + "%"
                : null;
            // Session-scoped token totals. ↑ = total prompt sent to the
            // provider (= cached + new, same split shown right after the
            // cache % block). ↓ = session output. All values come straight
            // from pi's per-assistant-message usage (input / cacheRead /
            // cacheWrite / output / totalTokens) so they are token-accurate.
            const inputTok = fmt(a.input + a.cacheRead);
            const outputTok = fmt(a.output);
            const cachedTok = fmt(a.cacheRead);
            const newTok = fmt(a.input);
            // Pre-split digits/unit so each can be coloured independently:
            // digits stay c1 (the value), unit goes c2 (label scale).
            const inputTokParts = splitUnit(inputTok);
            const outputTokParts = splitUnit(outputTok);
            const cachedTokParts = splitUnit(cachedTok);
            const newTokParts = splitUnit(newTok);

            // line 2 — cost · burn rate
            // const turnCost = `$${a.lastTurnCost.toFixed(4)}`;
            const turnCost = `$${formatCost(a.lastTurnCost, 4)}`;

            // const ctxTotalCost = `$${a.cost.toFixed(2)}`;
            const ctxTotalCost = `$${formatCost(a.cost, 2)}`;

            const userTurns = String(a.userTurns);
            const aiTurns = String(a.aiTurns ?? Math.max(0, a.turns - a.userTurns));
            const ctxTime = cached ? cached.sessionStr : "0s";
            // const perHour = cached ? `$${cached.costPerHour.toFixed(2)}` : "$0";
            // const perMin = cached ? `$${cached.costPerMinute.toFixed(2)}` : "$0";
            const perHour = cached ? `$${formatCost(cached.costPerHour, 2)}` : "$0";
            const perMin = cached ? `$${formatCost(cached.costPerMinute, 2)}` : "$0";

            // line 3 — tools · skills · timing
            const toolCount = String(cache.getCount());
            const toolTokens = fmt(cache.getTotal());
            const toolTokensParts = splitUnit(toolTokens);
            const skillAvail = cache.getSkillCount();
            const usedSkills = String(data.getUsedSkillCount());
            const showSkills = skillAvail > 0 || data.getUsedSkillCount() > 0;
            const thinkLast = fmtDurationShort(data.getLastThinkingMs());
            const thinkAvg = fmtDurationShort(data.getAvgThinkingMs());
            const respLast = fmtDurationShort(data.getLastResponseMs());
            const respAvg = fmtDurationShort(data.getAvgResponseMs());

            // line 4 — timeframe aggregates (Today / Last 3 Hours / Last 6
            //          Hours / Last 24 Hours / Last 2 Days / Last 3 Days /
            //          Last 7 Days / Last 28 Days via /aftc-set-costs-timeframe)
            const tfLabel = tf.timeframeLabel;
            const tfCost = `$${tf.costUsd.toFixed(2)}`;
            const tfPrompts = String(tf.userPrompts);
            const tfTurns = String(tf.totalTurns);
            const tfCacheHit = `${(tf.avgCacheHit * 100).toFixed(1)}%`;
            const tfThink = fmtDurationHMS(tf.avgThinkingMs);
            const tfResp = fmtDurationHMS(tf.avgResponseMs);

            // line 5 — subscription allowance (conditional)
            const allowance = data.getAllowance();
            const allowanceLine = allowance ? buildAllowanceLine(allowance, theme) : null;

            // ──────────────────────────────────────────────────────────
            // CONSTRUCTION — pure assembly.
            // Recolour a field by swapping its wrapper: c1(x) / c2(x) / c3(x).
            // ──────────────────────────────────────────────────────────
            const raw = [
                // 1 — model · thinking | CTX Window (X%) | Turn Cache % / Avg % | Cached / New | Tk ↑ Tk ↓
                `▏ ${c1(modelName)}${thinking ? ` ${c3("·")} ${c1(thinking.toUpperCase())}` : ""} ${c3("│")} ${hasCtxWin ? `${c1(ctxTokens)} ${c2("CTX Window")}` : c1(ctxTokens)}${ctxUsePct ? ` ${c2("(")}${c1(ctxUsePct)}${c2(")")}` : ""} ${c3("│")} ${c2("Turn Cache")} ${c1(turnHit)} / ${c2("Avg")} ${c1(avgHit)}${trend ? " " + c2(trend) : ""} ${c3("│")} ${c2("Cached")} ${c1(cachedTokParts.digits)}${c2(cachedTokParts.unit)} / ${c2("New")} ${c1(newTokParts.digits)}${c2(newTokParts.unit)} ${c3("│")} ${c2("Tk")} ${c2("↑")}${c1(inputTokParts.digits)}${c2(inputTokParts.unit)} ${c2("Tk")} ${c2("↓")}${c1(outputTokParts.digits)}${c2(outputTokParts.unit)}`,

                // 2 — cost · burn rate
                // `▏ ${c2("Turn")} ${c1(turnCost)} ${c3("·")} ${c2("CTX Total")} ${c1(ctxTotalCost)} (${c1(userTurns)} ${c2("User")} / ${c1(totalTurns)} ${c2("Turns")}) ${c3("|")} ${c2("CTX Time")} ${c1(ctxTime)} ${c3("·")} ${c1(perHour)}${c2("/hr")} ${c3("·")} ${c1(perMin)}${c2("/min")}`,
                `▏ ${c2("Prompts:")} ${c2("User")} ${c1(userTurns)} / ${c2("AI")} ${c1(aiTurns)} ${c3("|")} ${c2("CTX Time")} ${c1(ctxTime)} ${c3("│")} ${c2("Turn cost")} ${c1(turnCost)} ${c3("│")} ${c2("CTX Time Total Cost")} ${c1(ctxTotalCost)} ${c3("│")} ${c1(perHour)}${c2("/hr")} ${c3("│")} ${c1(perMin)}${c2("/min")}`,

                // 3 — tools · skills · timing
                // `▏ ${c1(toolCount)} ${c2("Tools")} ${c1(toolTokens)}${c2("t")}${showSkills ? ` ${c3("│")} ${c2("Skills")} ${c1(usedSkills)}/${c1(String(skillAvail))}` : ""} ${c3("│")} ${c2("Thinking time")} ${c1(thinkLast)} ${c2("Last")} / ${c1(thinkAvg)} ${c2("Avg")} ${c3("│")} ${c2("Response time:")} ${c1(respLast)} ${c2("Last")} / ${c1(respAvg)} ${c2("Avg")}`,
                `▏ ${c2("Turn Time")} ${c1(thinkLast)} / ${c2("Avg")} ${c1(thinkAvg)} ${c3("│")} ${c2("Turn Response Time")} ${c1(respLast)} / ${c2("Avg")} ${c1(respAvg)} ${c3("│")} ${c1(toolCount)} ${c2("Tools")} ~${c1(toolTokensParts.digits)}${c2(toolTokensParts.unit)}${showSkills ? ` ${c3("│")} ${c2("Skills used")} ${c1(usedSkills)}/${c1(String(skillAvail))}` : ""}`,

                // 4 — timeframe aggregates
                `▏ ${c1("Averages:")} ${c2(`Cost ${c1(tfLabel)}:`)} ${c1(tfCost)} ${c3("|")} ${c2("Prompts: User")} ${c1(tfPrompts)} / ${c2("AI")} ${c1(tfTurns)} ${c3("|")} ${c2("Cache")} ${c1(tfCacheHit)} ${c3("|")} ${c2("Think time")} ${c1(tfThink)} ${c3("|")} ${c2("Response time")} ${c1(tfResp)}`,
            ];

            // 5 — subscription allowance (only for supported providers)
            if (allowanceLine) raw.push(`▏ ${allowanceLine}`);

            // Wrap every line in the footer bg + dim fallback; truncate to width.
            return raw.map((l) => line(l, w));
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
            // trade-off (rules.md §7.1).
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