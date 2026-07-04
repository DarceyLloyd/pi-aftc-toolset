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
import type { FooterDataProvider } from "./types";
import { getPreference, setPreference } from "./state";

// ──────────────────────────────────────────────────────────────────────
// Formatting helpers (used only by the footer)
// ──────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
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
        const truncated = truncateToWidth(text, width, "…", true);
        const padded = truncated + " ".repeat(Math.max(0, width - truncated.length));
        return theme.bg("customMessageBg", theme.fg("dim", padded));
    }

    return {
        dispose() { clearInterval(ticker); },
        invalidate() {},
        render(width: number): string[] {
            const w = Math.max(1, width);
            const a = data.getAccumulator();
            const m = data.getModel();
            const cache = data.getToolCache();

            const hasTurns = a.turns > 0;
            const turnHit = hasTurns ? hitRate(a.lastTurnCacheRead, a.lastTurnInput) : "0";
            const aggHit = hasTurns ? hitRate(a.cacheRead, a.input) : "0";
            const trend = hasTurns ? trendArrow(data.getRecentAvg(), a.cacheRead / Math.max(1, a.cacheRead + a.input)) : "";
            const modelName = m.name || "no model";
            const thinkSuffix = m.reasoning && m.thinkingLevel && m.thinkingLevel !== "off" ? ` · ${m.thinkingLevel}` : "";
            const ctxStr = m.contextWindow > 0 ? `${fmt(m.contextWindow)} CTX Window` : "0";

            const splitStr = a.lastTurnInput > 0
                ? `${fmt(a.lastTurnCacheRead)} Cached / ${fmt(Math.max(0, a.lastTurnInput - a.lastTurnCacheRead))} new`
                : "";
            const turnCostStr = `$${a.lastTurnCost.toFixed(5)}`;
            const ctxTotalStr = `$${a.cost.toFixed(2)}`;

            const cached = data.getCachedSession();
            const projPart = cached
                ? `CTX Time ${cached.sessionStr} · $${cached.costPerHour.toFixed(2)}/hr · $${cached.costPerMinute.toFixed(3)}/min`
                : `CTX Time 0s · $0.00/hr · $0.000/min`;

            const skillAvail = cache.getSkillCount();
            const skillInfo = skillAvail > 0 || data.getUsedSkillCount() > 0
                ? ` │ Skills ${data.getUsedSkillCount()}/${skillAvail}`
                : "";
            const thinkLast = fmtDurationShort(data.getLastThinkingMs());
            const thinkAvg = fmtDurationShort(data.getAvgThinkingMs());
            const respLast = fmtDurationShort(data.getLastResponseMs());
            const respAvg = fmtDurationShort(data.getAvgResponseMs());
            const timingInfo = ` │ Thinking time ${thinkLast} Last / ${thinkAvg} Avg │ Response time: ${respLast} Last / ${respAvg} Avg`;

            // 4th line: aggregates from the SQLite `turns` table over a
            // configurable time window (Today / 3h / 6h / 24h / 2d / 3d /
            // 7d / 28d, set via /aftc-footer-report-timeframe). Refresh is
            // throttled to 10s by core.ts; this just reads the cached
            // snapshot, so it's cheap on every render.
            const tf = data.getTimeframeStats();
            const tfStr =
                `▏ Avg ${tf.timeframeLabel}: Cost $${tf.costUsd.toFixed(2)} | ` +
                `Prompts/Turns ${tf.userPrompts}/${tf.totalTurns} | ` +
                `Cache ${(tf.avgCacheHit * 100).toFixed(1)}% | ` +
                `Think time ${fmtDurationHMS(tf.avgThinkingMs)} | ` +
                `Response time ${fmtDurationHMS(tf.avgResponseMs)}`;

            return [
                line(`▏ ${modelName}${thinkSuffix} │ Cache Turn ${turnHit} / Avg ${aggHit} ${trend} │ ${ctxStr} │ IO ↑${fmt(a.input)} ↓${fmt(a.output)} │ ${splitStr}`, w),
                line(`▏ Turn ${turnCostStr} · CTX Total ${ctxTotalStr} (${a.userTurns} User / ${a.turns} Turns) | ${projPart}`, w),
                line(`▏ ${cache.getCount()} Tools ~${fmt(cache.getTotal())}t${skillInfo}${timingInfo}`, w),
                line(tfStr, w),
            ];
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
    }

    function hide(ctx: ExtensionContext): void {
        if (!ctx.hasUI) return;
        active = false;
        disposeCurrent();
        ctx.ui.setWidget("aftc-cache", undefined);
    }

    // /aftc-footer — toggle the widget on/off at runtime.
    pi.registerCommand("aftc-footer", {
        description: "Toggle the cache diagnostics widget on/off",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            if (active) {
                hide(ctx);
                // Persist the new value as a user preference so the
                // widget stays hidden across /reload, /new, and
                // fresh pi startup.
                setPreference("footerEnabled", false);
                ctx.ui.notify?.("Cache footer hidden.", "info");
            } else {
                show(ctx);
                setPreference("footerEnabled", true);
                ctx.ui.notify?.("Cache footer shown.", "info");
            }
        },
    });

    // Show the widget on session_start (after the orchestrator has
    // wired core's data provider to us). The user's preference
    // (loaded above) is the source of truth for "should this be
    // visible right now".
    pi.on("session_start", async (_event, ctx) => {
        if (active) show(ctx);
    });

    // Clean up the active component on shutdown.
    pi.on("session_shutdown", async () => {
        disposeCurrent();
    });
}