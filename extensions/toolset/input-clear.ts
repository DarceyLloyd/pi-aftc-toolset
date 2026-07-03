/**
 * pi-aftc-toolset — input-clear feature module.
 *
 * Registers the `alt+c` keyboard shortcut to clear the text in pi's
 * input editor. Single key, no triple-press logic.
 *
 * The handler calls `ctx.ui.setEditorText("")` and shows a brief
 * notification so the user has feedback that the clear fired.
 *
 * Per rules.md §1.5, this is a self-contained feature module: it owns
 * no shared state and is wired into pi by the orchestrator in index.ts.
 *
 * See `input-clear.readme.md` for the full contract.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function createInputClear(pi: ExtensionAPI): void {
    pi.registerShortcut("alt+c", {
        description: "Clear the input editor (start typing fresh)",
        handler: async (ctx: ExtensionContext) => {
            // Guard: only meaningful when there's a UI (TUI / RPC).
            if (!ctx.ui.setEditorText) return;
            ctx.ui.setEditorText("");
            // ctx.ui.notify?.("Input cleared", "info");
        },
    });
}
