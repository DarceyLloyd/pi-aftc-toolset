/**
 * pi-aftc-toolset — subagents RPC child transport.
 *
 * ONE supervised `pi --mode rpc` child process + the custom strict-LF
 * JSONL reader (design section 4 + invariant 11). We reuse the framing
 * approach of pi's shipped RpcClient conceptually but NOT its process
 * model — verified disqualifiers: it writes child stderr to the parent
 * TTY, spawns without `detached` (no killable process group), uses a
 * racy 100ms readiness sleep, and defaults cliPath to the relative
 * `dist/cli.js` (breaks under bin shims).
 *
 * Exports:
 *   - SubAgentJsonLineReader — strict-LF framing. Splits on \n bytes
 *     ONLY (never Node readline — it splits on U+2028/U+2029 which are
 *     valid inside JSON strings), strips one trailing \r per record,
 *     and decodes UTF-8 only for COMPLETE lines so multibyte sequences
 *     split across chunk boundaries survive.
 *   - resolvePiEntry() — spawn entry: prefer the SAME pi entry script
 *     the parent uses (process.argv[1]) run with process.execPath;
 *     PATH fallback otherwise. Never hardcode dist/cli.js.
 *   - buildSubAgentChildArgs() — the pure, unit-testable argv builder
 *     for the controlled child startup flags.
 *   - spawnSubAgentChild() — detached spawn, scrubbed env, JSONL
 *     routing (responses by id / events), readiness via a real
 *     get_state request (a SIGNAL, never a sleep), stdin close, and
 *     platform-correct process-TREE kill (POSIX: kill(-pid); Windows:
 *     taskkill /T /F).
 *
 * See `subagent-rpc-child-readme.md`.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import { platform } from "node:os";

// ─────────────────────────────────────────────────────────────────────────────
// Strict-LF JSONL reader (invariant 11)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Incremental strict-LF JSONL parser. Feed raw stdout chunks via
 * push(); complete records are handed to onRecord as parsed objects.
 * Malformed JSON lines are reported via onError and skipped (a bad
 * line must never kill the run).
 */
export class SubAgentJsonLineReader {
    private buffer: Buffer = Buffer.alloc(0);

    constructor(
        private readonly onRecord: (record: Record<string, unknown>) => void,
        private readonly onError: (err: Error) => void = () => {},
    ) {}

    push(chunk: Buffer): void {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        let newlineIndex = this.buffer.indexOf(0x0a);
        while (newlineIndex !== -1) {
            let line = this.buffer.subarray(0, newlineIndex);
            this.buffer = this.buffer.subarray(newlineIndex + 1);
            // Accept optional CRLF framing by stripping one trailing \r.
            if (line.length > 0 && line[line.length - 1] === 0x0d) {
                line = line.subarray(0, line.length - 1);
            }
            if (line.length > 0) this.parseLine(line);
            newlineIndex = this.buffer.indexOf(0x0a);
        }
    }

    private parseLine(lineBytes: Buffer): void {
        // Decode ONLY complete lines: a multibyte UTF-8 sequence split
        // across chunk boundaries stays intact because we never decode
        // the partial tail.
        const text = lineBytes.toString("utf8");
        try {
            const parsed = JSON.parse(text) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                this.onRecord(parsed as Record<string, unknown>);
            }
        } catch (err) {
            this.onError(new Error(`subagents: invalid JSONL from child: ${(err as Error).message}`));
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawn entry resolution
// ─────────────────────────────────────────────────────────────────────────────

export interface SubAgentPiEntry {
    command: string;
    preArgs: string[];
}

/**
 * Resolve how to launch a child pi. Prefer the SAME entry script the
 * parent process was started with (process.argv[1]) run under
 * process.execPath — identical runtime, no PATH surprises. Fall back to
 * `pi` on PATH (pi.cmd on Windows).
 */
export function resolvePiEntry(): SubAgentPiEntry {
    const entry = process.argv[1];
    if (entry && /\.(c|m)?js$/i.test(entry)) {
        try {
            if (fs.existsSync(entry)) return { command: process.execPath, preArgs: [entry] };
        } catch { /* fall through to PATH */ }
    }
    return { command: platform() === "win32" ? "pi.cmd" : "pi", preArgs: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Argv builder (pure — unit tested)
// ─────────────────────────────────────────────────────────────────────────────

export interface SubAgentChildSpec {
    /** Absolute path of child-runtime.ts (the ONLY extension loaded). */
    childRuntimePath: string;
    /** Resolved `provider/modelId` — resolved BEFORE spawn, never after. */
    model: string;
    /** Resolved thinking level, or null to inherit the child default. */
    thinking: string | null;
    /** Granted built-in tools. EMPTY = all built-ins (no --tools flag).
     *  When the flag IS used, `report_result` is always appended — it is
     *  an extension tool that --tools would otherwise filter out. */
    tools: string[];
    /** Explicit skill paths (v1: parsed in profiles, rarely set). */
    skillPaths: string[];
    /** project = AGENTS.md/CLAUDE.md discovery on; none = --no-context-files. */
    contextFiles: "project" | "none";
    /** Private run dir, or null for --no-session (in-memory child session). */
    sessionDir: string | null;
}

/**
 * Build the controlled child startup argv (design section 4). Every
 * flag verified against the installed pi CLI.
 */
export function buildSubAgentChildArgs(spec: SubAgentChildSpec): string[] {
    const args: string[] = [
        "--mode", "rpc",
        "--no-extensions", "-e", spec.childRuntimePath,
        "--no-prompt-templates", "--no-themes", "--no-skills",
        "--no-approve",
        "--model", spec.model,
    ];
    if (spec.thinking) args.push("--thinking", spec.thinking);

    // --tools is a comma allowlist that ALSO filters extension tools, so
    // report_result must ride along whenever the flag is used. An EMPTY
    // tools list means "all built-ins" -> omit the flag entirely.
    if (spec.tools.length > 0) {
        const tools = [...spec.tools];
        if (!tools.includes("report_result")) tools.push("report_result");
        args.push("--tools", tools.join(","));
    }

    for (const skillPath of spec.skillPaths) args.push("--skill", skillPath);
    if (spec.contextFiles === "none") args.push("--no-context-files");
    if (spec.sessionDir) args.push("--session-dir", spec.sessionDir);
    else args.push("--no-session");
    return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Process-tree kill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Terminate the whole child process TREE. POSIX: signal the negative
 * pid (the detached process group), falling back to the direct pid.
 * Windows: taskkill /T (graceful without force, /F for the kill rung).
 * Never throws — a kill of an already-gone tree is success.
 */
export function killSubAgentProcessTree(pid: number, force: boolean): void {
    if (platform() === "win32") {
        const flags = force ? ["/pid", String(pid), "/T", "/F"] : ["/pid", String(pid), "/T"];
        try { execFileSync("taskkill", flags, { stdio: "ignore" }); } catch { /* gone */ }
        return;
    }
    const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";
    try { process.kill(-pid, signal); return; } catch { /* try direct */ }
    try { process.kill(pid, signal); } catch { /* gone */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Child handle
// ─────────────────────────────────────────────────────────────────────────────

export interface SubAgentChildEvents {
    /** Every non-response JSON record (agent/tool/message events). */
    onEvent?: (event: Record<string, unknown>) => void;
    /** One stderr line (already used to feed the stall watchdog). */
    onStderrLine?: (line: string) => void;
    /** Process exit. */
    onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
    /** JSONL framing / parse problems (never fatal). */
    onProtocolError?: (err: Error) => void;
}

export interface SubAgentSpawnOptions {
    args: string[];
    cwd: string;
    /** Extra env for the child; merged over a SCRUBBED copy of
     *  process.env (every PI_SESSION_* variable removed so the child
     *  can never impersonate the parent session). */
    env?: Record<string, string>;
    events?: SubAgentChildEvents;
    /** Test seam: replace the resolved pi entry (fake child harness). */
    entryOverride?: SubAgentPiEntry;
}

export interface SubAgentChild {
    readonly pid: number | null;
    /** Resolves once when the process exits. */
    readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    /** Write one JSON command line. False when stdin is closed. */
    sendCommand(command: Record<string, unknown>): boolean;
    /** Send a command with an `id` and await its correlated response. */
    request(command: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
    /** Graceful rung: close stdin so the child can exit naturally. */
    closeStdin(): void;
    /** Signal the whole process tree (force = the SIGKILL rung). */
    killTree(force: boolean): void;
    /** Drop listeners (idempotent). */
    dispose(): void;
}

let requestCounter = 0;

/**
 * Spawn ONE supervised `pi --mode rpc` child. Detached so the child
 * tree is one killable process group (POSIX) / taskkill-able tree
 * (Windows). stderr is captured per line (never echoed to the parent
 * TUI). Env is scrubbed of PI_SESSION_* values.
 */
export function spawnSubAgentChild(options: SubAgentSpawnOptions): SubAgentChild {
    const entry = options.entryOverride ?? resolvePiEntry();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined) continue;
        if (key.startsWith("PI_SESSION_")) continue; // scrub — no parent impersonation
        env[key] = value;
    }
    Object.assign(env, options.env ?? {});

    const child: ChildProcess = spawn(entry.command, [...entry.preArgs, ...options.args], {
        cwd: options.cwd,
        env,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });

    const pending = new Map<string, { resolve: (r: Record<string, unknown>) => void; timer: NodeJS.Timeout }>();
    const reader = new SubAgentJsonLineReader(
        (record) => {
            if (record.type === "response") {
                if (typeof record.id === "string" && pending.has(record.id)) {
                    const waiter = pending.get(record.id)!;
                    pending.delete(record.id);
                    clearTimeout(waiter.timer);
                    waiter.resolve(record);
                }
                // Id-less responses are command ACKs (prompt/steer/abort).
                // They are NOT agent events — swallow them so they cannot
                // feed progress/watchdog logic.
                return;
            }
            options.events?.onEvent?.(record);
        },
        (err) => options.events?.onProtocolError?.(err),
    );

    let exitResolve: (v: { code: number | null; signal: NodeJS.Signals | null }) => void = () => {};
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        exitResolve = resolve;
    });

    let stderrTail = "";
    child.stdout?.on("data", (chunk: Buffer) => reader.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
        stderrTail += chunk.toString("utf8");
        let idx = stderrTail.indexOf("\n");
        while (idx !== -1) {
            const line = stderrTail.slice(0, idx).replace(/\r$/, "");
            stderrTail = stderrTail.slice(idx + 1);
            if (line.trim().length > 0) options.events?.onStderrLine?.(line);
            idx = stderrTail.indexOf("\n");
        }
    });
    child.once("exit", (code, signal) => {
        for (const [, waiter] of pending) clearTimeout(waiter.timer);
        pending.clear();
        exitResolve({ code, signal });
        options.events?.onExit?.(code, signal);
    });
    // The child is ours to reap; never let a spawn error crash the parent.
    child.once("error", (err) => {
        options.events?.onProtocolError?.(new Error(`subagents: child spawn error: ${err.message}`));
        exitResolve({ code: null, signal: null });
    });

    let stdinClosed = false;
    const handle: SubAgentChild = {
        pid: child.pid ?? null,
        exited,
        sendCommand(command) {
            if (stdinClosed || !child.stdin || child.stdin.destroyed) return false;
            try {
                child.stdin.write(JSON.stringify(command) + "\n");
                return true;
            } catch {
                return false;
            }
        },
        request(command, timeoutMs = 30_000) {
            const id = `sa-req-${++requestCounter}`;
            return new Promise<Record<string, unknown>>((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`subagents: child request "${command.type}" timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                pending.set(id, { resolve, timer });
                if (!handle.sendCommand({ ...command, id })) {
                    pending.delete(id);
                    clearTimeout(timer);
                    reject(new Error(`subagents: child stdin closed before "${command.type}"`));
                }
            });
        },
        closeStdin() {
            if (stdinClosed) return;
            stdinClosed = true;
            try { child.stdin?.end(); } catch { /* already gone */ }
        },
        killTree(force) {
            if (child.pid) killSubAgentProcessTree(child.pid, force);
        },
        dispose() {
            for (const [, waiter] of pending) clearTimeout(waiter.timer);
            pending.clear();
            child.stdout?.removeAllListeners();
            child.stderr?.removeAllListeners();
        },
    };
    return handle;
}
