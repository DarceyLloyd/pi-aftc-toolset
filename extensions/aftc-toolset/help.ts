/**
 * pi-aftc-toolset — help / discovery feature module.
 *
 * Registers the `/aftc-help` command, which displays two sections via
 * the AFTC UI toolkit's scrollable viewer (`showViewer`):
 *   1. Commands (slash commands registered by this extension)
 *   2. Shortcuts (keyboard shortcuts registered by this extension)
 *
 * The data is a static snapshot — the orchestrator could in principle
 * introspect pi.getCommands() and the registered shortcuts, but a
 * static description is simpler, more stable across pi versions, and
 * gives us control over wording/formatting.
 *
 * Per .dev/dev_guide.md section 1.5, this is a self-contained feature module: it owns
 * no state and is wired into pi by the orchestrator in index.ts.
 *
 * Output goes through showViewer (AFTC UI takeover; headless prints
 * with the [aftc-toolset] prefix). Writing directly to stdout via
 * console.log inside a TUI extension interleaves with pi's redraws and
 * corrupts the screen — that is what broke pi in earlier versions of
 * this module.
 *
 * See `help.readme.md` for the command/shortcut table and headless
 * fallback behaviour.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { showViewer, type AftcViewerRow } from "./ui/aftcUi";

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
//   - ssh/index.ts          (ssh-connect, ssh-disconnect, ssh-status,
//                            ssh-shell, ssh transfers, ssh-help)
//   - response.ts           (aftc-response-divider)
//   - help.ts               (aftc-help) ← this file
//   - intro.ts              (aftc-intro-stop, aftc-intro-on)
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
	["/aftc-install", "Install runtime deps (SQLite + Python + SSH carrier)"],
	["/cls", "Clear the terminal screen"],
	["/theme", "Open the theme picker"],
];

const RESPONSE_COMMANDS: Array<[string, string]> = [
	["/aftc-response-divider", "Toggle the divider above each reply"],
	["/aftc-intro-stop", "Disable the AFTC startup animation"],
	["/aftc-intro-on", "Enable and play the AFTC startup animation"],
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
	["/ssh-connection-manager", "Open the full-screen connection manager (alias /ssh-cm)"],
	["/ssh-cm", "Short alias for /ssh-connection-manager"],
	["/ssh-connections", "List locally saved connection names"],
	["/ssh-connect [name]", "Connect locally using a saved connection"],
	["/ssh-auto-accept-session-on", "Auto-approve new SSH host keys (saved)"],
	["/ssh-auto-accept-session-off", "Ask before trusting new SSH host keys"],
	["/ssh-status", "Show SSH connection status"],
	["/ssh-select [id]", "Select the active SSH session for local commands"],
	["/ssh-shell", "Open a full-screen interactive SSH terminal"],
	["/ssh-close-shell <id>", "Close an interactive SSH shell"],
	["/ssh-interrupt <id>", "Send recovery keys to an SSH shell"],
	["/ssh-upload <local> <remote>", "Upload a file (--preserve keeps attrs)"],
	["/ssh-download <remote> <local>", "Download a file (--preserve keeps attrs)"],
	["/ssh-rename <from> <to>", "Rename a remote path after confirmation"],
	["/ssh-disconnect [id]", "Disconnect an SSH session"],
	["/ssh-help", "Show SSH workflow guidance"],
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
// Sectioned command/description listings. The viewer word-wraps long
// descriptions inside the panel, so nothing is cut off.
// -----------------------------------------------------------------------------

/** One section: accent bold title, then per command an accent command
 * line, a white `Description: …` line, and a blank spacer. */
function renderSectionRows(
	title: string,
	items: Array<[string, string]>,
): AftcViewerRow[] {
	const rows: AftcViewerRow[] = [
		{ text: title, tone: "accent", bold: true },
		{ text: "", divider: true },
	];
	if (items.length === 0) {
		rows.push({ text: `(no ${title.toLowerCase()})`, tone: "muted" });
		return rows;
	}
	for (const [command, description] of items) {
		rows.push({ text: command, tone: "accent" });
		rows.push({ text: description });
		rows.push({ text: "" });
	}
	return rows;
}

// -----------------------------------------------------------------------------
// HelpModule
// -----------------------------------------------------------------------------

class HelpModule {
	constructor(private pi: ExtensionAPI) {}

	attach(): void {
		this.registerCommands();
	}

	/** Rows for the /aftc-help viewer. */
	generateHelp(): AftcViewerRow[] {
		const rows: AftcViewerRow[] = [];
		rows.push({ text: "Available slash commands from the pi-aftc-toolset." });
		rows.push({ text: "" });
		rows.push(...renderSectionRows("General", GENERAL_COMMANDS));
		rows.push(...renderSectionRows("Response", RESPONSE_COMMANDS));
		rows.push(...renderSectionRows("Interrupt", INTERRUPT_COMMANDS));
		rows.push(...renderSectionRows("Navigation", NAVIGATION_COMMANDS));
		rows.push(...renderSectionRows("Footer / cache / timing", CACHE_COMMANDS));
		rows.push(...renderSectionRows("Usage report", USAGE_COMMANDS));
		rows.push(...renderSectionRows("SSH", SSH_COMMANDS));
		rows.push(...renderSectionRows("Replay", REPLAY_COMMANDS));
		rows.push(...renderSectionRows("Keep it short", KEEP_SHORT_COMMANDS));
		rows.push(...renderSectionRows("Skills", SKILL_COMMANDS));
		rows.push(...renderSectionRows("Thinking", THINKING_COMMANDS));
		rows.push(...renderSectionRows("Shortcuts", SHORTCUTS));
		return rows;
	}

	private registerCommands(): void {
		this.pi.registerCommand("aftc-help", {
			description: "Show the pi-aftc-toolset help (commands and shortcuts)",
			handler: async (_a: string, ctx: ExtensionCommandContext) => {
				// AFTC UI showViewer — scrollable takeover; returns control
				// to the editor when dismissed (Esc / Enter / q).
				// Never use console.log here — it interleaves with the TUI
				// and corrupts the screen.
				const rows = this.generateHelp();
				if (ctx.hasUI) {
					await showViewer(ctx, { title: "/aftc-help", rows });
				} else {
					// Headless fallback (e.g. RPC / -p mode).
					for (const row of rows) console.log(`[aftc-toolset] ${row.text}`);
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
