/**
 * pi-aftc-toolset / background terminals — /bt UI.
 *
 * One screen built on the shared aftc-ui primitives (no hand-rolled TUI
 * components — this project renders all dialogs through aftc-ui):
 *
 * - `/bt` → a scrollable list of the RUNNING terminals with a
 *   "TERMINATE ALL" row at the top. Enter on a row asks a yes/no confirm,
 *   stops the selection, and returns to a refreshed list; Esc closes.
 *   (Output inspection is the model's `bg_status` tool — /bt is the
 *   stop surface.)
 *
 * Every path guards `ctx.mode === "tui"`: outside the TUI the command
 * prints a plain-text listing via aftcConsole.print (the headless path).
 *
 * See background-terminal-ui-readme.md for the full contract.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showConfirm, showMenu } from "../ui/aftc-ui";
import * as aftcConsole from "../ui/aftc-console";
import {
    formatElapsed,
    formatExit,
    type BackgroundTerminalManager,
    type TerminalSnapshot,
} from "./background-terminal-manager";

/** Value of the "stop everything" row. */
const ALL_VALUE = "__all__";

/** One-line summary for a terminal row. */
export function describeTerminal(snap: TerminalSnapshot): string {
    const details = [
        `pid ${snap.pid ?? "?"}`,
        formatElapsed(snap),
        snap.status === "running" ? "exit -" : formatExit(snap),
    ];
    return `${snap.id} [${snap.status}] "${snap.title}" (${details.join(", ")})`;
}

/**
 * The /bt screen: scrollable list of running terminals, TERMINATE ALL at
 * the top. Enter asks a yes/no confirm, stops the selection, then the list
 * re-renders refreshed (loop). Esc closes.
 */
export async function manageTerminals(
    ctx: ExtensionCommandContext,
    manager: BackgroundTerminalManager,
): Promise<void> {
    // Loop so the user lands back on a refreshed list after every stop.
    while (true) {
        const running = manager.list().filter((snap) => snap.status === "running");
        if (running.length === 0) {
            aftcConsole.info(ctx, "No running background terminals. The agent starts them with bg_start.");
            return;
        }
        const items = [
            { value: ALL_VALUE, label: `TERMINATE ALL (${running.length})` },
            ...running.map((snap) => ({
                value: snap.id,
                label: describeTerminal(snap),
            })),
        ];
        const picked = await showMenu(ctx, {
            title: "Background terminals",
            items,
            help: "Enter stop · Esc close",
        });
        if (!picked) return;

        if (picked === ALL_VALUE) {
            // Factual safety note: a kill signals ONLY the terminal's own
            // process tree (Windows taskkill /T on the child pid; POSIX
            // signals the child's own detached process group). pi spawned
            // the terminals, so pi is their ANCESTOR and can never be in
            // the killed tree — this pi session and every other shell are
            // out of reach. Only programs started INSIDE a terminal
            // (eg a pi session launched there) stop with it.
            const ok = await showConfirm(ctx, {
                title: "Terminate all terminals?",
                body:
                    `Stop all ${running.length} running background terminal${running.length === 1 ? "" : "s"} and everything they started?\n` +
                    "This cannot stop this pi session or any other shell.\n" +
                    "A program started INSIDE a terminal (eg a pi session) stops with it.",
                yesLabel: "Yes, stop them all",
                noLabel: "No, keep running",
            });
            if (!ok) continue;
            await manager.kill(running.map((snap) => snap.id));
            aftcConsole.emphasis(
                ctx,
                `Stopped ${running.length} background terminal${running.length === 1 ? "" : "s"}.`,
            );
            continue; // refreshed list
        }

        const snap = manager.get(picked);
        if (!snap || snap.status !== "running") continue; // settled/raced — refresh
        const ok = await showConfirm(ctx, {
            title: "Stop terminal?",
            body: `Stop ${snap.id} "${snap.title}" and everything it started?`,
            yesLabel: "Yes, stop it",
            noLabel: "No, keep running",
        });
        if (!ok) continue;
        await manager.kill([picked]);
        aftcConsole.emphasis(ctx, `Stopped ${picked}.`);
        // Back to the refreshed list.
    }
}

/** Headless listing for /bt (print mode / RPC mode). */
export function printTerminalList(
    manager: BackgroundTerminalManager,
): void {
    const terminals = manager.list();
    if (terminals.length === 0) {
        aftcConsole.print("No background terminals.");
        return;
    }
    for (const snap of terminals) aftcConsole.print(describeTerminal(snap));
}
