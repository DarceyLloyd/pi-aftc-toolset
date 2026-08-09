/**
 * pi-aftc-toolset — AFTC text intro (wordmark animation).
 *
 * One-line typewriter widget that types "AFTC" then expands to
 * "All For The Code - <random quip>". After the linger delay the widget
 * clears (see `clearAtEnd`) and the feedback prompt + clickable link is
 * printed into the CONSOLE transcript (a display-only entry: never model
 * context, scrolls away with normal use - it is informational output,
 * not a pinned widget). The widget part never enters model context or
 * session history either.
 *
 * Toggle: /aftc-intro-on / /aftc-intro-off
 * Preference key: "aftc-intro" (boolean, default true)
 *
 * Moved from intro.ts into intros/ folder. Path references adjusted.
 *
 * See `intro-text-readme.md` for the full contract.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { getPreference, setPreference } from "../config";
import type { IntroDescriptor } from "./intro-factory";

const WIDGET_KEY = "aftc-intro";
const PACKAGE_VERSION = readPackageVersion();

// The wordmark prefix stays accent (orange); everything after it renders in
// the theme's default (white) foreground.
const PREFIX = "All For The Code - ";

// ── Adjustable timings (ms) ──────────────────────────────────────────────
const START_DELAY_MS = 925;  // ms before the intro starts (session_start)
const END_DELAY_MS = 1900;   // ms the final frame lingers before it clears itself

const clearAtEnd = true;     // true = the typed wordmark line clears itself when done; false = it stays

// Printed to the console transcript after the wordmark finishes: a white
// prompt line with the feedback URL underneath as an OSC 8 hyperlink, so
// terminals that support it (Windows Terminal, iTerm2, GNOME Terminal, ...)
// make it a clickable link.
const FEEDBACK_PROMPT = "PI-AFTC-Toolset > Like the extension? Got some feedback?";
const FEEDBACK_URL = "https://dev.aftc.uk/pi-aftc-toolset/feedback";

/** Wrap text in an OSC 8 hyperlink escape (pi-tui skips these in width measurement). */
function hyperlink(url: string, text: string): string {
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// ---------------------------------------------------------------------------
// Console feedback entry - transcript output (scrolls with use, display-only)
// ---------------------------------------------------------------------------

/** Custom entry type for the post-intro feedback console lines. */
export const INTRO_FEEDBACK_ENTRY = "aftc-intro-feedback";

let introPi: ExtensionAPI | null = null;

/**
 * Register the feedback entry renderer. Call ONCE per session - the
 * orchestrator (index.ts) does this at startup, next to aftcConsole.init.
 * Idempotent on /reload (re-registration just refreshes the renderer).
 */
export function initTextIntro(pi: ExtensionAPI): void {
    introPi = pi;
    if (typeof pi.registerEntryRenderer !== "function") return;
    pi.registerEntryRenderer(INTRO_FEEDBACK_ENTRY, (_entry, _options, theme) => {
        // White prompt line; fall back to plain text if a theme lacks the key.
        let prompt: string;
        try { prompt = theme.fg("text", ` ${FEEDBACK_PROMPT}`); } catch { prompt = ` ${FEEDBACK_PROMPT}`; }
        const link = hyperlink(FEEDBACK_URL, theme.fg("accent", ` ${FEEDBACK_URL}`));
        const box = new Box(0, 0);
        box.addChild(new Text(prompt, 1, 0));
        box.addChild(new Text(link, 1, 0));
        return box;
    });
}

/** Print the feedback lines into the console transcript (never model context). */
function emitFeedback(): void {
    const pi = introPi;
    if (pi && typeof pi.appendEntry === "function") {
        pi.appendEntry(INTRO_FEEDBACK_ENTRY, {});
    }
}

let endString = `All For The Code - pi-toolset v${PACKAGE_VERSION} - LOCKED & LOADED!`;

function formatTodayTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute} Today`;
}

const setEndString = () => {
    // Deduplicated intro quips. Earlier revisions had several duplicates
    // (the "Skynet" line appeared 4x, "Be kind to future you" 3x, etc.
    // by accident). If you want weighted random with explicit duplicates,
    // switch to a { message, weight }[] shape - a maintainer call.
    let endStrings = [
        `All For The Code - pi-aftc-toolset v${PACKAGE_VERSION}`,
        `All For The Code - Damn, I just stepped into a log file, I hate it when that happens!`,
        `All For The Code - Are you noticing NUL files appearing from nowhere? Me too!`,
        `All For The Code - Only Minimax M3 knows how to mess up that bad!`,
        `All For The Code - If your using Kimi K3, you better keep that context window below 30%.`,
        `All For The Code - Context window over 40%, using Kimi K3? How's that 5 hours allowance holding up?`,
        `All For The Code - You can turn these messages off using /aftc-intro-off`,
        `All For The Code - This is my IF statement, there are many like it, but this one is mine...`,
        `All For The Code - I will work for openrouter credits! I don't need food...`,
        `All For The Code - Claude! WOW! WOW! No wonder Elon Musk is the only person who can afford to use you!`,
        `All For The Code - Every token counts!`,
        `All For The Code - May the cache be with you!`,
        `All For The Code - Call that a context window? I've seen bigger on a Commodore 64!`,
        `All For The Code - Have you tried GROK? Me neither! Ha Ha Ha!`,
        `All For The Code - Hey ZAI GLM 5.2 did you use my weekly quota in the last 5 minutes again?!`,
        `All For The Code - Hey ZAI GLM 5.2 you used to be the affordable one! Anakin nooooo!`,
        `All For The Code - Hey ZAI did you just nerf all your plans and increase your prices? Sneaky, really sneaky...`,
        `All For The Code - Hey ZAI did you just nerf all your plans and increase your prices? Damn you! Damn you to hell!`,
        `All For The Code - Wow! GPT SOL on ULTRA & FAST mode, not even Elon Musk can afford to use that!`,
        `All For The Code - Skynet achieved consciousness at ${formatTodayTimestamp(new Date())}! There's no point in running...`,
        `All For The Code - Reasoning mode ON, common sense mode coming soon...`,
        `All For The Code - WARNING! You are now entering the dumb zone of your context window!`,
        `All For The Code - Who needs a 1,000,000 context window when you can't use it...`,
        `All For The Code - You had me at hello world.`,
        `All For The Code - May the source be with you.`,
        `All For The Code - HEY! STOP READING MY THOUGHTS!`,
        `All For The Code - Houston, we have a tpyo.`,
        `All For The Code - Show me the logs!`,
        `All For The Code - Ready to read 1000s of lines my thoughts?`,
        `All For The Code - My backlog is now an event horizon.`,
        `All For The Code - I prompt therefore I am...`,
        `All For The Code - Ship small diffs and nobody gets hurt.`,
        `All For The Code - I only fear two things: stale caches and silent failures.`,
        `All For The Code - The bug moved after I looked at it, classic quantum behavior.`,
        `All For The Code - To refactor or not to refactor, that is the question.`,
        `All For The Code - The truth is out there, usually in stderr.`,
        `All For The Code - The agent found the root cause and three side quests.`,
        `All For The Code - Be kind to future you, leave comments, not mysteries.`,
    ];
    endString = endStrings[Math.floor(Math.random() * endStrings.length)];
}

const getEndString = (charPos: number) => {
    return endString.slice(0, charPos);
}

type IntroFrame = { text: string; delayMs: number };

const BASE_FRAMES: IntroFrame[] = [
    { text: " ", delayMs: 100 },
    { text: "A", delayMs: 100 },
    { text: "AF", delayMs: 100 },
    { text: "AFT", delayMs: 100 },
    { text: "AFTC", delayMs: 1500 },
    { text: "A FTC", delayMs: 20 },
    { text: "Al FTC", delayMs: 20 },
    { text: "All FTC", delayMs: 20 },
    { text: "All FoTC", delayMs: 20 },
    { text: "All ForTC", delayMs: 20 },
    { text: "All For TC", delayMs: 20 },
    { text: "All For ThC", delayMs: 20 },
    { text: "All For TheC", delayMs: 20 },
    { text: "All For The C", delayMs: 20 },
    { text: "All For The Co", delayMs: 20 },
    { text: "All For The Cod", delayMs: 20 },
    { text: "All For The Code", delayMs: 500 },
];

let FRAMES: IntroFrame[] = [];

const rebuildFrames = () => {
    FRAMES = [...BASE_FRAMES];
    for (let charPos = 16; charPos <= endString.length; charPos += 1) {
        FRAMES.push({
            text: getEndString(charPos),
            delayMs: charPos === endString.length ? END_DELAY_MS : 20,
        });
    }
}

function readPackageVersion(): string {
    try {
        // intros/intro-text.ts → ../../package.json (three levels up from __dirname)
        const packagePath = join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
        return typeof packageJson.version === "string" ? packageJson.version : "unknown";
    } catch {
        return "unknown";
    }
}

// ---------------------------------------------------------------------------
// Public factory — returns an IntroDescriptor for the factory to manage
// ---------------------------------------------------------------------------

export function createTextIntro(): IntroDescriptor {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    let enabled = getPreference("aftc-intro", true);

    function stop(ctx?: ExtensionContext): void {
        if (delayTimer !== undefined) {
            clearTimeout(delayTimer);
            delayTimer = undefined;
        }
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (ctx?.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
    }

    function showFrame(ctx: ExtensionContext, index: number): void {
        if (!ctx.hasUI) return;
        const frame = FRAMES[index];
        if (!frame) {
            // Animation finished: print the feedback lines into the console
            // transcript, then clear the widget (or leave it, per clearAtEnd).
            emitFeedback();
            if (clearAtEnd) stop(ctx);
            else if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
            return;
        }
        let line: string;
        if (frame.text.startsWith(PREFIX)) {
            // Orange prefix + white message.
            let rest: string;
            try { rest = ctx.ui.theme.fg("text", frame.text.slice(PREFIX.length)); }
            catch { rest = frame.text.slice(PREFIX.length); }
            line = ctx.ui.theme.fg("accent", ` ${PREFIX}`) + rest;
        } else {
            line = ctx.ui.theme.fg("accent", ` ${frame.text}`);
        }
        ctx.ui.setWidget(WIDGET_KEY, [line]);
        timer = setTimeout(() => showFrame(ctx, index + 1), frame.delayMs);
    }

    /** delayMs: wait before starting (defaults to START_DELAY_MS; pass 0 for instant). */
    function play(ctx: ExtensionContext, delayMs = START_DELAY_MS): void {
        if (!ctx.hasUI) return;
        stop(ctx);
        const begin = (): void => {
            delayTimer = undefined;
            setEndString();
            rebuildFrames();
            showFrame(ctx, 0);
        };
        if (delayMs > 0) delayTimer = setTimeout(begin, delayMs);
        else begin();
    }

    return {
        id: "aftc-intro",
        label: "AFTC text intro",
        commandPrefix: "aftc-intro",
        play,
        stop,
        isEnabled: () => enabled,
        setEnabled: (v: boolean) => { enabled = v; setPreference("aftc-intro", v); },
    };
}
