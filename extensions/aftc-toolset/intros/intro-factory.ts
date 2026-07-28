/**
 * pi-aftc-toolset — intros subsystem.
 *
 * The intro factory picks ONE random enabled intro on session_start and
 * plays it. Each intro module exports an IntroDescriptor with play/stop/
 * isEnabled/setEnabled/registerCommands. The factory owns the session
 * lifecycle (session_start → random pick → play; session_shutdown → stop all).
 *
 * Adding a new intro:
 *   1. Create intros/intro-<name>.ts exporting create<Name>Intro(pi) → IntroDescriptor
 *   2. Import it here and add to the INTROS array
 *   3. Add its preference key to config.ts if needed
 *
 * See `intro-factory-readme.md` and `intros/readme.md` for the full contract.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import * as aftcConsole from "../ui/aftc-console";
import { join } from "node:path";
import { getDataDir } from "../paths";
import { createTextIntro } from "./intro-text";
import { createWarGamesIntro } from "./intro-wargames";
import { registerHelpEntry } from "../help-registry";


// Debug log — writes to <data-dir>/intros-debug.log so output survives
// the console flood that happens right after session_start.
const DEBUG_LOG = join(getDataDir(), "intros-debug.log");
export function dlog(msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    try { appendFileSync(DEBUG_LOG, line, "utf8"); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Shared descriptor — every intro module returns one of these
// ---------------------------------------------------------------------------

export interface IntroDescriptor {
    /** Stable id (used as the preference key and log prefix). */
    id: string;
    /** Human-readable label for logs / help. */
    label: string;
    /** Play the intro animation. Guard hasUI / mode internally.
     *  Called by the factory on session_start (the play() call IS the trigger
     *  signal) and by the intro's own -on command (when it has one). */
    play(ctx: ExtensionContext): void;
    /** Stop any running animation and clean up timers/widgets. */
    stop(ctx?: ExtensionContext): void;
    /** Whether this intro is currently enabled in config. */
    isEnabled(): boolean;
    /** Persist enable/disable to config. */
    setEnabled(v: boolean): void;
    /** Prefix for auto-generated slash commands (eg "aftc-intro" → /aftc-intro-on, /aftc-intro-off).
     *  Empty string = NO slash commands (config-only enable; eg intros that exist
     *  purely for the session_start random draw). */
    commandPrefix: string;
    /** Register this intro's on/off slash commands. */
    // registerCommands is handled centrally by the factory — do NOT add it here.
}

// ---------------------------------------------------------------------------
// Factory — wired by the orchestrator (index.ts)
// ---------------------------------------------------------------------------

export function createIntros(pi: ExtensionAPI): void {
    const intros: IntroDescriptor[] = [
        createTextIntro(),
        createWarGamesIntro(),
    ];

    // Auto-generate on/off slash commands from each intro's commandPrefix.
    for (const intro of intros) {
        if (!intro.commandPrefix) continue; // empty prefix = no slash commands
        const onCmd = `${intro.commandPrefix}-on`;
        const offCmd = `${intro.commandPrefix}-off`;
        pi.registerCommand(onCmd, {
            description: `Enable the ${intro.label} (plays on session start)`,
            handler: async (_args, ctx) => {
                if (intro.isEnabled()) {
                    aftcConsole.emphasis(ctx, `${intro.label} is already ON`);
                    return;
                }
                intro.setEnabled(true);
                aftcConsole.emphasis(ctx, `${intro.label}: ON`);
                // Command handlers run after user interaction — immediate play.
                intro.play(ctx);
            },
        });
        pi.registerCommand(offCmd, {
            description: `Disable the ${intro.label}`,
            handler: async (_args, ctx) => {
                if (!intro.isEnabled()) {
                    aftcConsole.emphasis(ctx, `${intro.label} is already OFF`);
                    return;
                }
                intro.setEnabled(false);
                intro.stop(ctx);
                aftcConsole.emphasis(ctx, `${intro.label}: OFF`);
            },
        });
        registerHelpEntry({
            command: onCmd,
            description: `Enable the ${intro.label} (plays on session start)`,
            category: "Response",
        });
        registerHelpEntry({
            command: offCmd,
            description: `Disable the ${intro.label}`,
            category: "Response",
        });
    }

    // Session lifecycle: pick one random enabled intro on start; stop all on shutdown.
    pi.on("session_start", async (_event, ctx) => {
        dlog(`intros: session_start fired, hasUI=${ctx.hasUI}, mode=${ctx.mode}`);
        dlog(`intros: all intros: ${intros.map(i => `${i.id}(enabled=${i.isEnabled()})`).join(", ")}`);
        const enabled = intros.filter(i => i.isEnabled());
        dlog(`intros: enabled count=${enabled.length}`);
        if (enabled.length === 0) { dlog(`intros: none enabled, skipping`); return; }
        const pick = enabled[Math.floor(Math.random() * enabled.length)];
        dlog(`intros: picked "${pick.label}" (id=${pick.id})`);
        pick.play(ctx);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        dlog(`intros: session_shutdown fired, stopping all`);
        for (const intro of intros) {
            intro.stop(ctx);
        }
    });

    dlog(`intros: loaded ${intros.length} intro(s) — ${intros.map(i => i.id).join(", ")}`);
    dlog(`intros: debug log at ${DEBUG_LOG}`);
}
