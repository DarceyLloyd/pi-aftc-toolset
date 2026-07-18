/**
 * pi-aftc-toolset — keep-it-short slash command feature module.
 *
 * One slash command (with a short alias) that sends a fixed
 * "be concise" instruction prompt to the active model as a fresh
 * user message. Useful when the model has drifted into verbose
 * explanations and you want to nudge it back without rephrasing
 * manually.
 *
 *   - `/keep-it-short` — full name, autocomplete-friendly
 *   - `/kis`           — short alias, fewer keystrokes
 *
 * Both share the same handler so behaviour is always in lockstep
 * (see replay.ts / stfu.ts for the same alias pattern).
 *
 * Delivery:
 *   - Idle agent:   plain sendUserMessage → new turn immediately
 *   - Busy agent:   sendUserMessage with deliverAs: "followUp" →
 *                   queued until the current turn finishes. Safer
 *                   than "steer" which would interrupt mid-thought.
 *
 * Self-contained feature module (.dev/dev_guide.md section 1.5):
 *   - No closure state (the prompt is a constant).
 *   - No event subscriptions.
 *   - No background resources.
 *   - No cross-module imports.
 *
 * Wired in by the orchestrator (`index.ts`) via
 * `createKeepItShort(pi)`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Prompt text — fixed instruction sent to the model.
//
// Optimised for: brevity-by-default, no preamble, no re-stating what
// the model just did, direct answers to questions, prose-on-demand.
// Crucially explicit: "short" means "terse", NOT "silent" — a short
// reply is still a reply, and answers should always be complete.
// ─────────────────────────────────────────────────────────────────────────────

const KIS_PROMPT =
    "Be terse. Answer the actual question fully, but in the fewest words. " +
    "No preamble, no recap of what you just did, no 'here's…' openers. " +
    "Drop filler ('Sure!', 'Of course.', 'Let me…'). " +
    "Code stays as code, not wrapped in prose. " +
    "One-word replies (ok / done / yes / no etc) are fine when they answer the question. " +
    "Always respond with something, do not just finish a task and stay silent, say 'done' at the very least.";

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Truncate a string for safe notification display. */
function preview(s: string, max = 80): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared handler — wired to both /keep-it-short and /kis.
// Takes the command name for the headless log so the user can see
// which alias they fired.
// ─────────────────────────────────────────────────────────────────────────────

const KEEP_IT_SHORT_DESCRIPTION =
    "Send a fixed 'be concise' instruction prompt to the active model.";

const KIS_DESCRIPTION =
    "Short alias for /keep-it-short — same action, fewer keystrokes.";

async function handleKeepItShort(
    cmdName: string,
    pi: ExtensionAPI,
    _args: string,
    ctx: ExtensionCommandContext,
): Promise<void> {
    const idle = ctx.isIdle ? ctx.isIdle() : true;
    const previewText = preview(KIS_PROMPT);

    if (idle) {
        pi.sendUserMessage(KIS_PROMPT);
        if (ctx.hasUI) {
            ctx.ui.notify(`Sent: ${previewText}`, "info");
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: sent (${KIS_PROMPT.length} chars): ${previewText}`,
            );
        }
    } else {
        // Streaming: must specify deliverAs or pi throws.
        // "followUp" queues until the current turn finishes — safer
        // than "steer" (which interrupts mid-turn). Users who want
        // to interrupt should use /aftc-stop first, then /kis.
        pi.sendUserMessage(KIS_PROMPT, { deliverAs: "followUp" });
        if (ctx.hasUI) {
            ctx.ui.notify(`Sent (queued as follow-up): ${previewText}`, "info");
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: queued follow-up (${KIS_PROMPT.length} chars): ${previewText}`,
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createKeepItShort(pi: ExtensionAPI): void {
    // ---- /keep-it-short ----
    pi.registerCommand("keep-it-short", {
        description: KEEP_IT_SHORT_DESCRIPTION,
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            await handleKeepItShort("keep-it-short", pi, args, ctx);
        },
    });

    // ---- /kis ----
    pi.registerCommand("kis", {
        description: KIS_DESCRIPTION,
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            await handleKeepItShort("kis", pi, args, ctx);
        },
    });

    console.log(
        "[aftc-toolset] loaded — /keep-it-short, /kis (send a fixed 'be concise' prompt to the active model)",
    );
}