import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;
const STOP_GRACE_MS = 3_000;
const MAX_STDIO_BUFFER_BYTES = 64 * 1024;
const MAX_RPC_LINE_BYTES = 1024 * 1024;
const PROTOCOL_VERSION = 1;

interface RpcResponse {
    id?: number;
    result?: unknown;
    error?: { code?: unknown; message?: unknown };
    notify?: unknown;
    protocolVersion?: unknown;
    ready?: boolean;
    sessionId?: unknown;
    transferId?: unknown;
    bytes?: unknown;
    total?: unknown;
}

export class SshCarrierRequestError extends Error {
    constructor(public readonly code: number | undefined) {
        super("SSH carrier request failed.");
    }
}

interface PendingRequest {
    abortListener?: () => void;
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
    signal?: AbortSignal;
    timeout: ReturnType<typeof setTimeout>;
}

export interface SshCarrierRequestOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}

/**
 * Local JSON-RPC client for the packaged Paramiko sidecar. The sidecar only
 * communicates over stdio; it never opens an HTTP listener.
 */
export type SshCarrierState = "idle" | "ready" | "terminated";

export interface SshCarrierSpawnOptions {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

export interface SshCarrierOptions {
    /** Override the packaged carrier spawn. Used by deterministic protocol/lifecycle tests. */
    spawn?: SshCarrierSpawnOptions;
}

export class SshCarrier {
    private child: ChildProcess | undefined;
    private lineBuffer = "";
    private nextRequestId = 1;
    private pending = new Map<number, PendingRequest>();
    private readyListeners = new Set<(response: RpcResponse) => void>();
    private notificationListeners = new Set<(name: string, sessionId?: string) => void>();
    private lifecycleListeners = new Set<(state: SshCarrierState) => void>();
    private startPromise: Promise<void> | undefined;
    private stderrTail = "";
    private readonly spawnOverride?: SshCarrierSpawnOptions;
    private terminated = false;
    private explicitStop = false;
    private becameReady = false;

    constructor(options?: SshCarrierOptions) {
        this.spawnOverride = options?.spawn;
    }

    /** Observable lifecycle state. `terminated` rejects new requests until `reset()`. */
    public get state(): SshCarrierState {
        if (this.terminated) return "terminated";
        return this.child ? "ready" : "idle";
    }

    public async start(): Promise<void> {
        if (this.terminated) throw new Error("SSH carrier is unavailable.");
        if (this.startPromise) return this.startPromise;
        if (this.child) return;

        this.startPromise = this.startCarrier().finally(() => {
            this.startPromise = undefined;
        });
        return this.startPromise;
    }

    public async request<T>(
        method: string,
        params: Record<string, unknown>,
        options: SshCarrierRequestOptions = {},
    ): Promise<T> {
        if (options.signal?.aborted) throw new Error("SSH operation was cancelled.");
        await this.start();
        // The abort listener is only attached below, so an abort that
        // fired DURING start() would otherwise be missed and the request
        // would hang until timeout. Re-check before registering.
        if (options.signal?.aborted) throw new Error("SSH operation was cancelled.");
        const child = this.child;
        if (!child?.stdin || child.stdin.destroyed) {
            throw new Error("SSH carrier is unavailable.");
        }

        const id = this.nextRequestId++;
        const timeoutMs = Math.max(1, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
        const result = new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.rejectPending(id, new Error("SSH operation timed out."));
            }, timeoutMs);
            const abortListener = options.signal
                ? () => this.rejectPending(id, new Error("SSH operation was cancelled."))
                : undefined;
            if (abortListener) options.signal?.addEventListener("abort", abortListener, { once: true });
            this.pending.set(id, {
                abortListener,
                reject: reject as (error: Error) => void,
                resolve: resolve as (value: unknown) => void,
                signal: options.signal,
                timeout,
            });
        });

        try {
            child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
        } catch {
            this.rejectPending(id, new Error("SSH carrier is unavailable."));
        }
        return result;
    }

    public onNotification(listener: (name: string, sessionId: string | undefined, response: RpcResponse) => void): () => void {
        this.notificationListeners.add(listener);
        return () => this.notificationListeners.delete(listener);
    }

    /** Subscribe to lifecycle state changes. Fires once with `"terminated"` after an unexpected carrier exit. */
    public onLifecycle(listener: (state: SshCarrierState) => void): () => void {
        this.lifecycleListeners.add(listener);
        return () => this.lifecycleListeners.delete(listener);
    }

    /** Clear a `terminated` state so a subsequent `start()` can launch a fresh carrier process. */
    public reset(): void {
        if (this.child) return;
        this.terminated = false;
        this.explicitStop = false;
        this.becameReady = false;
        this.startPromise = undefined;
        this.lineBuffer = "";
        this.stderrTail = "";
    }

    public async stop(): Promise<void> {
        const child = this.child;
        if (!child) {
            // Never started, or already terminated: nothing to tear down.
            this.terminated = true;
            return;
        }

        this.explicitStop = true;
        this.writeShutdown(child);
        await this.waitForExit(child, STOP_GRACE_MS);
        // Always kill the process tree, even if the child already exited from
        // writeShutdown closing its stdin. A grandchild in the same process
        // group would otherwise be orphaned with no parent to reap it.
        await this.killProcessTree(child);
        if (this.child === child) this.finishChild(child, "SSH carrier stopped.");
    }

    private async startCarrier(): Promise<void> {
        const carrierDir = path.join(__dirname, "carrier");
        const uvName = process.platform === "win32" ? "uv.exe" : "uv";
        const bundledUv = path.join(carrierDir, "bin", uvName);
        const uvExecutable = fs.existsSync(bundledUv) ? bundledUv : uvName;
        const command = this.spawnOverride?.command ?? uvExecutable;
        const args = this.spawnOverride?.args ?? ["run", "--locked", "--project", carrierDir, "python", "-m", "aftc_ssh_carrier"];
        const child = spawn(
            command,
            args,
            {
                cwd: this.spawnOverride?.cwd ?? carrierDir,
                detached: process.platform !== "win32",
                env: this.spawnOverride?.env ?? { ...process.env, PYTHONUNBUFFERED: "1" },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            },
        );
        this.child = child;
        this.lineBuffer = "";
        this.stderrTail = "";

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => this.handleStdout(chunk));
        child.stderr?.on("data", (chunk: string) => this.appendStderr(chunk));
        child.on("error", () => this.finishChild(child, "SSH carrier could not be started."));
        child.on("exit", () => this.finishChild(child, "SSH carrier stopped unexpectedly."));

        try {
            await new Promise<void>((resolve, reject) => {
                let timeout: ReturnType<typeof setTimeout>;
                let settled = false;
                const cleanup = (): void => {
                    clearTimeout(timeout);
                    this.readyListeners.delete(onReady);
                    child.off("error", onError);
                };
                const fail = (error: Error): void => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(error);
                };
                const onError = (): void => fail(new Error("SSH carrier could not be started."));
                const onReady = (response: RpcResponse): void => {
                    if (!response.ready || settled) return;
                    if (response.protocolVersion !== PROTOCOL_VERSION) {
                        fail(new Error("SSH carrier protocol is incompatible."));
                        return;
                    }
                    this.becameReady = true;
                    settled = true;
                    cleanup();
                    resolve();
                };
                timeout = setTimeout(() => fail(new Error("SSH carrier did not start.")), START_TIMEOUT_MS);
                this.readyListeners.add(onReady);
                child.once("error", onError);
            });
        } catch (error) {
            await this.killProcessTree(child);
            this.finishChild(child, "SSH carrier could not be started.");
            throw error;
        }
    }

    private writeShutdown(child: ChildProcess): void {
        try {
            if (child.stdin && !child.stdin.destroyed) {
                child.stdin.write(`${JSON.stringify({ id: this.nextRequestId++, method: "shutdown", params: {} })}\n`);
                child.stdin.end();
            }
        } catch {
            // Forced cleanup below handles an already-closed process.
        }
    }

    private async waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise<void>((resolve) => {
            let timeout: ReturnType<typeof setTimeout>;
            const onExit = (): void => done();
            const done = (): void => {
                clearTimeout(timeout);
                child.off("exit", onExit);
                resolve();
            };
            timeout = setTimeout(done, timeoutMs);
            child.once("exit", onExit);
        });
    }

    private async killProcessTree(child: ChildProcess): Promise<void> {
        if (!child.pid) return;
        if (process.platform === "win32") {
            await new Promise<void>((resolve) => {
                const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
                    stdio: "ignore",
                    windowsHide: true,
                });
                killer.once("exit", () => resolve());
                killer.once("error", () => resolve());
            });
            return;
        }

        try {
            process.kill(-child.pid, "SIGTERM");
        } catch {
            try {
                child.kill("SIGTERM");
            } catch {
                // The child already exited.
            }
        }
        await this.waitForExit(child, STOP_GRACE_MS);
        if (child.exitCode !== null || child.signalCode !== null) return;
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch {
            try {
                child.kill("SIGKILL");
            } catch {
                // The child already exited.
            }
        }
    }

    private handleStdout(chunk: string): void {
        this.lineBuffer += chunk;
        if (Buffer.byteLength(this.lineBuffer, "utf8") > MAX_RPC_LINE_BYTES) {
            this.lineBuffer = "";
            return;
        }

        let newline = this.lineBuffer.indexOf("\n");
        while (newline >= 0) {
            const line = this.lineBuffer.slice(0, newline);
            this.lineBuffer = this.lineBuffer.slice(newline + 1);
            this.handleLine(line);
            newline = this.lineBuffer.indexOf("\n");
        }
    }

    private handleLine(line: string): void {
        let response: RpcResponse;
        try {
            response = JSON.parse(line) as RpcResponse;
        } catch {
            return;
        }
        for (const listener of this.readyListeners) listener(response);
        if (typeof response.notify === "string") {
            const sessionId = typeof response.sessionId === "string" ? response.sessionId : undefined;
            for (const listener of this.notificationListeners) listener(response.notify, sessionId, response);
        }
        if (typeof response.id !== "number") return;
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        this.cleanupPending(pending);
        if (response.error) {
            const code = typeof response.error.code === "number" ? response.error.code : undefined;
            pending.reject(new SshCarrierRequestError(code));
            return;
        }
        pending.resolve(response.result);
    }

    // Carrier stderr is retained only as a bounded diagnostic buffer. It never
    // appears in lifecycle errors or model-visible output; callers receive the
    // generic failAll message instead.
    private appendStderr(chunk: string): void {
        this.stderrTail = this.stderrTail.concat(chunk);
        if (Buffer.byteLength(this.stderrTail, "utf8") <= MAX_STDIO_BUFFER_BYTES) return;
        this.stderrTail = Buffer.from(this.stderrTail, "utf8").subarray(-MAX_STDIO_BUFFER_BYTES).toString("utf8");
    }

    private rejectPending(id: number, error: Error): void {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.cleanupPending(pending);
        pending.reject(error);
    }

    private cleanupPending(pending: PendingRequest): void {
        clearTimeout(pending.timeout);
        if (pending.abortListener && pending.signal) {
            pending.signal.removeEventListener("abort", pending.abortListener);
        }
    }

    private finishChild(child: ChildProcess, message: string): void {
        if (this.child !== child) return;
        this.child = undefined;
        this.readyListeners.clear();
        this.notificationListeners.clear();
        this.failAll(message);
        if (this.explicitStop) {
            // Expected teardown from stop(); stay unavailable without signalling a crash.
            this.terminated = true;
        } else if (this.becameReady) {
            this.markTerminated();
        }
        // A startup that never reached ready leaves terminated false so start() can retry.
    }

    private markTerminated(): void {
        if (this.terminated) return;
        this.terminated = true;
        this.startPromise = undefined;
        for (const listener of [...this.lifecycleListeners]) listener("terminated");
    }

    private failAll(message: string): void {
        for (const [id] of this.pending) this.rejectPending(id, new Error(message));
    }
}

/** Start and stop the exact packaged command used by the runtime client. */
export async function verifySshCarrierReady(): Promise<void> {
    const carrier = new SshCarrier();
    try {
        await carrier.start();
    } finally {
        await carrier.stop();
    }
}
