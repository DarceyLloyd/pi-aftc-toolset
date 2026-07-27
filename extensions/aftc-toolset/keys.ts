/**
 * pi-aftc-toolset — keys feature module.
 *
 * Single home for every keyboard shortcut the toolset registers:
 *
 *   alt+c  — clear the input editor
 *   alt+n  — insert a newline at the caret (formatting control)
 *
 * Per AGENTS.md this is a self-contained feature module: it owns no shared
 * state and is wired into pi by the orchestrator in index.ts.
 *
 * See `keys.readme.md` for the full contract.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function createKeys(pi: ExtensionAPI): void {
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
}
