/**
 * pi-aftc-toolset — save-and-replay prompt feature module.
 *
 * Two slash commands that let you save a prompt string and then
 * re-execute it later as if you had typed it fresh:
 *
 *   - `/save-replay-prompt <text>` — saves the text (everything after
 *     the command name) in `.pi-aftc-toolset/data/replay.json`.
 *     Persists across /reload, /new, session resume, and machine
 *     reboot. Single-line only — slash commands receive a single args
 *     string after the command name. Newlines are not supported by
 *     the slash-command input.
 *   - `/replay` — re-sends the saved prompt as a fresh user message
 *     via `pi.sendUserMessage(...)`. When the agent is idle this
 *     fires a new turn immediately. When the agent is busy it is
 *     queued with `deliverAs: "followUp"` so the in-flight turn is
 *     not interrupted.
 *
 * Storage:
 *   The `prompt` field in `.pi-aftc-toolset/data/replay.json`.
 *   Writes are atomic and best-effort, so a broken replay file never
 *   crashes a session.
 *
 * Self-contained feature module:
 *   - No closure state (the file is the saved prompt state).
 *   - One context handler keeps visual confirmation messages out of the model context.
 *   - No background resources.
 *   - Uses the shared data-directory path helper.
 *
 * Wired in by the orchestrator (`index.ts`) via `createReplay(pi)`.
 *
 * See `replay.readme.md` for the full contract (commands, behaviour
 * matrix, failure modes, design notes).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
    ExtensionAPI,
    ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getConfigJson, getReplayJson } from "./paths";

const REPLAY_SAVED_MESSAGE_TYPE = "aftc-replay-saved";
const REPLAY_SAVED_MESSAGE = "pi-aftc-toolset: replay prompt saved";
function writeReplayFile(prompt: string): void {
    const replayFile = getReplayJson();
    const directory = path.dirname(replayFile);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryFile = `${replayFile}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify({ prompt }, null, 2), "utf8");
    fs.renameSync(temporaryFile, replayFile);
}

/** Read replay.json, migrating a legacy state.json value when necessary. */
function loadReplay(): string | null {
    try {
        const replay = JSON.parse(fs.readFileSync(getReplayJson(), "utf8")) as { prompt?: unknown };
        return typeof replay.prompt === "string" && replay.prompt.length > 0 ? replay.prompt : null;
    } catch {
        // Continue with one-time state.json migration below.
    }

    try {
        const stateFile = getConfigJson();
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>;
        const prompt = state.replayPrompt;
        if (typeof prompt !== "string" || prompt.length === 0) return null;
        writeReplayFile(prompt);
        delete state.replayPrompt;
        const temporaryFile = `${stateFile}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), "utf8");
        fs.renameSync(temporaryFile, stateFile);
        return prompt;
    } catch {
        return null;
    }
}

/** Persist the saved replay prompt in replay.json. */
function saveReplay(prompt: string): void {
    try {
        writeReplayFile(prompt);
    } catch (error) {
        console.log(`[aftc-toolset] replay save error: ${(error as Error).message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Truncate a prompt for safe notification display. Adds an ellipsis on cut. */
function previewPrompt(prompt: string, max = 80): string {
    if (prompt.length <= max) return prompt;
    return prompt.slice(0, max) + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Handler — shared by /replay and /r so the alias is always in lockstep.
// Takes the command name for the headless log so the user can see which
// alias they actually fired (useful when both are muscle-memory).
// ─────────────────────────────────────────────────────────────────────────────

const REPLAY_DESCRIPTION =
    "Re-execute the saved /save-replay-prompt string as a fresh user message.";

const R_DESCRIPTION =
    "Short alias for /replay — same action, fewer keystrokes.";

/**
 * Shared handler for `/replay` and `/r`.
 *
 * Reads the saved prompt, decides between immediate and queued delivery
 * based on whether the agent is currently busy, and notifies (or logs)
 * what it just did so the user always gets feedback that the command
 * fired.
 */
async function handleReplay(
    cmdName: string,
    pi: ExtensionAPI,
    _args: string,
    ctx: ExtensionCommandContext,
): Promise<void> {
    const saved = loadReplay();
    if (!saved) {
        if (ctx.hasUI) {
            ctx.ui.notify(
                "No saved replay prompt — use /save-replay-prompt <text> first.",
                "warning",
            );
        } else {
            console.log(`[aftc-toolset] /${cmdName}: no saved prompt`);
        }
        return;
    }

    const idle = ctx.isIdle ? ctx.isIdle() : true;
    const preview = previewPrompt(saved);

    if (idle) {
        // Idle: plain sendUserMessage fires a new turn immediately.
        pi.sendUserMessage(saved);
        if (ctx.hasUI) {
            ctx.ui.notify(`Replaying: ${preview}`, "info");
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: sent (${saved.length} chars): ${preview}`,
            );
        }
    } else {
        // Streaming: must specify deliverAs or pi throws.
        // "followUp" queues until the current turn finishes — safer
        // for a replay than "steer" (which interrupts mid-turn). Users
        // who want to interrupt should use /aftc-stop first, then
        // /replay.
        pi.sendUserMessage(saved, { deliverAs: "followUp" });
        if (ctx.hasUI) {
            ctx.ui.notify(
                `Replaying (queued as follow-up): ${preview}`,
                "info",
            );
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: queued follow-up (${saved.length} chars): ${preview}`,
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createReplay(pi: ExtensionAPI): void {
    pi.registerMessageRenderer(REPLAY_SAVED_MESSAGE_TYPE, (message, _options, theme) => {
        return new Text(theme.fg("success", message.content), 0, 0);
    });

    // Keep visual save confirmations in the session history but out of the
    // model-visible conversation context.
    pi.on("context", async (event) => {
        const messages = event.messages.filter(
            (message) =>
                message.role !== "custom" ||
                message.customType !== REPLAY_SAVED_MESSAGE_TYPE,
        );
        return messages.length === event.messages.length ? undefined : { messages };
    });

    // ---- /save-replay-prompt <text> ----
    // Trims surrounding whitespace so `/save-replay-prompt   hello   `
    // and `/save-replay-prompt hello` both store exactly "hello".
    // Empty / whitespace-only args are rejected with a headless log
    // (a persisted confirmation would be misleading).
    pi.registerCommand("save-replay-prompt", {
        description:
            "Save text as a replay prompt: /save-replay-prompt <text>. Then /replay (or /r) re-sends it as a fresh user message.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const trimmed = args.trim();
            if (!trimmed) {
                console.log("[aftc-toolset] /save-replay-prompt: no text provided");
                return;
            }
            saveReplay(trimmed);
            if (ctx.hasUI) {
                pi.sendMessage({
                    customType: REPLAY_SAVED_MESSAGE_TYPE,
                    content: REPLAY_SAVED_MESSAGE,
                    display: true,
                });
            } else {
                console.log(`[aftc-toolset] ${REPLAY_SAVED_MESSAGE}`);
            }
        },
    });

    // ---- /replay ----
    // Full namespaced name. The autocomplete-friendly version.
    pi.registerCommand("replay", {
        description: REPLAY_DESCRIPTION,
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            await handleReplay("replay", pi, args, ctx);
        },
    });

    // ---- /r ----
    // Short alias for /replay. Same handler so behaviour is always
    // in lockstep — see the stfu.ts / aftc-stop pattern.
    pi.registerCommand("r", {
        description: R_DESCRIPTION,
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            await handleReplay("r", pi, args, ctx);
        },
    });

    console.log(
        "[aftc-toolset] loaded — /save-replay-prompt, /replay, /r (save and re-send a prompt string)",
    );
}
