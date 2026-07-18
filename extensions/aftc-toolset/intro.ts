/**
 * pi-aftc-toolset — temporary startup wordmark animation.
 *
 * Runs only after pi starts an interactive session. The animation is a
 * widget, not a session message, so it never enters model context or pi's
 * session history. Its timer is cleared on session shutdown and the widget
 * is removed when the animation completes. `/aftc-intro-stop` disables it
 * persistently; `/aftc-intro-on` re-enables and plays it immediately.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPreference, setPreference } from "./config";

const WIDGET_KEY = "aftc-intro";
const PACKAGE_VERSION = readPackageVersion();
const TYPE_DELAY_MS = 150;
const EXPAND_DELAY_MS = 120;
const AFTC_PAUSE_MS = 1500;
const HOLD_DELAY_MS = 1800;

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
    let endStrings = [
        `All For The Code - pi-toolset v${PACKAGE_VERSION} - LOCKED & LOADED!`,
        `All For The Code - pi-toolset v${PACKAGE_VERSION} - LOADED!`,
        `All For The Code - pi-toolset v${PACKAGE_VERSION} - READY!`,
        `All For The Code - pi-toolset v${PACKAGE_VERSION} - ONLINE!`,
        `All For The Code - You can turn these messages off using /aftc-intro-stop`,
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
            delayMs: charPos === endString.length ? HOLD_DELAY_MS : 20,
        });
    }
}

// { text: " ", delayMs: 100 },
//     { text: "A", delayMs: 100 },
//     { text: "AF", delayMs: 100 },
//     { text: "AFT", delayMs: 100 },
//     { text: "AFTC", delayMs: 1500 },
//     { text: "A FTC", delayMs: 100 },
//     { text: "A F TC", delayMs: 100 },
//     { text: "A F T C", delayMs: 160 },
//     { text: "Al Fo Th Co", delayMs: 100 },
//     { text: "All For The Cod", delayMs: 100 },
//     { text: "All For The Code", delayMs: 750 },
//     { text: `All For The Code - pi-toolset v${PACKAGE_VERSION} - LOADED!`, delayMs: HOLD_DELAY_MS },

function readPackageVersion(): string {
    try {
        const packagePath = join(__dirname, "..", "..", "package.json");
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
        return typeof packageJson.version === "string" ? packageJson.version : "unknown";
    } catch {
        return "unknown";
    }
}

/** Register the one-line AFTC startup animation. */
export function createIntroAnimation(pi: ExtensionAPI): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let enabled = getPreference("aftc-intro", true);

    function stop(ctx?: ExtensionContext): void {
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

    function start(ctx: ExtensionContext): void {
        if (!ctx.hasUI) return;
        stop(ctx);
        setEndString();
        rebuildFrames();
        showFrame(ctx, 0);
    }

    pi.on("session_start", async (_event, ctx) => {
        if (enabled) start(ctx);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        stop(ctx);
    });

    pi.registerCommand("aftc-intro-stop", {
        description: "Disable the AFTC startup animation",
        handler: async (_args, ctx) => {
            if (!enabled) {
                ctx.ui.notify("AFTC intro animation is already OFF", "info");
                return;
            }
            enabled = false;
            setPreference("aftc-intro", false);
            stop(ctx);
            ctx.ui.notify("AFTC intro animation: OFF", "warning");
        },
    });

    pi.registerCommand("aftc-intro-on", {
        description: "Enable and play the AFTC startup animation",
        handler: async (_args, ctx) => {
            if (enabled) {
                ctx.ui.notify("AFTC intro animation is already ON", "info");
                return;
            }
            enabled = true;
            setPreference("aftc-intro", true);
            start(ctx);
            ctx.ui.notify("AFTC intro animation: ON", "info");
        },
    });
}
