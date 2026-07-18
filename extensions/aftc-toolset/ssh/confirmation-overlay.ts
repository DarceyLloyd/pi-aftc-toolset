// Reusable overlay-based confirmation dialog for the SSH feature.
//
// Thin wrapper over the AFTC UI toolkit's showConfirm(): a GRUB-style
// full-screen takeover with the safe option highlighted by default.
// Outside the TUI it falls back to `ctx.ui.confirm`, so non-interactive
// callers behave exactly like the built-in confirm.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showConfirm } from "../../ui/aftcUi";

export interface ConfirmationOptions {
    title: string;
    body: string;
    yesLabel?: string;
    noLabel?: string;
}

const DEFAULT_YES = "Confirm";
const DEFAULT_NO = "Cancel";

/**
 * Show a two-button overlay modal. Returns true when the user picks the
 * yes action, false on no action or cancel. Resolves via the built-in
 * `ctx.ui.confirm` outside the TUI.
 */
export async function confirmOverlay(
    ctx: ExtensionCommandContext,
    options: ConfirmationOptions,
): Promise<boolean> {
    return showConfirm(ctx, {
        title: options.title,
        body: options.body,
        yesLabel: options.yesLabel ?? DEFAULT_YES,
        noLabel: options.noLabel ?? DEFAULT_NO,
    });
}
