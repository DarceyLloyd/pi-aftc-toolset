import * as path from "node:path";
import { SshCarrier, SshCarrierRequestError, type SshCarrierState } from "./carrier";
import type { SshConnectRequest } from "./connection-form";
import type { SshConnection } from "./connection-store";
import { redactSshText } from "./redaction";

/** Grace window before an idle carrier is stopped; a reconnect cancels it. */
const REAPER_GRACE_MS = 30_000;

export interface SshSessionView {
    id: string;
    name: string;
    connectedAt: number;
}

export interface SshStatus {
    connected: boolean;
    carrierState: SshCarrierState;
    sessions: SshSessionView[];
}

/** Single source of truth for the `/ssh-status` command and `ssh_status` tool. */
export function formatSshStatus(status: SshStatus): string {
    if (status.connected) {
        const lines = status.sessions.map((session) => `${session.name} (${session.id})`);
        return `Connected\n${lines.join("\n")}`;
    }
    const reason = status.carrierState === "idle"
        ? "no SSH session yet"
        : status.carrierState === "ready"
            ? "no SSH sessions"
            : "SSH carrier stopped";
    return `Not connected - ${reason}`;
}

interface ConnectedSession extends SshSessionView {
    carrierSessionId: string;
    redactionConnection: SshConnection;
}

export interface SshShellOutput {
    text: string;
    truncated: boolean;
}

export interface SshRunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    truncated: boolean;
}

function remotePath(value: string): string {
    const cleaned = value.replace(/^@/, "");
    if (!cleaned || cleaned.includes("\0") || cleaned.includes("\\")) throw new Error("Invalid remote path.");
    return path.posix.normalize(cleaned);
}

export class SshHostKeyApprovalRequired extends Error {
    constructor() {
        super("SSH host key needs local approval.");
    }
}

/** Keeps carrier identifiers and credentials inside the local extension. */
export class SshSessionManager {
    private readonly carrier: SshCarrier;
    private readonly reaperGraceMs: number;
    private readonly sessions = new Map<string, ConnectedSession>();
    private selectedSessionId: string | undefined;
    private reaperTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(carrier: SshCarrier = new SshCarrier(), reaperGraceMs: number = REAPER_GRACE_MS) {
        this.carrier = carrier;
        this.reaperGraceMs = reaperGraceMs;
        this.carrier.onNotification((name, sessionId) => {
            if (name !== "session_lost" || !sessionId) return;
            this.sessions.delete(sessionId);
            if (this.selectedSessionId === sessionId) this.selectedSessionId = undefined;
            this.armReaperIfEmpty();
        });
        // A carrier crash loses every in-memory SSH transport at once. Drop all
        // sessions so status reflects reality and later operations fail fast
        // instead of silently restarting a carrier that cannot restore them.
        this.carrier.onLifecycle((state) => {
            if (state !== "terminated") return;
            this.sessions.clear();
            this.selectedSessionId = undefined;
            this.cancelReaper();
        });
    }

    public async connect(request: SshConnectRequest, allowNewHostKey = false): Promise<SshSessionView> {
        // A reconnect during the reaper grace window must cancel the pending
        // carrier stop so the new connection can reuse a live carrier.
        this.cancelReaper();
        // A previous crash leaves the carrier terminated. A fresh connection
        // attempt is the explicit reconnect path, so reset before requesting.
        if (this.carrier.state === "terminated") this.carrier.reset();
        const { connection } = request;
        const credentials = request.credentials;
        let result: { sessionId?: unknown };
        let requiresHostKeyApproval = false;
        try {
            result = await this.carrier.request<{ sessionId?: unknown }>("connect", {
            allowAgent: false,
            connectTimeoutMs: connection.connectTimeoutMs ?? 30_000,
            host: connection.host,
            identityFile: connection.identityFile,
            identityPassphrase: credentials.identityPassphrase,
            lookForKeys: false,
            password: credentials.password,
            port: connection.port ?? 22,
            user: connection.username,
            strictHostKeyChecking: allowNewHostKey ? "accept-new" : "ask",
            });
        } catch (error) {
            if (error instanceof SshCarrierRequestError && error.code === -32041) {
                requiresHostKeyApproval = true;
                throw new SshHostKeyApprovalRequired();
            }
            throw error;
        } finally {
            // Keep credentials only long enough for the local host-key approval
            // retry. All completed and failed authentication attempts clear them.
            if (!requiresHostKeyApproval) {
                credentials.password = undefined;
                credentials.identityPassphrase = undefined;
            }
        }
        if (typeof result.sessionId !== "string" || !result.sessionId) {
            throw new Error("SSH connection failed.");
        }
        const session: ConnectedSession = {
            id: result.sessionId,
            carrierSessionId: result.sessionId,
            connectedAt: Date.now(),
            name: connection.name,
            redactionConnection: { ...connection },
        };
        this.sessions.set(session.id, session);
        this.selectedSessionId = session.id;
        return this.toView(session);
    }

    public list(): SshSessionView[] {
        return [...this.sessions.values()].map((session) => this.toView(session));
    }

    public selected(): SshSessionView | undefined {
        const session = this.selectedSessionId ? this.sessions.get(this.selectedSessionId) : undefined;
        return session ? this.toView(session) : undefined;
    }

    public select(sessionId: string): boolean {
        if (!this.sessions.has(sessionId)) return false;
        this.selectedSessionId = sessionId;
        return true;
    }

    public getStatus(): SshStatus {
        const sessions = this.list();
        return { connected: sessions.length > 0, carrierState: this.carrier.state, sessions };
    }

    public isConnected(): boolean {
        return this.sessions.size > 0;
    }

    /**
     * Stop the carrier shortly after the last session goes away, so an idle
     * sidecar does not outlive its usefulness. A new connect cancels the timer
     * and reuses a live carrier; the next use after a stop lazy-starts a fresh
     * sidecar through the existing request path. Skipped when the carrier is
     * already terminated (a crash or an idle sidecar that already self-exited).
     */
    private armReaperIfEmpty(): void {
        if (this.sessions.size > 0) return;
        if (this.carrier.state === "terminated") return;
        if (this.reaperTimer) return;
        const timer = setTimeout(() => {
            this.reaperTimer = undefined;
            if (this.sessions.size > 0) return;
            void this.carrier.stop().catch(() => undefined);
        }, this.reaperGraceMs);
        timer.unref();
        this.reaperTimer = timer;
    }

    private cancelReaper(): void {
        if (!this.reaperTimer) return;
        clearTimeout(this.reaperTimer);
        this.reaperTimer = undefined;
    }

    /** Redact active connection metadata before any local TUI rendering. */
    public redactText(sessionId: string, text: string): string {
        return redactSshText(text, this.require(sessionId).redactionConnection);
    }

    public async run(
        sessionId: string,
        command: string,
        timeoutMs = 30_000,
        signal?: AbortSignal,
        stdinText?: string,
    ): Promise<SshRunResult> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ stdout?: unknown; stderr?: unknown; exitCode?: unknown; truncated?: unknown }>("run", {
            command,
            sessionId: session.carrierSessionId,
            ...(stdinText === undefined ? {} : { stdinText }),
            timeoutMs,
        }, { signal, timeoutMs: timeoutMs + 5_000 });
        return {
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : "",
            exitCode: typeof result.exitCode === "number" ? result.exitCode : -1,
            truncated: result.truncated === true,
        };
    }

    public async openShell(sessionId: string): Promise<string> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ shellId?: unknown }>("open_shell", {
            cols: 120,
            rows: 40,
            sessionId: session.carrierSessionId,
            term: "xterm-256color",
        });
        if (typeof result.shellId !== "string" || !result.shellId) throw new Error("SSH shell could not be opened.");
        return result.shellId;
    }

    public async sendKeys(sessionId: string, shellId: string, keys: string[]): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("send_keys", { keys, sessionId: session.carrierSessionId, shellId });
    }

    public async paste(sessionId: string, shellId: string, text: string): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("paste", { sessionId: session.carrierSessionId, shellId, text });
    }

    public async resizeShell(sessionId: string, shellId: string, cols: number, rows: number): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("resize_shell", { cols, rows, sessionId: session.carrierSessionId, shellId });
    }

    public async closeShell(sessionId: string, shellId: string): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("close_shell", { sessionId: session.carrierSessionId, shellId });
    }

    public async peek(sessionId: string, shellId: string): Promise<SshShellOutput> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ text?: unknown; truncated?: unknown }>("peek", {
            maxBytes: 50_000,
            sessionId: session.carrierSessionId,
            shellId,
        });
        return {
            text: typeof result.text === "string" ? result.text : "",
            truncated: result.truncated === true,
        };
    }

    public async interrupt(sessionId: string, shellId: string): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("interrupt_shell", { count: 5, sessionId: session.carrierSessionId, shellId });
    }

    public async upload(sessionId: string, localPath: string, remotePathValue: string, preserve = false, signal?: AbortSignal, onProgress?: (bytes: number, total: number) => void): Promise<void> {
        const session = this.require(sessionId);
        await this.runTransfer("upload", session.carrierSessionId, { localPath, preserve, remotePath: remotePath(remotePathValue) }, signal, onProgress);
    }

    public async download(sessionId: string, remotePathValue: string, localPath: string, preserve = false, signal?: AbortSignal, onProgress?: (bytes: number, total: number) => void): Promise<void> {
        const session = this.require(sessionId);
        await this.runTransfer("download", session.carrierSessionId, { localPath, preserve, remotePath: remotePath(remotePathValue) }, signal, onProgress);
    }

    /**
     * Run a transfer with an opaque id so a concurrent `cancel_transfer` request
     * can abort it, and so the carrier's `transfer_progress` notifications can
     * be routed to `onProgress`. When `signal` aborts, the carrier-side transfer
     * is signalled to stop and clean up its temporary file.
     */
    private async runTransfer(
        method: "upload" | "download",
        carrierSessionId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
        onProgress?: (bytes: number, total: number) => void,
    ): Promise<void> {
        const transferId = (signal || onProgress) ? `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` : undefined;
        const unsubscribe = transferId && onProgress
            ? this.carrier.onNotification((name, sid, payload) => {
                if (name !== "transfer_progress" || sid !== carrierSessionId || payload?.transferId !== transferId) return;
                onProgress(Number(payload.bytes) || 0, Number(payload.total) || 0);
            })
            : undefined;
        const onAbort = transferId && signal
            ? () => { void this.carrier.request("cancel_transfer", { transferId }).catch(() => undefined); }
            : undefined;
        if (onAbort && signal) signal.addEventListener("abort", onAbort, { once: true });
        try {
            await this.carrier.request(method, { ...params, sessionId: carrierSessionId, ...(transferId ? { transferId } : {}) }, { signal });
        } finally {
            if (onAbort && signal) signal.removeEventListener("abort", onAbort);
            if (unsubscribe) unsubscribe();
        }
    }

    public async readFile(sessionId: string, remotePathValue: string): Promise<string> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ content?: unknown }>("read_file", {
            remotePath: remotePath(remotePathValue),
            sessionId: session.carrierSessionId,
        });
        return typeof result.content === "string" ? result.content : "";
    }

    public async writeFile(sessionId: string, remotePathValue: string, content: string): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("write_file", { content, remotePath: remotePath(remotePathValue), sessionId: session.carrierSessionId });
    }

    public async rename(sessionId: string, sourcePath: string, destinationPath: string): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("rename", {
            destinationPath: remotePath(destinationPath),
            sessionId: session.carrierSessionId,
            sourcePath: remotePath(sourcePath),
        });
    }

    public async listDir(sessionId: string, remotePathValue: string): Promise<unknown[]> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ entries?: unknown }>("list_dir", {
            remotePath: remotePath(remotePathValue),
            sessionId: session.carrierSessionId,
        });
        return Array.isArray(result.entries) ? result.entries : [];
    }

    public async stat(sessionId: string, remotePathValue: string): Promise<unknown> {
        const session = this.require(sessionId);
        return this.carrier.request("stat", { remotePath: remotePath(remotePathValue), sessionId: session.carrierSessionId });
    }

    public async mkdir(sessionId: string, remotePathValue: string, recursive: boolean): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("mkdir", { recursive, remotePath: remotePath(remotePathValue), sessionId: session.carrierSessionId });
    }

    public async remove(sessionId: string, remotePathValue: string, recursive: boolean): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("remove", { recursive, remotePath: remotePath(remotePathValue), sessionId: session.carrierSessionId });
    }

    public async forwardLocal(sessionId: string, localHost: string, localPort: number, remoteHost: string, remotePort: number): Promise<{ forwardId: string; localPort: number }> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ forwardId?: unknown; localPort?: unknown }>("forward_local", {
            localHost, localPort, remoteHost, remotePort, sessionId: session.carrierSessionId,
        });
        if (typeof result.forwardId !== "string" || typeof result.localPort !== "number") throw new Error("SSH forward could not be opened.");
        return { forwardId: result.forwardId, localPort: result.localPort };
    }

    public async forwardRemote(sessionId: string, remotePort: number, localHost: string, localPort: number): Promise<{ forwardId: string }> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ forwardId?: unknown }>("forward_remote", {
            localHost, localPort, remotePort, sessionId: session.carrierSessionId,
        });
        if (typeof result.forwardId !== "string") throw new Error("SSH forward could not be opened.");
        return { forwardId: result.forwardId };
    }

    public async forwardDynamic(sessionId: string, localHost: string, localPort: number): Promise<{ forwardId: string; localPort: number }> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ forwardId?: unknown; localPort?: unknown }>("forward_dynamic", {
            localHost, localPort, sessionId: session.carrierSessionId,
        });
        if (typeof result.forwardId !== "string" || typeof result.localPort !== "number") throw new Error("SSH forward could not be opened.");
        return { forwardId: result.forwardId, localPort: result.localPort };
    }

    public async cancelForward(sessionId: string, forwardId: string): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("cancel_forward", { forwardId, sessionId: session.carrierSessionId });
    }

    public async listForwards(sessionId: string): Promise<unknown[]> {
        const session = this.require(sessionId);
        const result = await this.carrier.request<{ forwards?: unknown }>("list_forwards", { sessionId: session.carrierSessionId });
        return Array.isArray(result.forwards) ? result.forwards : [];
    }

    public async disconnect(sessionId: string): Promise<void> {
        const session = this.require(sessionId);
        await this.carrier.request("disconnect", { sessionId: session.carrierSessionId });
        this.sessions.delete(sessionId);
        if (this.selectedSessionId === sessionId) this.selectedSessionId = undefined;
        this.armReaperIfEmpty();
    }

    public async dispose(): Promise<void> {
        this.cancelReaper();
        for (const session of [...this.sessions.values()]) {
            try {
                await this.carrier.request("disconnect", { sessionId: session.carrierSessionId });
            } catch {
                // Carrier shutdown handles already-lost sessions.
            }
        }
        this.sessions.clear();
        this.selectedSessionId = undefined;
        await this.carrier.stop();
    }

    private require(sessionId: string): ConnectedSession {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error("SSH session is not connected.");
        return session;
    }

    private toView(session: ConnectedSession): SshSessionView {
        return { id: session.id, name: session.name, connectedAt: session.connectedAt };
    }
}
