/**
 * pi-aftc-toolset — subagents shared interfaces (codename 007).
 *
 * The single type surface for the sub-agent feature: profiles,
 * runs, reports, usage and the live status
 * snapshot the footer line consumes. Modules inside `subagents/` share
 * these types instead of importing each other's internals; the
 * orchestrator (`index.ts`) wires the factory `createSubAgents(pi)`.
 *
 * Naming convention (design section 21): descriptive camelCase with a
 * capital-A `SubAgent` prefix everywhere. Config KEYS inside
 * subagents-config.json stay unprefixed (the file is the namespace) —
 * see `subagent-config.ts`.
 *
 * See `types-readme.md`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Profiles
// ─────────────────────────────────────────────────────────────────────────────

/** Where a profile was discovered. Precedence: project > user > builtin. */
export type SubAgentProfileSource = "project" | "user" | "builtin";

/**
 * One agent definition, parsed from a markdown file with YAML
 * frontmatter. Every frontmatter field is optional in the file; the
 * catalog fills these defaults. Capabilities live HERE, never in tool
 * arguments (design principle 3).
 */
export interface SubAgentProfile {
    /** Agent slug (filename without `.md`). */
    name: string;
    /** Discovery tier. */
    source: SubAgentProfileSource;
    /** Absolute path of the `.md` file this profile was parsed from. */
    filePath: string;
    /** One-liner shown to the model + menus. Defaults to the name. */
    description: string;
    /** Pretty UI name (frontmatter `display_name`). Defaults to name. */
    displayName: string;
    /**
     * Model spec: `"inherit"`, a `provider/modelId`, a fuzzy name
     * (`"haiku"`), or a fallback array (first resolvable wins). Resolved
     * in the parent BEFORE spawn — never fail after spawn.
     */
    model: string | string[];
    /** Hint only: cheap / standard / premium (drives recommendations). */
    modelTier: string | null;
    /** "inherit" or off/minimal/low/medium/high/xhigh/max. */
    thinking: string;
    /**
     * Granted pi tools. Empty array = profile left it open (all built-ins).
     * The marker `"*"` = all, `"none"` = no tools.
     */
    tools: string[];
    /** Comma denylist that wins over `tools`. */
    disallowedTools: string[];
    /** Named skills to preload (v1: parsed, preloading is a later phase). */
    skills: string[];
    /** Whether the child loads AGENTS.md/CLAUDE.md context files. */
    contextFiles: "project" | "none";
    /** Fork a bounded parent-conversation snapshot (opt-in, later phase). */
    inheritContext: boolean;
    /** replace = body is the system prompt; append = twin mode. */
    promptMode: "replace" | "append";
    /** Max agentic turns before graceful wrap-up. */
    maxTurns: number;
    /** Hard wall-clock cap in seconds. */
    timeoutSeconds: number;
    /** Per-agent stall-window override in seconds; null = global pref. */
    stallTimeoutSeconds: number | null;
    /** Per-agent stall-watchdog exemption. */
    stallDetectionEnabled: boolean;
    /** Per-agent loop-watchdog exemption. */
    loopDetectionEnabled: boolean;
    /** Grant read access to the aftc-codex knowledge base. */
    codexEnabled: boolean;
    /** Additionally grant codex entry writes (v1: parsed, not enforced). */
    codexWriteEnabled: boolean;
    /** Keep the child pi session on disk (private run dir) vs in-memory. */
    persistSession: boolean;
    /** Write the child transcript file. */
    outputTranscript: boolean;
    /** false hides the agent from discovery. */
    enabled: boolean;
    /** Grouping labels. */
    tags: string[];
    /** `extends:` base agent name (resolved by the catalog). */
    extendsName: string | null;
    /** The markdown body — the agent's system prompt. */
    body: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs
// ─────────────────────────────────────────────────────────────────────────────

export type SubAgentRunState =
    | "queued"
    | "starting"
    | "running"
    | "completed"
    | "blocked"
    | "failed"
    | "cancelled"
    | "timed_out";

/** Terminal states — a run reaches at most ONE of these (invariant 2). */
export const SUB_AGENT_TERMINAL_STATES: readonly SubAgentRunState[] = [
    "completed", "blocked", "failed", "cancelled", "timed_out",
];

export function isSubAgentTerminalState(state: SubAgentRunState): boolean {
    return (SUB_AGENT_TERMINAL_STATES as readonly string[]).includes(state);
}

/** Accumulated model usage for one run (child process totals). */
export interface SubAgentUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    /** USD. */
    cost: number;
}

export function emptySubAgentUsage(): SubAgentUsage {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/**
 * The bounded semantic handoff. `structured` = true when it came from the
 * child's `report_result` tool; false when the child's final assistant
 * text was used directly (forgiving handoff — design principle 8).
 */
export interface SubAgentReport {
    summary: string;
    /** blocked = the child needs a handler decision. */
    status: "completed" | "blocked";
    /** What the child needs when blocked (max 4). */
    questions: string[];
    /** Relative paths worth looking at (max 8). */
    artifacts: string[];
    structured: boolean;
}

/** Live view of one run, safe to hand to UI/renderers. */
export interface SubAgentRunView {
    id: string;
    operative: string;
    task: string;
    state: SubAgentRunState;
    /** Epoch ms when the run left the queue (starting). */
    startedAt: number | null;
    /** Epoch ms of the terminal state. */
    endedAt: number | null;
    pid: number | null;
    /** Turns observed (turn_end events). */
    turnCount: number;
    /** Tool executions observed. */
    toolCallCount: number;
    usage: SubAgentUsage;
    /** Latest context-window snapshot from the child, if any. */
    contextPercent: number | null;
    contextWindow: number | null;
    /** Compaction count observed in the child. */
    compactionCount: number;
    report: SubAgentReport | null;
    /** "stall" / "loop" / "grace-wrap" / error text. */
    diagnostics: string[];
    /** "partial" when a watchdog flagged the run. */
    flags: string[];
}

/** What the foreground tool result carries. */
export interface SubAgentRunResult {
    runId: string;
    operative: string;
    state: SubAgentRunState;
    report: SubAgentReport | null;
    /** Final assistant text (the report fallback; also useful on failure). */
    finalText: string;
    usage: SubAgentUsage;
    diagnostics: string[];
    flags: string[];
    elapsedMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status snapshot (footer line + /007-status)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory live snapshot — never read from a database (design: no DB
 * writes). The footer line renders this whenever the feature is
 * enabled (even when idle).
 */
export interface SubAgentStatusSnapshot {
    /** True while any run is queued/starting/running. */
    active: boolean;
    runningCount: number;
    queuedCount: number;
    /** In-session subagent spend accumulator (USD). */
    sessionCost: number;
    /** The busiest run: agent name + context-window % used. */
    busiest: { operative: string; contextPercent: number } | null;
    /** Currently running agents: name + latest context-window % (null = unknown). */
    runningAgents: Array<{ name: string; contextPercent: number | null }>;
    /** Average wall time (ms) of completed runs this session; null = none. */
    avgElapsedMs: number | null;
    /** Any run stalled / looping / over the context threshold. */
    warning: boolean;
}
