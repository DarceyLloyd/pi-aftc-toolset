/**
 * pi-aftc-toolset — aftc-resume feature module.
 *
 * Hand work off between context windows with a handoff file, so a fresh
 * session can continue without re-deriving what was already worked out.
 *
 * Two slash commands:
 *
 *   - `/aftc-resume-save` — stop current work and write `./aftc-resume.md`
 *     (goal, current state, decisions, knowledge learned, key files, tasks
 *     & progress, next steps, open questions). If an `aftc-resume.md`
 *     already exists it is FIRST renamed to `aftc-resume-<last-modified>.md`
 *     so snapshots accumulate and nothing is ever overwritten.
 *   - `/aftc-resume` — after `/new`, tells the model to read the handoff
 *     file, load the codex resources it lists (only when codex is enabled),
 *     read its key files plus the project's docx docs and AGENTS.md, then
 *     continue the work where it left off.
 *
 * Division of labour (single-writer rule):
 *   - The MODEL writes the handoff body (its work state) using its own
 *     file tools, driven by the save instruction.
 *   - The EXTENSION owns the `## Resume metadata` block at the top of the
 *     file (project, saved timestamp, codex state, status). It is merged
 *     in AFTER the agent settles, so the extension never races the model's
 *     write. Facts the model gets wrong (dates, cwd, exact codex list)
 *     live in the metadata block.
 *
 * Codex resource tracking: a `tool_call` observe-hook records every
 * `codex_load` topic call in session state; the tracked set is embedded in
 * the save instruction (when codex is enabled). Resources auto-loaded by
 * the codex feature (auto-detect pins) never pass through `codex_load`, so
 * the model is also asked to list what it loaded. At resume time the
 * instruction is emitted only when `aftcCodexEnabled` is true — the resume
 * flow NEVER depends on codex being on; key files are the fallback.
 *
 * Self-contained feature module:
 *   - Closure state: session-scoped codex-load set (cleared on session_start).
 *   - One observe-only event subscription (tool_call — never blocks).
 *   - No background resources, timers or processes.
 *   - No cross-module imports (config.ts / help-registry.ts / ui/* are
 *     shared utilities, not features).
 *
 * Wired in by the orchestrator (`index.ts`) via `createResume(pi)`.
 *
 * See `resume-readme.md` for the full contract.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";
import { getPreference } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Handoff file name, rooted at the session cwd. */
export const RESUME_FILE = "aftc-resume.md";

/** Metadata block marker (extension-owned; the model never writes it). */
const METADATA_MARKER = "## Resume metadata";

/** Cap on how long the save command waits for the model's finalize turn. */
const WAIT_TIMEOUT_MS = 120_000;

/** Minimum believable handoff size (bytes) — smaller means the write failed. */
const MIN_HANDOFF_BYTES = 150;

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE — codex_load tracking (observe-only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codex topics the model loaded via `codex_load` this session. Reset on
 * every session_start because pi keeps extension modules alive across
 * `/new` — without the reset, an old session's loads would pollute the
 * next one's handoff.
 */
const codexLoads = new Set<string>();

// ─────────────────────────────────────────────────────────────────────────────
// FILE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Absolute path of the handoff file in the given working directory. */
function resumeFilePath(cwd: string): string {
    return path.join(cwd, RESUME_FILE);
}

/** `YYYYMMDD-HHMMSS` (Windows-safe, no colons) for a snapshot name. Exported for tests. */
export function snapshotStamp(d: Date): string {
    const p = (n: number): string => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
}

/**
 * Rename an existing handoff file to `aftc-resume-<last-modified>.md`
 * (the old file's own mtime, not "now" — that is when that state was
 * last valid). Appends `-2`, `-3`, … on a same-second collision. Returns
 * the snapshot file name, or null when no existing file was present.
 */
function snapshotExisting(cwd: string): string | null {
    const file = resumeFilePath(cwd);
    let stat: fs.Stats;
    try {
        stat = fs.statSync(file);
        if (!stat.isFile()) return null;
    } catch {
        return null; // no existing handoff — nothing to snapshot
    }
    const base = `aftc-resume-${snapshotStamp(stat.mtime)}`;
    let candidate = `${base}.md`;
    let i = 2;
    while (fs.existsSync(path.join(cwd, candidate))) {
        candidate = `${base}-${i}.md`;
        i += 1;
    }
    fs.renameSync(file, path.join(cwd, candidate));
    return candidate;
}

/** Names of existing snapshot files (`aftc-resume-*.md`) in cwd, sorted. Exported for tests. */
export function listSnapshots(cwd: string): string[] {
    let names: string[] = [];
    try {
        names = fs.readdirSync(cwd);
    } catch {
        return [];
    }
    return names
        .filter((n) => /^aftc-resume-.*\.md$/.test(n) && n !== RESUME_FILE)
        .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// METADATA BLOCK (extension-owned)
// ─────────────────────────────────────────────────────────────────────────────

interface ResumeMeta {
    cwd: string;
    saved: string;
    codexEnabled: boolean;
    resources: string[];
}

/** Metadata block text (extension-owned, top of the handoff). Exported for tests. */
export function buildMetaBlock(meta: ResumeMeta): string {
    const resources = meta.codexEnabled && meta.resources.length > 0
        ? meta.resources.join(", ")
        : "(none)";
    return (
        `${METADATA_MARKER}\n\n` +
        `- project: ${meta.cwd}\n` +
        `- saved: ${meta.saved}\n` +
        `- codex enabled: ${meta.codexEnabled ? "yes" : "no"}\n` +
        `- codex resources: ${resources}\n` +
        `- status: pending\n`
    );
}

/**
 * Merge the extension-owned metadata block into the model's handoff file:
 * replace an existing `## Resume metadata` block, or prepend one. Pure
 * string function — the caller decides whether to write. Exported for tests.
 */
export function mergeMetaBlock(content: string, block: string): string {
    const idx = content.indexOf(METADATA_MARKER);
    if (idx === -1) return block + "\n" + content;
    // Block runs from the marker to the next "## " heading (or EOF).
    const rest = content.slice(idx);
    const nextHeading = rest.indexOf("\n## ");
    if (nextHeading === -1) return content.slice(0, idx) + block;
    return content.slice(0, idx) + block + content.slice(idx + nextHeading);
}

/**
 * Finalize step after the model settles: ensure the metadata block exists
 * with fresh facts, and verify the file is non-trivial. Returns a summary
 * for the command's report.
 */
function finalizeHandoff(file: string, meta: ResumeMeta): { wrote: boolean; size: number } {
    let content: string | null = null;
    try {
        content = fs.readFileSync(file, "utf8");
    } catch {
        content = null;
    }

    const block = buildMetaBlock(meta);

    if (content === null) {
        // The model never wrote the file (aborted finalize / tool failure).
        // Write a minimal metadata-only handoff so the resume flow still
        // has a file to find — the work-state body is lost, but the
        // metadata tells the next session what happened.
        const minimal =
            `${block}\n` +
            `## Note\n\n` +
            `The finalize instruction did not complete and the model did not write a handoff. ` +
            `No work state was captured beyond the metadata above.\n`;
        fs.writeFileSync(file, minimal, "utf8");
        return { wrote: false, size: Buffer.byteLength(minimal, "utf8") };
    }

    const merged = mergeMetaBlock(content, block);
    if (merged !== content) fs.writeFileSync(file, merged, "utf8");
    return { wrote: true, size: Buffer.byteLength(merged, "utf8") };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The save instruction sent to the model. The model stops, writes the
 * handoff (its work state), confirms with one line, and stops.
 * Exported for tests.
 */
export function buildSavePrompt(cwd: string, codexEnabled: boolean, resources: string[]): string {
    const codexSection = codexEnabled
        ? `\n## Codex Resources\nList the codex resources (codex_load topics) you loaded this session` +
          (resources.length > 0 ? ` — loaded this session: ${resources.join(", ")}` : "") +
          ".\n"
        : "";
    return (
        `Stop your current work and save a handoff file so the work can continue in a fresh session. ` +
        `The previous handoff (if any) was already renamed to a timestamped snapshot by the toolset. ` +
        `Do not write a "## Resume metadata" section — the toolset adds it after you finish. ` +
        `Keep the file under ~15 KB: be specific enough that a fresh session can continue without re-deriving anything.\n\n` +
        `Write ./aftc-resume.md in this project (cwd: ${cwd}) with exactly these sections:\n\n` +
        `## Goal\nWhat the overall goal is.\n\n` +
        `## Current State\nWhat has been done, what exists now, where things stand.\n\n` +
        `## Decisions Made\nImportant decisions and why (so they are not re-litigated).\n\n` +
        `## Knowledge Learned\nGotchas, discoveries, working patterns — anything worked out that should not be worked out again.\n\n` +
        `## Key Files\nThe files most relevant to the work — a fresh session should read these first.\n\n` +
        `## Tasks & Progress\nRemaining tasks. If you are following a tasks.md (or plan.md), summarise progress against it and reference it.\n\n` +
        `## Next Steps\nExactly what to do first on resume, in order.\n\n` +
        `## Open Questions\nAnything unresolved.\n` +
        codexSection +
        `\nAfter writing the file, reply with ONE short line confirming it (eg "State saved to aftc-resume.md"), then STOP. Do not continue the work.`
    );
}

/**
 * The resume instruction sent to the model after `/new`. Conditional
 * parts (codex loads, docx docs) are computed at resume time — the file
 * path is always read first, so the flow works with codex on or off.
 * Exported for tests.
 */
export function buildResumePrompt(cwd: string, codexEnabled: boolean): string {
    const docxParts: string[] = [];
    if (fs.existsSync(path.join(cwd, "docx", "project_documentation.md"))) {
        docxParts.push("project_documentation.md");
    }
    if (fs.existsSync(path.join(cwd, "docx", "project_map.md"))) {
        docxParts.push("project_map.md");
    }
    // Existence-checked, but when listed the file MUST be read — both docx
    // docs are named explicitly so a model cannot skip one of them.
    const docxLine =
        docxParts.length === 0
            ? ""
            : docxParts.length === 1
              ? `\n   - This project has docx documentation — read docx/${docxParts[0]} before resuming (the file exists).`
              : `\n   - This project has docx documentation — read BOTH docx/${docxParts[0]} and docx/${docxParts[1]} before resuming (both exist).`;
    const codexLine = codexEnabled
        ? `\n   - If the file lists codex resources, load them with codex_load (skip any already loaded in this session).`
        : "";

    return (
        `A previous work session saved its state in ./aftc-resume.md (this project).\n\n` +
        `1. Read ./aftc-resume.md first.\n` +
        `2. Before starting work, do ALL of the following:\n` +
        `   - Read the files listed under "Key Files".` +
        codexLine +
        docxLine +
        `\n   - Re-read and acknowledge the AGENTS.md project rules (and CLAUDE.md if present) before starting.` +
        `\n3. Restate the goal and the next steps from the file, then continue the work where it left off.` +
        `\n4. If the work in the file is already complete, or you are starting a different task, tell the user and skip the resume.` +
        `\n5. When the work described in the file is fully complete, update the file's "status" line under "## Resume metadata" to "completed".`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY + WAIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send the instruction as a user message, queued when the agent is busy,
 * and (for the save flow) wait for the agent to settle so the handoff can
 * be verified. Returns "settled" | "timeout".
 */
async function sendAndWaitForSettle(
    pi: ExtensionAPI,
    ctx: ExtensionCommandContext,
    text: string,
): Promise<"settled" | "timeout"> {
    if (ctx.isIdle ? ctx.isIdle() : true) {
        pi.sendUserMessage(text);
    } else {
        pi.sendUserMessage(text, { deliverAs: "followUp" });
    }

    const timeout = new Promise<"timeout">((resolve) => {
        const t = setTimeout(() => resolve("timeout"), WAIT_TIMEOUT_MS);
        t.unref?.();
    });
    const settled = (async (): Promise<"settled"> => {
        try {
            await ctx.waitForIdle();
        } catch {
            // stale ctx / aborted — treat as settled so the save flow can
            // still verify what landed on disk.
        }
        return "settled";
    })();
    return Promise.race([settled, timeout]);
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `/aftc-resume-save` — snapshot any existing handoff, instruct the model
 * to write the new one, wait for it to settle, then merge the metadata
 * block and verify.
 */
async function handleSave(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
    const cwd = ctx.cwd;
    const snapshot = snapshotExisting(cwd);
    const codexEnabled = getPreference("aftcCodexEnabled", false);
    const resources = codexEnabled ? [...codexLoads] : [];

    if (snapshot) {
        aftcConsole.log(`aftc-resume: snapshotted existing handoff -> ${snapshot}`);
    }

    const prompt = buildSavePrompt(cwd, codexEnabled, resources);
    const outcome = await sendAndWaitForSettle(pi, ctx, prompt);

    if (outcome === "timeout") {
        if (ctx.hasUI) {
            aftcConsole.warn(
                ctx,
                "Timed out waiting for the model to finish saving — check aftc-resume.md manually.",
            );
        } else {
            console.log(
                "[aftc-toolset] /aftc-resume-save: timed out waiting for the model — check aftc-resume.md manually",
            );
        }
        return;
    }

    const file = resumeFilePath(cwd);
    const result = finalizeHandoff(file, {
        cwd,
        saved: new Date().toISOString(),
        codexEnabled,
        resources,
    });

    if (ctx.hasUI) {
        if (result.wrote && result.size >= MIN_HANDOFF_BYTES) {
            aftcConsole.emphasis(
                ctx,
                `Work state saved to ${RESUME_FILE}` +
                    (snapshot ? ` (previous handoff kept as ${snapshot})` : "") +
                    `. Run /new then /aftc-resume to continue in a fresh window.`,
            );
        } else if (result.wrote) {
            aftcConsole.warn(
                ctx,
                `${RESUME_FILE} looks empty — the model may not have completed the save. Check the file before resuming.`,
            );
        } else {
            aftcConsole.warn(
                ctx,
                "The model did not write the handoff — a minimal state file was created instead. Resume with caution.",
            );
        }
    } else {
        console.log(
            `[aftc-toolset] /aftc-resume-save: ${result.wrote ? "saved" : "minimal file written"} ` +
                `${RESUME_FILE} (${result.size} bytes)` +
                (snapshot ? `, snapshot ${snapshot}` : ""),
        );
    }
}

/**
 * `/aftc-resume` — kick the model off on the handoff: read the file,
 * load codex resources (codex on), read key files + docx docs + AGENTS.md,
 * then continue. Fire-and-forget — the model takes over from here.
 */
async function handleResume(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
    const cwd = ctx.cwd;
    const file = resumeFilePath(cwd);
    if (!fs.existsSync(file)) {
        const snapshots = listSnapshots(cwd);
        const hint =
            snapshots.length > 0
                ? ` No handoff file found, but snapshots exist: ${snapshots.join(", ")}.`
                : "";
        if (ctx.hasUI) {
            aftcConsole.warn(
                ctx,
                `No ${RESUME_FILE} found in this project — run /aftc-resume-save before /new first.` + hint,
            );
        } else {
            console.log(
                `[aftc-toolset] /aftc-resume: no ${RESUME_FILE} in ${cwd}` +
                    (snapshots.length > 0 ? ` (snapshots: ${snapshots.join(", ")})` : ""),
            );
        }
        return;
    }

    const codexEnabled = getPreference("aftcCodexEnabled", false);
    const prompt = buildResumePrompt(cwd, codexEnabled);
    if (ctx.isIdle ? ctx.isIdle() : true) {
        pi.sendUserMessage(prompt);
    } else {
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    }

    if (ctx.hasUI) {
        aftcConsole.emphasis(ctx, `Resume instruction sent — the model will read ${RESUME_FILE} and continue.`);
    } else {
        console.log(`[aftc-toolset] /aftc-resume: resume instruction sent`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register the two aftc-resume commands, the observe-only codex_load
 * tracker, and the per-session state reset.
 *
 * @param pi  The `ExtensionAPI` instance handed to the extension factory.
 */
export function createResume(pi: ExtensionAPI): void {
    // Session-scoped state: reset the codex-load tracker whenever a
    // session starts (pi keeps the module alive across /new).
    pi.on("session_start", async () => {
        codexLoads.clear();
    });

    // Observe-only: record codex_load topics so the save flow can embed
    // the exact list. Never blocks, never mutates.
    pi.on("tool_call", async (event) => {
        if (event.toolName !== "codex_load") return;
        const topic = (event.input as { topic?: unknown } | undefined)?.topic;
        if (typeof topic === "string" && topic.length > 0) {
            codexLoads.add(topic);
        }
    });

    // ---- /aftc-resume-save ----
    registerHelpEntry({
        command: "aftc-resume-save",
        description:
            "Save the current work state to aftc-resume.md (an existing file is kept as a timestamped snapshot) so a fresh session can continue the work",
        category: "General",
    });

    pi.registerCommand("aftc-resume-save", {
        description:
            "Stop current work and write ./aftc-resume.md (handoff file). An existing aftc-resume.md is first renamed to a timestamped snapshot.",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            try {
                await handleSave(pi, ctx);
            } catch (err) {
                aftcConsole.logError(`aftc-resume-save: ${(err as Error).message}`);
                if (ctx.hasUI) {
                    aftcConsole.error(ctx, "Could not save the work state — see the debug log.");
                }
            }
        },
    });

    // ---- /aftc-resume ----
    registerHelpEntry({
        command: "aftc-resume",
        description:
            "Resume work from the saved aftc-resume.md handoff: read the file, load its codex resources and key files, then continue",
        category: "General",
    });

    pi.registerCommand("aftc-resume", {
        description:
            "Tell the model to read ./aftc-resume.md and continue the saved work (run after /new).",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            try {
                await handleResume(pi, ctx);
            } catch (err) {
                aftcConsole.logError(`aftc-resume: ${(err as Error).message}`);
                if (ctx.hasUI) {
                    aftcConsole.error(ctx, "Could not send the resume instruction — see the debug log.");
                }
            }
        },
    });

    aftcConsole.log(
        "loaded — /aftc-resume-save, /aftc-resume (hand work off between context windows via aftc-resume.md)",
    );
}
