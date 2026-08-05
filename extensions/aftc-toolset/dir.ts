/**
 * pi-aftc-toolset — directory listing feature module.
 *
 * Registers the `/dir` slash command (aliased `/ls`) which displays the
 * current working directory name followed by a platform-appropriate
 * directory listing inline in pi's conversation/output area (above the
 * input prompt).
 *
 * Uses pi.registerEntryRenderer() + pi.appendEntry() so the listing
 * appears as a clean inline card in the conversation transcript,
 * not as a modal dialog.
 *
 * Platform detection (from Node's process.platform):
 *   - win32  → `dir` (Windows-style listing)
 *   - darwin → `ls -la` (macOS)
 *   - linux  → `ls -la`
 *   - others → `ls -la` (fallback)
 *
 * Per AGENTS.md, this is a self-contained feature module: no
 * shared state with other feature modules, wired in by index.ts.
 *
 * See `dir-readme.md` for the full contract.
 */

import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { registerHelpEntry } from "./help-registry";
import * as aftcConsole from "./ui/aftc-console";

// ─────────────────────────────────────────────────────────────────────────────
// Custom entry type constant — shared between renderer and appender
// ─────────────────────────────────────────────────────────────────────────────

const ENTRY_TYPE = "dir-listing";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Determine the platform listing command. */
function listingCommand(): { file: string; args: string[] } {
	switch (process.platform) {
		case "win32":
			return { file: "dir", args: [] };
		case "darwin":
			return { file: "ls", args: ["-la"] };
		case "linux":
			return { file: "ls", args: ["-la"] };
		default:
			return { file: "ls", args: ["-la"] };
	}
}

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

/**
 * Run a system command synchronously and return its output as a string.
 * Uses `execFileSync` (NOT `execSync`) so no shell is spawned — the
 * command and its arguments are passed as an array, eliminating any
 * shell-injection / quoting surprises. Silently catches errors and
 * returns the error message prefixed with "[error]".
 */
function runCommand(file: string, args: string[]): string {
	try {
		const result = execFileSync(file, args, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return result;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return `[error] Failed to run "${file}": ${msg}`;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom entry renderer — displays the listing inline in the conversation
// ─────────────────────────────────────────────────────────────────────────────

interface DirListingData {
	dir: string;
	platform: string;
	lines: string[];
	error?: string;
}

/** Build the full listing output from cwd + raw command output. */
function buildListingData(cwd: string, rawOutput: string, platform: string, error?: string): DirListingData {
	// Shorten $HOME paths to ~/ for readability.
	const home = os.homedir();
	const shortCwd = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

	// Split the raw output into individual lines, trimming trailing empties.
	const outputLines = rawOutput.split(/\r?\n/);
	let lastNonEmpty = outputLines.length - 1;
	while (lastNonEmpty >= 0 && outputLines[lastNonEmpty].trim() === "") {
		lastNonEmpty--;
	}

	const lines: string[] = [""];
	lines.push(`  Directory: ${shortCwd}  (${platform})`);
	lines.push("");
	for (let i = 0; i <= lastNonEmpty; i++) {
		lines.push(`  ${outputLines[i]}`);
	}
	// Trailing blank line so the listing is cleanly separated from
	// pi's input prompt.
	lines.push("");

	return { dir: shortCwd, platform, lines, error };
}

/** Title string derived from the listing data. */
function listingTitle(data: DirListingData): string {
	return data.error
		? `📁 ${data.dir} — error`
		: `📁 ${data.dir}  (${data.platform})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createDir(pi: ExtensionAPI): void {
	// Register the custom entry renderer so entries appear inline.
	pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data as DirListingData;

		// Build a box with a subtle background so the listing stands out.
		const inner: Text[] = [];
		for (const line of data.lines) {
			inner.push(new Text(line, 0, 0));
		}

		// Wrap everything in a Box with a custom-message background.
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(listingTitle(data), 0, 0));
		for (const t of inner) {
			box.addChild(t);
		}
		return box;
	});

	// Shared handler for both /dir and /ls.
	async function dirHandler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
		const cwd = ctx.cwd;
		const { file, args } = listingCommand();
		const label = platformLabel();

		const output = runCommand(file, args);
		const isError = output.startsWith("[error]");
		const data = buildListingData(cwd, output, label, isError ? output : undefined);

		// Append as a persistent entry in the session — renders inline
		// via the registered renderer above, never pollutes LLM context.
		pi.appendEntry(ENTRY_TYPE, data);
	}

	registerHelpEntry({
		command: "dir",
		description: "List the current directory",
		category: "Navigation",
		aliases: ["ls"],
	});

	pi.registerCommand("dir", {
		description:
			"List current directory contents (platform-native: dir on Windows, ls -la on macOS/Linux). Alias: /ls",
		handler: dirHandler,
	});

	pi.registerCommand("ls", {
		description: "Alias for /dir — list current directory contents.",
		handler: dirHandler,
	});

	aftcConsole.log("loaded — /dir, /ls");
}
