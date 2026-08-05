/**
 * pi-aftc-toolset -- audio notification feature module.
 *
 * Plays an MP3 sound when:
 *   1. A task completes (agent_settled) and its duration exceeds a
 *      configurable threshold (/aftc-notify-time, default 1 s).
 *   2. The AI asks the user a question via the ask_user_question tool
 *      (plays immediately regardless of duration).
 *   3. The agent ends with a provider/network error (stopReason "error").
 *   4. The user aborts the agent (stopReason "aborted").
 *   5. Context-window usage crosses 25%, 50% or 75% (checked on each
 *      assistant message_end via ctx.getContextUsage().percent; a threshold
 *      fires once on the upward crossing and re-arms when usage drops back
 *      below it, e.g. after compaction).
 *
 * The AI model is completely unaware of this feature. Detection is
 * pure TypeScript-side event handling -- no model tool, no prompt
 * snippet, no prompt guidelines.
 *
 * Playback uses a bundled miniaudio-based binary (public domain /
 * MIT-0, zero distribution obligations). The binary is spawned
 * detached: no window, no blocking, self-exits when the track ends.
 *
 * ---------------------------------------------------------------------------
 * SLASH COMMANDS
 * ---------------------------------------------------------------------------
 *   /aftc-audio-notifications  Open a menu to pick sounds for question,
 *                             task-complete, error, aborted and context-
 *                             window 25/50/75% (MP3s in
 *                             data/aftc-audio-notifications/{question,
 *                             task-complete,error,aborted,context-window/{25,50,75}}/).
 *                             Stores filenames in config.json.
 *                             Alias: /aftc-notifications
 *   /aftc-notify-time [sec]   Show or set the minimum task duration (in
 *                             seconds) before the completion sound plays.
 *                             0 disables time-based notification.
 *
 * ---------------------------------------------------------------------------
 * CONFIG (config.json via Preferences)
 * ---------------------------------------------------------------------------
 *   notifySoundQuestion       string   Filename in data/aftc-audio-notifications/question/ or "" for none.
 *   notifySoundTaskComplete   string   Filename in data/aftc-audio-notifications/task-complete/ or "" for none.
 *   notifySoundError          string   Filename in data/aftc-audio-notifications/error/ or "" for none.
 *   notifySoundAborted        string   Filename in data/aftc-audio-notifications/aborted/ or "" for none.
 *   notifySoundContext25/50/75 string  Filenames in data/aftc-audio-notifications/context-window/{25,50,75}/
 *                                      or "" for none.
 *   notifyTimeSec             number   Threshold in seconds (default 1; owner = DEFAULT_PREFERENCES in config.ts).
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE
 * ---------------------------------------------------------------------------
 * Self-contained feature module. No cross-module imports except config
 * and the AFTC UI leaf utility. Wired by the orchestrator (index.ts)
 * via createNotify(pi).
 *
 * See `notify-readme.md` for the full contract.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";
import * as fs from "node:fs";
import * as path from "node:path";
import { getPreference, setPreference } from "./config";
import { showMenu } from "./ui/aftc-ui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[aftc-toolset] notify:";

/** Notification sound categories that can play. */
type NotifyKind =
    | "question" | "task" | "error" | "aborted" | "startup"
    | "context25" | "context50" | "context75";

/** Context-window usage thresholds that can play a sound (ascending). */
const CONTEXT_THRESHOLDS: ReadonlyArray<{ pct: number; kind: NotifyKind }> = [
    { pct: 25, kind: "context25" },
    { pct: 50, kind: "context50" },
    { pct: 75, kind: "context75" },
];

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Directory containing the user's MP3 notification sounds. */
function getAudioDir(): string {
    return path.join(__dirname, "data", "aftc-audio-notifications");
}

/** Directory containing the platform player binaries. */
function getBinDir(): string {
    return path.join(__dirname, "bin");
}

/**
 * Resolve the platform-specific play_sound binary.
 * Returns null when no binary exists for this platform/arch.
 */
function getPlayerBinary(): string | null {
    let name: string;
    if (process.platform === "win32") {
        name = "play_sound-win-x64.exe";
    } else if (process.platform === "darwin") {
        name = process.arch === "arm64"
            ? "play_sound-macos-arm64"
            : "play_sound-macos-x64";
    } else if (process.platform === "linux") {
        name = "play_sound-linux-x64";
    } else {
        return null;
    }
    const binPath = path.join(getBinDir(), name);
    return fs.existsSync(binPath) ? binPath : null;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/** Tracks the last preview playback so browsing the picker kills the
 *  previous sound before starting the next one. */
let previewChild: ReturnType<typeof spawn> | null = null;

/**
 * Kill a spawned child AND its entire process tree. POSIX spawns
 * here are detached (session leaders), so `child.kill()` only sends
 * a signal to the (already-detached) parent and the audio binary
 * keeps playing. Use `process.kill(-pid, "SIGTERM")` to kill the
 * whole process group. On Windows, `taskkill /T /F`.
 */
function killPreviewTree(child: ReturnType<typeof spawn>): void {
    if (child.pid == null) {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        return;
    }
    if (process.platform === "win32") {
        try {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                stdio: "ignore",
                windowsHide: true,
            });
        } catch {
            try { child.kill("SIGTERM"); } catch { /* ignore */ }
        }
    } else {
        try { process.kill(-child.pid, "SIGTERM"); }
        catch { try { child.kill("SIGTERM"); } catch { /* ignore */ } }
    }
}

/** Test hook (tests/notify-check): observe playback instead of spawning
 *  the audio binary. Pass null to restore real playback. */
let playOverride: ((audioFilePath: string) => void) | null = null;
export function _setPlayOverrideForTests(fn: ((audioFilePath: string) => void) | null): void {
    playOverride = fn;
}

/**
 * Play an audio file using the bundled miniaudio binary.
 * Fire-and-forget: spawns detached, no window, process self-exits
 * when playback finishes. Errors are logged and swallowed.
 */
function playSound(audioFilePath: string): void {
    if (playOverride) {
        playOverride(audioFilePath);
        return;
    }
    const bin = getPlayerBinary();
    if (!bin) {
        console.log(`${LOG_PREFIX} no player binary for ${process.platform}/${process.arch}`);
        return;
    }
    if (!fs.existsSync(audioFilePath)) {
        console.log(`${LOG_PREFIX} audio file not found: ${audioFilePath}`);
        return;
    }
    try {
        const child = spawn(bin, [audioFilePath], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
        });
        child.unref();
    } catch (err) {
        console.log(`${LOG_PREFIX} spawn error: ${(err as Error).message}`);
    }
}

/**
 * Play a preview sound (picker browsing). Kills the previous preview
 * first so sounds don't overlap during navigation. The kill uses
 * the process-group tree (POSIX) or taskkill /T (Windows) so the
 * detached audio binary actually stops.
 */
function playPreview(audioFilePath: string): void {
    if (previewChild) {
        killPreviewTree(previewChild);
        previewChild = null;
    }
    const bin = getPlayerBinary();
    if (!bin || !fs.existsSync(audioFilePath)) return;
    try {
        previewChild = spawn(bin, [audioFilePath], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
        });
        previewChild.unref();
    } catch {
        previewChild = null;
    }
}

/**
 * Play the configured notification sound for a category (if any).
 * Resolves the filename from config to an absolute path in the
 * category's subfolder under the audio dir.
 */
function playConfiguredSound(kind: NotifyKind): void {
    // Feature on/off switch: audio notifications are OFF by default; nothing
    // plays until the user enables the feature in /aftc-audio-notifications.
    if (!getPreference("notifyEnabled", false)) return;
    const prefMap: Record<string, string> = {
        question: "notifySoundQuestion",
        task: "notifySoundTaskComplete",
        error: "notifySoundError",
        aborted: "notifySoundAborted",
        startup: "notifySoundStartup",
        context25: "notifySoundContext25",
        context50: "notifySoundContext50",
        context75: "notifySoundContext75",
    };
    const dirMap: Record<string, string> = {
        question: "question",
        task: "task-complete",
        error: "error",
        aborted: "aborted",
        startup: "startup",
        context25: path.join("context-window", "25"),
        context50: path.join("context-window", "50"),
        context75: path.join("context-window", "75"),
    };
    const soundFile = getPreference(prefMap[kind], "");
    if (!soundFile) return;
    playSound(path.join(getAudioDir(), dirMap[kind], soundFile));
}

// ---------------------------------------------------------------------------
// Audio file discovery
// ---------------------------------------------------------------------------

/** List .mp3 files in an audio-dir subfolder (filenames only, sorted). */
function listAudioFiles(subfolder: string): string[] {
    const dir = path.join(getAudioDir(), subfolder);
    try {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter((f) => f.toLowerCase().endsWith(".mp3"))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    } catch {
        return [];
    }
}

/** Display name for a sound file: drop .mp3, turn - and _ into spaces. */
function prettySoundLabel(filename: string): string {
    return filename
        .replace(/\.mp3$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
}

// ---------------------------------------------------------------------------
// PUBLIC FACTORY -- wired by the orchestrator (index.ts)
// ---------------------------------------------------------------------------

export function createNotify(pi: ExtensionAPI): void {
    // -- Per-task state (reset on each agent run) -------------------------
    let taskStartMs = 0;
    let questionAsked = false;
    let lastStopReason: string | undefined;
    // Context-window threshold state: true = usage is currently above that
    // threshold (it has fired and stays silent until usage drops back below).
    const contextCrossed: Record<number, boolean> = { 25: false, 50: false, 75: false };

    // -- Context-window threshold check (assistant message_end) -----------
    // Reads pi's own context-usage estimate and fires the configured sound
    // for each threshold on the UPWARD crossing only; a threshold re-arms
    // when usage drops back below it (e.g. after compaction). When one
    // message crosses several thresholds at once, only the HIGHEST newly-
    // crossed threshold plays (a 20% -> 80% jump plays the 75% sound, not
    // all three), while every crossed threshold is marked so none re-fires
    // while usage stays above it.
    function checkContextThresholds(ctx: { getContextUsage?: () => { percent?: number | null } | null }): void {
        if (!getPreference("notifyEnabled", false)) return;
        const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : null;
        const pct = usage && typeof usage.percent === "number" && Number.isFinite(usage.percent)
            ? usage.percent
            : null;
        if (pct === null) return;
        let highestNew: NotifyKind | null = null;
        for (const t of CONTEXT_THRESHOLDS) {
            if (pct >= t.pct) {
                if (!contextCrossed[t.pct]) {
                    contextCrossed[t.pct] = true;
                    highestNew = t.kind; // ascending order: last one wins
                }
            } else {
                contextCrossed[t.pct] = false; // dropped back below: re-arm
            }
        }
        if (highestNew) playConfiguredSound(highestNew);
    }


    // -- Event: startup sound on fresh session start ----------------------
    pi.on("session_start", async (event) => {
        contextCrossed[25] = contextCrossed[50] = contextCrossed[75] = false;
        if (event.reason === "startup" || event.reason === "new") {
            playConfiguredSound("startup");
        }
    });
    // -- Event: track when the agent starts a task -----------------------
    pi.on("agent_start", async () => {
        // Only record the FIRST agent_start in a sequence (retries fire
        // additional agent_start events before the single agent_settled).
        if (taskStartMs === 0) {
            taskStartMs = Date.now();
            questionAsked = false;
            lastStopReason = undefined;
        }
    });

    // -- Event: detect ask_user_question tool calls ----------------------
    pi.on("tool_call", async (event) => {
        if (event.toolName === "ask_user_question") {
            questionAsked = true;
            // Play immediately -- the agent is about to block waiting
            // for user input, so agent_settled won't fire until the
            // user answers.
            playConfiguredSound("question");
        }
    });

    // -- Event: track the last assistant message stopReason ---------------
    // When the assistant turn ends with an error or abort, also reset
    // the per-task state so the next agent_start is guaranteed to start
    // fresh. agent_settled normally resets taskStartMs, but if the
    // pipeline skips that hop (e.g. a crashed provider that fires
    // message_end with an error but never reaches agent_settled) the
    // next task would compute its duration against the failed
    // timestamp - the B-005 bug. Resetting here is the safety net.
    pi.on("message_end", async (event, ctx) => {
        if (event.message.role === "assistant") {
            lastStopReason = (event.message as any).stopReason;
            if (lastStopReason === "error" || lastStopReason === "aborted") {
                taskStartMs = 0;
                questionAsked = false;
            }
            checkContextThresholds(ctx);
        }
    });

    // -- Event: task completed / errored / aborted -------------------------
    pi.on("agent_settled", async () => {
        if (taskStartMs === 0) return;
        const durationSec = (Date.now() - taskStartMs) / 1000;
        taskStartMs = 0;

        // Skip if the question notification already played for this run.
        if (questionAsked) return;

        // Error or abort: play immediately (no time threshold).
        if (lastStopReason === "error") {
            playConfiguredSound("error");
            return;
        }
        if (lastStopReason === "aborted") {
            playConfiguredSound("aborted");
            return;
        }

        // Normal completion: respect the time threshold. The fallback
        // (1) matches the shipped default in config.ts DEFAULT_PREFERENCES -
        // both versions MUST stay in sync (the docs + the config
        // defaults table are the source of truth).
        const threshold = getPreference("notifyTimeSec", 1);
        if (threshold <= 0) return;
        if (durationSec < threshold) return;

        playConfiguredSound("task");
    });

    // -- Shared handler for /aftc-audio-notifications + alias ------------
    async function handleAudioNotifications(_args: string, ctx: ExtensionCommandContext): Promise<void> {
        type Pref =
            | "notifySoundQuestion" | "notifySoundTaskComplete" | "notifySoundError"
            | "notifySoundAborted" | "notifySoundStartup"
            | "notifySoundContext25" | "notifySoundContext50" | "notifySoundContext75";
        const categories: Array<{ id: string; label: string; pref: Pref; dir: string }> = [
            { id: "startup", label: "Choose sound for startup", pref: "notifySoundStartup", dir: "startup" },
            { id: "question", label: "Choose sound for question", pref: "notifySoundQuestion", dir: "question" },
            { id: "task", label: "Choose sound for task complete", pref: "notifySoundTaskComplete", dir: "task-complete" },
            { id: "error", label: "Choose sound for error", pref: "notifySoundError", dir: "error" },
            { id: "aborted", label: "Choose sound for aborted", pref: "notifySoundAborted", dir: "aborted" },
            { id: "context25", label: "Choose sound for context 25%", pref: "notifySoundContext25", dir: path.join("context-window", "25") },
            { id: "context50", label: "Choose sound for context 50%", pref: "notifySoundContext50", dir: path.join("context-window", "50") },
            { id: "context75", label: "Choose sound for context 75%", pref: "notifySoundContext75", dir: path.join("context-window", "75") },
        ];

        if (!ctx.hasUI) {
            for (const c of categories) {
                const cur = getPreference(c.pref, "");
                console.log(`${LOG_PREFIX} ${c.label}: ${cur ? prettySoundLabel(cur) : "NONE"}`);
            }
            return;
        }

        // Loop: choice menu -> sound picker -> back to choice menu.
        // Esc on the choice menu exits; Esc on a sound picker goes back.
        let selectedIndex = 0;
        while (true) {
            // Settings-hub rows: each shows its current sound in an aligned
            // column (the /codex convention); the current selection is also
            // shown inside each picker.
            const choiceItems = [
                // Enabled toggle row first (codex-menu convention): Enter flips
                // Yes/No, the menu re-renders with selection preserved.
                { value: "__enabled__", label: "Enabled", description: getPreference("notifyEnabled", false) ? " | Yes" : " | No" },
                ...categories.map((c) => {
                    const cur = getPreference(c.pref, "");
                    return { value: c.id, label: c.label, description: ` | ${cur ? prettySoundLabel(cur) : "NONE"}` };
                }),
                { value: "__open_dir__", label: "Open notification sounds dir" },
            ];

            const choice = await showMenu(ctx, {
                title: "Notification sounds",
                body: ["Pick which sound to configure."],
                labelWidth: 31,
                initialIndex: selectedIndex,
                items: choiceItems,
                help: "Enter = choose   Esc = done",
            });

            if (choice === null) return; // Esc -> exit
            selectedIndex = Math.max(0, choiceItems.findIndex((i) => i.value === choice));

            // Enabled toggle: flip and re-render (selection preserved).
            if (choice === "__enabled__") {
                const nowOn = !getPreference("notifyEnabled", false);
                setPreference("notifyEnabled", nowOn);
                aftcConsole.emphasis(ctx, `Audio notifications: ${nowOn ? "ON" : "OFF"}`);
                continue;
            }

            // Special action: open the audio directory in the OS file manager.
            if (choice === "__open_dir__") {
                const audioDir = getAudioDir();
                if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
                let cmd: string, args: string[];
                if (process.platform === "win32") { cmd = "explorer.exe"; args = [audioDir]; }
                else if (process.platform === "darwin") { cmd = "open"; args = [audioDir]; }
                else { cmd = "xdg-open"; args = [audioDir]; }
                const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
                child.unref();
                aftcConsole.emphasis(ctx, `Opened: ${audioDir}`);
                return; // close menu after opening dir
            }

            const cat = categories.find((c) => c.id === choice);
            if (!cat) return;

            const dir = path.join(getAudioDir(), cat.dir);
            const files = listAudioFiles(cat.dir);
            const current = getPreference(cat.pref, "");

            const items: Array<{ value: string; label: string; description?: string }> = [
                { value: "", label: "NONE", description: current === "" ? " (current)" : undefined },
                ...files.map((f) => ({
                    value: f,
                    label: prettySoundLabel(f),
                    description: f === current ? " (current)" : undefined,
                })),
            ];
            const soundLabelWidth = items.reduce((m, i) => Math.max(m, i.label.length), 0) + 1;
            const currentIndex = items.findIndex((i) => i.value === current);

            const chosen = await showMenu(ctx, {
                title: cat.label,
                body: [
                    current ? `Current: ${prettySoundLabel(current)}` : "Current: NONE",
                ],
                items,
                labelWidth: soundLabelWidth,
                initialIndex: currentIndex >= 0 ? currentIndex : 0,
                help: "Enter = select   Esc = back",
                onHighlight: (item) => {
                    if (item.value) {
                        playPreview(path.join(dir, item.value));
                    }
                },
            });

            if (chosen === null) continue; // Esc -> back to choice menu

            setPreference(cat.pref, chosen);
            aftcConsole.emphasis(
                ctx,
                chosen
                    ? `${cat.label}: ${prettySoundLabel(chosen)}`
                    : `${cat.label}: NONE`,
            );
            // loop back to the choice menu
        }
    }

    // -- Command: /aftc-audio-notifications --------------------------------
    registerHelpEntry({
        command: "aftc-audio-notifications",
        description: "Choose notification sounds",
        category: "Audio notification",
        aliases: ["aftc-notifications"],
    });

    pi.registerCommand("aftc-audio-notifications", {
        description: "Choose notification sounds (startup, question, task-complete, error, aborted, context 25/50/75%)",
        handler: handleAudioNotifications,
    });

    // -- Alias: /aftc-notifications ----------------------------------------
    pi.registerCommand("aftc-notifications", {
        description: "Alias for /aftc-audio-notifications",
        handler: handleAudioNotifications,
    });


    // -- Command: /aftc-notify-time [seconds] ----------------------------
    registerHelpEntry({
        command: "aftc-notify-time",
        args: "[sec]",
        description: "Show or set the task-duration threshold (0 = off)",
        category: "Audio notification",
    });

    pi.registerCommand("aftc-notify-time", {
        description: "Show or set the task-duration threshold (seconds) for the completion sound",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const trimmed = (args ?? "").trim();

            // No argument: show current value.
            if (!trimmed) {
                const current = getPreference("notifyTimeSec", 1);
                const msg = current <= 0
                    ? "Time-based notification: disabled"
                    : `Time-based notification: ${current}s`;
                if (ctx.hasUI) {
                    aftcConsole.emphasis(ctx, msg);
                } else {
                    console.log(`${LOG_PREFIX} ${msg}`);
                }
                return;
            }

            // Parse the argument.
            const sec = Number(trimmed);
            if (!Number.isFinite(sec) || sec < 0 || !Number.isInteger(sec)) {
                if (ctx.hasUI) {
                    aftcConsole.warn(ctx, "Usage: /aftc-notify-time <seconds> (0 = disabled)");
                }
                return;
            }

            setPreference("notifyTimeSec", sec);
            const msg = sec <= 0
                ? "Time-based notification: disabled"
                : `Time-based notification: ${sec}s`;
            if (ctx.hasUI) {
                aftcConsole.emphasis(ctx, msg);
            } else {
                console.log(`${LOG_PREFIX} ${msg}`);
            }
        },
    });

    aftcConsole.log(`notify: loaded -- /aftc-audio-notifications, /aftc-notify-time`);
}
