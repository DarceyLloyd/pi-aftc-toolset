/**
 * pi-aftc-toolset — emergency-interrupt feature module.
 *
 * Registers two slash commands that abort the currently-running agent
 * operation:
 *
 *   - `/aftc-stop` — namespaced, follows the project's `/aftc-*` command
 *     convention (.dev/dev_guide.md section 6.2). For when you want to be explicit.
 *   - `/stfu`      — short alias for the same action. For when the model
 *     has gone into a 30-minute "wait…" loop and you just want out, fast.
 *
 * Both commands do exactly the same thing — pick whichever you can type
 * fastest. They are documented as aliases of each other in `/aftc-help`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Pi already exposes `Escape` to interrupt a streaming operation from the
 * TUI, but there is no built-in slash command for it. Slash commands are
 * useful because:
 *
 *   - They work identically regardless of where editor focus is.
 *   - They are scriptable and discoverable via `/aftc-help`.
 *   - They survive being typed in a hurry (no need to find Escape).
 *
 * Concretely: when a reasoning model (e.g. GLM, O1-class) gets stuck in a
 * long internal monologue or a runaway tool-call loop, hitting
 * `/aftc-stop` (or `/stfu`) calls `ctx.abort()` to cancel the in-flight
 * provider stream and any running tool, returning the user to the editor.
 *
 * ---------------------------------------------------------------------------
 * HOW IT WORKS
 * ---------------------------------------------------------------------------
 * Pi's `ExtensionContext` exposes a fire-and-forget `ctx.abort()` helper
 * (see pi's `docs/extensions.md` section "ctx.isIdle() / ctx.abort() /
 * ctx.hasPendingMessages()"). It cancels the current agent turn. We use
 * it directly — no event handlers, no shared state, no background
 * resources.
 *
 * When the agent is already idle (nothing to stop), we emit an
 * informational notification rather than failing silently, so the user
 * gets feedback that the command was received but had nothing to do.
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE
 * ---------------------------------------------------------------------------
 * Self-contained feature module (.dev/dev_guide.md section 1.5):
 *
 *   - No closure state.
 *   - No event subscriptions.
 *   - No cross-module imports.
 *   - No shared resources, timers, or processes.
 *
 * Wired into pi by the orchestrator (`index.ts`) via `createStfu(pi)`.
 *
 * ---------------------------------------------------------------------------
 * TEST CHECKLIST
 * ---------------------------------------------------------------------------
 *  1. Open pi with a model that streams slowly.
 *  2. Send a prompt → while the model is still streaming, hit
 *     `/aftc-stop` (or `/stfu`) → the stream should halt and the editor
 *     should regain focus.
 *  3. While idle, hit `/aftc-stop` → notification "Agent is already
 *     idle — nothing to stop." should appear.
 *  4. `/aftc-help` → both `/stfu` and `/aftc-stop` should appear under
 *     the "Interrupt" section.
 *
 * See `stfu.readme.md` for the full contract.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Description shown in `/aftc-help` for the namespaced command. Both
 * commands are documented as aliases of each other so the help output
 * reads as "two names, one action" rather than two separate features.
 */
const AFTC_STOP_DESCRIPTION =
    "Stop the current agent operation (escape a runaway thinking loop or stalled tool call). Alias for /stfu.";

/**
 * Short description for `/stfu`. Explicitly points users at the
 * namespaced twin so they discover the convention via `/aftc-help`.
 */
const STFU_DESCRIPTION =
    "Stop the current agent operation. Short alias for /aftc-stop.";

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER  —  shared by both commands; takes the command name for feedback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common handler for `/stfu` and `/aftc-stop`.
 *
 * Fire-and-forget: returns immediately after `ctx.abort()`. The abort
 * itself runs in the agent runtime; we don't await it.
 *
 * @param cmdName  The command name being executed — used in the
 *                 "Stopped via /stfu" feedback so the user knows which
 *                 alias they hit (helpful when both are muscle-memory).
 */
async function handleStop(
    cmdName: string,
    ctx: ExtensionCommandContext,
): Promise<void> {
    // ctx.isIdle() is the documented way to check whether anything is
    // running (extensions.md section "ctx.isIdle() / ctx.abort() / ..."). When
    // true, there's nothing to abort and ctx.abort() would be a silent
    // no-op — emit a friendly notification instead so the user gets
    // feedback that the command was received.
    if (ctx.isIdle && ctx.isIdle()) {
        if (ctx.hasUI) {
            ctx.ui.notify("Agent is already idle — nothing to stop.", "info");
        } else {
            console.log("[aftc-toolset] stfu: agent already idle — nothing to stop");
        }
        return;
    }

    // Fire-and-forget abort. Per pi docs this cancels the current agent
    // operation and returns control to the editor. It is safe to call
    // from command handlers (extension-command context).
    ctx.abort();

    // Confirm the abort in the UI. We can't await the abort itself —
    // it's fire-and-forget — so the notification is the user-visible
    // confirmation that the command fired.
    if (ctx.hasUI) {
        ctx.ui.notify(`Stopped via /${cmdName}`, "warning");
    } else {
        console.log(`[aftc-toolset] stfu: aborted via /${cmdName}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY  —  wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register the two abort slash commands with pi.
 *
 * Both commands are functionally identical aliases. We register them
 * separately rather than as a single command so users get autocomplete
 * on both names in the slash-command picker.
 *
 * @param pi  The `ExtensionAPI` instance handed to the extension factory.
 * @returns void — this module owns no shared state.
 */
export function createStfu(pi: ExtensionAPI): void {
    // Namespaced command — follows the project's /aftc-* convention
    // (.dev/dev_guide.md section 6.2). Use this when you want to be explicit.
    pi.registerCommand("aftc-stop", {
        description: AFTC_STOP_DESCRIPTION,
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            await handleStop("aftc-stop", ctx);
        },
    });

    // Short alias — same action, easier to type in a hurry.
    pi.registerCommand("stfu", {
        description: STFU_DESCRIPTION,
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            await handleStop("stfu", ctx);
        },
    });

    console.log("[aftc-toolset] loaded — /aftc-stop, /stfu (interrupt current agent operation)");
}