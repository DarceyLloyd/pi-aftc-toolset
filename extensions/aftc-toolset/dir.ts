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
 * Per .dev/dev_guide.md section 1.5, this is a self-contained feature module: no
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

const ENTRY_TYPE = "dir-listing";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Determine the platform listing command. */
function listingCommand(): string {
	switch (process.platform) {
		case "win32":
			return "dir";
		case "darwin":
			return "ls -la";
		case "linux":
			return "ls -la";
		default:
			return "ls -la";
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
 * Silently catches errors and returns the error message prefixed with
 * "[error]".
 */
function runCommand(cmd: string): string {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
		const { execSync } = require("node:child_process") as typeof import("node:child_process");
		const result = execSync(cmd, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
		});
		return result;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return `[error] Failed to run "${cmd}": ${msg}`;
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
		const cmd = listingCommand();
		const label = platformLabel();

		const output = runCommand(cmd);
		const isError = output.startsWith("[error]");
		const data = buildListingData(cwd, output, label, isError ? output : undefined);

		// Append as a persistent entry in the session — renders inline
		// via the registered renderer above, never pollutes LLM context.
		pi.appendEntry(ENTRY_TYPE, data);
	}

	pi.registerCommand("dir", {
		description:
			"List current directory contents (platform-native: dir on Windows, ls -la on macOS/Linux). Alias: /ls",
		handler: dirHandler,
	});

	pi.registerCommand("ls", {
		description: "Alias for /dir — list current directory contents.",
		handler: dirHandler,
	});

	console.log("[aftc-toolset] loaded — /dir, /ls");
}
