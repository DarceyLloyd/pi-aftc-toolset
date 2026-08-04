/**
 * pi-aftc-toolset / docx — project documentation generator (`/docx`).
 *
 * One slash command that regenerates a project's full documentation set
 * (per the shipped `documentation_guide.md` in this folder) into
 * `./docx/`, with the previous documentation folded into
 * `./docx/old_docs.zip`.
 *
 * Flow:
 *   1. Context-window gate (skipped by --yes): when >= 10% of the
 *      context window is already used, warn that generation is a long
 *      task and offer Exit / "Yes I understand, proceed".
 *   2. Confirm modal (skipped by --yes): warns that all previous
 *      documentation is moved into ./docx/old_docs/ (zipped to old_docs.zip
 *      at the end of the run) and advises making a backup first.
 *   3. Deterministic backup (docx-backup.ts): moves root .md files,
 *      ./docs/** and any previous ./docx/ output into ./docx/old_docs/
 *      (structure preserved, counts verified). AI context files
 *      (AGENTS.md etc.) are COPIED, not moved — AGENTS.md is edited in
 *      place by the generation run. Any backup error aborts BEFORE the
 *      model is engaged.
 *   4. The guide's execution prompt (section 18 of the shipped guide) is
 *      injected as a user message with [PROJECT_PATH] / script paths
 *      substituted. The model does the generation; as its final action
 *      it runs scripts/zip-old.mjs to pack docx/old_docs into old_docs.zip.
 *
 * Self-contained feature module: no cross-module imports beyond the
 * shared ui/ + help-registry utilities, wired by index.ts via
 * `createDocx(pi)`.
 *
 * See `docx-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
    ExtensionAPI,
    ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import * as aftcConsole from "../ui/aftc-console";
import { showConfirm } from "../ui/aftc-ui";
import { registerHelpEntry } from "../help-registry";
import { runDocxBackup, type DocxBackupResult } from "./docx-backup";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** Warn when this much of the context window is already used. */
const CONTEXT_WARN_PERCENT = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ─────────────────────────────────────────────────────────────────────────────

/** Forward-slash absolute path (safe to quote inside a bash command). */
function slashPath(p: string): string {
    return p.split(path.sep).join("/");
}

/**
 * Extract the section-18 execution prompt (the ```text fenced block) from
 * the shipped guide. The guide is the single source of truth for the
 * prompt — never duplicate the steps here.
 */
function extractExecutionPrompt(guide: string): string | null {
    const sectionIdx = guide.indexOf("## 18. AI Execution Prompt");
    if (sectionIdx < 0) return null;
    const fenceStart = guide.indexOf("```text", sectionIdx);
    if (fenceStart < 0) return null;
    const bodyStart = guide.indexOf("\n", fenceStart) + 1;
    const fenceEnd = guide.indexOf("```", bodyStart);
    if (fenceEnd < 0) return null;
    return guide.slice(bodyStart, fenceEnd).trim();
}

function buildDocxPrompt(projectRoot: string, backup: DocxBackupResult): string | null {
    const featureDir = __dirname;
    const guidePath = path.join(featureDir, "documentation_guide.md");
    let guide: string;
    try {
        guide = fs.readFileSync(guidePath, "utf8");
    } catch {
        return null;
    }
    const template = extractExecutionPrompt(guide);
    if (!template) return null;

    const root = slashPath(path.resolve(projectRoot));
    const script = (name: string): string =>
        slashPath(path.join(featureDir, "scripts", name));

    const prompt = template
        .split("[PROJECT_PATH]").join(root)
        .split("[GUIDE_PATH]").join("the guide appended below this prompt")
        .split("[MAP_SCAN_PATH]").join(script("map-scan.mjs"))
        .split("[LINK_AUDIT_PATH]").join(script("link-audit.mjs"))
        .split("[ZIP_OLD_PATH]").join(script("zip-old.mjs"));

    const backupSummary = backup.firstRun
        ? "No pre-existing documentation was found - this is a first-time generation. docx/old_docs/ is empty; skip any step that references it."
        : [
            `Backup completed by the tooling: ${backup.moved.length} file(s) moved into docx/old_docs/ (rel-from-root paths preserved).`,
            backup.copied.length > 0
                ? `${backup.copied.length} AI context file(s) (AGENTS.md etc.) were COPIED into docx/old_docs/ and left in place.`
                : "",
            backup.partnerSkipped.length > 0
                ? `Partner docs left in place (belong to code): ${backup.partnerSkipped.join(", ")}.`
                : "",
            backup.docsLeftovers.length > 0
                ? `./docs/ was kept because non-documentation files remain: ${backup.docsLeftovers.join(", ")}.`
                : "",
            backup.docsDirRemoved ? "./docs/ was fully emptied and removed." : "",
        ].filter(Boolean).join("\n");

    return [
        "You are running /docx (pi-aftc-toolset documentation generator).",
        "",
        "BACKUP STATE (already performed - never move/zip docs yourself):",
        backupSummary,
        "",
        prompt,
        "",
        "---",
        "",
        guide,
    ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Command handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleDocx(
    pi: ExtensionAPI,
    args: string,
    ctx: ExtensionCommandContext,
): Promise<void> {
    const skipConfirm = args.trim().split(/\s+/).includes("--yes");
    const projectRoot = ctx.cwd;

    if (!skipConfirm) {
        if (!ctx.hasUI) {
            aftcConsole.warn(
                ctx,
                "/docx needs interactive confirmation - re-run as /docx --yes to skip the confirmations (headless).",
            );
            return;
        }

        // 1. Context-window gate. Generation is a long multi-turn task;
        //    warn when a meaningful slice of the window is already used.
        const usage = ctx.getContextUsage();
        if (usage && usage.percent >= CONTEXT_WARN_PERCENT) {
            const windowTokens = ctx.model?.contextWindow;
            const windowText = windowTokens
                ? ` of ${windowTokens.toLocaleString()}`
                : "";
            const proceed = await showConfirm(ctx, {
                title: "Context window warning",
                body:
                    `Your context window is ${Math.round(usage.percent)}% used${windowText} ` +
                    `(${Math.round(usage.tokens).toLocaleString()} tokens). /docx is a long task ` +
                    "that can use a large share of the remaining window, depending on the size " +
                    "and complexity of your project. Consider starting a fresh session with " +
                    "/new and running /docx there.",
                yesLabel: "Yes I understand, proceed",
                noLabel: "Exit",
            });
            if (!proceed) return;
        }

        // 2. Main confirmation.
        const confirmed = await showConfirm(ctx, {
            title: "Generate project documentation?",
            body:
                "All existing documentation (root .md files and ./docs/) will be moved to " +
                "./docx/old_docs/ and zipped to ./docx/old_docs.zip when generation completes. " +
                "Make your own backup before proceeding. Generate fresh documentation for " +
                "this project?",
            yesLabel: "Yes, proceed",
            noLabel: "No, exit",
        });
        if (!confirmed) {
            aftcConsole.emphasis(ctx, "/docx cancelled - nothing was changed.");
            return;
        }
    }

    // 3. Deterministic backup. Any error aborts BEFORE the model runs.
    let backup: DocxBackupResult;
    try {
        backup = runDocxBackup(projectRoot);
    } catch (err) {
        aftcConsole.error(
            ctx,
            `/docx backup failed: ${(err as Error).message} - generation aborted, nothing was moved.`,
        );
        return;
    }
    if (backup.errors.length > 0) {
        aftcConsole.error(
            ctx,
            `/docx backup incomplete - generation aborted:\n${backup.errors.join("\n")}`,
        );
        return;
    }
    for (const warning of backup.warnings) {
        aftcConsole.warn(ctx, warning);
    }
    if (backup.firstRun) {
        aftcConsole.emphasis(ctx, "/docx: no existing documentation found - first-time generation.");
    } else {
        aftcConsole.emphasis(
            ctx,
            `/docx: ${backup.moved.length} file(s) backed up to docx/old_docs/` +
            (backup.copied.length > 0 ? ` (${backup.copied.length} AI context file(s) copied)` : "") +
            " - zipped to docx/old_docs.zip when generation completes.",
        );
    }

    // 4. Inject the execution prompt.
    const prompt = buildDocxPrompt(projectRoot, backup);
    if (!prompt) {
        aftcConsole.error(
            ctx,
            "/docx: documentation_guide.md is missing or malformed in the extension package - cannot generate.",
        );
        return;
    }
    try {
        if (ctx.isIdle()) {
            pi.sendUserMessage(prompt);
            if (!ctx.hasUI) {
                // Print/headless mode: pi's sendUserMessage is fire-and-forget
                // and the process exits as soon as this command returns,
                // which would kill the generation turn before it starts.
                // Hold the command open: wait for the turn to start (it is
                // queued asynchronously), then for the agent to settle.
                const startDeadline = Date.now() + 10_000;
                while (ctx.isIdle() && Date.now() < startDeadline) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                await ctx.waitForIdle();
            }
        } else {
            pi.sendUserMessage(prompt, { deliverAs: "followUp" });
        }
        aftcConsole.emphasis(ctx, "/docx: generation started - follow the progress in the transcript.");
    } catch (err) {
        aftcConsole.error(ctx, `/docx: failed to start generation: ${(err as Error).message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createDocx(pi: ExtensionAPI): void {
    registerHelpEntry({
        command: "docx",
        args: "[--yes]",
        description: "Regenerate project docs into ./docx/ (old docs zipped to docx/old_docs.zip)",
        category: "General",
    });

    pi.registerCommand("docx", {
        description:
            "Regenerate the project's full documentation set into ./docx/ per the shipped documentation guide. " +
            "Existing docs are backed up to docx/old_docs.zip. --yes skips the confirmations (headless).",
        getArgumentCompletions: (prefix: string) => {
            const items = [{ value: "--yes", label: "--yes", description: "Skip confirmations (headless)" }];
            const filtered = items.filter((i) => i.value.startsWith(prefix));
            return filtered.length > 0 ? filtered : null;
        },
        handler: async (args, ctx) => {
            await handleDocx(pi, args, ctx);
        },
    });

    console.log("[aftc-toolset] loaded — /docx (project documentation generator)");
}
