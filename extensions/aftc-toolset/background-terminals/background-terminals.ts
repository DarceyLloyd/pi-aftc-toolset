/**
 * pi-aftc-toolset / background terminals — coordinator.
 *
 * The feature edge: registers the enable/disable commands (always) and, when
 * the `backgroundTerminalsEnabled` preference is on, the four model tools
 * (bg_start / bg_status / bg_list / bg_kill), the /bt command,
 * the "N terminals running" widget, and the exactly-once completion follow-up.
 *
 * OFF BY DEFAULT (project rule: new user-facing features default OFF).
 * /bt-on persists the preference; /reload applies it.
 *
 * Processes are session-scoped: session_shutdown disposes the manager, which
 * SIGKILLs every tree. Spill-to-disk full-log capture from the upstream
 * reference is intentionally dropped (lean port) — each stream keeps a
 * bounded in-memory tail instead; truncation is reported honestly.
 *
 * See background-terminals-readme.md for the full contract.
 */

import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    truncateTail,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs";
import { getPreference, setPreference } from "../config";
import { registerHelpEntry } from "../help-registry";
import * as aftcConsole from "../ui/aftc-console";
import {
    BackgroundTerminalManager,
    MAX_RUNNING,
    formatElapsed,
    formatExit,
    sanitizeText,
    type KillResult,
    type TerminalSnapshot,
} from "./background-terminal-manager";
import {
    manageTerminals,
    printTerminalList,
} from "./background-terminal-ui";

const WIDGET_KEY = "background-terminals";
const RESULT_MESSAGE_TYPE = "background-terminal-result";

// --- Truncation constants (single place) ------------------------------------

const STATUS_STDOUT_MAX = 16 * 1024;
const STATUS_STDERR_MAX = 8 * 1024;
const RESULT_STDOUT_MAX = 8 * 1024;
const RESULT_STDERR_MAX = 4 * 1024;
const STATUS_STDOUT_MAX_LINES = 400;
const STATUS_STDERR_MAX_LINES = 200;
const RESULT_STDOUT_MAX_LINES = 40;
const RESULT_STDERR_MAX_LINES = 20;

/** One full-detail metadata line for the model (bg_list). */
function describeFull(snap: TerminalSnapshot): string {
    const details = [
        `pid ${snap.pid ?? "?"}`,
        formatElapsed(snap),
        snap.status === "running" ? "exit -" : formatExit(snap),
        snap.cwd,
        `stdout ${formatSize(snap.stdout.totalBytes)}, stderr ${formatSize(snap.stderr.totalBytes)}`,
    ];
    return `${snap.id} [${snap.status}] "${snap.title}" (${details.join(", ")})`;
}

/** Tail-truncated, labelled output section with an honest truncation note. */
function outputSection(
    label: string,
    view: TerminalSnapshot["stdout"],
    maxBytes: number,
    maxLines: number,
): string {
    if (view.totalBytes === 0) return `${label}: (empty)`;
    const truncation = truncateTail(view.text, {
        maxBytes: Math.min(maxBytes, DEFAULT_MAX_BYTES),
        maxLines: Math.min(maxLines, DEFAULT_MAX_LINES),
    });
    let text = `${label}:\n${truncation.content}`;
    if (truncation.truncated || view.truncatedBytes > 0) {
        text += `\n[${label} truncated: showing last ${formatSize(truncation.outputBytes)} of ${formatSize(view.totalBytes)}.]`;
    }
    return text;
}

function buildStartResult(snap: TerminalSnapshot): string {
    return (
        `Started background terminal ${snap.id} "${snap.title}" (pid ${snap.pid ?? "?"}, ${snap.cwd}).\n` +
        `It runs in the background with no stdin. You'll get a message when it exits, ` +
        `or use bg_status(id: "${snap.id}") to peek, bg_kill to stop it, bg_list to see all.`
    );
}

function buildStatusResult(snap: TerminalSnapshot): string {
    let text = describeFull(snap);
    if (snap.errorText) text += `\nError: ${snap.errorText}`;
    text += `\n\n${outputSection("stdout", snap.stdout, STATUS_STDOUT_MAX, STATUS_STDOUT_MAX_LINES)}`;
    text += `\n\n${outputSection("stderr", snap.stderr, STATUS_STDERR_MAX, STATUS_STDERR_MAX_LINES)}`;
    return text;
}

/** The async completion follow-up injected into the model's context. */
function buildTerminalResultMessage(snap: TerminalSnapshot): string {
    const how = snap.status === "killed" ? "was killed" : `exited (${formatExit(snap)})`;
    let text = `Background terminal ${snap.id} "${snap.title}" ${how} after ${formatElapsed(snap)}.`;
    if (snap.errorText) text += `\nError: ${snap.errorText}`;
    text += `\n\n${outputSection("stdout", snap.stdout, RESULT_STDOUT_MAX, RESULT_STDOUT_MAX_LINES)}`;
    if (snap.stderr.totalBytes > 0) {
        text += `\n\n${outputSection("stderr", snap.stderr, RESULT_STDERR_MAX, RESULT_STDERR_MAX_LINES)}`;
    }
    return text;
}

function buildKillReport(results: ReadonlyArray<KillResult>): string {
    return results
        .map((entry) => {
            if (entry.killed) {
                return `Killed ${entry.id} "${entry.title}" (${entry.exit}).`;
            }
            return `${entry.id} "${entry.title}" was already ${entry.status} (${entry.exit}).`;
        })
        .join("\n");
}

/** Deferred one-shot delivery map — keyed by id, so double delivery is
 *  structurally impossible (whoever drains first wins). */
function createDeferredResultDelivery<T extends { id: string }>() {
    const pending = new Map<string, T>();
    return {
        defer(result: T) {
            pending.set(result.id, result);
        },
        consume(ids: Iterable<string>) {
            for (const id of ids) pending.delete(id);
        },
        drain() {
            const results = [...pending.values()];
            pending.clear();
            return results;
        },
        clear() {
            pending.clear();
        },
    };
}

// --- Coordinator -------------------------------------------------------------

export function createBackgroundTerminals(pi: ExtensionAPI): void {
    // Enable/disable commands are ALWAYS registered — they are how you turn
    // the feature back on after disabling it. Everything else is registered
    // conditionally below so that, when disabled, the tools are fully absent
    // from the model's tool list (no wasted prompt tokens, no stray calls).
    registerHelpEntry({
        command: "bt-on",
        description: "Enable the background terminals feature (/reload to apply)",
        category: "Background terminals",
    });
    pi.registerCommand("bt-on", {
        description: "Enable the background terminals feature (bg_start/bg_status/bg_list/bg_kill + /bt). /reload to apply.",
        handler: async (_args, ctx) => {
            setPreference("backgroundTerminalsEnabled", true);
            aftcConsole.emphasis(ctx, "Background terminals enabled. Run /reload to apply.");
        },
    });
    registerHelpEntry({
        command: "bt-off",
        description: "Disable the background terminals feature (/reload to apply)",
        category: "Background terminals",
    });
    pi.registerCommand("bt-off", {
        description: "Disable the background terminals feature. /reload to apply.",
        handler: async (_args, ctx) => {
            setPreference("backgroundTerminalsEnabled", false);
            aftcConsole.emphasis(ctx, "Background terminals disabled. Run /reload to apply.");
        },
    });

    if (!getPreference("backgroundTerminalsEnabled", false)) return;

    const manager = new BackgroundTerminalManager();
    const resultDelivery = createDeferredResultDelivery<TerminalSnapshot>();
    let sessionContext: ExtensionContext | undefined;
    let widgetRunning = 0;

    // --- One-line widget (only while ≥1 is running) -------------------------

    const setWidget = (lines: string[] | undefined): void => {
        try {
            sessionContext?.ui?.setWidget(WIDGET_KEY, lines);
        } catch {
            // UI may be unavailable (print/RPC modes or teardown).
        }
    };

    const updateWidget = (): void => {
        const running = manager.runningCount();
        if (running === widgetRunning) return;
        widgetRunning = running;
        if (running === 0) {
            setWidget(undefined);
            return;
        }
        setWidget([
            `■ ${running} background terminal${running === 1 ? "" : "s"} running — /bt to view or stop`,
        ]);
    };

    // --- Completion follow-up (exactly once, no polling, no turn races) -----

    const deliverResult = (snap: TerminalSnapshot): boolean => {
        try {
            pi.sendMessage(
                {
                    customType: RESULT_MESSAGE_TYPE,
                    content: buildTerminalResultMessage(snap),
                    display: true,
                    details: {
                        id: snap.id,
                        title: snap.title,
                        status: snap.status,
                        exitCode: snap.exitCode,
                        signal: snap.signal,
                    },
                },
                // followUp: queued until the agent has no more tool calls —
                // never interrupts a mid-turn stream. triggerTurn wakes the
                // model immediately iff idle; if busy the queued follow-up is
                // delivered when the current run settles. Either way exactly
                // one delivery.
                { deliverAs: "followUp", triggerTurn: true },
            );
            return true;
        } catch {
            // Session may be shutting down; retain the snapshot so a later
            // agent-settled flush can retry instead of silently dropping it.
            return false;
        }
    };

    const flushResults = (): void => {
        for (const snap of resultDelivery.drain()) {
            if (!deliverResult(snap)) resultDelivery.defer(snap);
        }
    };

    const onSettled = (snap: TerminalSnapshot, consumed: boolean): void => {
        if (consumed) {
            // An in-flight bg_kill / bg_status is returning this settlement.
            resultDelivery.consume([snap.id]);
            return;
        }
        // Defer a copy: the live snapshot's output views keep mutating
        // (late flushes) after settle.
        resultDelivery.defer({
            ...snap,
            stdout: { ...snap.stdout },
            stderr: { ...snap.stderr },
        });
        if (sessionContext?.isIdle()) flushResults();
    };
    manager.setOnSettled(onSettled);

    // Widget follows every manager change (spawn, output, settle).
    manager.subscribe(updateWidget);

    pi.on("session_start", (_event, ctx) => {
        sessionContext = ctx;
    });
    // Drain deferred results when the agent settles; together with the
    // isIdle() fast path and the Map-keyed delivery, double delivery is
    // structurally impossible.
    pi.on("agent_settled", flushResults);
    // /new, /resume, /fork, /reload and quit all emit session_shutdown.
    // Processes never survive a session transition: disposeAll SIGKILLs every
    // tree (bounded), and no result is queued into the dying session.
    pi.on("session_shutdown", async () => {
        sessionContext = undefined;
        resultDelivery.clear();
        widgetRunning = 0;
        setWidget(undefined);
        await manager.disposeAll();
    });

    // --- Completion message rendering --------------------------------------

    pi.registerMessageRenderer(RESULT_MESSAGE_TYPE, (message, _opts, theme) => {
        const details = (message.details ?? {}) as {
            id?: string;
            title?: string;
            status?: string;
            exitCode?: number;
            signal?: string;
        };
        const failed = details.status === "failed";
        const killed = details.status === "killed";
        const icon = failed
            ? theme.fg("error", "x")
            : killed
                ? theme.fg("muted", "■")
                : theme.fg("success", "■");
        const how = killed
            ? "killed"
            : (details.signal ?? `exit ${details.exitCode ?? "?"}`);
        const header =
            `${icon} ` +
            theme.fg("accent", theme.bold(`terminal ${details.id ?? "?"}`)) +
            theme.fg("muted", ` · ${details.title ?? ""} · ${how}`);

        const content = typeof message.content === "string" ? message.content : "";
        // Remove only the summary line; an Error line (when present) is part
        // of the actual result and must remain visible. The body carries raw
        // process output — sanitize ANSI/control chars or the transcript smears.
        const body = sanitizeText(content.split("\n").slice(1).join("\n").trim());
        const previewLines = body.split("\n").slice(0, 8);
        let text = header;
        for (const line of previewLines) text += `\n${theme.fg("text", line)}`;
        if (body.split("\n").length > 8) {
            text += `\n${theme.fg("dim", "... (use bg_status for more)")}`;
        }
        return new Text(text, 0, 0);
    });

    // --- Tools --------------------------------------------------------------

    pi.registerTool({
        name: "bg_start",
        label: "Start Background Terminal",
        description:
            "Start a long-running shell command as a background terminal (git-bash on Windows, $SHELL//bin/sh elsewhere). " +
            "Fire-and-forget: returns immediately with an id, and you get a message with the final output when the process exits. " +
            "The process receives NO stdin (immediate EOF) and there is no way to send input later — interactive commands will not work; use bg_kill to stop a stuck one. " +
            `Terminals are session-scoped: they are killed when the session ends or reloads. Output shown to you is tail-truncated (stdout ${formatSize(STATUS_STDOUT_MAX)}, stderr ${formatSize(STATUS_STDERR_MAX)}); a larger tail is retained in memory per stream. ` +
            `Max ${MAX_RUNNING} background terminals can run at once.`,
        promptSnippet:
            "Run a long-lived shell command in the background (dev servers, builds, watchers); output is captured and you're notified on exit",
        promptGuidelines: [
            "Use bg_start for commands expected to run long or indefinitely (servers, watch modes, long builds); use the regular bash tool for quick commands.",
            "bg_start processes receive no stdin — never start a command that requires interactive input.",
            "After bg_start, keep working; the exit result arrives automatically. Use bg_status only when you need current output before continuing.",
        ],
        parameters: Type.Object({
            command: Type.String({
                description:
                    "Shell command line to run in the background (git-bash on Windows, sh elsewhere). It receives no stdin (EOF immediately); interactive commands will not work.",
            }),
            title: Type.String({
                description: "Short human-readable name shown in listings and the UI",
            }),
            working_dir: Type.Optional(
                Type.String({
                    description: "Working directory (default: current working directory)",
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const command = String(params.command ?? "").trim();
            if (!command) throw new Error("command must not be empty.");

            // Strip a leading '@' some models prepend to path arguments.
            const rawDir = String(params.working_dir ?? ".");
            const rel = rawDir.startsWith("@") ? rawDir.slice(1) : rawDir;
            const cwd = path.resolve(ctx.cwd ?? process.cwd(), rel);
            if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
                throw new Error(`working_dir is not a directory: ${cwd}`);
            }

            // Collapse whitespace (a newline inside a one-line UI row desyncs
            // the TUI renderer) before bounding the length.
            const title =
                String(params.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80) ||
                "terminal";

            const snap = manager.start({ command, title, cwd });
            return {
                content: [{ type: "text", text: buildStartResult(snap) }],
                details: { id: snap.id, title: snap.title, cwd, pid: snap.pid },
            };
        },
    });

    pi.registerTool({
        name: "bg_status",
        label: "Check Background Terminal",
        description:
            "Peek at a background terminal's status and current output (tail-truncated) without blocking. If the terminal already exited, this returns its final state.",
        parameters: Type.Object({
            id: Type.String({ description: 'Terminal id, e.g. "bt-1"' }),
        }),
        async execute(_toolCallId, params) {
            const snap = manager.get(String(params.id ?? ""));
            if (!snap) {
                const known = manager.list().map((s) => s.id);
                throw new Error(
                    `Unknown terminal id "${params.id}". Known: ${known.join(", ") || "none"}.`,
                );
            }
            // This status is returning the settlement itself; a pending
            // automatic follow-up for the same settle would be a duplicate.
            if (snap.status !== "running") resultDelivery.consume([snap.id]);

            return {
                content: [{ type: "text", text: buildStatusResult(snap) }],
                details: {
                    id: snap.id,
                    status: snap.status,
                    pid: snap.pid,
                    exitCode: snap.exitCode,
                    signal: snap.signal,
                },
            };
        },
    });

    pi.registerTool({
        name: "bg_list",
        label: "List Background Terminals",
        description:
            "List all background terminals (running and settled) with pid, elapsed time, exit status, and output sizes.",
        parameters: Type.Object({}),
        async execute() {
            const terminals = manager.list();
            const text =
                terminals.length === 0
                    ? "No background terminals."
                    : terminals.map((snap) => describeFull(snap)).join("\n");
            return {
                content: [{ type: "text", text }],
                details: {
                    terminals: terminals.map((snap) => ({
                        id: snap.id,
                        title: snap.title,
                        status: snap.status,
                        pid: snap.pid,
                    })),
                },
            };
        },
    });

    pi.registerTool({
        name: "bg_kill",
        label: "Kill Background Terminals",
        description:
            "Stop one or more running background terminals (SIGTERM to the whole process tree, escalating to SIGKILL). Returns each terminal's final state; already-settled ids are reported as such.",
        parameters: Type.Object({
            ids: Type.Array(Type.String(), {
                description: 'Terminal ids to stop, e.g. ["bt-1"]',
            }),
        }),
        async execute(_toolCallId, params) {
            const ids = [...new Set((params.ids ?? []).map((id: unknown) => String(id)))];
            if (ids.length === 0) throw new Error("Provide at least one terminal id.");

            const known = manager.list().map((snap) => snap.id);
            const unknown = ids.filter((id) => !manager.get(id));
            if (unknown.length > 0) {
                throw new Error(
                    `Unknown terminal id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
                );
            }

            const report = await manager.kill(ids);
            // Settlement may have happened before this kill began (or during
            // it). Remove any deferred automatic delivery now that this tool
            // returns the final state itself.
            resultDelivery.consume(ids);

            return {
                content: [{ type: "text", text: buildKillReport(report) }],
                details: {
                    results: report.map((entry) => ({
                        id: entry.id,
                        title: entry.title,
                        status: entry.status,
                        killed: entry.killed,
                    })),
                },
            };
        },
    });

    // --- Commands -----------------------------------------------------------

    registerHelpEntry({
        command: "bt",
        description: "List running background terminals and stop them",
        category: "Background terminals",
    });
    pi.registerCommand("bt", {
        description: "List running background terminals (started by the bg_start tool) and stop them.",
        handler: async (_args, ctx: ExtensionCommandContext) => {
            if (ctx.mode !== "tui") {
                printTerminalList(manager);
                return;
            }
            await manageTerminals(ctx, manager);
        },
    });
}
