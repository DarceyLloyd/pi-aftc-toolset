/**
 * pi-aftc-toolset / aftc-codex — self-education loop (spec B).
 *
 * /aftc-codex-learn (B2): injects instructions telling the model to persist DURABLE,
 * GENERAL lessons into the codex resources using the codex entry tools
 * (codex_add_entry / codex_edit_entry / codex_remove_entry) — never hand-edited
 * files, never a bash-run sync script. The tools generate the [ID]s, validate the
 * three-kind format (Rules / Gotchyas / Issues & Solutions), place entries under
 * the canonical sections, create missing topic files/category folders, and
 * regenerate the resource list internally when a topic file is created. The
 * injected prompt keeps only the work the tools CANNOT do: reviewing the session,
 * routing each lesson to the right topic doc (TECH lessons -> resources/), checking
 * for duplicates (the model must codex_load the target first — the tools enforce
 * it), and classifying the entry kind.
 *
 * See `codex-learn-readme.md` for the full contract.
 */

import { getPreference } from "../config";
import type { CodexContext } from "./aftc-codex";


// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface CodexLearnApi {
    /** Build the /aftc-codex-learn instruction prompt. */
    buildLearnPrompt(): string;
    /** Inject the learn prompt as a user message. `busy` = agent streaming. */
    injectLearnPrompt(busy: boolean): void;
}

export function createCodexLearn(ctx: CodexContext): CodexLearnApi {
    const { pi } = ctx;

    function buildLearnPrompt(): string {
        const autoAdd = getPreference("aftcCodexAutoAddEntries", true);
        return [
            "You are running the aftc-codex self-education loop (/aftc-codex-learn).",
            "",
            "GOAL: Record DURABLE, GENERAL lessons from this session into the codex knowledge base so future sessions benefit. Do NOT record project-specific facts.",
            "",
            "HOW: Use the codex entry tools for EVERY write — never hand-edit resource files and never run any sync script (the tools handle IDs, format, section placement, topic/category creation and the resource list internally):",
            "- codex_add_entry — new entries (batch several for the same topic in ONE call).",
            "- codex_edit_entry — correct/amend an existing entry by its [ID].",
            "- codex_remove_entry — delete a stale entry by its [ID] (state what you removed and why).",
            "All three write to your LIVE per-user copy in the OS data dir. The package's data/aftc-codex seed is READ-ONLY — the tools never touch it.",
            "",
            "STEPS:",
            "1. Review this session for lessons worth recording (anything that took real effort, a non-obvious method, a tooling/framework quirk, an observed failure with a diagnosis).",
            "2. Consult the resource list (already in your system prompt, or codex_load(\"list\")) to pick the RIGHT topic doc for each lesson: update an existing doc; create a new one (topic \"category/name\", new categories allowed) only when no doc covers the topic.",
            "3. codex_load each target topic and check your lesson is not already there (the write tools REFUSE to modify a topic you have not loaded this session, and reject exact duplicates).",
            autoAdd
                ? "4. WRITE the entries with codex_add_entry. Classify each lesson first (first match wins, IN ORDER):"
                : "4. PROPOSE the new lesson entries to me and WAIT for my confirmation, then write them with codex_add_entry. Classify each lesson first (first match wins, IN ORDER):",
            "   a) Observed failure (greppable error/symptom) with a diagnosis -> kind \"issue\" (text = one-line symptom, cause, fix — the tool appends the current date).",
            "   b) Convention we choose to follow (could be violated) -> kind \"rule\" (one line).",
            "   c) Technology trap you can only avoid, not change -> kind \"gotcha\" (ONE line with BOTH the trap AND the countermeasure).",
            "   Routing: technology lessons -> resources/{languages|libraries|frameworks|engines|tools|runtimes|design|database}/<topic>.md. The fixed top-level docs (codex-rules, guidance, markdown) are NEVER written by -learn.",
            "5. Correct or remove outdated entries you noticed (codex_edit_entry / codex_remove_entry) — do not wait for a future -learn.",
            "",
            "RULES: Durable + general only (no project names/paths/URLs). Write for a weak reader: fewest plain words that still carry the full lesson. Never fabricate or pad — if nothing durable was learned, say so and stop.",
        ].join("\n");
    }

    function injectLearnPrompt(busy: boolean): void {
        try {
            const prompt = buildLearnPrompt();
            if (busy) {
                pi.sendUserMessage(prompt, { deliverAs: "followUp" });
            } else {
                pi.sendUserMessage(prompt);
            }
        } catch (err) {
            console.log(`[aftc-toolset] codex injectLearnPrompt error: ${(err as Error).message}`);
        }
    }

    return { buildLearnPrompt, injectLearnPrompt };
}
