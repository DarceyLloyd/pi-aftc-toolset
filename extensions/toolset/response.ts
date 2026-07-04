/**
 * pi-aftc-toolset — response divider feature module.
 *
 * Injects a full-width, themed horizontal rule (box-drawing character)
 * immediately before each assistant response, so the user sees a clear
 * visual break the moment the model starts streaming.
 *
 * Architecture — three hooks cooperate; no shared state with other modules:
 *
 *   1. `registerMessageRenderer` for DIVIDER_TYPE. The renderer returns a
 *      Component whose `render(width)` emits the line, so the rule is
 *      ALWAYS exactly the pane width — no hardcoded width, no wrapping,
 *      no truncation. Color comes from the current active theme.
 *
 *   2. `before_agent_start` injects a custom message of our type as the
 *      first thing in the turn. The message is:
 *        - Persisted to the session (survives /resume and /compact)
 *        - Rendered in the TUI (so the user sees it)
 *        - Filtered back out by the `context` handler before the LLM
 *          sees it (never pollutes the model's context)
 *
 *   3. `context` strips our custom messages from the LLM-visible list.
 *      No-ops when none are present (e.g. on tool-call follow-up turns).
 *
 * Toggleable at runtime via `/aftc-response-divider` (default: ON). When
 * disabled:
 *   - `before_agent_start` returns nothing → no new dividers injected
 *   - The renderer's `render(width)` returns `[]` → existing dividers
 *     collapse on the next TUI paint (forced via setStatus → requestRender)
 *
 * Per rules.md §1.5, this is a self-contained feature module: it owns no
 * shared state, shares nothing with the other feature modules, and is
 * wired into pi by the orchestrator in index.ts.
 *
 * ---------------------------------------------------------------------------
 * TEST CHECKLIST
 * ---------------------------------------------------------------------------
 *  1. Open pi, send a prompt → see full-width rule above the response.
 *  2. Resize the terminal → rule resizes to match (no wrap, no truncation).
 *  3. /resume an old session → rules from previous turns are still there.
 *  4. /settings → switch theme → rule color updates immediately.
 *  5. Look at a tool-call follow-up turn → no extra rule between tool
 *     result and the next assistant message (rule only fires once per
 *     user prompt, not per turn).
 *  6. (Optional) Use a debug extension to log the system prompt — the
 *     rule must NOT appear in the LLM's context.
 *  7. Run `/aftc-response-divider` → existing dividers collapse, status
 *     indicator clears. Run again → dividers reappear, status returns.
 *  8. After toggling OFF, send a new prompt → no divider above the reply.
 * ---------------------------------------------------------------------------
 *
 * See `response.readme.md` for the full contract and configuration knobs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { getPreference, setPreference } from "./state";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION  —  tweak these to taste
// ─────────────────────────────────────────────────────────────────────────────

/** The customType registered with pi.registerMessageRenderer. */
const DIVIDER_TYPE = "response-divider";

/**
 * Background color for the divider line.  Set to a *Bg theme token
 * (e.g. "selectedBg", "toolPendingBg", "customMessageBg") for a SOLID
 * color bar that spans the full pane width — every cell from column 0
 * to the last column gets the bg color, so the bar is always flush
 * with the edges no matter when it was rendered or how the window was
 * resized.
 *
 * Set to "" to disable the bar entirely.
 *
 * For a character-based rule (e.g. "────────") instead of a bar, set
 * HR_BG_COLOR = "" and HR_CHAR = "─" (or "━", "═", etc.).
 */
const HR_BG_COLOR = "";

/**
 * Foreground color used when the divider renders characters instead of
 * a bg bar.  Ignored when HR_BG_COLOR is set (the bg dominates).
 * Good picks: "borderMuted", "dim", "border", "mdHr", "accent".
 */
const HR_COLOR = "border";

/**
 * Character used when the divider renders a rule (HR_BG_COLOR = "").
 * Set to " " (space) for an invisible line that only the bg shows.
 * One cell per character; visible width = w * visible-width(HR_CHAR).
 *   "─" light   "━" heavy   "═" double   "▔" top block   "—" em dash
 */
const HR_CHAR = "\u2500"; // light horizontal rule ─

/**
 * If true, add an extra backgrounded line below the bar for breathing
 * room before the assistant text starts.  Only applies when
 * HR_BG_COLOR is set; the blank carries the same bg so the color band
 * is uninterrupted.
 */
const HR_TRAILING_BLANK = false;

// ─────────────────────────────────────────────────────────────────────────────
// THEME COLOR REFERENCE  (for the HR_COLOR constant above and for hand-editing)
// ─────────────────────────────────────────────────────────────────────────────
//
// USAGE
//   theme.fg("token", "text")     → foreground (text) color
//   theme.bg("token", "text")     → background color
//   theme.fg("token", theme.bg("other", "text"))  → compose fg + bg
//   theme.bold(text)              → bold
//   theme.italic(text)            → italic
//   theme.strikethrough(text)     → strikethrough
//
//   ⚠ Styles do NOT carry across lines. Re-apply per line, or use
//     wrapTextWithAnsi() from @earendil-works/pi-tui.
//
// FOREGROUND (TEXT) TOKENS  —  all 51 required theme tokens
//
//   CORE UI (11)
//     accent, border, borderAccent, borderMuted, success, error, warning,
//     muted, dim, text, thinkingText
//
//   BACKGROUNDS & CONTENT (11)  ← use with theme.bg()
//     userMessageBg/Text, customMessageBg/Text, customMessageLabel,
//     toolPendingBg/SuccessBg/ErrorBg, toolTitle, toolOutput, selectedBg
//
//   MARKDOWN (10)
//     mdHeading, mdLink, mdLinkUrl, mdCode, mdCodeBlock, mdCodeBlockBorder,
//     mdQuote, mdQuoteBorder, mdHr, mdListBullet
//
//   TOOL DIFFS (3)
//     toolDiffAdded, toolDiffRemoved, toolDiffContext
//
//   SYNTAX (9)
//     syntaxComment, syntaxKeyword, syntaxFunction, syntaxVariable,
//     syntaxString, syntaxNumber, syntaxType, syntaxOperator, syntaxPunctuation
//
//   THINKING-LEVEL BORDER (6)
//     thinkingOff, thinkingMinimal, thinkingLow,
//     thinkingMedium, thinkingHigh, thinkingXhigh
//
//   MODES (1)
//     bashMode
//
// RUNTIME THEME SWITCHING  (admin / `/settings` re-route)
//   ctx.ui.getAllThemes()                // [{ name, path? }, ...]
//   ctx.ui.getTheme("light")             // load without switching
//   ctx.ui.setTheme("light")             // → { success, error? }
//   ctx.ui.setTheme(themeObject)         // or pass the Theme object
//   ctx.ui.theme.fg(...)                 // current active theme (anytime)
//
// When the theme changes, the TUI calls invalidate() on every component.
// Our renderer is re-invoked on each rebuild, so the closure captures the
// fresh theme automatically — no manual cache invalidation required.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a pi extension that draws a full-width themed divider before
 * every assistant response.
 */
export function createResponseDivider(pi: ExtensionAPI): void {
    // Toggle state. Loaded from state.json (a USER PREFERENCE that
    // persists across /reload, /new, and fresh pi startup). Falls back
    // to true (the historical default) if state.json is missing or
    // the field hasn't been written yet.
    let enabled = getPreference("responseDividerEnabled", true);

    /** Status key used so the toggle's setStatus() also forces a re-render. */
    const STATUS_KEY = "aftc-response-divider";

    // 1) Custom message renderer — drawn at paint time, exact pane width.
    //    Reads `enabled` from the closure on every render, so the divider
    //    disappears the moment `enabled` flips to false.
    pi.registerMessageRenderer(DIVIDER_TYPE, (_msg, _opts, theme) => {
        return {
            render(width: number): string[] {
                if (!enabled) return [];
                const w = Math.max(0, width);

                // The rule line.  Composed fg + bg if a bg is set.
                const fg = theme.fg(HR_COLOR, HR_CHAR.repeat(w));
                const rule = HR_BG_COLOR ? theme.bg(HR_BG_COLOR, fg) : fg;

                const out: string[] = [truncateToWidth(rule, w, "")];

                // Trailing blank: with a bg, we emit w spaces carrying the
                // same bg so the color band extends flush to the response.
                if (HR_TRAILING_BLANK) {
                    if (HR_BG_COLOR) {
                        out.push(truncateToWidth(theme.bg(HR_BG_COLOR, " ".repeat(w)), w, ""));
                    } else {
                        out.push("");
                    }
                }

                return out;
            },
            invalidate(): void {},
        };
    });

    // 2) Inject the divider as the first message in each agent turn.
    //    Fires once per user prompt (NOT per tool-call follow-up turn),
    //    so exactly one divider renders above the first assistant message.
    pi.on("before_agent_start", async (_event, _ctx) => {
        if (!enabled) return undefined;
        return {
            message: {
                customType: DIVIDER_TYPE,
                content: "",
                display: true,
            },
        };
    });

    // 3) Strip divider messages from the LLM-visible list (visual-only).
    //    Always strip — safe even when disabled, defensive against stale
    //    session entries from before the toggle was ever off.
    pi.on("context", async (event, _ctx) => {
        const messages = event.messages.filter(
            (m) => m.role !== "custom" || m.customType !== DIVIDER_TYPE,
        );
        if (messages.length === event.messages.length) return undefined;
        return { messages };
    });

    // 4) /aftc-response-divider — toggle the feature on/off at runtime.
    //    setStatus() also calls tui.requestRender() internally, which
    //    forces a re-paint so existing dividers collapse (or reappear)
    //    immediately, not on the next natural re-render.
    pi.registerCommand("aftc-response-divider", {
        description:
            "Toggle the full-width response divider above each assistant reply (default: on)",
        handler: async (_args, ctx) => {
            enabled = !enabled;
            // Persist the new value as a user preference so it
            // survives /reload, /new, and fresh pi startup.
            setPreference("responseDividerEnabled", enabled);
            if (enabled) {
                ctx.ui.setStatus(
                    STATUS_KEY,
                    ctx.ui.theme.fg("success", "│ divider"),
                );
                ctx.ui.notify("Response divider: ON", "info");
            } else {
                ctx.ui.setStatus(STATUS_KEY, undefined);
                ctx.ui.notify("Response divider: OFF", "warning");
            }
        },
    });
}
