// New-connection dialog for the SSH connection manager.
//
// A thin wrapper over the shared AFTC UI form suite (ui/aftcUi.ts —
// showForm/AftcForm). The dialog is a GRUB-style full-screen takeover:
// Tab / Shift+Tab move focus through the fields and onto the bottom
// [ SAVE CONNECTION ] action, Enter advances (or submits on the action),
// Escape cancels. The active field is unmistakable: accent ❯ label,
// boxed input with accent borders on a full-width dark-orange selection
// bar, and the only typing cursor on screen.
//
// Field / validation definition (enforced by AftcForm):
//   - connection name, username, and host are required;
//   - port (int, 1–65535) defaults to 22 when empty;
//   - timeout (int, 1–300 seconds) defaults to 30 when empty;
//   - private-key path and password are optional.
// An empty password is allowed (key auth / passwordless servers) but the
// caller confirms it first — see runNewConnectionFlow.
//
// Privacy: the password field is collected here so it can be SAVED with
// the connection (user-approved, local-only ssh.json). It is never
// logged, never shown back, and is covered by the redaction layer.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showForm, type AftcFormField } from "../../ui/aftcUi";
import { findSshConnection, saveSshConnection, type SshConnection } from "../connection-store";
import { confirmOverlay } from "../confirmation-overlay";

const TITLE = "New SSH connection";

const DEFAULT_PORT = 22;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 300;

export interface NewConnectionValues {
    name: string;
    username: string;
    host: string;
    port: number;
    connectTimeoutMs: number;
    identityFile?: string;
    /** Verbatim (untrimmed) password. Undefined when the field was empty. */
    password?: string;
}

/** The form definition. Password is NEVER pre-filled — an initial value
 * only exists when re-showing after the empty-password confirm, which by
 * definition had no password. */
function buildFields(initial: Partial<NewConnectionValues>): AftcFormField[] {
    return [
        { id: "name", label: "Connection name (required)", required: true, ...(initial.name ? { initial: initial.name } : {}) },
        { id: "username", label: "Username (required)", required: true, ...(initial.username ? { initial: initial.username } : {}) },
        { id: "host", label: "Host (required)", required: true, ...(initial.host ? { initial: initial.host } : {}) },
        { id: "port", label: "Port (leave empty for 22)", type: "int", min: 1, max: 65535, ...(initial.port !== undefined ? { initial: String(initial.port) } : {}) },
        { id: "timeout", label: "Connection timeout seconds (leave empty for 30)", type: "int", min: MIN_TIMEOUT_SECONDS, max: MAX_TIMEOUT_SECONDS, ...(initial.connectTimeoutMs !== undefined ? { initial: String(Math.round(initial.connectTimeoutMs / 1000)) } : {}) },
        { id: "key", label: "Private-key file path (optional)", ...(initial.identityFile ? { initial: initial.identityFile } : {}) },
        { id: "password", label: "Password (optional — leave empty for key auth / passwordless)", type: "password" },
    ];
}

/**
 * Show the new-connection dialog. Resolves with validated values, or null
 * when the user cancels. TUI-only (the manager already guards for that).
 */
export async function showNewConnectionDialog(
    ctx: ExtensionCommandContext,
    initial: Partial<NewConnectionValues> = {},
): Promise<NewConnectionValues | null> {
    if (ctx.mode !== "tui") return null;
    const values = await showForm(ctx, {
        title: TITLE,
        submitLabel: "[ SAVE CONNECTION ]",
        fields: buildFields(initial),
    });
    if (!values) return null;

    // Required string fields are guaranteed non-empty (AftcForm checked
    // the trim); resolve them trimmed. Password stays verbatim — only a
    // completely empty field counts as "no password".
    const name = String(values.name ?? "").trim();
    const username = String(values.username ?? "").trim();
    const host = String(values.host ?? "").trim();
    const port = typeof values.port === "number" ? values.port : DEFAULT_PORT;
    const timeoutSeconds = typeof values.timeout === "number" ? values.timeout : DEFAULT_TIMEOUT_SECONDS;
    const identityFile = String(values.key ?? "").trim() || undefined;
    const passwordRaw = typeof values.password === "string" ? values.password : "";

    return {
        name,
        username,
        host,
        port,
        connectTimeoutMs: timeoutSeconds * 1000,
        ...(identityFile ? { identityFile } : {}),
        ...(passwordRaw.length > 0 ? { password: passwordRaw } : {}),
    };
}

/**
 * The full Add-new-connection flow used by the connection manager:
 *
 *   dialog → (empty password? → Yes/No confirm) → (name collision? →
 *   replace confirm) → save to the local store → notify.
 *
 * Returns the saved connection, or null when the user cancelled. A "No"
 * on the password confirm re-opens the dialog with the entered values
 * preserved (except the password field, which was empty by definition).
 */
export async function runNewConnectionFlow(ctx: ExtensionCommandContext): Promise<SshConnection | null> {
    let initial: Partial<NewConnectionValues> = {};
    for (;;) {
        const values = await showNewConnectionDialog(ctx, initial);
        if (!values) return null;
        initial = values;

        if (!values.password) {
            const sure = await confirmOverlay(ctx, {
                title: "You didn't enter a password?",
                body: "Are you sure?",
                yesLabel: "Yes",
                noLabel: "No",
            });
            if (!sure) continue; // Back to the dialog, values preserved.
        }

        if (findSshConnection(values.name)) {
            const replace = await confirmOverlay(ctx, {
                title: "Replace saved SSH connection?",
                body: "A saved connection already uses this name. Replace its local settings?",
            });
            if (!replace) continue;
        }

        const connection: SshConnection = {
            name: values.name,
            username: values.username,
            host: values.host,
            port: values.port,
            connectTimeoutMs: values.connectTimeoutMs,
            ...(values.identityFile ? { identityFile: values.identityFile } : {}),
            ...(values.password ? { password: values.password } : {}),
        };
        saveSshConnection(connection);
        ctx.ui.notify(`SSH connection saved: ${values.name}`, "info");
        return connection;
    }
}
