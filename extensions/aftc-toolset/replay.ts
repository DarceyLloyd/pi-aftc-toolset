/**
 * pi-aftc-toolset — save-and-replay prompt feature module.
 *
 * Two slash commands that let you save a prompt string and then
 * re-execute it later as if you had typed it fresh:
 *
 *   - `/save-replay-prompt <text>` — saves the text (everything after
 *     the command name) in config.json (persistent data dir).
 *     Persists across /reload, /new, session resume, and machine
 *     reboot. Single-line only — slash commands receive a single args
 *     string after the command name.
 *   - `/replay` — re-sends the saved prompt as a fresh user message
 *     via `pi.sendUserMessage(...)`. When the agent is idle this
 *     fires a new turn immediately. When the agent is busy it is
 *     queued with `deliverAs: "followUp"` so the in-flight turn is
 *     not interrupted.
 *
 * Storage:
 *   The `replayPrompt` field in config.json (via getPreference/setPreference).
 *   Previously stored in replay.json — a one-time migration copies the
 *   value forward and deletes the old file.
 *
 * Self-contained feature module:
 *   - No closure state (config.json is the saved prompt state).
 *   - One context handler keeps visual confirmation messages out of the model context.
 *   - No background resources.
 *
 * Wired in by the orchestrator (`index.ts`) via `createReplay(pi)`.
 *
 * See `replay-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";
import type {
    ExtensionAPI,
    ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getPreference, setPreference } from "./config";
import { getDataDir } from "./paths";

const REPLAY_SAVED_MESSAGE_TYPE = "aftc-replay-saved";
const REPLAY_SAVED_MESSAGE = "pi-aftc-toolset: replay prompt saved";
const REPLAY_EMPTY_ENTRY_TYPE = "aftc-replay-empty";

// ---------------------------------------------------------------------------
// One-time migration: replay.json -> config.json
// ---------------------------------------------------------------------------

let migrationDone = false;

/** Migrate a legacy replay.json value into config.json, then delete the file. */
function migrateReplayJson(): void {
    if (migrationDone) return;
    migrationDone = true;

    // If config already has a non-empty value, just clean up the old file.
    const existing = getPreference("replayPrompt", "");
    const replayFile = path.join(getDataDir(), "replay.json");

    try {
        if (!fs.existsSync(replayFile)) return;
        const data = JSON.parse(fs.readFileSync(replayFile, "utf8")) as { prompt?: unknown };
        if (!existing && typeof data.prompt === "string" && data.prompt.length > 0) {
            setPreference("replayPrompt", data.prompt);
        }
    } catch {
        // Corrupt/unreadable — ignore, just delete below.
    }

    // Remove the old file regardless (it's no longer used).
    try { fs.unlinkSync(replayFile); } catch { /* locked or missing — ignore */ }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Truncate a prompt for safe notification display. Adds an ellipsis on cut. */
function previewPrompt(prompt: string, max = 80): string {
    if (prompt.length <= max) return prompt;
    return prompt.slice(0, max) + "\u2026";
}

// ---------------------------------------------------------------------------
// Handler — shared by /replay and /r
// ---------------------------------------------------------------------------

const REPLAY_DESCRIPTION =
    "Re-execute the saved /save-replay-prompt string as a fresh user message.";

const R_DESCRIPTION =
    "Short alias for /replay — same action, fewer keystrokes.";

async function handleReplay(
    cmdName: string,
    pi: ExtensionAPI,
    _args: string,
    ctx: ExtensionCommandContext,
): Promise<void> {
    migrateReplayJson();

    const saved = getPreference("replayPrompt", "");
    if (!saved) {
        if (ctx.hasUI) {
            pi.appendEntry(REPLAY_EMPTY_ENTRY_TYPE, {});
        } else {
            console.log(`[aftc-toolset] /${cmdName}: no saved prompt`);
        }
        return;
    }

    const idle = ctx.isIdle ? ctx.isIdle() : true;
    const preview = previewPrompt(saved);

    if (idle) {
        pi.sendUserMessage(saved);
        if (ctx.hasUI) {
            aftcConsole.emphasis(ctx, `Replaying: ${preview}`);
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: sent (${saved.length} chars): ${preview}`,
            );
        }
    } else {
        pi.sendUserMessage(saved, { deliverAs: "followUp" });
        if (ctx.hasUI) {
            aftcConsole.emphasis(ctx, `Replaying (queued as follow-up): ${preview}`);
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: queued follow-up (${saved.length} chars): ${preview}`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// PUBLIC FACTORY — wired by the orchestrator (index.ts)
// ---------------------------------------------------------------------------

export function createReplay(pi: ExtensionAPI): void {
    // Run migration eagerly at load time so the value is available immediately.
    migrateReplayJson();

    pi.registerMessageRenderer(REPLAY_SAVED_MESSAGE_TYPE, (message, _options, theme) => {
        return new Text(theme.fg("success", message.content), 0, 0);
    });

    pi.registerEntryRenderer(REPLAY_EMPTY_ENTRY_TYPE, (_entry, _options, theme) => {
        return new Text(
            theme.fg("warning", "No replay command found, set one via /save-replay-prompt <text>"),
            0, 0,
        );
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
    registerHelpEntry({
        command: "save-replay-prompt",
        args: "<text>",
        description: "Save a prompt string for later replay",
        category: "Replay",
    });

    pi.registerCommand("save-replay-prompt", {
        description:
            "Save text as a replay prompt: /save-replay-prompt <text>. Then /replay (or /r) re-sends it as a fresh user message.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const trimmed = args.trim();
            if (!trimmed) {
                console.log("[aftc-toolset] /save-replay-prompt: no text provided");
                return;
            }
            setPreference("replayPrompt", trimmed);
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
    registerHelpEntry({
        command: "replay",
        description: "Re-send the saved prompt",
        category: "Replay",
        aliases: ["r"],
    });

    pi.registerCommand("replay", {
        description: REPLAY_DESCRIPTION,
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            await handleReplay("replay", pi, args, ctx);
        },
    });

    // ---- /r ----
    pi.registerCommand("r", {
        description: R_DESCRIPTION,
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            await handleReplay("r", pi, args, ctx);
        },
    });

    aftcConsole.log("loaded — /save-replay-prompt, /replay, /r (save and re-send a prompt string)");
}
