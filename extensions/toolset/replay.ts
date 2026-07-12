/**
 * pi-aftc-toolset — save-and-replay prompt feature module.
 *
 * Two slash commands that let you save a prompt string and then
 * re-execute it later as if you had typed it fresh:
 *
 *   - `/save-replay-prompt <text>` — saves the text (everything after
 *     the command name) to `.pi-aftc-toolset/data/replay.json`.
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
 *   `.pi-aftc-toolset/data/replay.json` with shape
 *   `{ prompt: string, savedAt: number }`. Atomic writes (tmp + rename).
 *   Best-effort: read/write errors are logged, never thrown, so a
 *   broken state file never crashes a session.
 *
 * Self-contained feature module (rules.md §1.5):
 *   - No closure state (the file IS the state).
 *   - No event subscriptions.
 *   - No background resources.
 *   - No cross-module imports (uses `getDataDir` from paths.ts only).
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
import { getDataDir } from "./paths";

// ─────────────────────────────────────────────────────────────────────────────
// Storage — .pi-aftc-toolset/data/replay.json
// ─────────────────────────────────────────────────────────────────────────────

const REPLAY_FILENAME = "replay.json";

/** On-disk shape. `prompt` is the only required field; `savedAt` is informational. */
interface ReplayState {
    prompt: string;
    savedAt: number;
}

/** Absolute path to the replay state file. */
function getReplayFile(): string {
    return path.join(getDataDir(), REPLAY_FILENAME);
}

/**
 * Read the saved replay prompt. Returns `null` when:
 *   - the file does not exist (no save yet)
 *   - the file is unreadable (permissions / encoding error)
 *   - the file is malformed JSON
 *   - the parsed `prompt` is not a string
 *
 * Never throws. This is intentional: a broken state file must never
 * block /replay from running — at worst the user gets a "no saved
 * prompt" notification and re-saves.
 */
function loadReplay(): ReplayState | null {
    try {
        const raw = fs.readFileSync(getReplayFile(), "utf-8");
        const parsed = JSON.parse(raw) as Partial<ReplayState> | null;
        if (!parsed || typeof parsed.prompt !== "string") return null;
        return {
            prompt: parsed.prompt,
            savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
        };
    } catch {
        return null;
    }
}

/**
 * Persist the saved replay prompt. Atomic write (tmp + rename) so a
 * crash mid-write cannot leave the file half-written. Creates the
 * data directory on demand.
 *
 * Best-effort: I/O errors are logged and swallowed. Throwing would
 * block the slash command handler and leave the user with no feedback.
 */
function saveReplay(state: ReplayState): void {
    const filePath = getReplayFile();
    const dataDir = path.dirname(filePath);
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const tmpPath = filePath + ".tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        console.log(`[aftc-toolset] replay.json write error: ${(err as Error).message}`);
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
    const preview = previewPrompt(saved.prompt);

    if (idle) {
        // Idle: plain sendUserMessage fires a new turn immediately.
        pi.sendUserMessage(saved.prompt);
        if (ctx.hasUI) {
            ctx.ui.notify(`Replaying: ${preview}`, "info");
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: sent (${saved.prompt.length} chars): ${preview}`,
            );
        }
    } else {
        // Streaming: must specify deliverAs or pi throws.
        // "followUp" queues until the current turn finishes — safer
        // for a replay than "steer" (which interrupts mid-turn). Users
        // who want to interrupt should use /aftc-stop first, then
        // /replay.
        pi.sendUserMessage(saved.prompt, { deliverAs: "followUp" });
        if (ctx.hasUI) {
            ctx.ui.notify(
                `Replaying (queued as follow-up): ${preview}`,
                "info",
            );
        } else {
            console.log(
                `[aftc-toolset] /${cmdName}: queued follow-up (${saved.prompt.length} chars): ${preview}`,
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createReplay(pi: ExtensionAPI): void {
    // ---- /save-replay-prompt <text> ----
    // Trims surrounding whitespace so `/save-replay-prompt   hello   `
    // and `/save-replay-prompt hello` both store exactly "hello".
    // Empty / whitespace-only args are rejected with a headless log
    // (UI notify would be noisy if the user is just probing the cmd).
    pi.registerCommand("save-replay-prompt", {
        description:
            "Save text as a replay prompt: /save-replay-prompt <text>. Then /replay (or /r) re-sends it as a fresh user message.",
        handler: async (args: string, _ctx: ExtensionCommandContext) => {
            const trimmed = args.trim();
            if (!trimmed) {
                console.log("[aftc-toolset] /save-replay-prompt: no text provided");
                return;
            }
            saveReplay({ prompt: trimmed, savedAt: Date.now() });
            console.log(
                `[aftc-toolset] /save-replay-prompt: saved ${trimmed.length} chars`,
            );
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
