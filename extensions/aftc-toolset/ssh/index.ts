import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateHead, truncateTail, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findSshConnection, getSshConnections, getSshSessionAutoAccept, saveSshConnection, setSshSessionAutoAccept } from "./connection-store";
import { createConnectionManager } from "./connection-manager/ConnectionManager";
import { createSavedConnectionRequest } from "./connection-form";
import { pickConnection, pickSession } from "./picker";
import { formatSshStatus, SshHostKeyApprovalRequired, SshSessionManager, type SshSessionView } from "./session";
import { showSshTerminal } from "./terminal-overlay";
import { showViewer } from "../../ui/aftcUi";
import { confirmOverlay } from "./confirmation-overlay";
import { sshSafeError as safeError, sshSafeErrorMessage as safeMessage } from "./redaction";

const LOCAL_OUTPUT_DISPLAY_MAX = 50_000;

/** Build the full (unbounded) human-readable command output. */
export function buildRunOutput(output: { stdout: string; stderr: string; truncated: boolean }): string {
    const parts = [
        output.stdout ? `stdout:\n${output.stdout}` : "",
        output.stderr ? `stderr:\n${output.stderr}` : "",
    ].filter(Boolean);
    const suffix = output.truncated ? "\n\n[Carrier output was truncated locally.]" : "";
    return (parts.join("\n\n") || "(no output)") + suffix;
}

/**
 * When command output exceeds the local display bound, write the full (already
 * redacted) text to a local temp file and return its path so the user can
 * inspect it. The file is local-only; it is never returned to the model. The
 * caller is responsible for redacting connection metadata before calling.
 * Returns null when the output fits the display bound or the file cannot be written.
 */
export function localOutputCapturePath(text: string): string | null {
    if (Buffer.byteLength(text, "utf8") <= LOCAL_OUTPUT_DISPLAY_MAX) return null;
    try {
        const filePath = path.join(os.tmpdir(), "pi-aftc-ssh-output.txt");
        fs.writeFileSync(filePath, text, "utf8");
        return filePath;
    } catch {
        return null;
    }
}

function localPath(cwd: string, value: string): string {
    return path.resolve(cwd, value.replace(/^@/, ""));
}

const SSH_TOOL_MAX_LINES = 2000;
const SSH_TOOL_MAX_BYTES = 50_000;

/**
 * Bound model-facing output with Pi's truncators. When truncation occurs, the
 * full (already redacted) text is written to a local temp file and the model is
 * told exactly where the complete version lives. The file is local-only and is
 * never returned to the model.
 */
function boundToolOutput(text: string, mode: "head" | "tail"): string {
    const result = mode === "tail"
        ? truncateTail(text, { maxLines: SSH_TOOL_MAX_LINES, maxBytes: SSH_TOOL_MAX_BYTES })
        : truncateHead(text, { maxLines: SSH_TOOL_MAX_LINES, maxBytes: SSH_TOOL_MAX_BYTES });
    if (!result.truncated) return text;
    const capturePath = writeLocalCapture(text);
    const where = capturePath ? ` Full version saved locally: ${capturePath}` : "";
    return `${result.content}\n\n[Output truncated to ${SSH_TOOL_MAX_BYTES / 1000} KB / ${SSH_TOOL_MAX_LINES} lines.${where}]`;
}

function writeLocalCapture(text: string): string | null {
    try {
        const filePath = path.join(os.tmpdir(), "pi-aftc-ssh-output.txt");
        fs.writeFileSync(filePath, text, "utf8");
        return filePath;
    } catch {
        return null;
    }
}

function parseTwoPaths(args: string): [string, string] | null {
    const values: string[] = [];
    const matcher = /"([^\"]*)"|'([^']*)'|(\S+)/g;
    for (let match = matcher.exec(args); match; match = matcher.exec(args)) {
        values.push(match[1] ?? match[2] ?? match[3] ?? "");
    }
    return values.length === 2 ? [values[0]!, values[1]!] : null;
}

export function createSshModule(pi: ExtensionAPI, sessions: SshSessionManager = new SshSessionManager()): void {

    /**
     * Connect (or reconnect) a saved SSH server by name. Throws model-friendly
     * errors for unknown names, headless mode, and local cancellation. It never
     * creates, edits, or deletes a saved connection, and accepts no endpoint or
     * credential value - only the saved name.
     */
    async function connectSaved(ctx: ExtensionCommandContext, name: string): Promise<SshSessionView> {
        const existing = sessions.list().find((item) => item.name === name);
        if (existing) return existing;
        const connection = findSshConnection(name);
        if (!connection) throw new Error(`No saved connection named '${name}'.`);
        if (!ctx.hasUI) throw new Error("Cannot connect from headless mode. Use /ssh-connect interactively in the TUI.");
        const request = await createSavedConnectionRequest(ctx, connection);
        if (!request) throw new Error("SSH connection was cancelled locally.");
        try {
            return await sessions.connect(request);
        } catch (error) {
            if (!(error instanceof SshHostKeyApprovalRequired)) throw error;
            // Saved preference: skip the approval dialog entirely. Changed
            // host keys are still rejected by the carrier regardless.
            if (getSshSessionAutoAccept()) return await sessions.connect(request, true);
            const approved = await confirmOverlay(ctx, {
                title: "New SSH host key",
                body: "Trust this new host key for the current Pi session?\nTurn auto accept on via slash command /ssh-auto-accept-session-on",
            });
            if (!approved) throw new Error("SSH connection was cancelled locally.");
            return await sessions.connect(request, true);
        }
    }

    pi.registerCommand("ssh-auto-accept-session-on", {
        description: "Auto-approve NEW SSH host keys (saved in ssh.json). Changed keys still ask.",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            setSshSessionAutoAccept(true);
            ctx.ui.notify("SSH new-host-key auto-accept is ON. New host keys will be trusted without asking; changed keys are still rejected.", "warning");
        },
    });

    pi.registerCommand("ssh-auto-accept-session-off", {
        description: "Ask for approval before trusting NEW SSH host keys (default).",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            setSshSessionAutoAccept(false);
            ctx.ui.notify("SSH new-host-key auto-accept is OFF. New host keys will ask for approval.", "info");
        },
    });

    pi.registerCommand("ssh-connections", {
        description: "List locally saved SSH connection names.",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            const names = getSshConnections().map((connection) => connection.name);
            await showViewer(ctx, { title: "Saved SSH connections", lines: names.length ? names : ["No saved SSH connections."] });
        },
    });

    pi.registerCommand("ssh-connect", {
        description: "Connect using a saved SSH connection.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            if (!args.trim() && getSshConnections().length === 0) {
                return ctx.ui.notify("No saved SSH connections. Create one in the connection manager: /ssh-cm", "warning");
            }
            const selected = args.trim() ? findSshConnection(args.trim()) ?? null : await pickConnection(ctx);
            if (!selected) return;
            const request = await createSavedConnectionRequest(ctx, selected);
            if (!request) return;
            try {
                let session;
                try {
                    session = await sessions.connect(request);
                } catch (error) {
                    if (!(error instanceof SshHostKeyApprovalRequired)) throw error;
                    const approved = getSshSessionAutoAccept() || (ctx.hasUI && await confirmOverlay(ctx, {
                        title: "New SSH host key",
                        body: "Trust this new host key for the current Pi session?\nTurn auto accept on via slash command /ssh-auto-accept-session-on",
                    }));
                    if (!approved) return;
                    session = await sessions.connect(request, true);
                }
                ctx.ui.notify(`SSH connected: ${session.name}`, "info");
            } catch {
                ctx.ui.notify("SSH connection failed. Check the saved connection.", "error");
            }
        },
    });

    pi.registerCommand("ssh-status", {
        description: "Show SSH connection status.",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            // One-line warning notification, not a modal. The
            // model-facing ssh_status tool keeps its own output.
            const status = sessions.getStatus();
            const text = status.connected
                ? `SSH Status: Connected to ${status.sessions.map((session) => session.name).join(", ")}`
                : "SSH Status: Not connected";
            ctx.ui.notify(text, "warning");
        },
    });

    pi.registerCommand("ssh-select", {
        description: "Select an active SSH session for local SSH commands.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const id = args.trim() || await pickSession(ctx, sessions.list());
            if (!id) return ctx.ui.notify("No SSH session was selected.", "warning");
            if (!sessions.select(id)) return ctx.ui.notify("That SSH session is not connected.", "warning");
            ctx.ui.notify("SSH session selected.", "info");
        },
    });

    pi.registerCommand("ssh-disconnect", {
        description: "Disconnect an SSH session by opaque id.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const id = args.trim() || sessions.selected()?.id;
            if (!id) return ctx.ui.notify("No SSH session is connected.", "warning");
            try {
                await sessions.disconnect(id);
                ctx.ui.notify("SSH disconnected.", "info");
            } catch {
                ctx.ui.notify("SSH disconnect failed.", "error");
            }
        },
    });

    pi.registerCommand("ssh-shell", {
        description: "Open an interactive PTY shell on the selected SSH session.",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            const session = sessions.selected();
            if (!session) return ctx.ui.notify("No SSH session is connected.", "warning");
            try {
                const shellId = await sessions.openShell(session.id);
                await showSshTerminal(ctx, sessions, session.id, shellId);
            } catch {
                ctx.ui.notify("SSH shell could not be opened.", "error");
            }
        },
    });

    pi.registerCommand("ssh-close-shell", {
        description: "Close an interactive shell by opaque shell id.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const session = sessions.selected();
            const shellId = args.trim();
            if (!session || !shellId) return ctx.ui.notify("Select a session and provide a shell id.", "warning");
            try {
                await sessions.closeShell(session.id, shellId);
                ctx.ui.notify("SSH shell closed.", "info");
            } catch {
                ctx.ui.notify("SSH shell close failed.", "error");
            }
        },
    });

    pi.registerCommand("ssh-interrupt", {
        description: "Send Ctrl+C and Ctrl+D recovery keys to an interactive shell.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const session = sessions.selected();
            const shellId = args.trim();
            if (!session || !shellId) return ctx.ui.notify("Select a session and provide a shell id.", "warning");
            try {
                await sessions.interrupt(session.id, shellId);
                ctx.ui.notify("SSH interrupt sent.", "info");
            } catch {
                ctx.ui.notify("SSH interrupt failed.", "error");
            }
        },
    });

    pi.registerCommand("ssh-help", {
        description: "Show SSH connection and interactive-shell guidance.",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            await showViewer(ctx, { title: "SSH help", lines: [
                "/ssh-connect [name] connects to a saved connection (new ones are created in /ssh-cm).",
                "/ssh-cm opens the connection manager (add / edit / delete saved connections).",
                "/ssh-shell opens a full-screen interactive terminal on the selected session.",
                "Use Ctrl+] to leave the terminal locally; Escape is sent to the remote program.",
                "/ssh-close-shell <id> closes a shell; /ssh-interrupt <id> sends recovery keys.",
                "/ssh-upload and /ssh-download transfer files (--preserve keeps attributes).",
                "/ssh-status shows connection status; /ssh-disconnect [id] closes a session.",
                "/ssh-auto-accept-session-on trusts NEW host keys without asking; -off restores the prompt.",
                "For commands, remote file work, or driven programs, ask the AI model — its SSH tools cover those.",
            ] });
        },
    });

    pi.registerCommand("ssh-upload", {
        description: "Upload a local file to the selected SSH session. Quote paths containing spaces. Add --preserve to keep timestamps and permissions.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const session = sessions.selected();
            const preserve = args.includes("--preserve");
            const paths = parseTwoPaths(args.replace(/--preserve/g, ""));
            if (!session || !paths) return ctx.ui.notify("Select a session and provide local and remote paths.", "warning");
            const [localInput, remotePath] = paths;
            const localFile = localPath(ctx.cwd, localInput);
            if (!fs.existsSync(localFile) || !fs.statSync(localFile).isFile()) {
                return ctx.ui.notify("The local upload path is not a file.", "warning");
            }
            try {
                await sessions.stat(session.id, remotePath);
                const approved = await confirmOverlay(ctx, { title: "Replace remote file?", body: "The remote path already exists. Continue with upload?" });
                if (!approved) return;
            } catch {
                // A failed stat normally means the upload creates a new remote file.
            }
            try {
                await sessions.upload(session.id, localFile, remotePath, preserve);
                ctx.ui.notify(preserve ? "SSH upload completed (attributes preserved)." : "SSH upload completed.", "info");
            } catch {
                ctx.ui.notify("SSH upload failed.", "error");
            }
        },
    });

    pi.registerCommand("ssh-download", {
        description: "Download a remote file from the selected SSH session. Quote paths containing spaces. Add --preserve to keep timestamps (and permissions on POSIX hosts).",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const session = sessions.selected();
            const preserve = args.includes("--preserve");
            const paths = parseTwoPaths(args.replace(/--preserve/g, ""));
            if (!session || !paths) return ctx.ui.notify("Select a session and provide remote and local paths.", "warning");
            const [remotePath, localInput] = paths;
            const localFile = localPath(ctx.cwd, localInput);
            if (fs.existsSync(localFile)) {
                const approved = await confirmOverlay(ctx, { title: "Replace local file?", body: "The local path already exists. Continue with download?" });
                if (!approved) return;
            }
            try {
                await sessions.download(session.id, remotePath, localFile, preserve);
                ctx.ui.notify(preserve ? "SSH download completed (attributes preserved)." : "SSH download completed.", "info");
            } catch {
                ctx.ui.notify("SSH download failed.", "error");
            }
        },
    });

    pi.registerCommand("ssh-rename", {
        description: "Rename a remote file or directory on the selected SSH session after confirmation.",
        handler: async (args: string, ctx: ExtensionCommandContext) => {
            const session = sessions.selected();
            const paths = parseTwoPaths(args);
            if (!session || !paths) return ctx.ui.notify("Select a session and provide source and destination paths.", "warning");
            let destinationExists = false;
            try { await sessions.stat(session.id, paths[1]); destinationExists = true; } catch { /* New destination path. */ }
            if (!await confirmOverlay(ctx, {
                title: destinationExists ? "Replace remote path?" : "Rename remote path?",
                body: destinationExists ? "The destination exists. Continue with replacement?" : "Rename the selected remote path?",
            })) return;
            try {
                await sessions.rename(session.id, paths[0], paths[1]);
                ctx.ui.notify("SSH remote path renamed.", "info");
            } catch {
                ctx.ui.notify("SSH rename failed.", "error");
            }
        },
    });

    pi.registerTool({
        name: "ssh_status", label: "SSH Status", description: "List locally authorized SSH sessions by name and opaque id, or report why SSH is not connected.",
        promptSnippet: "List authorized SSH sessions and their opaque ids, or why SSH is not connected",
        promptGuidelines: ["Use ssh_status to learn which saved sessions are connected and their opaque ids before running commands, transfers, or shell work."],
        parameters: Type.Object({}),
        execute: async () => {
            const status = sessions.getStatus();
            const hint = status.connected ? "" : "\n\nConnect a saved server with ssh_connect(<name>); you cannot create connections.";
            return { content: [{ type: "text", text: formatSshStatus(status) + hint }] };
        },
    });

    pi.registerTool({
        name: "ssh_connect", label: "SSH Connect", description: "Connect or reconnect a saved SSH server by saved connection name and return its opaque session id. It cannot create, edit, or delete connections, and accepts no host, user, port, password, key path, or passphrase. A local prompt collects credentials; it fails safely in headless mode.",
        promptSnippet: "Connect a saved SSH server by name (reconnect-safe; never creates connections)",
        promptGuidelines: [
            "Use ssh_connect to connect or reconnect a saved SSH server by its saved name.",
            "ssh_connect returns the same opaque session id when the saved name is already connected; it cannot create connections.",
        ],
        parameters: Type.Object({ connectionName: Type.String({ description: "Saved connection name already created locally by the user." }) }),
        execute: async (_id, params, _signal, _onUpdate, ctx) => {
            const session = await connectSaved(ctx, params.connectionName);
            return { content: [{ type: "text", text: `SSH session ready: ${session.id} (${session.name}).` }] };
        },
    });

    pi.registerTool({
        name: "ssh_disconnect", label: "SSH Disconnect", description: "Disconnect an SSH session by opaque id. Throws when the id is stale or already disconnected.",
        promptSnippet: "Disconnect an SSH session by opaque id when work is done",
        promptGuidelines: ["Use ssh_disconnect to close an SSH session by its opaque id when work is done."],
        parameters: Type.Object({ sessionId: Type.String({ description: "Opaque session id from ssh_status or ssh_connect." }) }),
        execute: async (_id, params) => {
            try {
                await sessions.disconnect(params.sessionId);
            } catch (error) {
                throw new Error(safeMessage(error));
            }
            return { content: [{ type: "text", text: "SSH session disconnected." }] };
        },
    });

    pi.registerTool({
        name: "ssh_run", label: "SSH Run", description: "Run a non-interactive command on an already connected opaque SSH session. Output is truncated to 2000 lines / 50 KB.",
        promptSnippet: "Run a bounded non-interactive command on an SSH session",
        promptGuidelines: [
            "Use ssh_run for bounded, non-interactive commands.",
            "Use ssh_open_shell for interactive terminal programs (Nano, Vi, htop) and the ssh_* SFTP tools for remote files.",
        ],
        parameters: Type.Object({
            sessionId: Type.String(),
            command: Type.String(),
            timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
            stdinText: Type.Optional(Type.String({ maxLength: 65536, description: "Optional bounded standard input; never use for credentials." })),
        }),
        execute: async (_id, params, signal) => {
            const timeoutMs = (params.timeout ?? 30) * 1000;
            let output;
            try {
                output = await sessions.run(params.sessionId, params.command, timeoutMs, signal, params.stdinText);
            } catch (error) {
                throw new Error(safeMessage(error));
            }
            return {
                content: [{ type: "text", text: boundToolOutput(sessions.redactText(params.sessionId, buildRunOutput(output)), "tail") }],
                details: { exitCode: output.exitCode, truncated: output.truncated, stdout: Boolean(output.stdout), stderr: Boolean(output.stderr) },
            };
        },
    });

    pi.registerTool({
        name: "ssh_open_shell", label: "SSH Open Shell", description: "Open an interactive PTY shell for Nano, Vi, and other interactive programs.",
        promptSnippet: "Open an interactive PTY shell (Nano, Vi, htop) on an SSH session",
        promptGuidelines: [
            "Use ssh_open_shell only for interactive terminal programs (Nano, Vi, htop, tmux).",
            "Use ssh_run for one-shot commands and the ssh_* SFTP tools for remote files.",
        ],
        parameters: Type.Object({ sessionId: Type.String() }),
        execute: async (_id, params) => ({ content: [{ type: "text", text: `SSH shell opened: ${await sessions.openShell(params.sessionId)}` }] }),
    });

    pi.registerTool({
        name: "ssh_send_keys", label: "SSH Send Keys", description: "Send text or named terminal keys to an interactive SSH shell.",
        promptSnippet: "Send text or named terminal keys to an SSH shell",
        parameters: Type.Object({ sessionId: Type.String(), shellId: Type.String(), keys: Type.Array(Type.String()) }),
        execute: async (_id, params) => {
            await sessions.sendKeys(params.sessionId, params.shellId, params.keys);
            return { content: [{ type: "text", text: "SSH keys sent." }] };
        },
    });

    pi.registerTool({
        name: "ssh_paste", label: "SSH Paste", description: "Paste text into an interactive SSH shell.",
        promptSnippet: "Paste text into an SSH shell",
        parameters: Type.Object({ sessionId: Type.String(), shellId: Type.String(), text: Type.String() }),
        execute: async (_id, params) => {
            await sessions.paste(params.sessionId, params.shellId, params.text);
            return { content: [{ type: "text", text: "SSH text pasted." }] };
        },
    });

    pi.registerTool({
        name: "ssh_resize", label: "SSH Resize", description: "Resize an interactive SSH shell terminal.",
        promptSnippet: "Resize an SSH shell terminal",
        parameters: Type.Object({ sessionId: Type.String(), shellId: Type.String(), cols: Type.Integer({ minimum: 20, maximum: 500 }), rows: Type.Integer({ minimum: 5, maximum: 200 }) }),
        execute: async (_id, params) => {
            await sessions.resizeShell(params.sessionId, params.shellId, params.cols, params.rows);
            return { content: [{ type: "text", text: "SSH terminal resized." }] };
        },
    });

    pi.registerTool({
        name: "ssh_close", label: "SSH Close Shell", description: "Close an interactive SSH shell without disconnecting its SSH session.",
        promptSnippet: "Close an SSH shell without disconnecting its session",
        parameters: Type.Object({ sessionId: Type.String(), shellId: Type.String() }),
        execute: async (_id, params) => {
            await sessions.closeShell(params.sessionId, params.shellId);
            return { content: [{ type: "text", text: "SSH shell closed." }] };
        },
    });

    pi.registerTool({
        name: "ssh_peek", label: "SSH Peek", description: "Read bounded output (up to 50 KB) from an interactive SSH shell.",
        promptSnippet: "Read bounded output from an SSH shell",
        parameters: Type.Object({ sessionId: Type.String(), shellId: Type.String() }),
        execute: async (_id, params) => {
            const connection = sessions.list().find((session) => session.id === params.sessionId);
            if (!connection) throw safeError();
            const output = await sessions.peek(params.sessionId, params.shellId);
            const suffix = output.truncated ? "\n\n[Older terminal output was discarded locally.]" : "";
            return { content: [{ type: "text", text: (sessions.redactText(params.sessionId, output.text) || "(no output)") + suffix }] };
        },
    });

    pi.registerTool({
        name: "ssh_interrupt", label: "SSH Interrupt", description: "Send Ctrl+C and Ctrl+D recovery keys to an interactive SSH shell.",
        promptSnippet: "Send Ctrl+C / Ctrl+D recovery keys to an SSH shell",
        parameters: Type.Object({ sessionId: Type.String(), shellId: Type.String() }),
        execute: async (_id, params) => {
            await sessions.interrupt(params.sessionId, params.shellId);
            return { content: [{ type: "text", text: "SSH interrupt sent." }] };
        },
    });

    pi.registerTool({
        name: "ssh_upload", label: "SSH Upload", description: "Upload a local file to an already connected SSH session after local-user overwrite approval.",
        promptSnippet: "Upload a local file to an SSH session",
        promptGuidelines: ["Use ssh_upload for file uploads; the local user must approve any remote overwrite."],
        parameters: Type.Object({ sessionId: Type.String(), localPath: Type.String(), remotePath: Type.String(), preserve: Type.Optional(Type.Boolean({ description: "Restore remote timestamps and permission bits from the local file. Default false." })) }),
        execute: async (_id, params, signal, onUpdate, ctx) => {
            const localFile = localPath(ctx.cwd, params.localPath);
            if (!fs.existsSync(localFile) || !fs.statSync(localFile).isFile()) throw safeError();
            try {
                await sessions.stat(params.sessionId, params.remotePath);
                if (!ctx.hasUI || !await confirmOverlay(ctx, { title: "Replace remote file?", body: "Allow the model to replace the selected remote file?" })) {
                    throw new Error("Remote file replacement was not approved by the local user.");
                }
            } catch (error) {
                if (error instanceof Error && error.message.includes("not approved")) throw error;
            }
            try {
                await sessions.upload(params.sessionId, localFile, params.remotePath, params.preserve === true, signal, (bytes, total) => {
                    onUpdate?.({ content: [{ type: "text", text: `Transferred ${bytes}${total ? ` of ${total}` : ""} bytes.` }] });
                });
            } catch (error) {
                throw new Error(safeMessage(error));
            }
            return { content: [{ type: "text", text: "SSH upload completed." }] };
        },
    });

    pi.registerTool({
        name: "ssh_download", label: "SSH Download", description: "Download a remote file from an already connected SSH session after local-user overwrite approval.",
        promptSnippet: "Download a remote file from an SSH session",
        promptGuidelines: ["Use ssh_download for file downloads; the local user must approve any local overwrite."],
        parameters: Type.Object({ sessionId: Type.String(), remotePath: Type.String(), localPath: Type.String(), preserve: Type.Optional(Type.Boolean({ description: "Restore local timestamps (and permissions on POSIX hosts) from the remote file. Default false." })) }),
        execute: async (_id, params, signal, onUpdate, ctx) => {
            const localFile = localPath(ctx.cwd, params.localPath);
            if (fs.existsSync(localFile) && (!ctx.hasUI || !await confirmOverlay(ctx, { title: "Replace local file?", body: "Allow the model to replace the selected local file?" }))) {
                throw new Error("Local file replacement was not approved by the local user.");
            }
            try {
                await withFileMutationQueue(localFile, () => sessions.download(params.sessionId, params.remotePath, localFile, params.preserve === true, signal, (bytes, total) => {
                    onUpdate?.({ content: [{ type: "text", text: `Transferred ${bytes}${total ? ` of ${total}` : ""} bytes.` }] });
                }));
            } catch (error) {
                throw new Error(safeMessage(error));
            }
            return { content: [{ type: "text", text: "SSH download completed." }] };
        },
    });

    pi.registerTool({
        name: "ssh_list_dir", label: "SSH List Directory", description: "List a remote directory on an already connected SSH session. Output is truncated to 2000 lines / 50 KB.",
        promptSnippet: "List a remote directory on an SSH session",
        promptGuidelines: ["Use ssh_list_dir for remote directory work rather than shell parsing."],
        parameters: Type.Object({ sessionId: Type.String(), remotePath: Type.String() }),
        execute: async (_id, params) => {
            const entries = await sessions.listDir(params.sessionId, params.remotePath);
            return { content: [{ type: "text", text: boundToolOutput(sessions.redactText(params.sessionId, JSON.stringify(entries, null, 2)), "head") }] };
        },
    });

    pi.registerTool({
        name: "ssh_read_file", label: "SSH Read File", description: "Read a remote text file on an already connected SSH session. Output is truncated to 2000 lines / 50 KB.",
        promptSnippet: "Read a remote text file on an SSH session",
        promptGuidelines: ["Use ssh_read_file for remote file reads."],
        parameters: Type.Object({ sessionId: Type.String(), remotePath: Type.String() }),
        execute: async (_id, params) => ({ content: [{ type: "text", text: boundToolOutput(sessions.redactText(params.sessionId, await sessions.readFile(params.sessionId, params.remotePath)), "head") }] }),
    });

    pi.registerTool({
        name: "ssh_stat", label: "SSH File Status", description: "Read remote file or directory metadata on an already connected SSH session.",
        promptSnippet: "Read remote file or directory metadata on an SSH session",
        parameters: Type.Object({ sessionId: Type.String(), remotePath: Type.String() }),
        execute: async (_id, params) => {
            const status = await sessions.stat(params.sessionId, params.remotePath);
            return { content: [{ type: "text", text: boundToolOutput(sessions.redactText(params.sessionId, JSON.stringify(status, null, 2)), "head") }] };
        },
    });

    pi.registerTool({
        name: "ssh_write_file", label: "SSH Write File", description: "Write a remote text file after local-user confirmation.",
        promptSnippet: "Write a remote text file on an SSH session",
        promptGuidelines: ["Use ssh_write_file for remote file writes; it always requires local approval."],
        parameters: Type.Object({ sessionId: Type.String(), remotePath: Type.String(), content: Type.String() }),
        execute: async (_id, params, _signal, _onUpdate, ctx) => {
            if (!ctx.hasUI || !await confirmOverlay(ctx, { title: "Write remote file?", body: "Allow the model to write the selected remote file?" })) {
                throw new Error("Remote file write was not approved by the local user.");
            }
            await sessions.writeFile(params.sessionId, params.remotePath, params.content);
            return { content: [{ type: "text", text: "SSH remote file written." }] };
        },
    });

    pi.registerTool({
        name: "ssh_mkdir", label: "SSH Make Directory", description: "Create a remote directory after local-user confirmation.",
        promptSnippet: "Create a remote directory on an SSH session",
        parameters: Type.Object({ sessionId: Type.String(), remotePath: Type.String(), recursive: Type.Optional(Type.Boolean()) }),
        execute: async (_id, params, _signal, _onUpdate, ctx) => {
            if (!ctx.hasUI || !await confirmOverlay(ctx, { title: "Create remote directory?", body: "Allow the model to create the selected remote directory?" })) {
                throw new Error("Remote directory creation was not approved by the local user.");
            }
            await sessions.mkdir(params.sessionId, params.remotePath, params.recursive ?? false);
            return { content: [{ type: "text", text: "SSH remote directory created." }] };
        },
    });

    pi.registerTool({
        name: "ssh_rename", label: "SSH Rename", description: "Rename a remote file or directory after local-user confirmation.",
        promptSnippet: "Rename a remote path on an SSH session",
        parameters: Type.Object({ sessionId: Type.String(), sourcePath: Type.String(), destinationPath: Type.String() }),
        execute: async (_id, params, _signal, _onUpdate, ctx) => {
            if (!ctx.hasUI || !await confirmOverlay(ctx, { title: "Rename remote path?", body: "Allow the model to rename the selected remote path?" })) {
                throw new Error("Remote path rename was not approved by the local user.");
            }
            await sessions.rename(params.sessionId, params.sourcePath, params.destinationPath);
            return { content: [{ type: "text", text: "SSH remote path renamed." }] };
        },
    });

    pi.registerTool({
        name: "ssh_remove", label: "SSH Remove", description: "Remove a remote file or directory after local-user confirmation.",
        promptSnippet: "Remove a remote path on an SSH session",
        parameters: Type.Object({ sessionId: Type.String(), remotePath: Type.String(), recursive: Type.Optional(Type.Boolean()) }),
        execute: async (_id, params, _signal, _onUpdate, ctx) => {
            if (!ctx.hasUI || !await confirmOverlay(ctx, { title: "Remove remote path?", body: "Allow the model to remove the selected remote path?" })) {
                throw new Error("Remote path removal was not approved by the local user.");
            }
            await sessions.remove(params.sessionId, params.remotePath, params.recursive ?? false);
            return { content: [{ type: "text", text: "SSH remote path removed." }] };
        },
    });

    // Full-screen connection manager (/ssh-connection-manager + /ssh-cm).
    createConnectionManager(pi);

    pi.on("session_shutdown", async () => { await sessions.dispose(); });
}
