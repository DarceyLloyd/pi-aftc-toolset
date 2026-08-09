/**
 * pi-aftc-toolset / aftc-codex — planning/documentation intent detection (spec D14).
 *
 * The OPTIONAL heuristic layer on top of the D5 directive wording: when the
 * user's message reads like planning or documentation work, the model gets a
 * one-line suggestion to load documentation-and-planning.md first. The base
 * layer (the marker + rules wording naming the topic) stays the robust path -
 * this module only nudges.
 *
 * Safety rails (LOCKED):
 *   - Suggestion only, NEVER an unconditional auto-load.
 *   - Once per session at most, and never when the topic was already loaded.
 *   - Only while the codex feature is live (enabled + prepped, not rules-only).
 *   - Extension-sourced input is ignored (no self-trigger loops).
 *
 * Wired through the coordinator. See `codex-intent-readme.md`.
 */

import { Text } from "@earendil-works/pi-tui";
import { getPreference } from "../config";
import type { CodexContext } from "./aftc-codex";
import type { CodexReadTracker } from "./codex-entries";
import * as aftcConsole from "../ui/aftc-console";

/** Custom-message type for the intent suggestion (in LLM context, prunable). */
export const CODEX_INTENT_MESSAGE = "aftc-codex-intent";

/** The intent-loaded topic this module nudges towards (resources root file). */
const TOPIC = "documentation-and-planning";
const TOPIC_REL = "documentation-and-planning.md";

/** Light word-boundary heuristic for planning / documentation intent. Bare
 *  "docs" is deliberately excluded (too noisy); a false positive costs one
 *  suggestion line, a false negative just falls back to the D5 directive. */
const INTENT_RE = /\b(plan|plans|planning|roadmap|spec|document|documentation|documenting|readme|docx)\b/i;

export function createCodexIntent(ctx: CodexContext, readTracker: CodexReadTracker): void {
    const { pi, store, state } = ctx;
    let suggestedThisSession = false;

    pi.on("session_start", async (event) => {
        if (event.reason === "new" || event.reason === "startup") suggestedThisSession = false;
    });

    pi.registerMessageRenderer(CODEX_INTENT_MESSAGE, (message, _opts, theme) => {
        const text = typeof message.content === "string" ? message.content : "";
        try {
            return new Text(theme.fg("accent", text), 0, 0);
        } catch {
            return new Text(text, 0, 0);
        }
    });

    pi.on("input", async (event, ictx) => {
        try {
            if (event.source === "extension") return; // never react to our own injections
            if (suggestedThisSession) return;
            if (!getPreference("aftcCodexEnabled", false)) return;
            if (!state.prepped || state.silent || state.rulesOnly) return;
            if (readTracker.sessionReads.has(TOPIC_REL)) return; // already loaded
            if (!INTENT_RE.test(event.text ?? "")) return;
            if (!store.readResource(TOPIC)) return; // topic not present in this live copy
            suggestedThisSession = true;
            const content =
                `AFTC-CODEX instruction (mandatory): this request is planning/documentation work. Call ` +
                `codex_load("${TOPIC}") NOW, before anything else - its rules apply even before the ` +
                `project stack is known. Then continue.`;
            if (ictx.isIdle()) {
                pi.sendMessage({ customType: CODEX_INTENT_MESSAGE, content, display: true });
            } else {
                // Agent busy: deliverAs is required or pi throws (codex m5UHsz).
                pi.sendMessage({ customType: CODEX_INTENT_MESSAGE, content, display: true }, { deliverAs: "steer" });
            }
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex intent error: ${(err as Error).message}`);
        }
    });

    aftcConsole.log("codex-intent: loaded — planning/documentation intent suggestion");
}
