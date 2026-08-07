/**
 * pi-aftc-toolset — subagents main module (codename 007).
 *
 * The `aftc-codex.ts` analogue for the sub-agent feature: one factory
 * `createSubAgents(pi)` that the orchestrator wires. Owns:
 *   - the `subagent` model tool (foreground-only in v1 — NO mode field)
 *   - model resolution BEFORE spawn (never fail after spawn)
 *   - the supervisor lifecycle + session_shutdown teardown
 *   - the /007 command surface (via subagent-commands.ts)
 *   - the live status snapshot the footer line consumes
 *
 * Capability surface (design section 11): children are hermetic. The
 * ONLY things a child can ever see of this toolset are a read-only
 * codex_load (default on) and codex entry writes (default off, v1:
 * parsed but read-only enforced), both triple-gated: parent codex on
 * AND global subagents setting AND the agent's own flag.
 * Notifications, usage DB, docx, SSH and UI are NEVER exposed.
 *
 * Naming: capital-A SubAgent prefix on every export (design section 21).
 *
 * See `subagents-readme.md`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as nodePath from "node:path";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { getPreference } from "../config";
import type { AllowanceProvider, AllowanceView } from "../types";
import * as aftcConsole from "../ui/aftc-console";
import { showMenu } from "../ui/aftc-ui";
import { getSubAgentPref } from "./subagent-config";
import { discoverSubAgentProfiles, resolveSubAgentProfile } from "./subagent-catalog";
import { createSubAgentSupervisor, type SubAgentSupervisor } from "./subagent-supervisor";
import type { SubAgentProfile, SubAgentRunResult, SubAgentStatusSnapshot } from "./types";
import { registerSubAgentCommands } from "./subagent-commands";

// ─────────────────────────────────────────────────────────────────────────────
// Model resolution — BEFORE spawn, never after (design section 6.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a profile model spec to `provider/modelId` using the parent's
 * model registry. Spec forms: "inherit" (the parent's active model),
 * exact `provider/modelId`, fuzzy name, or a fallback array (first
 * resolvable wins). Throws when nothing resolves — the caller turns
 * that into a clean pre-spawn failure.
 */
export async function resolveSubAgentModel(
    spec: string | string[],
    ctx: ExtensionContext,
): Promise<string> {
    const candidates = Array.isArray(spec) ? spec : [spec];
    const registry = ctx.modelRegistry;
    for (const raw of candidates) {
        const candidate = String(raw ?? "").trim();
        if (!candidate || candidate === "inherit") {
            const current = ctx.model as { provider?: string; id?: string } | undefined;
            if (current?.provider && current?.id) return `${current.provider}/${current.id}`;
            continue;
        }
        if (candidate.includes("/")) {
            const slash = candidate.indexOf("/");
            const provider = candidate.slice(0, slash);
            const modelId = candidate.slice(slash + 1);
            try {
                const found = registry.find(provider, modelId) as { id?: string } | null;
                if (found?.id) return `${provider}/${found.id}`;
            } catch { /* try next candidate */ }
            continue;
        }
        // Fuzzy: substring match on modelId or provider/modelId.
        try {
            const models = registry.getAvailable() as Array<{ provider: string; id: string }>;
            const needle = candidate.toLowerCase();
            const hits = models.filter((m) =>
                m.id.toLowerCase().includes(needle)
                || `${m.provider}/${m.id}`.toLowerCase().includes(needle));
            if (hits.length > 0) {
                hits.sort((a, b) => a.id.length - b.id.length);
                return `${hits[0].provider}/${hits[0].id}`;
            }
        } catch { /* try next candidate */ }
    }
    throw new Error(`subagents: no available model matches ${JSON.stringify(spec)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Result rendering
// ─────────────────────────────────────────────────────────────────────────────

function formatSubAgentResultText(result: SubAgentRunResult): string {
    const lines: string[] = [];
    lines.push(`[subagent ${result.operative} ${result.runId}] ${result.state} in ${(result.elapsedMs / 1000).toFixed(1)}s`);
    if (result.report) {
        lines.push("");
        lines.push(result.report.summary);
        if (result.report.status === "blocked" && result.report.questions.length > 0) {
            lines.push("");
            lines.push("Blocked — needs a decision:");
            for (const question of result.report.questions) lines.push(`  - ${question}`);
        }
        if (result.report.artifacts.length > 0) {
            lines.push("");
            lines.push(`Artifacts: ${result.report.artifacts.join(", ")}`);
        }
    } else if (result.finalText.trim()) {
        lines.push("", result.finalText);
    } else {
        lines.push("", "(no report captured)");
    }
    if (result.diagnostics.length > 0) lines.push(`Diagnostics: ${result.diagnostics.join("; ")}`);
    if (result.flags.length > 0) lines.push(`Flags: ${result.flags.join(", ")} (result may be incomplete)`);
    return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Allowance gate — pure evaluation (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide whether the allowance gate FIRES for a given allowance view.
 * No view (provider without a usage endpoint) -> no gate ("when
 * available" means exactly this). Fires when ANY window (5h rolling or
 * weekly) is at/above warnPercent. The UI decision (confirm / headless
 * auto-proceed) is made by the caller.
 */
export function evaluateSubAgentAllowanceGate(
    view: AllowanceView | null,
    warnPercent: number,
): { fires: boolean; usedPercent: number | null; window: string | null } {
    if (!view) return { fires: false, usedPercent: null, window: null };
    const fiveHour = view.fiveHour;
    if (fiveHour && fiveHour.usedPercent >= warnPercent) {
        return { fires: true, usedPercent: fiveHour.usedPercent, window: "5h" };
    }
    const weekly = view.weekly;
    if (weekly && weekly.usedPercent >= warnPercent) {
        return { fires: true, usedPercent: weekly.usedPercent, window: "weekly" };
    }
    return { fires: false, usedPercent: null, window: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export interface SubAgentsFactoryDeps {
    /** Subscription allowance provider — the spending guard on spawn. */
    allowance?: AllowanceProvider;
}

/**
 * Wire the 007 sub-agent feature into pi. Synchronous factory; no
 * processes or timers start here (AGENTS.md lifecycle rule) — children
 * start lazily from the `subagent` tool and every tree is killed in
 * session_shutdown.
 */
export function createSubAgents(pi: ExtensionAPI, deps: SubAgentsFactoryDeps = {}): void {
    const supervisor: SubAgentSupervisor = createSubAgentSupervisor();
    let allowanceSilencedThisSession = false;

    /**
     * Spending guard = the allowance gate, not a cost gate (design
     * section 13). No allowance data (provider without a usage
     * endpoint) -> no gate. At/above allowanceWarnPercent of ANY window
     * -> one TUI confirm; headless auto-proceeds with a logged warning.
     */
    async function allowanceGate(ctx: ExtensionContext, agent: string): Promise<boolean> {
        if (!getSubAgentPref("allowanceGateEnabled", true)) return true;
        const view = deps.allowance?.getAllowance() ?? null;
        const evalGate = evaluateSubAgentAllowanceGate(view, getSubAgentPref("allowanceWarnPercent", 85));
        if (!evalGate.fires) return true;
        const line = `${view!.providerLabel} allowance is at ${Math.round(evalGate.usedPercent!)}%`
            + ` (${evalGate.window} window). Spawning "${agent}" will consume more.`;
        if (!ctx.hasUI || allowanceSilencedThisSession) {
            aftcConsole.log(`subagents: allowance gate auto-proceed — ${line}`);
            return true;
        }
        const choice = await showMenu(ctx, {
            title: "Sub-agents — Allowance gate",
            body: [line],
            items: [
                { value: "cancel", label: "Don't spawn" },
                { value: "spawn", label: "Spawn anyway" },
                { value: "silence", label: "Spawn, and don't ask again this session" },
            ],
            initialIndex: 0,
        });
        if (choice === "silence") { allowanceSilencedThisSession = true; return true; }
        return choice === "spawn";
    }

    // ── the subagent tool (foreground-only in v1) ────────────────────────────
    // Agent roster for the tool prompt: deduped by name, precedence
    // order (the first discovered copy of a name is the authoritative one).
    const seenRosterNames = new Set<string>();
    const roster = discoverSubAgentProfiles()
        .filter((p) => (seenRosterNames.has(p.name) ? false : (seenRosterNames.add(p.name), true)))
        .map((p) => `${p.name}: ${p.description}`)
        .join("\n");

    pi.registerTool({
        name: "subagent",
        label: "Sub-Agent",
        description:
            "Delegate a focused task to an isolated sub-agent that runs in its " +
            "own fresh context window with its own tools and model, and returns a bounded " +
            "report. The sub-agent's capabilities come from its profile — you pick WHICH " +
            "agent and WHAT task; you can never change model, tools or limits per call. " +
            "Delegate research, review and other self-contained work — not tiny one-step work and " +
            "not the user's whole request without decomposition. For parallel independent " +
            "work, emit sibling subagent calls.\n\nAvailable sub-agents:\n"
            + (roster || "(none — enable via /007)"),
        promptSnippet:
            "Delegate a focused task to an isolated sub-agent with a fresh context window (foreground)",
        promptGuidelines: [
            "Use subagent to delegate focused, self-contained work (research, independent review, implementation chunks) that would otherwise clutter the main context; do not use it for tiny one-step work.",
            "When calling subagent, give a concrete objective + deliverable, relevant paths in context, and acceptance checks that make 'done' testable.",
            "For several independent investigations, emit sibling subagent calls in one turn — they run in parallel.",
        ],
        parameters: Type.Object({
            agent: Type.String({
                description: "Which sub-agent runs the task, eg \"explorer\", \"planner\", \"user/my-agent\".",
            }),
            task: Type.String({
                description: "Objective + deliverable (max 16 KiB). What to find/do and what to hand back.",
            }),
            context: Type.Optional(Type.String({
                description: "Explicit hand-off facts the child can't cheaply rediscover (max 32 KiB). NOT conversation history.",
            })),
            acceptance: Type.Optional(Type.Array(Type.String(), {
                description: "Checks that make 'done' testable (max 8).",
            })),
            target: Type.Optional(Type.String({
                description: "Working dir for the child, below the current workspace root (no elevation).",
            })),
        }),
        async execute(_toolCallId, params, _signal, onUpdate, ctx) {
            if (!getSubAgentPref("enabled", false)) {
                throw new Error("subagents: feature is disabled — run /007 and enable it.");
            }
            const agentName = String(params.agent ?? "").replace(/^@/, "");
            const target = typeof params.target === "string"
                ? params.target.replace(/^@/, "").trim() : undefined;

            const profiles = discoverSubAgentProfiles();
            const profile: SubAgentProfile | null = resolveSubAgentProfile(agentName, profiles)
                ?? ((): SubAgentProfile | null => {
                    const fallback = getSubAgentPref("fallbackOperative", "none");
                    if (fallback !== "none") return resolveSubAgentProfile(fallback, profiles);
                    return null;
                })();
            if (!profile) {
                const known = profiles.map((p) => p.name).join(", ") || "(none)";
                throw new Error(`subagents: unknown sub-agent "${agentName}". Known: ${known}`);
            }

            // Workspace: target stays below the current root (no elevation).
            let cwd = ctx.cwd ?? process.cwd();
            if (target) {
                const resolved = nodePath.resolve(cwd, target);
                if (!resolved.startsWith(cwd)) {
                    throw new Error(`subagents: target "${target}" escapes the workspace root.`);
                }
                cwd = resolved;
            }

            let lastProgress = "";
            const result = await supervisor.startRun({
                profile,
                task: String(params.task ?? ""),
                context: typeof params.context === "string" ? params.context : undefined,
                acceptance: Array.isArray(params.acceptance)
                    ? params.acceptance.filter((a): a is string => typeof a === "string")
                    : undefined,
                target,
                cwd,
                resolveModel: (spec) => resolveSubAgentModel(spec, ctx),
                preSpawnGate: () => allowanceGate(ctx, profile.name),
                parentCodexEnabled: getPreference("aftcCodexEnabled", false),
                onProgress: (line) => {
                    lastProgress = line;
                    onUpdate?.({
                        content: [{ type: "text", text: line }],
                        details: { progress: line },
                    });
                },
            });

            const text = formatSubAgentResultText(result);
            if (result.state === "failed" || result.state === "cancelled") {
                // Throw so pi marks the tool call as an error (the model sees the
                // failure/cancellation and can react; a gate refusal is a cancel).
                throw new Error(text);
            }
            return {
                content: [{ type: "text", text }],
                details: {
                    runId: result.runId,
                    operative: result.operative,
                    state: result.state,
                    elapsedMs: result.elapsedMs,
                    diagnostics: result.diagnostics,
                    flags: result.flags,
                    progress: lastProgress,
                },
                // Nested child usage rides on this tool result and contributes
                // EXACTLY ONCE to pi's native session totals (invariant 13).
                usage: {
                    input: result.usage.input,
                    output: result.usage.output,
                    cacheRead: result.usage.cacheRead,
                    cacheWrite: result.usage.cacheWrite,
                    totalTokens: result.usage.input + result.usage.output + result.usage.cacheWrite,
                    cost: {
                        input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
                        total: result.usage.cost,
                    },
                },
            };
        },

        // Compact + expanded tool-row rendering (design section 12).
        renderCall(args: Record<string, unknown>, theme) {
            const agent = String(args.agent ?? "?");
            const task = String(args.task ?? "").split("\n")[0] ?? "";
            const brief = task.length > 64 ? task.slice(0, 64) + "…" : task;
            return new Text(theme.fg("accent", `subagent ${agent}`) + " " + theme.fg("dim", brief), 0, 0);
        },
        renderResult(result: { details?: Record<string, unknown> }, options: { expanded?: boolean }, theme) {
            const details = (result.details ?? {}) as Record<string, unknown>;
            const state = String(details.state ?? "");
            const id = String(details.runId ?? "");
            const agent = String(details.operative ?? "");
            const elapsed = typeof details.elapsedMs === "number"
                ? `${(details.elapsedMs / 1000).toFixed(1)}s` : "";
            const summary = `${agent} · ${id} · ${state}${elapsed ? ` · ${elapsed}` : ""}`;
            return new Text(theme.fg("accent", "subagent ") + theme.fg("dim", summary), 0, 0);
        },
    });

    // ── commands + menus ──────────────────────────────────────────────────────
    registerSubAgentCommands(pi, {
        supervisor,
        getSnapshot: (): SubAgentStatusSnapshot => supervisor.getStatusSnapshot(),
    });

    // ── lifecycle: kill every child tree on the way out ──────────────────────
    pi.on("session_shutdown", async () => {
        await supervisor.shutdown();
    });

    aftcConsole.log("subagents: loaded");

    return {
        /** Live in-memory snapshot (never the DB) for the footer line + status. */
        getStatusSnapshot: (): SubAgentStatusSnapshot => supervisor.getStatusSnapshot(),
    };
}

/**
 * Adaptive duration for the footer line: "5s" / "1m 30s" / "2h 14m".
 */
function formatSubAgentDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
}

/** Structural match of the footer widget's c1/c2/c3 theme helpers
 *  (no cross-module import — AGENTS.md module rule). */
export interface SubAgentFooterColors {
    c1: (s: string) => string;
    c2: (s: string) => string;
    c3: (s: string) => string;
}

/**
 * Format the integrated footer line in the SAME theme as the rest of
 * the footer bar (c2 labels, c1 values, c3 dividers):
 * `Sub Agents running: 2/4 | Session cost: $0.14 | Agent avg task time: 1m 30s | Agents running: worker 42%, explorer 18%`
 * with a warning prefix when any run is stalled, looping or over the
 * context threshold. Shown whenever the feature is enabled — the
 * caller decides visibility (footerLineEnabled / enabled prefs); the
 * line itself never reads config.
 */
export function buildSubAgentFooterLine(
    snapshot: SubAgentStatusSnapshot,
    colors: SubAgentFooterColors,
    maxConcurrent: number,
): string {
    const avg = snapshot.avgElapsedMs === null
        ? "—" : formatSubAgentDuration(snapshot.avgElapsedMs);
    const names = snapshot.runningAgents.length > 0
        ? snapshot.runningAgents.map((a) =>
            a.contextPercent === null ? a.name : `${a.name} ${a.contextPercent}%`).join(", ")
        : "—";
    const runningSeg = `${colors.c2("Sub Agents running:")} `
        + `${colors.c1(String(snapshot.runningCount))}${colors.c2("/")}${colors.c1(String(maxConcurrent))}`;
    const costSeg = `${colors.c2("Session cost:")} ${colors.c1("$" + snapshot.sessionCost.toFixed(2))}`;
    const avgSeg = `${colors.c2("Agent avg task time:")} ${colors.c1(avg)}`;
    const namesSeg = `${colors.c2("Agents running:")} ${colors.c1(names)}`;
    const parts = [
        runningSeg, colors.c3("|"), costSeg, colors.c3("|"), avgSeg, colors.c3("|"), namesSeg,
    ];
    return `${snapshot.warning ? colors.c1("! ") : ""}${parts.join(" ")}`;
}
