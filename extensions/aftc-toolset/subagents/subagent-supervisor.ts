/**
 * pi-aftc-toolset — subagents supervisor.
 *
 * The in-extension coordinator for sub-agent runs: scheduling, child
 * processes, run state, watchdogs, cancellation and the termination
 * ladder. Foreground-only in v1 — `startRun()` resolves with the
 * SubAgentRunResult the `subagent` tool returns.
 *
 * Lifecycle guarantees kept here (design section 18):
 *   - invariant 1: every accepted run launches AT MOST one child
 *   - invariant 2: at most one terminal state + one report (first wins)
 *   - invariant 6: no child tree survives abort/timeout/shutdown —
 *     session teardown and the process `exit` hook force-kill every
 *     live tree (abnormal-parent-exit net)
 *   - invariant 7: concurrency slots are reserved BEFORE spawn
 *   - invariant 12: bounded everything (report, progress, transcript
 *     lines)
 *   - invariant 14: per-run state; events are attributed by child
 *     handle, never globally
 *   - invariant 16: a spawn/readiness failure finalises the run as
 *     `failed` — never retried through a second execution path
 *   - invariant 17: the stall watchdog steers exactly once, then aborts
 *
 * NO database writes: spend lives in an in-memory accumulator for the
 * session. Model resolution happens BEFORE spawn (never fail after
 * spawn). Capabilities live in the profile, never in tool arguments.
 *
 * See `subagent-supervisor-readme.md`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { type SubAgentChild, type SubAgentSpawnOptions } from "./subagent-rpc-child";
import { buildSubAgentChildArgs, killSubAgentProcessTree, spawnSubAgentChild } from "./subagent-rpc-child";
import {
    emptySubAgentUsage, isSubAgentTerminalState,
    type SubAgentProfile, type SubAgentReport, type SubAgentRunResult,
    type SubAgentRunState, type SubAgentRunView, type SubAgentStatusSnapshot,
} from "./types";
import { getSubAgentPref } from "./subagent-config";
import { getDataDir, getPackageRoot } from "../paths";

// ─────────────────────────────────────────────────────────────────────────────
// Constants (bounds — invariant 12)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TASK_BYTES = 16 * 1024;
const MAX_CONTEXT_BYTES = 32 * 1024;
const MAX_ACCEPTANCE = 8;
const MAX_SUMMARY_BYTES = 16 * 1024;
const MAX_QUESTIONS = 4;
const MAX_ARTIFACTS = 8;
const MAX_FINAL_TEXT_BYTES = 24 * 1024;

const READY_TIMEOUT_MS = 30_000;
const SETTLED_WAIT_MS = 3_000;
const NATURAL_EXIT_WAIT_MS = 2_000;
const SIGTERM_GRACE_MS = 2_000;
const STATS_TIMEOUT_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

interface InternalRun {
    view: SubAgentRunView;
    profile: SubAgentProfile;
    child: SubAgentChild | null;
    childStarted: boolean;
    settled: boolean;
    reportedOnce: boolean;
    terminateRequested: boolean;
    graceWrapSent: boolean;
    stallSteered: boolean;
    loopSteered: boolean;
    /** Set while the cancel/termination ladder owns the outcome — the
     *  settled/exit handlers must not race it with their own finalise. */
    cancelling: boolean;
    lastProgressAt: number;
    signatures: string[];
    finalText: string;
    runDir: string;
    resolveRun: ((result: SubAgentRunResult) => void) | null;
    queueWaiter: (() => void) | null;
    transcriptEnabled: boolean;
}

export interface SubAgentStartParams {
    profile: SubAgentProfile;
    task: string;
    context?: string;
    acceptance?: string[];
    target?: string;
    cwd: string;
    /** Resolve the profile model spec to `provider/modelId` BEFORE spawn.
     *  Throw to fail the run pre-spawn. */
    resolveModel: (spec: string | string[]) => Promise<string>;
    /** Optional pre-spawn gate (allowance). false cancels the spawn. */
    preSpawnGate?: (profile: SubAgentProfile) => Promise<boolean>;
    /** Parent codex on? (capability gate third leg). */
    parentCodexEnabled?: boolean;
    /** Bounded progress lines for the tool's onUpdate. */
    onProgress?: (line: string) => void;
}

export interface SubAgentSupervisorDeps {
    /** Test seam: replace the real pi spawn (fake-child harness). */
    spawner?: (options: SubAgentSpawnOptions) => SubAgentChild;
    /** Test seam: run-dir root override. */
    runsRoot?: string;
    /** Test seam: child-runtime path override. */
    childRuntimePath?: string;
    /** Test seam: watchdog tick in ms (default 1000). */
    watchdogTickMs?: number;
    /** Test seam: clock override. */
    now?: () => number;
}

export interface SubAgentSupervisor {
    startRun(params: SubAgentStartParams): Promise<SubAgentRunResult>;
    cancelRun(runId: string, reason?: string): Promise<boolean>;
    getRuns(): SubAgentRunView[];
    getStatusSnapshot(): SubAgentStatusSnapshot;
    /** session_shutdown: kill every tree, settle every run. Idempotent. */
    shutdown(): Promise<void>;
    /** Stop the watchdog (test cleanup). */
    dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abnormal-parent-exit net (invariant 6) — module scope so ONE hook serves
// every supervisor instance: sync tree kill of every live child on the way
// out, even when the parent dies without running session_shutdown.
// ─────────────────────────────────────────────────────────────────────────────

const liveSubAgentPids = new Set<number>();

function ensureSubAgentExitHook(): void {
    if ((ensureSubAgentExitHook as { installed?: boolean }).installed) return;
    (ensureSubAgentExitHook as { installed?: boolean }).installed = true;
    process.once("exit", () => {
        for (const pid of liveSubAgentPids) killSubAgentProcessTree(pid, true);
        liveSubAgentPids.clear();
    });
}

export function createSubAgentSupervisor(deps: SubAgentSupervisorDeps = {}): SubAgentSupervisor {
    const now = deps.now ?? Date.now;
    const spawner = deps.spawner ?? spawnSubAgentChild;
    const runsRoot = deps.runsRoot ?? path.join(getDataDir(), "subagents", "runs");
    const childRuntimePath = deps.childRuntimePath
        ?? path.join(getPackageRoot(), "extensions", "aftc-toolset", "subagents", "child-runtime.ts");

    const runs = new Map<string, InternalRun>();
    const queue: InternalRun[] = [];
    let spawnCount = 0;
    let sessionCost = 0;
    let watchdog: NodeJS.Timeout | null = null;
    let disposed = false;

    // ── helpers ──────────────────────────────────────────────────────────────

    const activeCount = () => [...runs.values()].filter(
        (r) => r.view.state === "starting" || r.view.state === "running").length;

    function touch(run: InternalRun): void {
        run.lastProgressAt = now();
        run.stallSteered = false; // progress resets the one-steer budget
    }

    function addUsage(run: InternalRun, usage: Record<string, unknown> | undefined | null): void {
        if (!usage || typeof usage !== "object") return;
        const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        run.view.usage.input += num(usage.input);
        run.view.usage.output += num(usage.output);
        run.view.usage.cacheRead += num(usage.cacheRead);
        run.view.usage.cacheWrite += num(usage.cacheWrite);
        const cost = usage.cost as Record<string, unknown> | undefined;
        run.view.usage.cost += num(cost?.total ?? usage.cost);
    }

    function appendTranscript(run: InternalRun, record: unknown): void {
        if (!run.transcriptEnabled) return;
        try {
            fs.appendFileSync(path.join(run.runDir, "transcript.jsonl"),
                JSON.stringify(record) + "\n", "utf8");
        } catch { /* transcript is best-effort */ }
    }

    function writeAtomic(file: string, data: string): void {
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, data, "utf8");
        fs.renameSync(tmp, file);
    }

    // ── report capture (first wins — invariant 2) ───────────────────────────

    function captureReport(run: InternalRun, args: Record<string, unknown>): void {
        if (run.reportedOnce) return; // first report wins
        run.reportedOnce = true;
        const str = (v: unknown, cap: number): string =>
            typeof v === "string" ? Buffer.from(v.slice(0, cap), "utf8").subarray(0, cap).toString("utf8") : "";
        const questions = Array.isArray(args.questions)
            ? args.questions.filter((q): q is string => typeof q === "string").slice(0, MAX_QUESTIONS)
            : [];
        const artifacts = Array.isArray(args.artifacts)
            ? args.artifacts.filter((a): a is string => typeof a === "string").slice(0, MAX_ARTIFACTS)
            : [];
        const status = args.status === "blocked" ? "blocked" : "completed";
        const report: SubAgentReport = {
            summary: str(args.summary, MAX_SUMMARY_BYTES),
            status,
            questions,
            artifacts,
            structured: true,
        };
        run.view.report = report;
        if (args.terminate === true) run.terminateRequested = true;
        try {
            writeAtomic(path.join(run.runDir, "report.json"), JSON.stringify(report, null, 2));
        } catch { /* best-effort */ }
    }

    // ── finalisation (at most one terminal state — invariant 2) ─────────────

    function finalise(run: InternalRun, state: SubAgentRunState, diagnostic?: string): void {
        if (isSubAgentTerminalState(run.view.state)) return; // one terminal state
        run.view.state = state;
        run.view.endedAt = now();
        if (run.view.pid) liveSubAgentPids.delete(run.view.pid);
        if (diagnostic) run.view.diagnostics.push(diagnostic);

        // Forgiving handoff: final assistant text IS the report fallback.
        if (!run.view.report && run.finalText.trim().length > 0) {
            run.view.report = {
                summary: run.finalText.slice(0, MAX_SUMMARY_BYTES),
                status: "completed",
                questions: [],
                artifacts: [],
                structured: false,
            };
        }
        if (state === "blocked" && run.view.report) run.view.report.status = "blocked";

        sessionCost += run.view.usage.cost;
        const started = run.view.startedAt ?? now();
        const result: SubAgentRunResult = {
            runId: run.view.id,
            operative: run.profile.name,
            state,
            report: run.view.report,
            finalText: run.finalText.slice(0, MAX_FINAL_TEXT_BYTES),
            usage: { ...run.view.usage },
            diagnostics: [...run.view.diagnostics],
            flags: [...run.view.flags],
            elapsedMs: now() - started,
        };
        if (run.resolveRun) {
            const resolve = run.resolveRun;
            run.resolveRun = null;
            resolve(result);
        }
        // Free a slot for the queue.
        const next = queue.shift();
        if (next?.queueWaiter) {
            const waiter = next.queueWaiter;
            next.queueWaiter = null;
            waiter();
        }
        if (activeCount() === 0 && queue.length === 0) stopWatchdog();
    }

    // ── termination ladder ───────────────────────────────────────────────────
    // abort -> wait agent_settled -> close stdin -> wait natural exit ->
    // SIGTERM group -> deadline -> SIGKILL group.

    async function terminationLadder(run: InternalRun): Promise<void> {
        const child = run.child;
        if (!child) return;
        const waitExit = async (ms: number): Promise<boolean> => {
            const timer = new Promise<false>((r) => setTimeout(() => r(false), ms));
            return Promise.race([child.exited.then(() => true), timer]);
        };
        child.sendCommand({ type: "abort" });
        if (await waitExit(SETTLED_WAIT_MS)) return;
        child.closeStdin();
        if (await waitExit(NATURAL_EXIT_WAIT_MS)) return;
        child.killTree(false);
        if (await waitExit(SIGTERM_GRACE_MS)) return;
        child.killTree(true);
        await waitExit(SIGTERM_GRACE_MS);
    }

    async function stopRun(run: InternalRun, state: SubAgentRunState, diagnostic: string): Promise<void> {
        if (isSubAgentTerminalState(run.view.state)) return;
        run.cancelling = true; // the ladder owns the outcome from here
        run.view.flags.push("partial");
        await terminationLadder(run);
        finalise(run, state, diagnostic);
    }

    // ── event wiring (per child — attribution by handle, invariant 14) ──────

    function wireEvents(run: InternalRun): void {
        const onEvent = (event: Record<string, unknown>): void => {
            appendTranscript(run, event);
            touch(run);
            const type = event.type;
            if (type === "message_update") return; // progress touch only
            if (type === "message_end") {
                const message = event.message as Record<string, unknown> | undefined;
                if (message?.role === "assistant") {
                    addUsage(run, message.usage as Record<string, unknown> | undefined);
                    const content = message.content as Array<Record<string, unknown>> | undefined;
                    if (Array.isArray(content)) {
                        const text = content
                            .filter((c) => c.type === "text" && typeof c.text === "string")
                            .map((c) => c.text as string)
                            .join("\n");
                        if (text.trim().length > 0) run.finalText = text;
                    }
                }
                return;
            }
            if (type === "tool_execution_start") {
                run.view.toolCallCount += 1;
                const name = String(event.toolName ?? "");
                const args = event.args as Record<string, unknown> | undefined;
                if (name === "report_result" && args) captureReport(run, args);
                else pushSignature(run, name, args);
                return;
            }
            if (type === "turn_end") {
                run.view.turnCount += 1;
                // Batch-scoped terminate: the batch finished (turn_end), so a
                // terminate:true report may now end the run gracefully.
                if (run.terminateRequested && !isSubAgentTerminalState(run.view.state)) {
                    void (async () => {
                        await gracefulFinish(run);
                    })();
                }
                return;
            }
            if (type === "compaction_end") {
                run.view.compactionCount += 1;
                return;
            }
            if (type === "agent_settled") {
                run.settled = true;
                void (async () => {
                    await gracefulFinish(run);
                })();
                return;
            }
        };

        const onExit = (code: number | null): void => {
            if (run.cancelling) return; // ladder owns this outcome
            if (isSubAgentTerminalState(run.view.state)) return;
            if (code === 0 || run.settled) {
                finalise(run, run.view.report?.status === "blocked" ? "blocked" : "completed",
                    code === 0 ? undefined : `child exited ${code} after settling`);
            } else {
                finalise(run, "failed", `child exited with code ${code ?? "null"} before settling`);
            }
        };
        void onExit; // wired below through the spawn options
        runEvents.set(run, { onEvent, onExit });
    }
    const runEvents = new WeakMap<InternalRun, {
        onEvent: (e: Record<string, unknown>) => void;
        onExit: (code: number | null) => void;
    }>();

    async function gracefulFinish(run: InternalRun): Promise<void> {
        if (run.cancelling) return; // ladder owns this outcome
        if (isSubAgentTerminalState(run.view.state)) return;
        // Authoritative totals + context snapshot, best-effort.
        const child = run.child;
        if (child) {
            try {
                const resp = await child.request({ type: "get_session_stats" }, STATS_TIMEOUT_MS);
                const data = (resp?.data ?? {}) as Record<string, unknown>;
                const tokens = data.tokens as Record<string, unknown> | undefined;
                if (tokens) {
                    const num = (v: unknown): number => (typeof v === "number" ? v : 0);
                    run.view.usage = {
                        input: num(tokens.input), output: num(tokens.output),
                        cacheRead: num(tokens.cacheRead), cacheWrite: num(tokens.cacheWrite),
                        cost: typeof data.cost === "number" ? data.cost : run.view.usage.cost,
                    };
                }
                const ctxUsage = data.contextUsage as Record<string, unknown> | undefined;
                if (ctxUsage && typeof ctxUsage.percent === "number") {
                    run.view.contextPercent = ctxUsage.percent;
                    run.view.contextWindow = typeof ctxUsage.contextWindow === "number"
                        ? ctxUsage.contextWindow : null;
                }
            } catch { /* stats are best-effort */ }
            run.child.closeStdin(); // graceful: let the child exit naturally
        }
        const state: SubAgentRunState = run.view.report?.status === "blocked"
            ? "blocked" : "completed";
        // Give the child a beat to exit on its own before finalising.
        await new Promise((r) => setTimeout(r, 50));
        finalise(run, state);
    }

    // ── loop detection signature ring (invariant 18) ────────────────────────

    const SIGNATURE_RING = 16;
    function pushSignature(run: InternalRun, name: string, args: Record<string, unknown> | undefined): void {
        if (!getSubAgentPref("loopDetectionEnabled", true) || !run.profile.loopDetectionEnabled) return;
        const key = Object.keys(args ?? {}).sort().map((k) => `${k}=${String((args as Record<string, unknown>)[k])}`).join("&");
        const signature = `${name}:${key.length > 120 ? key.slice(0, 120) : key}`;
        run.signatures.push(signature);
        if (run.signatures.length > SIGNATURE_RING) run.signatures.shift();
    }

    function loopRepeatCount(run: InternalRun): number {
        if (run.signatures.length === 0) return 0;
        const counts = new Map<string, number>();
        let max = 0;
        for (const sig of run.signatures) {
            const n = (counts.get(sig) ?? 0) + 1;
            counts.set(sig, n);
            if (n > max) max = n;
        }
        return max;
    }

    // ── watchdog (stall + loop + wall clock + max turns) ────────────────────

    function startWatchdog(): void {
        if (watchdog || disposed) return;
        const tickMs = deps.watchdogTickMs ?? 1000;
        watchdog = setInterval(() => { void watchdogTick(); }, tickMs);
        watchdog.unref?.();
    }
    function stopWatchdog(): void {
        if (watchdog) { clearInterval(watchdog); watchdog = null; }
    }

    async function watchdogTick(): Promise<void> {
        for (const run of [...runs.values()]) {
            const state = run.view.state;
            if (state !== "running") continue;
            if (run.cancelling) continue; // the termination ladder owns it
            const started = run.view.startedAt ?? now();

            // Hard wall-clock cap.
            if (now() - started > run.profile.timeoutSeconds * 1000) {
                await stopRun(run, "timed_out", `timeout after ${run.profile.timeoutSeconds}s`);
                continue;
            }
            // Graceful max-turns: steer wrap-up, then hard-abort after grace.
            if (run.view.turnCount >= run.profile.maxTurns && !run.graceWrapSent) {
                run.graceWrapSent = true;
                run.view.diagnostics.push("grace-wrap");
                run.child?.sendCommand({
                    type: "steer",
                    message: "Wrap up immediately - you reached your turn budget. Give your final answer/report now.",
                });
            } else if (run.graceWrapSent
                && run.view.turnCount >= run.profile.maxTurns + getSubAgentPref("graceTurns", 5)) {
                await stopRun(run, "timed_out", "turn budget exhausted after grace turns");
                continue;
            }
            // Stall (activity) watchdog — invariant 17: steer exactly once.
            const stallEnabled = getSubAgentPref("stallDetectionEnabled", true)
                && run.profile.stallDetectionEnabled;
            if (stallEnabled) {
                const windowMs = (run.profile.stallTimeoutSeconds
                    ?? getSubAgentPref("stallTimeoutSeconds", 120)) * 1000;
                if (now() - run.lastProgressAt > windowMs) {
                    if (!run.stallSteered) {
                        run.stallSteered = true;
                        run.view.diagnostics.push("stall");
                        run.child?.sendCommand({
                            type: "steer",
                            message: "No activity detected - are you stuck waiting on something? "
                                + "Make a decision, report blocked via report_result, or finish now.",
                        });
                    } else {
                        await stopRun(run, "timed_out", "stall watchdog: no progress after steering");
                        continue;
                    }
                }
            }
            // Loop detection — invariant 18: steer, then abort on re-loop.
            const threshold = getSubAgentPref("loopThreshold", 4);
            const repeats = loopRepeatCount(run);
            if (repeats >= threshold) {
                if (!run.loopSteered) {
                    run.loopSteered = true;
                    run.view.diagnostics.push("loop");
                    run.child?.sendCommand({
                        type: "steer",
                        message: "You appear to be repeating the same step. Step back, summarise what "
                            + "you have confirmed, then act or report blocked - do not re-run the same step.",
                    });
                } else if (repeats >= threshold + 2) {
                    await stopRun(run, "cancelled", "loop watchdog: repetition continued after steering");
                    continue;
                }
            }
        }
    }

    // ── run directory + child spawn ─────────────────────────────────────────

    function listCodexTopics(): string[] {
        try {
            const resourcesDir = path.join(getDataDir(), "aftc-codex", "resources");
            const topics: string[] = [];
            // Loose root-level topics (eg documentation-and-planning).
            for (const file of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
                if (file.isFile() && file.name.endsWith(".md") && file.name !== "codex-resource-list.md") {
                    topics.push(file.name.slice(0, -3));
                }
            }
            // Category folders, RECURSIVE (nested topics, eg ui-ux/web/web-app).
            const walk = (dir: string, prefix: string): void => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const rel = `${prefix}${entry.name}`;
                    if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/`);
                    else if (entry.name.endsWith(".md")) topics.push(rel.slice(0, -3));
                }
            };
            for (const category of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
                if (!category.isDirectory()) continue;
                walk(path.join(resourcesDir, category.name), `${category.name}/`);
            }
            return topics.sort();
        } catch {
            return [];
        }
    }

    async function launchChild(run: InternalRun, params: SubAgentStartParams): Promise<void> {
        spawnCount += 1;
        const runId = run.view.id;
        try {
            fs.mkdirSync(run.runDir, { recursive: true });
            writeAtomic(path.join(run.runDir, "meta.json"), JSON.stringify({
                runId,
                operative: run.profile.name,
                profileFile: run.profile.filePath,
                cwd: params.cwd,
                createdAt: new Date().toISOString(),
            }, null, 2));
        } catch { /* run dir is best-effort */ }

        const codexReadEnabled = !!params.parentCodexEnabled
            && getSubAgentPref("codexAccessEnabled", true)
            && run.profile.codexEnabled;
        const runConfigPath = path.join(run.runDir, "run-config.json");
        try {
            writeAtomic(runConfigPath, JSON.stringify({
                runId,
                operative: run.profile.name,
                codexReadEnabled,
                codexWriteEnabled: codexReadEnabled
                    && getSubAgentPref("codexWriteEnabled", false)
                    && run.profile.codexWriteEnabled,
                codexTopics: codexReadEnabled ? listCodexTopics() : [],
            }, null, 2));
            try { fs.chmodSync(runConfigPath, 0o600); } catch { /* windows */ }
        } catch { /* best-effort */ }

        const model = await params.resolveModel(run.profile.model);
        const args = buildSubAgentChildArgs({
            childRuntimePath,
            model,
            thinking: run.profile.thinking === "inherit" ? null : run.profile.thinking,
            tools: run.profile.tools.length === 0 || run.profile.tools.includes("*") || run.profile.tools.includes("all")
                ? [] : run.profile.tools.filter((t) => t !== "none"),
            skillPaths: [],
            contextFiles: run.profile.contextFiles,
            sessionDir: run.profile.persistSession ? path.join(run.runDir, "session") : null,
        });

        const events = runEvents.get(run);
        const child = spawner({
            args,
            cwd: params.target ? path.resolve(params.cwd, params.target) : params.cwd,
            env: { AFTC_SUBAGENT_RUN_CONFIG: runConfigPath },
            events: {
                onEvent: (e) => events?.onEvent(e),
                onStderrLine: () => touch(run),
                onExit: (code) => events?.onExit(code),
                onProtocolError: () => touch(run),
            },
        });
        run.child = child;
        run.view.pid = child.pid;
        if (child.pid) { ensureSubAgentExitHook(); liveSubAgentPids.add(child.pid); }
        run.childStarted = true;
    }

    // ── public API ───────────────────────────────────────────────────────────

    async function startRun(params: SubAgentStartParams): Promise<SubAgentRunResult> {
        if (disposed) throw new Error("subagents: supervisor is shut down");
        if (spawnCount >= getSubAgentPref("maxRunsPerSession", 20)) {
            throw new Error("subagents: per-session run limit reached");
        }

        const runId = `007-${randomBytes(4).toString("hex")}`;
        const run: InternalRun = {
            view: {
                id: runId,
                operative: params.profile.name,
                task: params.task.slice(0, MAX_TASK_BYTES),
                state: "queued",
                startedAt: null,
                endedAt: null,
                pid: null,
                turnCount: 0,
                toolCallCount: 0,
                usage: emptySubAgentUsage(),
                contextPercent: null,
                contextWindow: null,
                compactionCount: 0,
                report: null,
                diagnostics: [],
                flags: [],
            },
            profile: params.profile,
            child: null,
            childStarted: false,
            settled: false,
            reportedOnce: false,
            terminateRequested: false,
            graceWrapSent: false,
            stallSteered: false,
            loopSteered: false,
            cancelling: false,
            lastProgressAt: now(),
            signatures: [],
            finalText: "",
            runDir: path.join(runsRoot, runId),
            resolveRun: null,
            queueWaiter: null,
            transcriptEnabled: getSubAgentPref("outputTranscript", true)
                && params.profile.outputTranscript,
        };
        runs.set(runId, run);
        wireEvents(run);

        // Concurrency slot: reserve BEFORE spawn (invariant 7).
        if (activeCount() >= getSubAgentPref("maxConcurrent", 4)) {
            if (queue.length >= getSubAgentPref("maxQueued", 16)) {
                runs.delete(runId);
                throw new Error("subagents: queue is full");
            }
            run.view.state = "queued";
            await new Promise<void>((resolve) => {
                run.queueWaiter = resolve;
                queue.push(run);
            });
            if (disposed || isSubAgentTerminalState(run.view.state)) {
                throw new Error("subagents: run cancelled while queued");
            }
        }

        const resultPromise = new Promise<SubAgentRunResult>((resolve) => {
            run.resolveRun = resolve;
        });

        run.view.state = "starting";
        run.view.startedAt = now();
        run.lastProgressAt = now();
        startWatchdog();
        try {
            if (params.preSpawnGate) {
                const allowed = await params.preSpawnGate(params.profile);
                if (!allowed) {
                    finalise(run, "cancelled", "cancelled by user at the allowance gate");
                    return resultPromise;
                }
            }
            await launchChild(run, params);
            const child = run.child!;
            // Readiness via a real request (a SIGNAL, never a sleep).
            await child.request({ type: "get_state" }, READY_TIMEOUT_MS);
            run.view.state = "running";
            touch(run);

            // The briefing: the ONLY data channel to the child.
            const briefing: string[] = [`# Task\n${params.task.slice(0, MAX_TASK_BYTES)}`];
            if (params.context?.trim()) {
                briefing.push(`# Context (handoff notes)\n${params.context.slice(0, MAX_CONTEXT_BYTES)}`);
            }
            if (params.acceptance && params.acceptance.length > 0) {
                briefing.push(`# Acceptance checks\n${
                    params.acceptance.slice(0, MAX_ACCEPTANCE).map((a) => `- ${a}`).join("\n")}`);
            }
            if (params.target) briefing.push(`# Workspace\ntarget dir: ${params.target}`);
            const prompted = child.sendCommand({ type: "prompt", message: briefing.join("\n\n") });
            if (!prompted) {
                await stopRun(run, "failed", "child stdin closed before the briefing");
                return resultPromise;
            }
            params.onProgress?.(`${run.profile.name} ${runId} running`);
        } catch (err) {
            // Invariant 16: ONE execution path — finalise as failed, no retry.
            await terminationLadder(run);
            finalise(run, "failed", `startup failed: ${(err as Error).message}`);
        }
        return resultPromise;
    }

    async function cancelRun(runId: string, reason?: string): Promise<boolean> {
        const run = runs.get(runId);
        if (!run || isSubAgentTerminalState(run.view.state)) return false;
        await stopRun(run, "cancelled", reason ?? "cancelled by user");
        return true;
    }

    function getRuns(): SubAgentRunView[] {
        return [...runs.values()].map((r) => ({ ...r.view, usage: { ...r.view.usage } }));
    }

    function getStatusSnapshot(): SubAgentStatusSnapshot {
        let running = 0;
        let queued = 0;
        let busiest: { operative: string; contextPercent: number } | null = null;
        let warning = false;
        const runningAgents: Array<{ name: string; contextPercent: number | null }> = [];
        let completedTotalMs = 0;
        let completedCount = 0;
        for (const run of runs.values()) {
            if (run.view.state === "running") {
                running += 1;
                runningAgents.push({ name: run.view.operative, contextPercent: run.view.contextPercent });
                if (run.view.contextPercent !== null) {
                    if (!busiest || run.view.contextPercent > busiest.contextPercent) {
                        busiest = { operative: run.view.operative, contextPercent: run.view.contextPercent };
                    }
                    if (run.view.contextPercent >= 85) warning = true;
                }
                if (run.view.diagnostics.includes("stall") || run.view.diagnostics.includes("loop")) {
                    warning = true;
                }
            } else if (run.view.state === "queued") {
                queued += 1;
            } else if (run.view.state === "completed"
                && run.view.startedAt !== null && run.view.endedAt !== null) {
                completedTotalMs += Math.max(0, run.view.endedAt - run.view.startedAt);
                completedCount += 1;
            }
        }
        return {
            active: running > 0 || queued > 0,
            runningCount: running,
            queuedCount: queued,
            sessionCost,
            busiest,
            warning,
            runningAgents,
            avgElapsedMs: completedCount > 0 ? completedTotalMs / completedCount : null,
        };
    }

    async function shutdown(): Promise<void> {
        disposed = true;
        stopWatchdog();
        // Drain the queue: release every waiter, finalise as cancelled.
        for (const waiting of queue.splice(0)) {
            finalise(waiting, "cancelled", "shutdown while queued");
            if (waiting.queueWaiter) {
                const waiter = waiting.queueWaiter;
                waiting.queueWaiter = null;
                waiter(); // lets startRun wake up and throw "cancelled while queued"
            }
        }
        await Promise.all([...runs.values()]
            .filter((r) => !isSubAgentTerminalState(r.view.state))
            .map(async (run) => {
                run.child?.killTree(true); // shutdown = force rung, fast
                finalise(run, "cancelled", "session shutdown");
                await run.child?.exited.catch(() => {});
            }));
    }

    function dispose(): void {
        stopWatchdog();
        for (const run of runs.values()) run.child?.dispose();
    }

    return { startRun, cancelRun, getRuns, getStatusSnapshot, shutdown, dispose };
}
