/**
 * pi-aftc-toolset / aftc-codex — self-education loop (spec B).
 *
 * /aftc-codex-learn (B2): injects instructions telling the model to persist DURABLE,
 * GENERAL lessons into the codex resources using its STANDARD tools (read/edit/write
 * + bash to run the sync script). No separate model tool (KISS). The injected prompt:
 *   1. sync first, 2. check the resource list (update, never duplicate),
 *   3. PROPOSE entries and wait for confirmation (M-I8) in the established entry
 *      format, routing TECH gotchas -> the right category doc under resources/
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
                ? "3. WRITE the entries directly. Before writing, scan the target file for duplicate lead tokens or entry IDs — never add a duplicate. Use this entry format exactly:"
                : "3. PROPOSE the new lesson entries and WAIT for my confirmation before writing. Use this entry format exactly:",
            "     - `[ID] LEAD_TOKEN` — one-line symptom",
            "       Cause: why it happens.",
            "       Fix: what to do. (YYYY-MM)",
            "     Where to write (TECH gotchas only — create folders/.md under resources/):",
            `     - Technology gotchas -> "${resourcesDir}/{languages|libraries|frameworks|engines|tools}/<topic>.md"`,
            "     - Process / thinking guidance is NOT recorded by -learn (thought-and-action-guidance.md is a fixed maintainer doc).",
            "     - If the file does not exist yet, CREATE it (with a # heading). If the category folder does not exist, CREATE it.",
            getPreference("aftcCodexAutoAddEntries", true)
                ? `4. After writing, sync again — run: node "${script}"`
                : `4. After I confirm and you have written the entries, sync again — run: node "${script}"`,
            "",
            "RULES: Durable + general only. Keep the entry format. Decide routing in ONE pass and commit. If a topic has nothing durable to record, say so and move on (never pad).",
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
