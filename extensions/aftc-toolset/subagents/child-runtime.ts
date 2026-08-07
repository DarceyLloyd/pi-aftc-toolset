/**
 * pi-aftc-toolset — subagents child runtime (loaded INSIDE each child).
 *
 * The ONLY extension a sub-agent child ever loads (`--no-extensions` +
 * explicit `-e`). Lives in the CODE TREE — never in the shipped data
 * seed (design correction #2). Responsibilities:
 *
 *   1. Inject the fixed worker protocol into the child's system prompt
 *      (before_agent_start -> { systemPrompt }). Byte-stable within a
 *      run: static text + values from the run-config file, nothing
 *      volatile (the system prompt is the cached prefix).
 *   2. Register `report_result` — the child-side handoff tool (design
 *      section 5.4). FIRST report wins; later calls are acknowledged
 *      and discarded. `blocked` ends the run with questions surfaced
 *      to the parent (children have no UI — safety rule 8).
 *   3. Capability Exposure (design section 11): when the resolved gate
 *      allows it, register a read-only `codex_load` against the LIVE
 *      aftc-codex store and put a bounded capability brief (tool
 *      contract + topic list) into the child prompt. Nothing else of
 *      the toolset is ever visible to a child: no notifications, no
 *      usage DB, no docx, no SSH, no UI, no spawning.
 *
 * Run config: the supervisor writes a private 0600 JSON file and passes
 * its path via AFTC_SUBAGENT_RUN_CONFIG. Shape:
 *   { runId, operative, codexReadEnabled, codexTopics[], codexRoot? }
 * Missing/unreadable config degrades gracefully (protocol without
 * codex) — a child must never crash on startup.
 *
 * See `child-runtime-readme.md`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ─────────────────────────────────────────────────────────────────────────────
// Run config
// ─────────────────────────────────────────────────────────────────────────────

export interface SubAgentRunConfig {
    runId: string;
    operative: string;
    codexReadEnabled: boolean;
    /** v1: parsed but not enforced — child codex access is read-only. */
    codexWriteEnabled: boolean;
    codexTopics: string[];
    /** Override of the live codex root (tests). Default: <dataDir>/aftc-codex. */
    codexRoot?: string;
}

const RUN_CONFIG_ENV = "AFTC_SUBAGENT_RUN_CONFIG";

export function loadSubAgentRunConfig(): SubAgentRunConfig | null {
    const configPath = process.env[RUN_CONFIG_ENV];
    if (!configPath) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as SubAgentRunConfig;
        if (!parsed || typeof parsed !== "object" || typeof parsed.runId !== "string") return null;
        return {
            runId: parsed.runId,
            operative: typeof parsed.operative === "string" ? parsed.operative : "agent",
            codexReadEnabled: parsed.codexReadEnabled === true,
            codexWriteEnabled: parsed.codexWriteEnabled === true,
            codexTopics: Array.isArray(parsed.codexTopics)
                ? parsed.codexTopics.filter((t) => typeof t === "string")
                : [],
            codexRoot: typeof parsed.codexRoot === "string" ? parsed.codexRoot : undefined,
        };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker protocol prompt (byte-stable within a run)
// ─────────────────────────────────────────────────────────────────────────────

export function buildSubAgentWorkerPrompt(config: SubAgentRunConfig | null): string {
    const operative = config?.operative ?? "agent";
    const lines: string[] = [
        "# Sub-Agent Worker Protocol",
        "",
        `You are sub-agent "${operative}" — an isolated child session with a FRESH`,
        "context window. You see ONLY this protocol, your agent prompt, and the task",
        "briefing the parent handed you. You never see the parent's conversation.",
        "",
        "Rules:",
        "- Do the task yourself. You cannot delegate and you have no UI.",
        "- Your FINAL assistant text IS your report: bounded, factual, with exact",
        "  paths/evidence. The parent reads it directly.",
        "- If your toolset includes report_result, prefer it for the handoff:",
        "  summary (the report), optional artifacts (relative paths). Call it ONCE",
        "  — later calls are discarded.",
        "- If you genuinely cannot proceed without a decision, call report_result",
        "  with status \"blocked\" and list your questions. Do not ask via plain",
        "  text and wait — nobody is watching a prompt.",
        "- Never invent facts to fill gaps; say what you could not verify.",
        "",
    ];
    if (config?.codexReadEnabled) {
        lines.push(
            "Knowledge base: you have read-only access to the aftc-codex knowledge base",
            "via the codex_load tool (stored conventions and gotchas per technology).",
            "Load a topic before relying on a technology's conventions.",
            "Available topics:",
            ...(config.codexTopics.length > 0 ? config.codexTopics : ["(none listed — use codex_load to browse)"]),
            "",
        );
    }
    return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only codex access (self-contained — reads the live store directly)
// ─────────────────────────────────────────────────────────────────────────────

const CODEX_MAX_BYTES = 48 * 1024;

function defaultCodexRoot(): string {
    // Same data-dir resolution as the parent (paths.ts convention) without
    // importing feature code: honour the override env, then the OS default.
    const override = process.env.AFTC_TOOLSET_DATA_ROOT;
    const base = override && override.trim()
        ? path.resolve(override)
        : process.platform === "win32"
            ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "pi-aftc-toolset")
            : process.platform === "darwin"
                ? path.join(os.homedir(), "Library", "Application Support", "pi-aftc-toolset")
                : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "pi-aftc-toolset");
    return path.join(base, "data", "aftc-codex");
}

/** Find a topic file across all category folders + top-level files. */
export function findCodexTopicFile(codexRoot: string, topic: string): string | null {
    const wanted = topic.trim().toLowerCase();
    if (!wanted) return null;
    const resourcesDir = path.join(codexRoot, "resources");
    const candidates: string[] = [];
    try {
        candidates.push(path.join(resourcesDir, `${wanted}.md`));
        for (const entry of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            candidates.push(path.join(resourcesDir, entry.name, `${wanted}.md`));
        }
        // Top-level guidance files live at the codex root.
        candidates.push(path.join(codexRoot, `${wanted}.md`));
    } catch {
        return null;
    }
    for (const candidate of candidates) {
        try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
    }
    return null;
}

export function readCodexTopic(codexRoot: string, topic: string): string {
    const file = findCodexTopicFile(codexRoot, topic);
    if (!file) {
        return `No codex topic named "${topic}". Use the topic list from your task briefing.`;
    }
    try {
        let content = fs.readFileSync(file, "utf8");
        if (Buffer.byteLength(content, "utf8") > CODEX_MAX_BYTES) {
            content = Buffer.from(content, "utf8").subarray(0, CODEX_MAX_BYTES).toString("utf8");
            content += "\n\n[truncated]";
        }
        return content;
    } catch (err) {
        return `codex_load failed for "${topic}": ${(err as Error).message}`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension entry (runs inside the CHILD process)
// ─────────────────────────────────────────────────────────────────────────────

export default function subAgentChildRuntime(pi: ExtensionAPI): void {
    const config = loadSubAgentRunConfig();

    // 1. Worker protocol into the cached system-prompt prefix (stable).
    pi.on("before_agent_start", async (event) => {
        const block = buildSubAgentWorkerPrompt(config);
        return { systemPrompt: block + "\n\n" + event.systemPrompt };
    });

    // 2. report_result — the handoff tool. First report wins (invariant 2);
    //    per child process == per run, so module state is safe here.
    let reportedOnce = false;
    pi.registerTool({
        name: "report_result",
        label: "Report Result",
        description:
            "Hand your final report back to the parent session. Call this ONCE when the " +
            "task is done (or when you are blocked and need a decision). The first report " +
            "wins; later calls are discarded. Your final assistant text is also read as a " +
            "fallback report, so keep it bounded and factual either way.",
        parameters: Type.Object({
            summary: Type.String({ description: "The bounded report text (max 16 KiB)." }),
            status: Type.Optional(StringEnum(["completed", "blocked"] as const, {
                description: "blocked = you need a decision from the parent before you can proceed.",
            })),
            questions: Type.Optional(Type.Array(Type.String(), {
                description: "When blocked: what you need from the parent (max 4).",
            })),
            artifacts: Type.Optional(Type.Array(Type.String(), {
                description: "Relative paths of files worth looking at (max 8).",
            })),
            terminate: Type.Optional(Type.Boolean({
                description: "End the run right after this report.",
            })),
        }),
        async execute(_toolCallId, params) {
            if (reportedOnce) {
                return {
                    content: [{
                        type: "text",
                        text: "Report already recorded — the first report wins. Finish your turn.",
                    }],
                };
            }
            reportedOnce = true;
            const summary = typeof params.summary === "string"
                ? params.summary.slice(0, 16 * 1024)
                : "";
            return {
                content: [{
                    type: "text",
                    text: `Report recorded (${params.status === "blocked" ? "blocked" : "completed"}, `
                        + `${summary.length} chars). ${params.terminate ? "Run ending." : "You may finish your turn."}`,
                }],
            };
        },
    });

    // 3. Capability Exposure: read-only codex_load, only when the gate resolved on.
    if (config?.codexReadEnabled) {
        const codexRoot = config.codexRoot ?? defaultCodexRoot();
        pi.registerTool({
            name: "codex_load",
            label: "Codex Load",
            description:
                "Load one aftc-codex knowledge-base topic (stored conventions and gotchas " +
                "for a language/library/tool) by name. Read-only. Topics available to you " +
                "are listed in your task briefing.",
            parameters: Type.Object({
                topic: Type.String({ description: "Topic name, eg \"typescript\"." }),
            }),
            async execute(_toolCallId, params) {
                const topic = String(params.topic ?? "").replace(/^@/, "");
                const content = readCodexTopic(codexRoot, topic);
                return { content: [{ type: "text", text: content }] };
            },
        });
    }
}
