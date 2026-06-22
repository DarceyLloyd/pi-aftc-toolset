/**
 * pi-aftc-toolset — help / discovery feature module.
 *
 * Registers the `/aftc-help` command, which displays two sections via
 * pi's scrollable select dialog (ctx.ui.select):
 *   1. Commands (slash commands registered by this extension)
 *   2. Shortcuts (keyboard shortcuts registered by this extension)
 *
 * The data is a static snapshot — the orchestrator could in principle
 * introspect pi.getCommands() and the registered shortcuts, but a
 * static description is simpler, more stable across pi versions, and
 * gives us control over wording/formatting.
 *
 * Per rules.md §2, this is a self-contained feature module: it owns no
 * state and is wired into pi by the orchestrator in index.ts.
 *
 * Output goes through ctx.ui.select (rules.md §7.4: "For long output,
 * use ctx.ui.select(title, lines, { timeout }) so the user can scroll
 * and dismiss; don't dump to console only"). Writing directly to
 * stdout via console.log inside a TUI extension interleaves with pi's
 * redraws and corrupts the screen — that is what broke pi in earlier
 * versions of this module.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// -----------------------------------------------------------------------------
// Static command + shortcut tables. Keep these in sync with the actual
// `registerCommand` / `registerShortcut` calls in:
//   - core.ts          (cache-profile, cache-stats, cache-reset,
//                       aftc-footer, cost-timer-*, cls)
//   - usage.ts         (usage-report, usage-clear)
//   - install.ts       (aftc-install)
//   - ssh.ts           (ssh-connect, ssh-disconnect, ssh-status,
//                       ssh-gui, ssh-run)
//   - help.ts          (aftc-help) ← this file
//   - input-clear.ts   (alt+c)
//
// Note: /show-thinking and /hide-thinking were removed — pi's built-in
// Ctrl+T (app.thinking.toggle) and the hideThinkingBlock setting
// already cover showing/hiding thinking blocks in the main output.
// -----------------------------------------------------------------------------

const GENERAL_COMMANDS: Array<[string, string]> = [
    ["/aftc-help",    "Show this help screen"],
    ["/aftc-install", "Install missing runtime dependencies: better-sqlite3 plus Python SSH GUI deps"],
    ["/cls",          "Clear the terminal screen"],
];

const CACHE_COMMANDS: Array<[string, string]> = [
    ["/aftc-footer",     "Show or hide the footer dashboard"],
    ["/cache-profile",   "Per-tool token costs, prefix shape hashes, system prompt size, churn analysis"],
    ["/cache-stats",     "Session cache stats, cache-write ROI, SQLite-backed projections, model spend, prefix hashes"],
    ["/cache-reset",     "Zero in-memory accumulators (tokens, cost, turns, churn) for benchmarking/debugging"],
    ["/cost-timer-always-running", "Run the session cost timer continuously from the first user prompt (default)"],
    ["/cost-timer-stop-when-idle", "Advance the session timer only while the assistant is actively processing"],
    ["/cost-timer-info", "Show the current timer mode and explain both modes"],
];

const USAGE_COMMANDS: Array<[string, string]> = [
    ["/usage-report", "Generate and open .pi-aftc-toolset/data/report.html"],
    ["/usage-clear",  "Permanently delete all recorded SQLite usage rows after confirmation"],
];

const SSH_COMMANDS: Array<[string, string]> = [
    ["/ssh-gui",        "Launch the local PyQt6 SSH GUI"],
    ["/ssh-connect",    "Connect to a remote server: /ssh-connect user@host [password]"],
    ["/ssh-run",        "Run a one-shot command on the connected server: /ssh-run <command>"],
    ["/ssh-status",     "Show SSH GUI running state and connection status"],
    ["/ssh-disconnect", "Disconnect from the current SSH session"],
];

const SKILL_COMMANDS: Array<[string, string]> = [
    ["/skill:cache-audit", "Load the bundled workflow for cache-hit and prefix diagnostics"],
];

const SHORTCUTS: Array<[string, string]> = [
    ["alt+c", "Clear the text in pi's input editor — start typing fresh"],
    ["Ctrl+T", "Built-in pi shortcut — toggle visibility of model <thinking> blocks in the main output"],
];

// -----------------------------------------------------------------------------
// Simple sectioned listings — no box characters, just a title with
// dashes and aligned "key  description" lines. Clean, scannable, and
// works in any terminal.
// -----------------------------------------------------------------------------

/** "Title ──────────..." (single line, min 50 chars wide). */
function sectionHeader(title: string, minWidth = 50): string {
    const dashes = Math.max(1, minWidth - title.length - 1);
    return `${title} ${"─".repeat(dashes)}`;
}

/** Renders a section: header line, then aligned "key  description" lines. */
function renderSection(title: string, items: Array<[string, string]>): string[] {
    if (items.length === 0) return [`(no ${title.toLowerCase()})`];

    // Align descriptions to the widest key (so columns line up).
    const maxKey = Math.max(...items.map(([k]) => k.length));
    const pad = maxKey + 2;

    const lines: string[] = [sectionHeader(title)];
    for (const [key, desc] of items) {
        lines.push(`${key.padEnd(pad)}${desc}`);
    }
    return lines;
}

// -----------------------------------------------------------------------------
// HelpModule
// -----------------------------------------------------------------------------

class HelpModule {
    constructor(private pi: ExtensionAPI) {}

    attach(): void {
        this.registerCommands();
    }

    /** Lines for the /aftc-help dialog. */
    generateHelp(): string[] {
        const lines: string[] = [];
        lines.push("pi-aftc-toolset help");
        lines.push("AFTC productivity tools for pi: footer diagnostics, usage reports, SSH, shortcuts, skill/theme helpers.");
        lines.push("");
        lines.push(...renderSection("General", GENERAL_COMMANDS));
        lines.push("");
        lines.push(...renderSection("Footer / cache / timing", CACHE_COMMANDS));
        lines.push("");
        lines.push(...renderSection("Usage report", USAGE_COMMANDS));
        lines.push("");
        lines.push(...renderSection("SSH", SSH_COMMANDS));
        lines.push("");
        lines.push(...renderSection("Skills", SKILL_COMMANDS));
        lines.push("");
        lines.push(...renderSection("Shortcuts", SHORTCUTS));
        return lines;
    }

    private registerCommands(): void {
        this.pi.registerCommand("aftc-help", {
            description: "Show the pi-aftc-toolset help (commands and shortcuts)",
            handler: async (_a: string, ctx: ExtensionCommandContext) => {
                // Use ctx.ui.select — pi's scrollable modal. Returns control
                // to the editor when dismissed (Esc / Enter / timeout).
                // Never use console.log here — it interleaves with the TUI
                // and corrupts the screen.
                const lines = this.generateHelp();
                if (ctx.hasUI) {
                    await ctx.ui.select("/aftc-help", lines, { timeout: 60000 });
                } else {
                    // Headless fallback (e.g. RPC / -p mode).
                    for (const line of lines) console.log(`[aftc-toolset] ${line}`);
                }
            },
        });
    }
}

// -----------------------------------------------------------------------------
// Public factory — the orchestrator (index.ts) calls this. HelpModule is
// independent (doesn't need to be passed to other modules); it just needs
// to be instantiated so its /aftc-help command registers.
// -----------------------------------------------------------------------------

export function createHelpModule(pi: ExtensionAPI): HelpModule {
    const m = new HelpModule(pi);
    m.attach();
    return m;
}