/**
 * pi-aftc-toolset / background terminals — plain-TS process registry.
 *
 * Owns the registry of background shell processes the model can start,
 * inspect and stop. A "terminal" is one long-running command run through the
 * platform shell (git-bash on Windows, $SHELL//bin/sh elsewhere) with stdin
 * IGNORED at the OS level — there is no way to send input later. stdout and
 * stderr are captured separately into bounded in-memory tails (newest output
 * retained; the head is dropped and counted).
 *
 * WHY NO EFFECT: the upstream reference (my-pi-setup) builds this on
 * Effect v4. This project has a "no build step, few dependencies, keep it
 * simple" rule, so the manager is plain async/await + node:child_process.
 * Every teardown wait is bounded so a wedged process can never hang
 * session_shutdown; kill trees use the same SIGTERM→SIGKILL escalation as
 * run-script (process-group kill on POSIX, `taskkill /T /F` on Windows).
 *
 * See background-terminal-manager-readme.md for the full contract.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type TerminalStatus = "running" | "done" | "failed" | "killed";
// "done"   = exited with code 0
// "failed" = exited non-zero, or a spawn-level error after start
// "killed" = terminated by bg_kill, the /bt UI, or session teardown

/** Read-only view over one captured output stream (stdout or stderr). */
export interface OutputView {
    /** Decoded, possibly head-trimmed text (bounded by the in-memory cap). */
    readonly text: string;
    /** True total bytes ever received on this stream. */
    readonly totalBytes: number;
    /** Bytes dropped from the head of the in-memory view (0 = complete). */
    readonly truncatedBytes: number;
}

export interface TerminalSnapshot {
    readonly id: string;
    /** Exactly the command line the model asked to run. */
    readonly command: string;
    /** Short model-provided name, shown in listings and the UI. */
    readonly title: string;
    /** Resolved absolute cwd the process runs in. */
    readonly cwd: string;
    /** Undefined only if spawn itself failed before a pid was assigned. */
    readonly pid?: number;
    readonly status: TerminalStatus;
    readonly createdAt: number;
    readonly settledAt?: number;
    readonly exitCode?: number;
    readonly signal?: string;
    /** Spawn error / kill-escalation notes, bounded. */
    readonly errorText?: string;
    readonly stdout: OutputView;
    readonly stderr: OutputView;
}

export interface KillResult {
    readonly id: string;
    readonly title: string;
    readonly status: TerminalStatus;
    /** True when this call initiated the termination AND the entry settled
     *  as killed (a natural exit that won the race reports false). */
    readonly killed: boolean;
    /** Final exit rendering ("exit 0", "SIGTERM", ...) captured at settle. */
    readonly exit: string;
}

export const MAX_RUNNING = 8;
const MAX_TRACKED = 32;
/** In-memory retained cap per stream. */
const RETAINED_PER_STREAM = 2 * 1024 * 1024;
/** SIGTERM is normally enough; the second deadline covers a wedged process. */
const FORCE_KILL_AFTER_MS = 2_000;
/** After the shell exits, grace for descendants holding the pipes open. */
const SETTLE_GRACE_MS = 3_000;
/** Bound on a kill() wait — a wedged process cannot hang the tool. */
const KILL_WAIT_MS = 5_000;
const ERROR_TEXT_MAX = 4_096;

function bounded(text: string): string {
    return text.slice(0, ERROR_TEXT_MAX);
}

/** "exit 0", "exit 137", "SIGTERM", or "running". */
export function formatExit(snap: TerminalSnapshot): string {
    if (snap.status === "running") return "running";
    if (snap.signal) return snap.signal;
    if (snap.exitCode !== undefined) return `exit ${snap.exitCode}`;
    return snap.status;
}

export function formatElapsed(snap: TerminalSnapshot): string {
    const end = snap.settledAt ?? Date.now();
    const totalSeconds = Math.max(0, Math.round((end - snap.createdAt) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0
        ? `${minutes}m${seconds.toString().padStart(2, "0")}s`
        : `${seconds}s`;
}

// ─── ANSI / control stripping (render-time, never at capture) ────────────────
// Raw process output desyncs pi's TUI renderer; strip it only when drawing.

// eslint-disable-next-line no-control-regex
const OSC_PATTERN =
    /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;

export function sanitizeText(text: string): string {
    return text
        .replace(OSC_PATTERN, "")
        .replace(CSI_PATTERN, "")
        .replace(ESCAPE_PATTERN, "")
        .replaceAll("\t", "  ")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

// ─── Shell resolution (git-bash on Windows, $SHELL//bin/sh elsewhere) ───────

function findBash(): string {
    const candidates: string[] = [];
    if (process.platform === "win32") {
        const pf = process.env.ProgramFiles || "C:\\Program Files";
        const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        const local = process.env.LOCALAPPDATA || "";
        candidates.push(path.join(pf, "Git", "bin", "bash.exe"));
        candidates.push(path.join(pf86, "Git", "bin", "bash.exe"));
        if (local) candidates.push(path.join(local, "Programs", "Git", "bin", "bash.exe"));
    } else {
        candidates.push("/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash");
    }
    for (const candidate of candidates) {
        try {
            if (candidate && fs.existsSync(candidate)) return candidate;
        } catch {
            // ignore and try the next candidate
        }
    }
    return "bash";
}

function shellInvocation(command: string): { shell: string; args: string[] } {
    if (process.platform === "win32") {
        return { shell: findBash(), args: ["-c", command] };
    }
    return { shell: process.env.SHELL || "/bin/sh", args: ["-c", command] };
}

type KillSignal = "SIGTERM" | "SIGKILL";

/** Signal the whole process group so descendants die with the leader. */
function killTree(child: ChildProcess, signal: KillSignal): void {
    if (child.pid == null) {
        try { child.kill(signal); } catch { /* already gone */ }
        return;
    }
    if (process.platform === "win32") {
        // Windows has no POSIX signals: always force-kill the whole tree.
        // A graceful `taskkill` (no /F) fails on console processes, and the
        // fallback child.kill(signal) would kill only the shell and orphan
        // grandchildren holding the stdio pipes open.
        try {
            const killer = spawn(
                "taskkill",
                ["/pid", String(child.pid), "/T", "/F"],
                { stdio: "ignore", windowsHide: true },
            );
            killer.once("error", () => {
                try { child.kill("SIGKILL"); } catch { /* already gone */ }
            });
            killer.unref();
        } catch {
            try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }
        return;
    }
    // POSIX: signal the process group so descendants die with the leader.
    try {
        process.kill(-child.pid, signal);
        return;
    } catch {
        // Group already gone; fall through to the direct signal.
    }
    try { child.kill(signal); } catch { /* already gone */ }
}

// ─── Bounded output buffer ───────────────────────────────────────────────────

class OutputBuffer {
    private chunks: string[] = [];
    private retainedBytes = 0;
    private cachedText: string | undefined = "";
    /** Bumped on every push; lets the UI skip re-joining unchanged buffers. */
    version = 0;
    totalBytes = 0;
    truncatedBytes = 0;
    private readonly maxRetainedBytes: number;

    constructor(maxRetainedBytes: number) {
        this.maxRetainedBytes = maxRetainedBytes;
    }

    push(chunk: string): void {
        if (chunk.length === 0) return;
        let bytes = Buffer.byteLength(chunk, "utf8");
        this.totalBytes += bytes;
        if (bytes > this.maxRetainedBytes) {
            // One pathological chunk larger than the whole cap: evict all
            // retained text, keep only the chunk's tail (cut on a UTF-8
            // boundary) so retention stays strictly bounded and contiguous.
            this.truncatedBytes += this.retainedBytes;
            this.chunks = [];
            this.retainedBytes = 0;
            const raw = Buffer.from(chunk, "utf8");
            let start = raw.length - this.maxRetainedBytes;
            while (start < raw.length && (raw[start] & 0xc0) === 0x80) start++;
            this.truncatedBytes += start;
            chunk = raw.subarray(start).toString("utf8");
            bytes = raw.length - start;
        }
        this.chunks.push(chunk);
        this.retainedBytes += bytes;
        while (this.retainedBytes > this.maxRetainedBytes && this.chunks.length > 1) {
            const evicted = this.chunks.shift();
            if (evicted === undefined) break;
            const evictedBytes = Buffer.byteLength(evicted, "utf8");
            this.retainedBytes -= evictedBytes;
            this.truncatedBytes += evictedBytes;
        }
        this.cachedText = undefined;
        this.version++;
    }

    view(): OutputView {
        this.cachedText ??= this.chunks.join("");
        return {
            text: this.cachedText,
            totalBytes: this.totalBytes,
            truncatedBytes: this.truncatedBytes,
        };
    }
}

// ─── Internal state ──────────────────────────────────────────────────────────

/** Mutable snapshot; exposed to readers as the readonly TerminalSnapshot. */
interface MutableSnapshot extends TerminalSnapshot {
    status: TerminalStatus;
    pid?: number;
    settledAt?: number;
    exitCode?: number;
    signal?: string;
    errorText?: string;
}

interface Entry {
    snapshot: MutableSnapshot;
    child: ChildProcess;
    stdoutBuf: OutputBuffer;
    stderrBuf: OutputBuffer;
    /** Set when a kill actually signals a live process (a natural exit that
     *  won the race keeps its truthful done/failed status). */
    killSignaled: boolean;
    /** The child emitted 'error' (spawn failure etc.); settles as failed. */
    processErrored: boolean;
    /** 'exit' event observed (code/signal recorded). */
    exited: boolean;
    /** 'close' event observed (stdio flushed). */
    stdioClosed: boolean;
    settled: boolean;
    /** Completed exactly once when the entry settles. */
    settlePromise: Promise<void>;
    resolveSettle: () => void;
    exitCleanupTimer?: ReturnType<typeof setTimeout>;
}

export interface StartOptions {
    readonly command: string;
    readonly title: string;
    readonly cwd: string;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class BackgroundTerminalManager {
    private entries = new Map<string, Entry>();
    private counter = 0;
    private disposed = false;
    private listeners = new Set<() => void>();
    /** ids with an in-flight kill() collecting the result (settle → consumed). */
    private killInterest = new Map<string, number>();
    private onSettled:
        | ((snap: TerminalSnapshot, consumed: boolean) => void)
        | undefined;

    /** Register the settle hook. `consumed` is true when an active bg_kill is
     *  collecting the result (so it must not also be delivered as a follow-up). */
    setOnSettled(
        hook: ((snap: TerminalSnapshot, consumed: boolean) => void) | undefined,
    ): void {
        this.onSettled = hook;
    }

    /** Any-change notification (widget, /bt list). */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    list(): TerminalSnapshot[] {
        return [...this.entries.values()].map((entry) => entry.snapshot);
    }

    get(id: string): TerminalSnapshot | undefined {
        return this.entries.get(id)?.snapshot;
    }

    size(): number {
        return this.entries.size;
    }

    runningCount(): number {
        return [...this.entries.values()].filter(
            (entry) => entry.snapshot.status === "running",
        ).length;
    }

    /**
     * Spawn a background terminal and register it. Synchronous (spawn +
     * register happen before returning) so two parallel tool calls cannot
     * race past the running cap — the check-and-set has no await between it.
     */
    start(options: StartOptions): TerminalSnapshot {
        if (this.disposed) {
            throw new Error("Background terminal manager is shutting down.");
        }
        if (this.runningCount() >= MAX_RUNNING) {
            throw new Error(
                `Max ${MAX_RUNNING} background terminals can run at once. Stop one with bg_kill (or /bt) first.`,
            );
        }

        const { shell, args } = shellInvocation(options.command);
        const child = spawn(shell, args, {
            cwd: options.cwd,
            env: process.env,
            // stdin IGNORED: there is no input surface, ever. A process that
            // reads stdin sees EOF immediately.
            stdio: ["ignore", "pipe", "pipe"],
            // Own process group on POSIX → group kill takes the whole tree.
            detached: process.platform !== "win32",
            windowsHide: true,
        });

        const id = `bt-${++this.counter}`;
        const stdoutBuf = new OutputBuffer(RETAINED_PER_STREAM);
        const stderrBuf = new OutputBuffer(RETAINED_PER_STREAM);

        const snapshot: MutableSnapshot = {
            id,
            command: options.command,
            title: options.title,
            cwd: options.cwd,
            pid: child.pid,
            status: "running",
            createdAt: Date.now(),
            get stdout() {
                return stdoutBuf.view();
            },
            get stderr() {
                return stderrBuf.view();
            },
        };

        let resolveSettle!: () => void;
        const settlePromise = new Promise<void>((resolve) => {
            resolveSettle = resolve;
        });

        const entry: Entry = {
            snapshot,
            child,
            stdoutBuf,
            stderrBuf,
            killSignaled: false,
            processErrored: false,
            exited: false,
            stdioClosed: false,
            settled: false,
            settlePromise,
            resolveSettle,
        };

        // Plain-callback stream plumbing (setEncoding's StringDecoder is
        // multibyte-safe across chunk boundaries).
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            stdoutBuf.push(chunk);
            this.notify();
        });
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => {
            stderrBuf.push(chunk);
            this.notify();
        });

        // Spawn failures (ENOENT etc.) arrive via 'error', not a throw; Node
        // still emits 'close' afterwards, so settle here (idempotent) as
        // failed and let the close path be a no-op.
        child.once("error", (error: Error) => {
            entry.processErrored = true;
            entry.exited = true;
            snapshot.errorText ??= bounded(error.message ?? String(error));
            this.settle(entry);
        });
        // Record code/signal on 'exit'; settle on 'close' so the completion
        // notification always carries the final flushed output.
        child.once("exit", (code: number | null, signal: string | null) => {
            entry.exited = true;
            if (!entry.processErrored) {
                snapshot.exitCode = code ?? undefined;
                snapshot.signal = signal ?? undefined;
            }
            // A descendant can keep the pipes open after the shell exits.
            // Give close a short grace, then reap the surviving group so the
            // entry cannot occupy a running slot forever.
            if (!entry.stdioClosed) {
                entry.exitCleanupTimer = setTimeout(() => {
                    if (snapshot.status === "running" && !entry.stdioClosed) {
                        killTree(child, "SIGKILL");
                    }
                }, SETTLE_GRACE_MS);
                entry.exitCleanupTimer.unref?.();
            }
        });
        child.once("close", (code: number | null, signal: string | null) => {
            entry.stdioClosed = true;
            // Only trust close's code/signal when 'exit' never fired (a spawn
            // 'error' close reports the errno as its code).
            if (!entry.processErrored) {
                snapshot.exitCode ??= code ?? undefined;
                snapshot.signal ??= signal ?? undefined;
            }
            this.settle(entry);
        });

        this.entries.set(id, entry);
        this.notify();
        return snapshot as TerminalSnapshot;
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                // A failed widget/listener must not corrupt lifecycle state.
            }
        }
    }

    /** Single idempotent settle path — kill vs natural exit vs error races
     *  are resolved by whichever lands first (the second call is a no-op). */
    private settle(entry: Entry): void {
        const snapshot = entry.snapshot;
        if (snapshot.status !== "running") return;
        // Snapshot consumption first: kill waiters resume asynchronously, so
        // the settle hook must observe the interest that existed when
        // settlement won.
        const consumed = (this.killInterest.get(snapshot.id) ?? 0) > 0;
        snapshot.settledAt = Date.now();
        snapshot.status = entry.killSignaled
            ? "killed"
            : entry.processErrored
                ? "failed"
                : snapshot.exitCode === 0
                    ? "done"
                    : "failed";
        entry.settled = true;
        if (entry.exitCleanupTimer) clearTimeout(entry.exitCleanupTimer);
        entry.resolveSettle();
        this.notify();
        try {
            // During teardown, don't queue results into a shutting-down session.
            if (!this.disposed) this.onSettled?.(snapshot, consumed);
        } catch {
            // The parent session may be unavailable; settlement stays final.
        }
        this.pruneSettled();
    }

    /** Drop the oldest settled entries past MAX_TRACKED; never prune running. */
    private pruneSettled(): void {
        if (this.entries.size <= MAX_TRACKED) return;
        const candidates = [...this.entries.values()]
            .filter(
                (entry) =>
                    entry.snapshot.status !== "running" &&
                    !this.killInterest.has(entry.snapshot.id),
            )
            .sort(
                (a, b) =>
                    (a.snapshot.settledAt ?? 0) - (b.snapshot.settledAt ?? 0),
            );
        for (const entry of candidates) {
            if (this.entries.size <= MAX_TRACKED) break;
            this.entries.delete(entry.snapshot.id);
        }
    }

    /** SIGTERM → deadline → SIGKILL, detached from the caller so an abort
     *  cannot cancel a termination once it has begun. */
    private signalTermination(entry: Entry): void {
        if (entry.snapshot.status !== "running") return;
        entry.killSignaled = !entry.exited;
        killTree(entry.child, "SIGTERM");
        const timer = setTimeout(() => {
            if (!entry.stdioClosed) killTree(entry.child, "SIGKILL");
        }, FORCE_KILL_AFTER_MS);
        timer.unref?.();
    }

    /** Fire-and-forget kill for the /bt UI (the result still flows back to
     *  the model as a follow-up message). */
    requestKill(id: string): void {
        const entry = this.entries.get(id);
        if (entry) this.signalTermination(entry);
    }

    /** Kill running terminals; resolves only after they settle (bounded). */
    async kill(ids: ReadonlyArray<string>): Promise<KillResult[]> {
        const unique = [...new Set(ids)];
        const running = unique
            .map((id) => this.entries.get(id))
            .filter(
                (entry): entry is Entry =>
                    entry !== undefined && entry.snapshot.status === "running",
            );
        const runningIds = running.map((entry) => entry.snapshot.id);
        for (const id of runningIds) {
            this.killInterest.set(id, (this.killInterest.get(id) ?? 0) + 1);
        }
        try {
            for (const entry of running) this.signalTermination(entry);
            await Promise.all(
                running.map((entry) => this.waitSettle(entry, KILL_WAIT_MS)),
            );
        } finally {
            for (const id of runningIds) {
                const count = (this.killInterest.get(id) ?? 1) - 1;
                if (count <= 0) this.killInterest.delete(id);
                else this.killInterest.set(id, count);
            }
            this.pruneSettled();
        }
        return unique.map((id): KillResult => {
            const snapshot = this.entries.get(id)?.snapshot;
            const status = snapshot?.status ?? "killed";
            return {
                id,
                title: snapshot?.title ?? "?",
                status,
                killed: runningIds.includes(id) && status === "killed",
                exit: snapshot ? formatExit(snapshot) : "unknown",
            };
        });
    }

    private waitSettle(entry: Entry, ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            if (entry.settled) {
                resolve();
                return;
            }
            const timer = setTimeout(resolve, ms);
            timer.unref?.();
            entry.settlePromise.then(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    /** Kill every process (SIGKILL, bounded) and force-settle stragglers. */
    async disposeAll(): Promise<void> {
        this.disposed = true;
        const all = [...this.entries.values()];
        this.entries.clear();
        for (const entry of all) {
            if (entry.snapshot.status === "running") {
                entry.killSignaled = !entry.exited;
                killTree(entry.child, "SIGKILL");
            }
        }
        await Promise.allSettled(
            all.map((entry) => this.waitSettle(entry, 3_000)),
        );
        for (const entry of all) {
            if (entry.snapshot.status === "running") {
                entry.snapshot.settledAt = Date.now();
                entry.snapshot.status = "killed";
                entry.settled = true;
                entry.resolveSettle();
            }
        }
        this.notify();
    }
}
