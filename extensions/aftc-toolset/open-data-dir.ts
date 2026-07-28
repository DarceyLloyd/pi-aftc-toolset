/**
 * pi-aftc-toolset — open-data-dir feature module.
 *
 * Registers `/aftc-open-data-dir` (alias `/aftc-odd`) which opens the
 * persistent data directory in the OS file manager:
 *   - Windows: explorer.exe
 *   - Linux:   xdg-open (freedesktop standard — Ubuntu, Mint, Fedora, etc.)
 *   - macOS:   open
 *
 * The data dir holds turns.db, config.json, ssh.json,
 * report.html, and the aftc-codex knowledge base. It lives outside the
 * installed package so it survives `pi update`.
 */

import { spawn } from "node:child_process";
import * as aftcConsole from "./ui/aftc-console";
import { existsSync, mkdirSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getDataDir } from "./paths";
import { registerHelpEntry } from "./help-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Open a directory in the platform file manager. Detached + unref so it
 *  doesn't block pi and survives pi exiting. */
function openInFileManager(dir: string): void {
	let cmd: string;
	let args: string[];

	switch (process.platform) {
		case "win32":
			cmd = "explorer.exe";
			args = [dir];
			break;
		case "darwin":
			cmd = "open";
			args = [dir];
			break;
		default:
			// Linux and other Unix-like: freedesktop xdg-open
			cmd = "xdg-open";
			args = [dir];
			break;
	}

	const child = spawn(cmd, args, {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createOpenDataDir(pi: ExtensionAPI): void {
	async function handler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
		const dir = getDataDir();

		// Ensure the directory exists (it's created lazily by other modules,
		// but the user may run this before anything else has).
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		openInFileManager(dir);
		aftcConsole.emphasis(ctx, `Opened data dir: ${dir}`);
	}

	registerHelpEntry({
		command: "aftc-open-data-dir",
		description: "Open the data directory in your OS file manager",
		category: "General",
		aliases: ["aftc-odd"],
	});

	pi.registerCommand("aftc-open-data-dir", {
		description: "Open the pi-aftc-toolset data directory in your OS file manager.",
		handler,
	});

	pi.registerCommand("aftc-odd", {
		description: "Alias for /aftc-open-data-dir.",
		handler,
	});

	console.log("[aftc-toolset] loaded — /aftc-open-data-dir (/aftc-odd)");
}
