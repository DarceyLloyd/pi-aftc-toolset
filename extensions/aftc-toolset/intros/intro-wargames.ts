/**
 * pi-aftc-toolset — WarGames intro animation.
 *
 * on a black screen with a blinking block cursor. The bundled MP3 starts at
 * the START of typing; the takeover ends 0.5s after the MP3 ends (once typing
 * has finished), then pi's screen is restored exactly and a synthetic resize
 * forces pi to fully repaint (its differential renderer went stale while it
 * painted into the discarded alt screen).
 *
 * Trigger: the intro factory's play() call on session_start IS the signal —
 * the takeover starts immediately. No ctx.ui.custom() (flaky from
 * session_start), no timers guessing when the TUI is ready, no waiting for
 * the first prompt. Raw ANSI needs none of that:
 *  - the terminal ALTERNATE SCREEN BUFFER (the vim/htop mechanism) preserves
 *    pi's main screen and restores it exactly on exit — non-destructive;
 *  - a 250ms heartbeat full repaint overwrites any stray pi output that
 *    lands mid-takeover within one frame;
 *  - any key press dismisses early (the keypress also reaches pi — harmless);
 *  - crash-guards (max sound-phase time) mean pi can never be trapped.
 *
 * No slash commands — enabled via the config preference and played from the
 * session_start random draw. Preference key: "warGamesEnabled" (default false).
 *
 * The MP3 lives at data/aftc-intro/audio/voc_greetings-professor-falcon.mp3
 * (user-supplied; the animation still works without it — just no sound).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getPreference, setPreference } from "../config";
import { dlog, type IntroDescriptor } from "./intro-factory";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPED_TEXT = "GREETINGS PROFESSOR FALKEN";
const TYPE_SPEED_MS = 40;
const CURSOR_BLINK_MS = 530;
const HOLD_AFTER_TYPE_MS = 1500;
const SOUND_END_PAUSE_MS = 500;      // required: pause after the MP3 ends
const SOUND_MAX_MS = 15000;          // crash-guard: never trap the user
const HEARTBEAT_REPAINT_MS = 250;    // full repaint cadence (covers stray pi writes)

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const BG_GREEN_ON_BLACK = "\x1b[48;2;0;0;0m\x1b[38;2;51;255;51m";
const RESET = "\x1b[0m";
const CURSOR_ON = "█"; // block char
const CURSOR_OFF = " ";

// ---------------------------------------------------------------------------
// Audio playback (duplicated from notify.ts — modules must not import each other)
// ---------------------------------------------------------------------------

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
    // intros/intro-wargames.ts → ../bin/ (one level up from __dirname)
    const binPath = path.join(__dirname, "..", "bin", name);
    return fs.existsSync(binPath) ? binPath : null;
}

/** Spawn the player NON-detached so 'close' tells us exactly when the MP3 ends. */
function startMp3(filePath: string): ChildProcess | null {
    const bin = getPlayerBinary();
    if (!bin || !fs.existsSync(filePath)) return null;
    try {
        return spawn(bin, [filePath], { stdio: "ignore", windowsHide: true });
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Raw full-screen takeover (alternate screen buffer)
// ---------------------------------------------------------------------------

interface Takeover {
    finish(): void;
}

function startRawTakeover(onDone: () => void): Takeover {
    let charIndex = 0;
    let cursorVisible = true;
    let phase: "typing" | "hold" | "done" = "typing";
    let player: ChildProcess | null = null;
    let hasPlayer = false;
    let playerClosed = false;
    let audioEndedAt = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    const writeRaw = (s: string): void => {
        try { process.stdout.write(s); } catch { /* best-effort */ }
    };

    function buildFrame(): string {
        const cols = Math.max(20, process.stdout.columns || 80);
        const rows = Math.max(5, process.stdout.rows || 24);
        const text = TYPED_TEXT.slice(0, charIndex) + (cursorVisible ? CURSOR_ON : CURSOR_OFF);
        const lineRow = Math.min(rows - 1, Math.floor(rows / 2));
        const leftPad = Math.max(0, Math.floor((cols - text.length) / 2));
        // Every row is painted with absolute cursor positioning and one column
        // short of full width, so we never touch the bottom-right cell (no scroll).
        const blank = " ".repeat(cols - 1);
        let s = BG_GREEN_ON_BLACK;
        for (let r = 0; r < rows; r++) {
            s += `\x1b[${r + 1};1H`;
            if (r === lineRow) {
                const visibleText = text.slice(0, Math.max(0, cols - 1 - leftPad));
                const right = Math.max(0, cols - 1 - leftPad - visibleText.length);
                s += " ".repeat(Math.min(leftPad, cols - 1)) + visibleText + " ".repeat(right);
            } else {
                s += blank;
            }
        }
        return s;
    }

    function repaint(): void {
        if (phase === "done") return;
        writeRaw(buildFrame());
    }

    const schedule = (fn: () => void, ms: number): void => {
        timers.push(setTimeout(fn, ms));
    };

    function finish(): void {
        if (phase === "done") return;
        phase = "done";
        for (const t of timers) clearTimeout(t);
        for (const i of intervals) clearInterval(i);
        process.stdout.removeListener("resize", repaint);
        process.stdin.removeListener("data", onKey);
        if (player && player.exitCode === null) {
            try { player.kill(); } catch { /* best-effort */ }
        }
        writeRaw(RESET + CURSOR_SHOW + ALT_SCREEN_OFF);
        // pi kept rendering into the (now discarded) alt screen while we were up,
        // so its differential renderer is out of sync with the restored main
        // screen. pi-tui listens for stdout "resize" and does a full relayout +
        // repaint on it — emit a synthetic one to force pi to redraw everything.
        try { process.stdout.emit("resize"); } catch { /* best-effort */ }
        dlog(`wargames: takeover finished, pi screen restored (full repaint requested)`);
        onDone();
    }

    function onKey(): void {
        finish(); // any key dismisses early
    }

    // Finish only when typing is done AND the MP3 has ended + 0.5s pause.
    function maybeFinish(): void {
        if (phase !== "hold" || !playerClosed) return;
        const wait = Math.max(0, audioEndedAt + SOUND_END_PAUSE_MS - Date.now());
        schedule(finish, wait);
    }

    // Audio starts at the START of typing (first phase, before "PROFESSOR").
    function startSound(): void {
        // intros/intro-wargames.ts → ../data/aftc-intro/audio/ (one level up from __dirname)
        const mp3Path = path.join(__dirname, "..", "data", "aftc-intro", "audio", "voc_greetings-professor-falcon.mp3");
        player = startMp3(mp3Path);
        hasPlayer = player !== null;
        if (player) {
            player.on("close", () => { playerClosed = true; audioEndedAt = Date.now(); maybeFinish(); });
            player.on("error", () => { playerClosed = true; audioEndedAt = Date.now(); maybeFinish(); });
            // Crash-guard: never trap the user in the takeover.
            schedule(finish, SOUND_MAX_MS);
        }
    }

    function typeNext(): void {
        if (charIndex < TYPED_TEXT.length) {
            charIndex++;
            repaint();
            schedule(typeNext, TYPE_SPEED_MS);
        } else {
            phase = "hold";
            if (!hasPlayer) schedule(finish, HOLD_AFTER_TYPE_MS); // silent fallback
            else maybeFinish();
        }
    }

    // --- enter the alternate screen; pi's main screen is preserved by the terminal
    writeRaw(ALT_SCREEN_ON + CURSOR_HIDE);
    process.stdin.on("data", onKey);
    process.stdout.on("resize", repaint);
    intervals.push(setInterval(() => { cursorVisible = !cursorVisible; }, CURSOR_BLINK_MS));
    intervals.push(setInterval(repaint, HEARTBEAT_REPAINT_MS));
    repaint();
    startSound(); // audio starts at the start of typing
    schedule(typeNext, TYPE_SPEED_MS);
    dlog(`wargames: takeover started (raw ANSI, alternate screen)`);

    return { finish };
}

// ---------------------------------------------------------------------------
// Public factory — returns an IntroDescriptor for the factory to manage
// ---------------------------------------------------------------------------

export function createWarGamesIntro(): IntroDescriptor {
    let enabled = getPreference("warGamesEnabled", false);
    let takeover: Takeover | null = null;

    function play(ctx: ExtensionContext, _opts?: { defer?: boolean }): void {
        dlog(`wargames: play() called, hasUI=${ctx.hasUI}, mode=${ctx.mode}, isTTY=${process.stdout.isTTY === true}`);
        if (!ctx.hasUI || ctx.mode !== "tui" || !process.stdout.isTTY) {
            dlog(`wargames: play() ABORTED — not an interactive TUI`);
            return;
        }
        if (takeover) { dlog(`wargames: play() ignored — takeover already active`); return; }
        // The factory's play() call IS the signal — start the takeover now.
        takeover = startRawTakeover(() => { takeover = null; });
    }

    function stop(_ctx?: ExtensionContext): void {
        dlog(`wargames: stop() called, takeover=${takeover !== null}`);
        if (takeover) { takeover.finish(); takeover = null; }
    }

    return {
        id: "warGamesEnabled",
        label: "WarGames intro",
        commandPrefix: "", // no slash commands — in the /reload random draw only
        play,
        stop,
        isEnabled: () => enabled,
        setEnabled: (v: boolean) => { enabled = v; setPreference("warGamesEnabled", v); },
    };
}
