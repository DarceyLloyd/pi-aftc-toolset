/**
 * pi-aftc-toolset — help / discovery feature module.
 *
 * Registers the `/aftc-help` command, which displays sections via
 * the AFTC UI toolkit's scrollable viewer (`showViewer`):
 *   1. Commands — built from help-registry.ts, which every command-
 *      registering module feeds next to its pi.registerCommand call.
 *      The help screen can never drift from the commands that exist
 *      (tests/help-registry-check/ enforces the sync both ways).
 *   2. Skills + Shortcuts — static: /skill:* entries and keyboard
 *      shortcuts are not pi.registerCommand calls, so they stay
 *      hard-coded here.
 *
 * Per AGENTS.md, this is a self-contained feature module: it owns
 * no state and is wired into pi by the orchestrator in index.ts.
 *
 * Output goes through showViewer (AFTC UI takeover; headless prints
 * with the [aftc-toolset] prefix). Writing directly to stdout via
 * console.log inside a TUI extension interleaves with pi's redraws and
 * corrupts the screen.
 *
 * See `help-readme.md` for the rendering contract and headless
 * fallback behaviour, and `docs/help-registry.md` for the registry rules.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { showViewer, type AftcViewerRow } from "./ui/aftc-ui";
import {
	getHelpEntries,
	registerHelpEntry,
	HELP_CATEGORY_ORDER,
	type HelpEntry,
} from "./help-registry";

// -----------------------------------------------------------------------------
// Static sections — things that are NOT pi.registerCommand calls and so
// do not belong in the help registry.
// -----------------------------------------------------------------------------

const SKILL_ROWS: Array<[string, string]> = [
	// Workflows (the most useful starting points)
	["/skill:cache-audit", "Cache diagnostics workflow"],
	["/skill:bulk-read", "Concatenate many files into one doc"],
	["/skill:aftc-codex", "Knowledge base: codex_load, lessons, structure maps"],
	// Languages
	["/skill:typescript", "TypeScript strict mode + AFTC singleton MVC"],
	["/skill:javascript-mjs", "JavaScript ES modules + KISS"],
	["/skill:javascript-transpiled", "Transpiled JS + build targets"],
	["/skill:python", "Python + uv + stdlib-first"],
	["/skill:go", "Go conventions + error handling"],
	["/skill:php", "PHP 8.2+ strict types + Composer"],
	["/skill:pinescript", "Pine Script v6 for TradingView"],
	["/skill:bash", "Bash shell scripting"],
	["/skill:bat", "Windows Batch scripting"],
	["/skill:ps1", "PowerShell scripting"],
	["/skill:markdown", "AI-friendly markdown for docs"],
	// Frameworks / runtimes
	["/skill:react", "React + Vite + Next.js"],
	["/skill:vue", "Vue 3 + Composition API + Pinia"],
	["/skill:angular", "Angular standalone + signals"],
	["/skill:web-frontend", "HTML5 / CSS3 / accessibility / perf"],
	["/skill:bun", "Bun runtime + package manager"],
	["/skill:deno", "Deno + TypeScript-native"],
	["/skill:nodejs", "Node.js + ESM + async"],
	// Styling / markup
	["/skill:html", "HTML5 semantic + a11y"],
	["/skill:css", "CSS3 + custom properties"],
	["/skill:scss", "SCSS/Sass + BEM"],
	// Backend / typed
	["/skill:csharp", "C# / .NET + EF + ASP.NET"],
	// Container / OS / ops
	["/skill:docker", "Docker + Compose + Dockerfile"],
	["/skill:devops", "CI/CD pipelines + IaC"],
	["/skill:nginx", "Nginx reverse proxy + SSL"],
	["/skill:linux", "Linux sysadmin + systemd"],
	// Media
	["/skill:ffmpeg", "ffmpeg video/audio/image CLI"],
	// Engines
	["/skill:godot", "Godot 4.x + GDScript MVC"],
	// Tooling
	["/skill:git", "Git + GitHub CLI + Conventional Commits"],
	["/skill:tmux", "tmux session control"],
	["/skill:ssh", "SSH remote sessions + carriers"],
];

const SHORTCUT_ROWS: Array<[string, string]> = [
	["alt+c", "Clear the input editor"],
	["alt+n", "Insert a new line at the cursor"],
	["alt+x", "Cut all input text to the clipboard"],
	["Ctrl+T", "Toggle thinking block visibility (pi built-in)"],
];

// -----------------------------------------------------------------------------
// Sectioned command/description listings. The viewer word-wraps long
// descriptions inside the panel, so nothing is cut off.
// -----------------------------------------------------------------------------

/** One section: accent bold title, then per command an accent command
 * line, a white description line, and a blank spacer. */
function renderSectionRows(
	title: string,
	items: Array<[string, string]>,
): AftcViewerRow[] {
	const rows: AftcViewerRow[] = [
		{ text: title, tone: "accent", bold: true },
		{ text: "", divider: true },
	];
	for (const [command, description] of items) {
		rows.push({ text: command, tone: "accent" });
		rows.push({ text: description });
		rows.push({ text: "" });
	}
	return rows;
}

/** Format one registry entry as a [command, description] row. */
function entryRow(entry: HelpEntry): [string, string] {
	const command = `/${entry.command}${entry.args ? ` ${entry.args}` : ""}`;
	let description = entry.description;
	if (entry.aliases && entry.aliases.length > 0) {
		const aliases = entry.aliases.map((a) => `/${a}`).join(", ");
		description += ` (alias ${aliases})`;
	}
	return [command, description];
}

// -----------------------------------------------------------------------------
// HelpModule
// -----------------------------------------------------------------------------

class HelpModule {
	constructor(private pi: ExtensionAPI) {}

	attach(): void {
		this.registerCommands();
	}

	/** Rows for the /aftc-help viewer. Commands come from the registry,
	 *  grouped by category in canonical order; empty categories (eg
	 *  Providers while that module is disconnected) are skipped. */
	generateHelp(): AftcViewerRow[] {
		const entries = getHelpEntries();
		const rows: AftcViewerRow[] = [];
		rows.push({ text: "Available slash commands from the pi-aftc-toolset." });
		rows.push({ text: "" });
		for (const category of HELP_CATEGORY_ORDER) {
			const items = entries
				.filter((e) => e.category === category)
				.map(entryRow);
			if (items.length === 0) continue;
			rows.push(...renderSectionRows(category, items));
		}
		rows.push(...renderSectionRows("Skills", SKILL_ROWS));
		rows.push(...renderSectionRows("Shortcuts", SHORTCUT_ROWS));
		return rows;
	}

	private registerCommands(): void {
		registerHelpEntry({
			command: "aftc-help",
			description: "Show this help screen",
			category: "General",
		});

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
