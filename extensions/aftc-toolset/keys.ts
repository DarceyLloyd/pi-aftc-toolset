/**
 * pi-aftc-toolset — keys feature module.
 *
 * Single home for every keyboard shortcut the toolset registers:
 *
 *   alt+c  — clear the input editor
 *   alt+n  — insert a newline at the caret (formatting control)
 *   alt+x  — cut all input-editor text to the clipboard
 *
 * The cut action also exists as the `/aftc-cut-input` slash command (same
 * handler), so it is discoverable via `/aftc-help` and usable from RPC
 * mode where there is no key event stream.
 *
 * Per AGENTS.md this is a self-contained feature module: it owns no shared
 * state and is wired into pi by the orchestrator in index.ts.
 *
 * See `keys-readme.md` for the full contract.
 */

import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable dependencies (tests only — production uses pi's own clipboard)
// ─────────────────────────────────────────────────────────────────────────────

export interface KeysDeps {
	/**
	 * Clipboard writer. Defaults to pi's own `copyToClipboard` (the same
	 * helper pi's built-in copy features use): native addon, then
	 * pbcopy / clip / wl-copy / xclip / xsel / termux, then an OSC 52
	 * fallback — cross-platform, and it throws when every method fails.
	 */
	copy?: (text: string) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared cut handler — alt+x and /aftc-cut-input run the same code path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cut ALL text from the input editor into the system clipboard.
 *
 * Cut semantics: the editor is only cleared AFTER the clipboard write
 * succeeds — if every clipboard method fails (headless Linux without
 * xclip/xsel/wl-copy and no OSC 52 capable terminal) the text stays in
 * the editor so it is never lost.
 */
async function cutInputToClipboard(
	ctx: ExtensionContext,
	copy: (text: string) => Promise<void>,
): Promise<void> {
	// Guard: only meaningful when there's a UI (TUI / RPC).
	if (!ctx.hasUI) return;

	const text = ctx.ui.getEditorText();
	if (!text || text.trim() === "") {
		aftcConsole.warn(ctx, "Input is empty — nothing to cut.");
		return;
	}

	try {
		await copy(text);
	} catch (err) {
		aftcConsole.error(ctx, `Could not copy to the clipboard — input left intact (${(err as Error).message}).`);
		return;
	}

	ctx.ui.setEditorText("");
	aftcConsole.emphasis(ctx, `Cut ${text.length} chars from the input to the clipboard.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY  —  wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createKeys(pi: ExtensionAPI, deps: KeysDeps = {}): void {
	const copy = deps.copy ?? copyToClipboard;

	// --- alt+c: clear the input editor (moved from input-clear.ts) ---------
	pi.registerShortcut("alt+c", {
		description: "Clear the input editor (start typing fresh)",
		handler: async (ctx: ExtensionContext) => {
			// Guard: only meaningful when there's a UI (TUI / RPC).
			if (!ctx.hasUI) return;
			ctx.ui.setEditorText("");
		},
	});

	// --- alt+n: insert a newline at the caret ------------------------------
	pi.registerShortcut("alt+n", {
		description: "Insert a new line at the cursor",
		handler: async (ctx: ExtensionContext) => {
			if (!ctx.hasUI) return;
			// pasteToEditor routes through the editor's own paste handling,
			// which inserts at the caret instead of replacing the buffer
			// (setEditorText would move the caret to the end).
			ctx.ui.pasteToEditor("\n");
		},
	});

	// --- alt+x: cut all input text to the clipboard ------------------------
	pi.registerShortcut("alt+x", {
		description: "Cut all input text to the clipboard",
		handler: async (ctx: ExtensionContext) => {
			await cutInputToClipboard(ctx, copy);
		},
	});

	// --- /aftc-cut-input: the same cut as a slash command ------------------
	// Note: in the TUI a slash command consumes the editor line it was typed
	// on, so the command usually finds an empty editor there (use alt+x);
	// it earns its keep in RPC mode and as discoverable documentation.
	registerHelpEntry({
		command: "aftc-cut-input",
		description: "Cut all input-editor text to the clipboard (same as alt+x)",
		category: "General",
	});

	pi.registerCommand("aftc-cut-input", {
		description: "Cut all text from the input editor to the clipboard (same as the alt+x shortcut)",
		handler: async (_args: string, ctx: ExtensionContext) => {
			await cutInputToClipboard(ctx, copy);
		},
	});
}
