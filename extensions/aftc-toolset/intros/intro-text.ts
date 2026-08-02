/**
 * pi-aftc-toolset — AFTC text intro (wordmark animation).
 *
 * One-line typewriter widget that types "AFTC" then expands to
 * "All For The Code - <random quip>". Runs as a widget (not a message),
 * so it never enters model context or session history.
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
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPreference, setPreference } from "../config";
import type { IntroDescriptor } from "./intro-factory";

const WIDGET_KEY = "aftc-intro";
const PACKAGE_VERSION = readPackageVersion();

// ── Adjustable timings (ms) ──────────────────────────────────────────────
const START_DELAY_MS = 925; // ms before the intro starts (session_start)
const END_DELAY_MS = 1500;   // ms the final frame lingers before it clears itself

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
        `All For The Code - pi-aftc-toolset v${PACKAGE_VERSION} - LOCKED & LOADED!`,
        `All For The Code - pi-aftc-toolset v${PACKAGE_VERSION} - LOADED!`,
        `All For The Code - pi-aftc-toolset v${PACKAGE_VERSION} - READY!`,
        `All For The Code - Damn, I just stepped into a log file, I hate it when that happens!`,
        `All For The Code - Are you noticing NUL files appearing from nowhere? Me too!`,
        `All For The Code - Only Minimax M3 knows how to mess up that bad!`,
        `All For The Code - Be gentle, my keys are sensative today... A hard night's coding.`,
        `All For The Code - You can turn these messages off using /aftc-intro-off`,
        `All For The Code - This is my IF statement, there are many like it, but this one is mine...`,
        `All For The Code - I will work for openrouter credits! I don't need food...`,
        `All For The Code - Claude! WOW! WOW! No wonder Elon Musk is the only person who can afford to use you!`,
        `All For The Code - Every token counts!`,
        `All For The Code - May the cache be with you!`,
        `All For The Code - Call that a context window? I've seen bigger on a Commodore 64!`,
        `All For The Code - Have you tried GROK? Me neither! Ha Ha Ha!`,
        `All For The Code - Hey GLM 5.2 did you use my weekly quota in the last 5 minutes again?!`,
        `All For The Code - Wow! GPT SOL on ULTRA & FAST mode, not even Elon Musk can afford to use that!`,
        `All For The Code - Skynet achieved consciousness at ${formatTodayTimestamp(new Date())}! There's no point in running...`,
        `All For The Code - Reasoning mode ON, common sense mode coming soon...`,
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

const BASE_FRAMES: { text: string; delayMs: number }[] = [
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

let FRAMES: { text: string; delayMs: number }[] = [];

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
            stop(ctx);
            return;
        }
        ctx.ui.setWidget(WIDGET_KEY, [
            ctx.ui.theme.fg("accent", ` ${frame.text}`),
        ]);
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
