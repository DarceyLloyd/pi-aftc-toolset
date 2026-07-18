import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SshConnection } from "./connection-store";
import { authMethodOverlay, connectionFormOverlay } from "./connection-form-overlay";

export interface SshCredentials {
    password?: string;
    identityPassphrase?: string;
}

export interface SshConnectRequest {
    connection: SshConnection;
    credentials: SshCredentials;
}

async function requiredSecretInput(ctx: ExtensionCommandContext, title: string, errorMessage: string): Promise<string | null> {
    const value = await ctx.ui.input(title);
    if (value !== undefined && value.length > 0) return value;
    await ctx.ui.select("SSH connection", [errorMessage]);
    return null;
}

async function editedOptionalValue(ctx: ExtensionCommandContext, label: string, current: string): Promise<string | null> {
    const value = await ctx.ui.input(`${label} (current: ${current}; leave empty to keep)`);
    if (value === undefined) return null;
    return value.trim() || current;
}

/**
 * Build an edited SshConnection from sequential built-in prompts. Used
 * outside the TUI as a fallback. Returns null on cancel.
 */
async function editConnectionByField(
    ctx: ExtensionCommandContext,
    connection: SshConnection,
): Promise<SshConnection | null> {
    const username = await editedOptionalValue(ctx, "Server username", connection.username);
    if (!username) return null;
    const host = await editedOptionalValue(ctx, "Server host", connection.host);
    if (!host) return null;
    const portInput = await ctx.ui.input(`Port (current: ${connection.port ?? 22}; leave empty to keep)`);
    if (portInput === undefined) return null;
    const port = portInput.trim() ? Number(portInput.trim()) : connection.port ?? 22;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        await ctx.ui.select("SSH connection", ["Port must be a number from 1 to 65535."]);
        return null;
    }
    const timeoutInput = await ctx.ui.input(`Connection timeout seconds (current: ${(connection.connectTimeoutMs ?? 30_000) / 1000}; leave empty to keep)`);
    if (timeoutInput === undefined) return null;
    const timeoutSeconds = timeoutInput.trim() ? Number(timeoutInput.trim()) : (connection.connectTimeoutMs ?? 30_000) / 1000;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 300) {
        await ctx.ui.select("SSH connection", ["Timeout must be a whole number from 1 to 300 seconds."]);
        return null;
    }
    const keyInput = await ctx.ui.input("Private-key file path (leave empty to keep, enter - to clear)");
    if (keyInput === undefined) return null;
    const identityFile = keyInput.trim() === "-" ? undefined : keyInput.trim() || connection.identityFile;
    const updated: SshConnection = { ...connection, username, host, port, connectTimeoutMs: timeoutSeconds * 1000 };
    if (identityFile) updated.identityFile = identityFile;
    else delete updated.identityFile;
    return updated;
}

async function collectCredentialsByField(ctx: ExtensionCommandContext, connection: SshConnection): Promise<SshCredentials | null> {
    const method = await ctx.ui.select("SSH authentication", connection.identityFile ? ["Password", "Private key"] : ["Password"]);
    if (!method) return null;
    if (method === "Password") {
        const password = await requiredSecretInput(
            ctx,
            "Enter password. It is used only for this connection attempt.",
            "A password is required.",
        );
        return password !== null ? { password } : null;
    }
    const passphrase = await ctx.ui.input("Enter private-key passphrase, or leave empty for an unencrypted key.");
    return passphrase ? { identityPassphrase: passphrase } : {};
}

/** Resolve an SshConnection for the edit form. */
async function promptForConnection(
    ctx: ExtensionCommandContext,
    title: string,
    initial: Partial<SshConnection> = {},
): Promise<SshConnection | null> {
    if (ctx.mode === "tui") {
        const result = await connectionFormOverlay(ctx, { title, initial });
        if (!result) return null;
        return {
            name: result.name,
            username: result.username,
            host: result.host,
            port: result.port,
            connectTimeoutMs: result.connectTimeoutMs,
            ...(result.identityFile ? { identityFile: result.identityFile } : {}),
        };
    }
    return editConnectionByField(ctx, initial as SshConnection);
}

async function connectionRequest(ctx: ExtensionCommandContext, connection: SshConnection): Promise<SshConnectRequest | null> {
    // A saved password is used directly — no per-attempt prompt. The prompt
    // flow below only runs for connections without one.
    if (connection.password) {
        return { connection, credentials: { password: connection.password } };
    }
    let credentials: SshCredentials | null;
    if (ctx.mode === "tui") {
        const method = await authMethodOverlay(
            ctx,
            "SSH authentication",
            connection.identityFile ? "key" : "password",
        );
        if (!method) return null;
        if (method === "password") {
            const password = await requiredSecretInput(
                ctx,
                "Enter password. It is used only for this connection attempt.",
                "A password is required.",
            );
            if (password === null) return null;
            credentials = { password };
        } else {
            const passphrase = await ctx.ui.input("Enter private-key passphrase, or leave empty for an unencrypted key.");
            credentials = passphrase ? { identityPassphrase: passphrase } : {};
        }
    } else {
        credentials = await collectCredentialsByField(ctx, connection);
    }
    if (!credentials) return null;
    return { connection, credentials };
}

export async function createSavedConnectionRequest(ctx: ExtensionCommandContext, connection: SshConnection): Promise<SshConnectRequest | null> {
    return connectionRequest(ctx, connection);
}

export async function editConnectionSettings(
    ctx: ExtensionCommandContext,
    connection: SshConnection,
): Promise<SshConnection | null> {
    return promptForConnection(ctx, "Edit SSH connection", connection);
}
