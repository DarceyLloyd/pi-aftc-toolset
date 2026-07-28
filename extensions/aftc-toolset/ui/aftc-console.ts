/**
 * pi-aftc-toolset — centralised transcript + diagnostic output (aftc-console).
 *
 * One facade for everything aftc-toolset writes to the user's console:
 *   - transcript line messages (the conversation area): emphasis / warn / error / info
 *   - stdout diagnostic lines (load messages): log
 *
 * Why this exists: ctx.ui.notify() only supports "info" (dim) / "warning"
 * (yellow + "Warning:") / "error" (red) - NONE of which is the theme's
 * accent/emphasis colour. Every feature that wanted an emphasised status line
 * had to build its own pi.appendEntry() renderer. This module owns that renderer
 * once and exposes a uniform severity API, so output styling is defined in
 * exactly one place: change the colour, prefix, or transport here and it applies
 * everywhere.
 *
 * Transport split:
 *   - emphasis -> pi.appendEntry (accent-coloured custom entry; needs pi,
 *     registered once via init()). Falls back to a dim info line when the host
 *     has no entry-renderer API (tests / stripped hosts).
 *   - warn / error / info -> ctx.ui.notify (the three native severities).
 *   - log -> console.log with the "[aftc-toolset]" prefix (stdout diagnostics).
 *
 * Severity contract and usage guidance live in
 * docs/aftc-console-documentation.md - read it before relying on this module.
 *
 * Per AGENTS.md, this is a shared UI utility (sibling to
 * aftc-ui.ts), not a feature module: every feature may import it.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/** Custom entry type for emphasised (accent-coloured) transcript lines. */
export const AFTC_CONSOLE_EMPHASIS_ENTRY = "aftc-console-emphasis";

/** Prefix used by log() for stdout diagnostic lines. */
export const AFTC_PREFIX = "[aftc-toolset]";

interface EmphasisData {
    text: string;
}

// Cached API reference, refreshed on each init() so it survives /reload. Null
// only before the first init() (guarded in emphasis()).
let activePi: ExtensionAPI | null = null;

/**
 * Register the emphasis entry renderer. Call ONCE per session - the
 * orchestrator (index.ts) does this at startup. Idempotent: re-registering on
 * /reload just refreshes the cached pi and re-installs the renderer cleanly.
 */
export function init(pi: ExtensionAPI): void {
    activePi = pi;
    // Fail-soft: emphasis is cosmetic, so a host/mock without the entry-renderer
    // API simply skips registration (emphasis() then falls back to a dim line).
    if (typeof pi.registerEntryRenderer !== "function") return;
    pi.registerEntryRenderer(AFTC_CONSOLE_EMPHASIS_ENTRY, (entry, _options, theme) => {
        const text = (entry.data as EmphasisData | undefined)?.text ?? "";
        // x=1 matches the indent of ctx.ui.notify status lines.
        return new Text(theme.fg("accent", text), 1, 0);
    });
}

/**
 * Emphasised (accent-coloured) transcript line - the theme's emphasis colour
 * (orange in aftc-orange-viz). Use for status, success, and state-change
 * output: anything that is NOT a warning or an error. This is the capability
 * ctx.ui.notify cannot provide. Falls back to a dim info line when the entry
 * renderer is unavailable (tests / stripped hosts).
 */
export function emphasis(ctx: ExtensionContext, text: string): void {
    const pi = activePi;
    if (pi && typeof pi.appendEntry === "function") {
        pi.appendEntry(AFTC_CONSOLE_EMPHASIS_ENTRY, { text });
        return;
    }
    ctx.ui.notify(text, "info");
}

/**
 * Warning transcript line (yellow). Use when a requested action could not
 * proceed: nothing selected, not connected, missing arguments, "not a file".
 */
export function warn(ctx: ExtensionContext, text: string): void {
    ctx.ui.notify(text, "warning");
}

/** Error transcript line (red). Use for hard failures ("...failed", "could not be opened"). */
export function error(ctx: ExtensionContext, text: string): void {
    ctx.ui.notify(text, "error");
}

/**
 * Dim transcript line (faint grey). The rare neutral aside; most ordinary
 * output should use emphasis() instead.
 */
export function info(ctx: ExtensionContext, text: string): void {
    ctx.ui.notify(text, "info");
}

/**
 * Stdout diagnostic line with the "[aftc-toolset]" prefix. For load /
 * diagnostic messages that go to the process console (NOT the transcript).
 * Centralises the prefix so it stays consistent and greppable. If the text
 * already starts with the prefix it is emitted unchanged (no double prefix).
 */
export function log(text: string): void {
    console.log(text.startsWith(AFTC_PREFIX) ? text : `${AFTC_PREFIX} ${text}`);
}
