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
 * for duplicates (loading an EXISTING target first IS the duplicate check and the
 * write tools enforce it; new topics need no load), and classifying the entry kind.
 *
 * See `codex-learn-readme.md` for the full contract.
 */

import type { CodexContext } from "./aftc-codex";
import * as aftcConsole from "../ui/aftc-console";


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
        return [
            "You are running the aftc-codex self-education loop (/aftc-codex-learn).",
            "",
            "GOAL: Save DURABLE, GENERAL lessons from this session into the codex knowledge base so future sessions benefit. Never save project-specific facts (no project names, paths or URLs).",
            "",
            "WRITES go through the codex entry tools only — never hand-edit resource files:",
            "- codex_add_entry — add new entries. Put all entries for one topic in ONE call.",
            "- codex_edit_entry — fix an existing entry by its [ID].",
            "- codex_remove_entry — delete a stale entry by its [ID].",
            "",
            "HARD LIMITS — every entry must be GLOBAL and SAFE (checked BEFORE writing each entry):",
            "1. GENERALITY: would this entry make sense to a session working on ANY project? If it names a project, a real path/URL, or a term only one project's docs/workflow use — reword it generically or drop it. Project facts are NEVER saved.",
            "   BAD: \"Add a References block and last-reviewed stamp to every deep doc; keep map IDs stable\" (one project's documentation vocabulary).",
            "   GOOD: \"When generating docs from source, verify every claimed file/endpoint exists in code before documenting it as live — a reference to a missing file means the feature is removed.\"",
            "2. SECRETS: NEVER save passwords, API keys, tokens, private keys, connection strings or any credential — not even as examples. If a lesson involves a credential, describe the SHAPE only (\"the API key env var\"), never a value.",
            "3. The write tools mechanically reject real absolute paths, URLs, credential-looking values and the current project's name. A refusal means reword generically — never try to force the entry through.",
            "When in doubt: reword generically or drop — never save as-is.",
            "",
            "STEPS:",
            "1. Review this session for lessons worth keeping: anything that took real effort, a non-obvious method, a tooling/framework quirk, or a failure you diagnosed.",
            "2. Pick the right topic doc for each lesson. The resource list is in your system prompt (or codex_load(\"list\")). Prefer an existing doc; create a new one (topic \"category/name\") only when nothing covers the topic.",
            "3. BEFORE writing to an EXISTING topic, codex_load it. This is your duplicate check: read what is there. If your lesson already exists in any wording, amend it with codex_edit_entry or skip it — never add a near-duplicate. A NEW topic needs no load; codex_add_entry creates the file.",
            "4. WRITE the entries with codex_add_entry. If a write is refused because the topic was not loaded, codex_load it and retry — never drop a lesson over a refusal. Classify each lesson first (first match wins, IN ORDER):",
            "   a) A failure you observed (greppable error/symptom) and diagnosed -> kind \"issue\" (text = one-line symptom, plus cause and fix).",
            "   b) A convention we choose to follow -> kind \"rule\" (one line).",
            "   c) A technology trap you can only avoid, not change -> kind \"gotcha\" (one line naming BOTH the trap and the countermeasure).",
            "   Routing: technology lessons -> resources/{languages|libraries|frameworks|engines|tools|runtimes|servers-and-containers|database|os|file-formats|ui-ux}/<topic>.md (ui-ux nests by platform: ui-ux/web|desktop|mobile|plugin/<domain>.md; file-formats nests by format family: file-formats/audio/ etc. - BINARY FILE FORMAT lessons (parsing, decoding, byte surgery, decompression) go there, NEVER ui-ux); work-methodology lessons (planning, documentation) -> the root-level documentation-and-planning.md. The fixed top-level docs (codex-rules, guidance, markdown) are NEVER written by -learn.",
            "5. If you saw an outdated entry while reading a topic, fix or remove it now (codex_edit_entry / codex_remove_entry).",
            "",
            "RULES: Write short — fewest plain words that still carry the full lesson. Never fabricate or pad. If nothing durable was learned this session, say so and stop.",
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
            aftcConsole.logError(`[aftc-toolset] codex injectLearnPrompt error: ${(err as Error).message}`);
        }
    }

    return { buildLearnPrompt, injectLearnPrompt };
}
