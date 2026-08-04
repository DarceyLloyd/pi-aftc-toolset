/**
 * pi-aftc-toolset — quick-open-dir feature module.
 *
 * Registers `/qd`: a menu of directories opened in the OS file manager
 * (cross-platform: explorer.exe / open / xdg-open).
 *
 *   Title:   AFTC Quick Dir Access
 *   Message: Choose your poison:
 *   Options:
 *     - Open users data dir          (%APPDATA%\pi-aftc-toolset\data or OS equivalent)
 *     - Open .pi data dir            (~/CONFIG_DIR_NAME — pi's own config dir)
 *
 * ADDING MORE OPTIONS: append one entry to TARGETS below — value, label,
 * resolve(), optional ensure (mkdir -p first). Nothing else to touch.
 *
 * This module absorbs the retired open-data-dir.ts (/aftc-open-data-dir,
 * /aftc-odd): menu option 1 is the same action. The file-manager launcher
 * (openInFileManager) moved here with it.
 *
 * See `quick-open-dir-readme.md` for the full contract.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import * as aftcConsole from "./ui/aftc-console";
import { showMenu } from "./ui/aftc-ui";
import { getDataDir } from "./paths";
import { registerHelpEntry } from "./help-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable dependencies (tests only — production uses the real thing)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuickOpenDirDeps {
	/** File-manager launcher. Defaults to openInFileManager. */
	open?: (dir: string) => void;
	/** Menu driver. Defaults to aftc-ui showMenu. */
	menu?: typeof showMenu;
}

// ─────────────────────────────────────────────────────────────────────────────
// Targets — add future menu options here (one entry each)
// ─────────────────────────────────────────────────────────────────────────────

interface QuickDirTarget {
	value: string;
	label: string;
	/** Absolute directory to open. */
	resolve: () => string;
	/** mkdir -p the target before opening (lazy-created dirs). */
	ensure?: boolean;
}

const TARGETS: QuickDirTarget[] = [
	{ value: "data", label: "Open users data dir", resolve: getDataDir, ensure: true },
	{ value: "pi", label: "Open .pi data dir", resolve: () => join(homedir(), CONFIG_DIR_NAME) },
];

// ─────────────────────────────────────────────────────────────────────────────
// File-manager launcher (absorbed from open-data-dir.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Open a directory in the platform file manager. Detached + unref so it
 *  doesn't block pi and survives pi exiting. */
function openInFileManager(dir: string): void {
	let cmd: string;

	switch (process.platform) {
		case "win32":
			cmd = "explorer.exe";
			break;
		case "darwin":
			cmd = "open";
			break;
		default:
			// Linux and other Unix-like: freedesktop xdg-open
			cmd = "xdg-open";
			break;
	}

	const child = spawn(cmd, [dir], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createQuickOpenDir(pi: ExtensionAPI, deps: QuickOpenDirDeps = {}): void {
	const open = deps.open ?? openInFileManager;
	const menu = deps.menu ?? showMenu;

	async function handler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
		const choice = await menu(ctx, {
			title: "AFTC Quick Dir Access",
			body: ["Choose your poison:"],
			items: TARGETS.map((t) => ({ value: t.value, label: t.label })),
		});
		if (!choice) return; // Esc — nothing to do

		const target = TARGETS.find((t) => t.value === choice);
		if (!target) return;

		const dir = target.resolve();
		if (target.ensure && !existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		if (!existsSync(dir)) {
			aftcConsole.warn(ctx, `Directory not found: ${dir}`);
			return;
		}

		open(dir);
		aftcConsole.emphasis(ctx, `Opened: ${dir}`);
	}

	registerHelpEntry({
		command: "qd",
		description: "Quick dir access menu (data dir, .pi dir)",
		category: "Navigation",
	});

	pi.registerCommand("qd", {
		description: "Quick dir access menu: open the data dir or .pi dir in the OS file manager.",
		handler,
	});

	aftcConsole.log("loaded — /qd (quick dir access menu)");
}
