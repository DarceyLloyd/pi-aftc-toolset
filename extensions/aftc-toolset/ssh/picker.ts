// Saved-connection and active-session pickers for the SSH feature.
//
// Both pickers are thin wrappers over the AFTC UI toolkit's showMenu():
// a GRUB-style full-screen takeover with /cd-style navigation. Only safe
// metadata (names, opaque ids) ever enters these components — credentials
// stay out of the model context by design.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showMenu } from "../../ui/aftcUi";
import { getSshConnections, type SshConnection } from "./connection-store";
import type { SshSessionView } from "./session";

export type ConnectionChoice = SshConnection | null;

/** Selects only safe connection names. Credentials never enter the component.
 *  Connect-only: creating connections lives in the manager (/ssh-cm). */
export async function pickConnection(ctx: ExtensionCommandContext): Promise<ConnectionChoice> {
    const connections = getSshConnections();
    if (connections.length === 0) return null;
    const selected = await showMenu(ctx, {
        title: "SSH connections",
        items: connections.map((connection) => ({ value: connection.name, label: connection.name })),
    });

    if (!selected) return null;
    return connections.find((connection) => connection.name === selected) ?? null;
}

/** Select an in-memory session using only its saved name and opaque id. */
export async function pickSession(ctx: ExtensionCommandContext, sessions: SshSessionView[]): Promise<string | null> {
    if (sessions.length === 0) return null;
    return showMenu(ctx, {
        title: "Active SSH sessions",
        items: sessions.map((session) => ({
            value: session.id,
            label: session.name,
            description: session.id,
        })),
    });
}
