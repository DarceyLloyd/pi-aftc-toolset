/**
 * pi-aftc-toolset / aftc-codex — self-education loop (spec B).
 *
 * /aftc-codex-learn (B2): injects instructions telling the model to persist DURABLE,
 * GENERAL lessons into the codex resources using its STANDARD tools (read/edit/write
 * + bash to run the sync script). No separate model tool (KISS). The injected prompt:
 *   1. sync first, 2. check the resource list (update, never duplicate),
 *   3. PROPOSE entries and wait for confirmation (M-I8) in the established three-kind
 *      section format (Rules / Gotchyas / Issues & Solutions), routing TECH lessons ->
 *      the right category doc under resources/
 *      (the fixed top-level docs are never written by -learn), 4. sync after.
 *
 * See `codex-learn-readme.md` for the full contract.
 */

import * as path from "node:path";
import { getPreference } from "../config";
import { getPackageRoot } from "../paths";
import type { CodexContext } from "./aftc-codex";


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function syncScriptPath(): string {
    return path.join(
        getPackageRoot(), "extensions", "aftc-toolset", "aftc-codex",
        "scripts", "sync-codex-resources.mjs",
    );
}

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
    const { pi, store } = ctx;

    function buildLearnPrompt(): string {
        const root = store.getRoot();
        const resourcesDir = store.getResourcesDir();
        const script = syncScriptPath();
        return [
            "You are running the aftc-codex self-education loop (/aftc-codex-learn).",
            "",
            "GOAL: Record DURABLE, GENERAL lessons from this session into the codex knowledge base so future sessions benefit. Do NOT record project-specific facts.",
            "WHERE: the paths below are your LIVE writable copy in the OS data dir. The package's data/aftc-codex seed is READ-ONLY — never write there.",
            "",
            "STEPS:",
            `1. Sync first — run: node "${script}"`,
            `2. Read "${path.join(resourcesDir, "codex-resource-list.md")}" to see what docs already exist. If a doc covers your topic, add to it (do not duplicate an existing entry). If NO doc covers your topic, CREATE a new .md file in the correct category folder.`,
            getPreference("aftcCodexAutoAddEntries", true)
                ? "3. WRITE the entries directly. Before writing, scan the target file for duplicate lead tokens or entry IDs — never add a duplicate. Classify each lesson and use EXACTLY this format:"
                : "3. PROPOSE the new lesson entries and WAIT for my confirmation before writing. Classify each lesson and use EXACTLY this format:",
            "   Every resource file has THREE sections (always present, in this order): ## Rules, ## Gotchyas, ## Issues & Solutions",
            "   Write the entry at the END of the matching section, in its kind's format:",
            "   - RULE (a convention WE enforce; one line, no date):",
            "     - [ID] Never/Always X — one short reason.",
            "   - GOTCHA (a trap built INTO the technology; ONE line with BOTH parts — trap + what to do; no date):",
            "     - [ID] LEAD — the trap; what to do / watch for.",
            "   - ISSUE & SOLUTION (a concrete failure you OBSERVED, with diagnosis; dated):",
            "     - [ID] LEAD_TOKEN — one-line symptom",
            "       Cause: why it happens.",
            "       Fix: what to do. (YYYY-MM)",
            "   WHICH KIND? Answer IN ORDER, first match wins:",
            "     1) Observed failure (greppable error/symptom) with a diagnosis -> Issue.",
            "     2) Convention we choose to follow (could be violated) -> Rule.",
            "     3) Technology trap you can only avoid, not change -> Gotcha.",
            "     Where to write (TECH lessons only — create folders/.md under resources/):",
            `     - Technology lessons -> "${resourcesDir}/{languages|libraries|frameworks|engines|tools|runtimes}/<topic>.md"`,
            "     - Process / thinking guidance is NOT recorded by -learn (thought-and-action-guidance.md is a fixed maintainer doc).",
            "     - If the file does not exist yet, CREATE it with this exact skeleton (all three headings, each followed by a blank line): '# <Topic>', '## Rules', '## Gotchyas', '## Issues & Solutions'. If the category folder does not exist, CREATE it.",
            getPreference("aftcCodexAutoAddEntries", true)
                ? `4. After writing, sync again — run: node "${script}"`
                : `4. After I confirm and you have written the entries, sync again — run: node "${script}"`,
            "",
            "RULES: Durable + general only. Keep the section formats. Decide routing in ONE pass and commit. If a topic has nothing durable to record, say so and move on (never pad).",
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
