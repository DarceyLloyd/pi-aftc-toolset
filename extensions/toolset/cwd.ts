/**
 * pi-aftc-toolset — current-working-directory feature module.
 *
 * Registers the `/cwd` slash command which displays the current
 * working directory inline in pi's conversation/output area (above the
 * input prompt), using the same inline-card style as `/dir`.
 *
 * Uses pi.registerEntryRenderer() + pi.appendEntry() so the output
 * appears as a clean inline card in the conversation transcript,
 * not as a modal dialog, and never pollutes the LLM context.
 *
 * Per rules.md §1.5, this is a self-contained feature module: no
 * shared state with other feature modules, wired in by index.ts.
 */

import * as os from "node:os";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

// ─────────────────────────────────────────────────────────────────────────────
// Custom entry type constant — shared between renderer and appender
// ─────────────────────────────────────────────────────────────────────────────

const ENTRY_TYPE = "cwd-display";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Readable platform label for the header. */
function platformLabel(): string {
	switch (process.platform) {
		case "win32":
			return "Windows";
		case "darwin":
			return "macOS";
		case "linux":
			return "Linux";
		default:
			return process.platform;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom entry renderer — displays the cwd inline in the conversation
// ─────────────────────────────────────────────────────────────────────────────

interface CwdDisplayData {
	dir: string;
	platform: string;
	lines: string[];
}

/** Build the output lines from the current working directory. */
function buildCwdData(cwd: string, platform: string): CwdDisplayData {
	// Shorten $HOME paths to ~/ for readability.
	const home = os.homedir();
	const shortCwd = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

	const lines: string[] = [""];
	lines.push(`  Current working directory: ${shortCwd}  (${platform})`);
	// Trailing blank line so the card is cleanly separated from
	// pi's input prompt.
	lines.push("");

	return { dir: shortCwd, platform, lines };
}

/** Title string derived from the cwd data. */
function cwdTitle(data: CwdDisplayData): string {
	return `📂 ${data.dir}  (${data.platform})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createCwd(pi: ExtensionAPI): void {
	// Register the custom entry renderer so entries appear inline.
	pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data as CwdDisplayData;

		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(cwdTitle(data), 0, 0));
		for (const line of data.lines) {
			box.addChild(new Text(line, 0, 0));
		}
		return box;
	});

	async function cwdHandler(_args: string, _ctx: ExtensionCommandContext): Promise<void> {
		const cwd = process.cwd();
		const label = platformLabel();
		const data = buildCwdData(cwd, label);

		// Append as a persistent entry in the session — renders inline
		// via the registered renderer above, never pollutes LLM context.
		pi.appendEntry(ENTRY_TYPE, data);
	}

	pi.registerCommand("cwd", {
		description: "Show the current working directory (inline card, same style as /dir).",
		handler: cwdHandler,
	});

	console.log("[aftc-toolset] loaded — /cwd");
}
