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
 * Per rules.md §1.5, this is a self-contained feature module: it owns
 * no state and is wired into pi by the orchestrator in index.ts.
 *
 * Output goes through ctx.ui.select (rules.md §6.3: "For long output,
 * use ctx.ui.select(title, lines, { timeout })"). Writing directly to
 * stdout via console.log inside a TUI extension interleaves with pi's
 * redraws and corrupts the screen — that is what broke pi in earlier
 * versions of this module.
 *
 * See `help.readme.md` for the command/shortcut table and headless
 * fallback behaviour.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

// -----------------------------------------------------------------------------
// Static command + shortcut tables. Keep these in sync with the actual
// `registerCommand` / `registerShortcut` calls in:
//   - core.ts               (cache-profile, cache-stats, cache-reset,
//                            aftc-set-costs-timeframe, cls)
//   - think-parser.ts       (aftc-enable-think-processing,
//                            aftc-disable-think-processing)
//   - footer-widget.ts      (aftc-footer)
//   - usage-report.ts       (usage-report, usage-clear)
//   - install.ts            (aftc-install)
//   - ssh.ts                (ssh-connect, ssh-disconnect, ssh-status,
//                            ssh-gui, ssh-run)
//   - response.ts           (aftc-response-divider)
//   - help.ts               (aftc-help) ← this file
//   - input-clear.ts        (alt+c)
//   - theme.ts              (theme)
//   - stfu.ts               (aftc-stop, stfu)
//   - cd.ts                 (cd)
//   - dir.ts                (dir, ls)
//   - cwd.ts                (cwd)
//   - replay.ts             (save-replay-prompt, replay, r)
//   - keep-it-short.ts      (keep-it-short, kis)
//
// Note: /show-thinking and /hide-thinking were removed — pi's built-in
// Ctrl+T (app.thinking.toggle) and the hideThinkingBlock setting
// already cover showing/hiding thinking blocks in the main output.
// -----------------------------------------------------------------------------

const GENERAL_COMMANDS: Array<[string, string]> = [
	["/aftc-help", "Show this help screen"],
	["/aftc-install", "Install runtime deps (SQLite + SSH GUI)"],
	["/cls", "Clear the terminal screen"],
	["/theme", "Open the theme picker"],
];

const RESPONSE_COMMANDS: Array<[string, string]> = [
	["/aftc-response-divider", "Toggle the divider above each reply"],
];

const INTERRUPT_COMMANDS: Array<[string, string]> = [
	["/aftc-stop", "Stop the current agent operation"],
	["/stfu", "Short alias for /aftc-stop"],
];

const NAVIGATION_COMMANDS: Array<[string, string]> = [
	["/cd [path]", "Switch directory (picker or one-shot path)"],
	["/cd-set-max-depth [2-10]", "Set /cd picker depth (default 3)"],
	["/dir", "List the current directory (alias /ls)"],
	["/ls", "Alias for /dir"],
	["/cwd", "Show the current working directory"],
];

const CACHE_COMMANDS: Array<[string, string]> = [
	["/aftc-footer", "Toggle the footer dashboard"],
	["/aftc-set-costs-timeframe", "Set the footer 4th-line time window (default: Last 3 Days)"],
	["/cache-profile", "Per-tool token costs + prefix churn analysis"],
	["/cache-stats", "Session cache stats + spend"],
	["/cache-reset", "Zero accumulators (debugging)"],
];

const USAGE_COMMANDS: Array<[string, string]> = [
	["/usage-report", "Open the usage HTML report (ALPHA)"],
	["/usage-clear", "Delete all recorded usage rows"],
];

const SSH_COMMANDS: Array<[string, string]> = [
	["/ssh-gui", "Launch the local PyQt6 SSH GUI"],
	["/ssh-connect", "Connect to user@host"],
	["/ssh-run <cmd>", "Run a command on the connected server"],
	["/ssh-status", "Show GUI + connection status"],
	["/ssh-disconnect", "Disconnect the SSH session"],
];

const REPLAY_COMMANDS: Array<[string, string]> = [
	["/save-replay-prompt <text>", "Save a prompt string for later replay"],
	["/replay", "Re-send the saved prompt (alias /r)"],
	["/r", "Short alias for /replay"],
];

const KEEP_SHORT_COMMANDS: Array<[string, string]> = [
	["/keep-it-short", "Tell the model to be terse (alias /kis)"],
	["/kis", "Short alias for /keep-it-short"],
];

const SKILL_COMMANDS: Array<[string, string]> = [
	["/skill:cache-audit", "Cache diagnostics workflow"],
	["/skill:bulk-read", "Concatenate many files into one doc"],
];

const THINKING_COMMANDS: Array<[string, string]> = [
	["/aftc-enable-think-processing", "Enable <think>…</think> tag parsing"],
	["/aftc-disable-think-processing", "Disable <think>…</think> tag parsing"],
];

const SHORTCUTS: Array<[string, string]> = [
	["alt+c", "Clear the input editor"],
	["Ctrl+T", "Toggle thinking block visibility (pi built-in)"],
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
function renderSection(
	title: string,
	items: Array<[string, string]>,
): string[] {
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
		lines.push(
			"AFTC productivity tools for pi: footer diagnostics, usage reports, SSH, shortcuts, skills (cache-audit, bulk-read), and themes.",
		);
		lines.push("");
		lines.push(...renderSection("General", GENERAL_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Response", RESPONSE_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Interrupt", INTERRUPT_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Navigation", NAVIGATION_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Footer / cache / timing", CACHE_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Usage report", USAGE_COMMANDS));
		lines.push("");
		lines.push(...renderSection("SSH", SSH_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Replay", REPLAY_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Keep it short", KEEP_SHORT_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Skills", SKILL_COMMANDS));
		lines.push("");
		lines.push(...renderSection("Thinking", THINKING_COMMANDS));
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
