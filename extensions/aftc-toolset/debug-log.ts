/**
 * pi-aftc-toolset — /aftc-debug-log-on, /aftc-debug-log-off.
 *
 * Toggles the `debugLoggingEnabled` preference: the gate on aftcConsole.log()
 * stdout diagnostics (the "[aftc-toolset] loaded — …" and other chatter that
 * pi echoes into the TUI). OFF by default so the user's console stays clean;
 * turn on when diagnosing a problem, then back off. Error/warning output is
 * NEVER gated — this flag only silences routine diagnostics.
 *
 * See `debug-log-readme.md`.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getPreference, setPreference } from "./config";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";

function report(ctx: ExtensionCommandContext): void {
    const on = getPreference("debugLoggingEnabled", false);
    const msg = on
        ? "aftc-toolset debug logging ON — [aftc-toolset] diagnostic lines print to the console (/aftc-debug-log-off to silence)."
        : "aftc-toolset debug logging OFF — clean console (errors still print).";
    if (ctx.hasUI) aftcConsole.emphasis(ctx, msg);
    else aftcConsole.print(msg);
}

export function createDebugLog(pi: ExtensionAPI): void {
    registerHelpEntry({
        command: "aftc-debug-log-on",
        description: "Turn [aftc-toolset] diagnostic logging on",
        category: "General",
        aliases: ["aftc-debug-log-off"],
    });

    pi.registerCommand("aftc-debug-log-on", {
        description: "Turn [aftc-toolset] diagnostic logging on",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            setPreference("debugLoggingEnabled", true);
            report(ctx);
        },
    });

    pi.registerCommand("aftc-debug-log-off", {
        description: "Turn [aftc-toolset] diagnostic logging off",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            setPreference("debugLoggingEnabled", false);
            report(ctx);
        },
    });

    aftcConsole.log("loaded — /aftc-debug-log-on, /aftc-debug-log-off (stdout diagnostics gate)");
}
