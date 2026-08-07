/**
 * pi-aftc-toolset — subagents aftc-ui screens (codename 007).
 *
 * Every subagents screen is built ONLY from aftc-ui primitives
 * (showMenu / showConfirm / showInput / showViewer / showIntInput) with
 * aftc-console output; ctx.hasUI guards headless mode. Menu standards
 * (design section 7): grouped Action -> Manage -> Configure -> Help,
 * verb-led labels, simple Enabled/Disabled toggle vocabulary (enums
 * show their value — no tri-states), live counts in parens, Esc =
 * back, destructive actions confirm.
 *
 * Screens: disabled-state main menu (option 1 = Enable; seed failure
 * ABORTS the enable), enabled main menu, agents browser + detail
 * actions (Edit/Eject/Reset/Disable/Delete), settings, live status
 * table, kill menu (multi-select), guide viewer, agents-folder opener,
 * doctor diagnostics.
 *
 * See `subagent-ui-readme.md`.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showConfirm, showIntInput, showMenu, showViewer } from "../ui/aftc-ui";
import * as aftcConsole from "../ui/aftc-console";
import { getSubAgentPref, setSubAgentPref, setSubAgentPreset, SUB_AGENT_PRESETS } from "./subagent-config";
import {
    discoverSubAgentProfiles, getSubAgentLiveDir, getSubAgentSeedDir,
    resetSubAgentBuiltIn, seedSubAgentBuiltIns, subAgentSeedMismatch,
    syncSubAgentBuiltIns,
} from "./subagent-catalog";
import { resolvePiEntry } from "./subagent-rpc-child";
import type { SubAgentSupervisor } from "./subagent-supervisor";
import type { SubAgentProfile, SubAgentStatusSnapshot } from "./types";

export interface SubAgentUiDeps {
    supervisor: SubAgentSupervisor;
    getSnapshot(): SubAgentStatusSnapshot;
}

const HELP_LINES = [
    "Sub-Agents",
    "",
    "Delegate focused work to isolated sub-agents, each with its own fresh",
    "context window, its own tools and model. The parent session stays the",
    "planner.",
    "",
    "Commands:",
    "  /007                  Main menu",
    "  /007-status           Live run table",
    "  /007-kill             Stop one/several/all runs",
    "  /007-edit [name]      Edit an agent (On/Off options + raw file)",
    "  /007-reset <name>     Restore an agent to its original preset",
    "  /007-install          (Re)install the original presets into your agents folder",
    "  /007-sync             Pull improved presets (never overwrites your changes)",
    "  /007-open-agent-dir   Open the live agents folder",
    "  /007-guide            Read the agent-creation guide",
    "  /007-settings         Settings menu",
    "  /007-doctor           Diagnostics",
    "",
    "The model uses the `subagent` tool: it picks an agent and a task;",
    "capabilities always come from the agent's profile, never the call.",
    "",
    "Process isolation is crash/cancellation isolation, NOT a security",
    "sandbox: a sub-agent runs as you, with your credentials.",
];

// ─────────────────────────────────────────────────────────────────────────────
// Main menu
// ─────────────────────────────────────────────────────────────────────────────

export async function openSubAgentMainMenu(
    ctx: ExtensionCommandContext,
    deps: SubAgentUiDeps,
): Promise<void> {
    if (!getSubAgentPref("enabled", false)) {
        await openDisabledMenu(ctx);
        return;
    }
    await openEnabledMenu(ctx, deps);
}

async function openDisabledMenu(ctx: ExtensionCommandContext): Promise<void> {
    const choice = await showMenu(ctx, {
        title: "Sub-Agents [Disabled]",
        body: [
            "Sub-agents are off. Enable to let pi delegate focused work to",
            "isolated helpers (fresh context window each).",
        ],
        items: [
            { value: "enable", label: "Enable sub-agents" },
            { value: "guide", label: "Read the guide" },
            { value: "help", label: "Help" },
        ],
        help: "Enter select   Esc close",
    });
    if (choice === "enable") {
        // Confirm ONLY when the live data dir is missing; an existing
        // folder enables silently (the seed is idempotent copy-only).
        if (!fs.existsSync(getSubAgentLiveDir())) {
            const confirmed = await showConfirm(ctx, {
                title: "Enable sub-agents?",
                body: "Unable to detect local sub agents data directory. Shall I create and seed?",
                yesLabel: "Yes",
                noLabel: "No",
            });
            if (!confirmed) return;
        }
        try {
            const { copied, skipped } = seedSubAgentBuiltIns();
            setSubAgentPref("enabled", true);
            aftcConsole.emphasis(ctx,
                `Sub-agents enabled (${copied.length} seeded, ${skipped.length} kept)`);
        } catch (err) {
            // Seed failure ABORTS the enable — never half-seed into ON.
            aftcConsole.error(ctx,
                `Sub-agents: enabling failed — could not seed the agents folder: ${(err as Error).message}`);
        }
        return;
    }
    if (choice === "guide") {
        await showGuide(ctx);
        return;
    }
    if (choice === "help") {
        await showViewer(ctx, { title: "Sub-Agents — Help", lines: HELP_LINES });
    }
}

async function openEnabledMenu(
    ctx: ExtensionCommandContext,
    deps: SubAgentUiDeps,
): Promise<void> {
    for (;;) {
        const snapshot = deps.getSnapshot();
        const agents = discoverSubAgentProfiles();
        const items: Array<{ value: string; label: string; description?: string }> = [];
        if (snapshot.active) {
            items.push({
                value: "status",
                label: `Active work (${snapshot.runningCount} running, ${snapshot.queuedCount} queued)`,
            });
        }
        items.push({
            value: "agents",
            label: `Browse agents (${agents.length})`,
        });
        items.push({ value: "open-dir", label: "Open agents folder" });
        if (subAgentSeedMismatch()) {
            items.push({
                value: "sync",
                label: "Update shipped agents",
                description: "newer seed available (/007-sync)",
            });
        }
        items.push(
            { value: "settings", label: "Settings" },
            { value: "guide", label: "Read the guide" },
            { value: "disable", label: "Disable sub-agents" },
            { value: "help", label: "Help" },
        );
        const choice = await showMenu(ctx, {
            title: "Sub-Agents [Enabled]",
            items,
            help: "Enter select   Esc close",
        });
        if (choice === null) return;
        if (choice === "status") { await openStatusViewer(ctx, deps); continue; }
        if (choice === "agents") { await openAgentsMenu(ctx); continue; }
        if (choice === "open-dir") { openAgentsFolder(ctx); continue; }
        if (choice === "sync") { await runSync(ctx); continue; }
        if (choice === "settings") { await openSettingsMenu(ctx); continue; }
        if (choice === "guide") { await showGuide(ctx); continue; }
        if (choice === "disable") { await disableFlow(ctx, deps); return; }
        if (choice === "help") {
            await showViewer(ctx, { title: "Sub-Agents — Help", lines: HELP_LINES });
            continue;
        }
    }
}

async function disableFlow(ctx: ExtensionCommandContext, deps: SubAgentUiDeps): Promise<void> {
    const snapshot = deps.getSnapshot();
    if (snapshot.active) {
        const choice = await showMenu(ctx, {
            title: "Sub-agents still running",
            body: [`${snapshot.runningCount} running, ${snapshot.queuedCount} queued.`],
            items: [
                { value: "finish", label: "Let runs finish, then disable" },
                { value: "kill", label: "Kill runs now, then disable" },
                { value: "cancel", label: "Keep running (don't disable)" },
            ],
        });
        if (choice === "cancel" || choice === null) return;
        if (choice === "kill") {
            for (const run of deps.supervisor.getRuns()) {
                if (run.state === "running" || run.state === "starting" || run.state === "queued") {
                    await deps.supervisor.cancelRun(run.id, "feature disabled");
                }
            }
        }
    }
    const confirmed = await showConfirm(ctx, {
        title: "Disable sub-agents?",
        body: "Turns the feature off. Agent files stay in place.",
        yesLabel: "Disable",
    });
    if (confirmed) {
        setSubAgentPref("enabled", false);
        aftcConsole.emphasis(ctx, "Sub-agents disabled");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents browser + detail actions
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_DOT: Record<string, string> = { project: "•", user: "◦", builtin: "▪" };

async function openAgentsMenu(ctx: ExtensionCommandContext): Promise<void> {
    for (;;) {
        const profiles = discoverSubAgentProfiles();
        if (profiles.length === 0) {
            aftcConsole.warn(ctx, "Sub-agents: no agents found — run /007-install to seed the built-ins.");
            return;
        }
        const items = profiles.map((p) => ({
            value: p.name,
            label: `${SOURCE_DOT[p.source] ?? "?"} ${p.name}`,
            description: `${p.description.slice(0, 48)} [${p.source}]`,
        }));
        const choice = await showMenu(ctx, {
            title: "Sub-Agents",
            items,
            help: "Enter open   Esc back",
        });
        if (choice === null) return;
        const profile = profiles.find((p) => p.name === choice);
        if (profile) await openAgentDetail(ctx, profile);
    }
}

async function openAgentDetail(ctx: ExtensionCommandContext, profile: SubAgentProfile): Promise<void> {
    for (;;) {
        const items: Array<{ value: string; label: string; description?: string }> = [
            { value: "view", label: "View profile", description: "frontmatter + prompt" },
            { value: "edit", label: "Edit", description: "open in the editor" },
        ];
        if (profile.source === "builtin") {
            items.push({ value: "disable", label: "Disable", description: "set enabled: false" });
            items.push({ value: "delete", label: "Delete", description: "remove the file" });
        }
        if (profile.source !== "project") {
            items.push({ value: "reset", label: "Reset to default", description: "restore the original preset (discards your changes)" });
        }
        const choice = await showMenu(ctx, {
            title: profile.displayName,
            body: [profile.description, `source: ${profile.source} · model: ${String(profile.model)}`],
            items,
            help: "Enter select   Esc back",
        });
        if (choice === null) return;
        if (choice === "view") {
            const raw = fs.readFileSync(profile.filePath, "utf8").split("\n");
            await showViewer(ctx, { title: profile.name, lines: raw });
            continue;
        }
        if (choice === "edit") { await editAgentFile(ctx, profile); return; }
        if (choice === "disable") { setAgentEnabled(ctx, profile, false); return; }
        if (choice === "delete") {
            const ok = await showConfirm(ctx, {
                title: `Delete ${profile.name}?`,
                body: profile.filePath,
                yesLabel: "Delete",
            });
            if (ok) {
                fs.unlinkSync(profile.filePath);
                aftcConsole.emphasis(ctx, `Sub-agents: deleted ${profile.name}`);
            }
            return;
        }
        if (choice === "reset") {
            const ok = await showConfirm(ctx, {
                title: `Reset ${profile.name} to the original preset?`,
                body: "Discards your changes and restores the shipped original.",
                yesLabel: "Reset",
            });
            if (ok) {
                if (resetSubAgentBuiltIn(profile.name)) {
                    aftcConsole.emphasis(ctx, `Sub-agents: ${profile.name} restored to the original preset`);
                } else {
                    aftcConsole.warn(ctx, `Sub-agents: ${profile.name} has no shipped original to restore.`);
                }
            }
            return;
        }
    }
}

export async function editAgentFile(ctx: ExtensionCommandContext, profile: SubAgentProfile): Promise<void> {
    let editable = profile;
    if (profile.source === "builtin") {
        aftcConsole.warn(ctx, `Sub-agents: ${profile.name} is a shipped preset — copying it to your agents folder so you can edit it.`);
        syncAgentFromSeed(ctx, profile);
        const copyPath = path.join(getSubAgentLiveDir(), `${profile.name}.md`);
        if (!fs.existsSync(copyPath)) return;
        editable = { ...profile, source: "user", filePath: copyPath };
    }
    const original = fs.readFileSync(editable.filePath, "utf8");
    const edited = await ctx.ui.editor(`Edit ${editable.name}:`, original);
    if (typeof edited === "string" && edited !== original) {
        fs.writeFileSync(editable.filePath, edited, "utf8");
        aftcConsole.emphasis(ctx, `Sub-agents: saved ${editable.name}`);
    }
}

function syncAgentFromSeed(ctx: ExtensionCommandContext, profile: SubAgentProfile): void {
    syncAgentFromSeedByName(ctx, profile.name);
}

/** Copy ONE shipped preset into the user's editable agents folder
 *  (codex sync semantics for a single file): refuses when the copy
 *  already exists (the user's edits are never clobbered) and when the
 *  name is not a shipped preset. The copy takes precedence once present. */
export function syncAgentFromSeedByName(ctx: ExtensionCommandContext, name: string): void {
    const src = path.join(getSubAgentSeedDir(), `${name}.md`);
    if (!fs.existsSync(src)) {
        aftcConsole.warn(ctx, `Sub-agents: ${name} is not a shipped preset — nothing to copy.`);
        return;
    }
    const dest = path.join(getSubAgentLiveDir(), `${name}.md`);
    if (fs.existsSync(dest)) {
        aftcConsole.warn(ctx, `Sub-agents: ${name} already has an editable copy — open it with /007-edit ${name}.`);
        return;
    }
    fs.mkdirSync(getSubAgentLiveDir(), { recursive: true });
    fs.copyFileSync(src, dest);
    aftcConsole.emphasis(ctx, `Sub-agents: copied ${name} to your agents folder — this copy is yours to edit (${dest})`);
}

/** Flip/add a boolean frontmatter flag in a live agent file. */
function setAgentFrontmatterFlag(
    ctx: ExtensionCommandContext,
    profile: SubAgentProfile,
    key: string,
    field: keyof SubAgentProfile,
    value: boolean,
): SubAgentProfile {
    const raw = fs.readFileSync(profile.filePath, "utf8");
    const line = `${key}: ${value}`;
    const flagRe = new RegExp(`^${key}:\\s*(true|false)\\s*$`, "m");
    let next: string;
    if (flagRe.test(raw)) {
        next = raw.replace(flagRe, line);
    } else if (raw.startsWith("---\n")) {
        next = raw.replace(/^---\n/, `---\n${line}\n`);
    } else {
        next = `---\n${line}\n---\n\n${raw}`;
    }
    fs.writeFileSync(profile.filePath, next, "utf8");
    aftcConsole.emphasis(ctx, `Sub-agents: ${profile.name} — ${key} ${value ? "on" : "off"}`);
    // Local echo of the write (discovery hides disabled agents, so a
    // re-read is not reliable for every flag).
    return { ...profile, [field]: value };
}

/** Flip/add the `enabled:` frontmatter flag in a live agent file. */
function setAgentEnabled(ctx: ExtensionCommandContext, profile: SubAgentProfile, enabled: boolean): void {
    setAgentFrontmatterFlag(ctx, profile, "enabled", "enabled", enabled);
}

// ─────────────────────────────────────────────────────────────────────────────
// /007-edit — picker + per-agent On/Off options
// ─────────────────────────────────────────────────────────────────────────────

/** The boolean frontmatter flags exposed by the /007-edit options menu.
 *  `hint` is plain user-facing language — a first-time user must
 *  understand each toggle without knowing the internals. */
const AGENT_BOOL_OPTIONS: Array<{ key: string; label: string; hint: string; field: keyof SubAgentProfile; get: (p: SubAgentProfile) => boolean }> = [
    { key: "codex", label: "Use the knowledge base", hint: "can read stored conventions via codex", field: "codexEnabled", get: (p) => p.codexEnabled },
    { key: "codex_write", label: "Save lessons", hint: "may record lessons back to the knowledge base", field: "codexWriteEnabled", get: (p) => p.codexWriteEnabled },
    { key: "stall_detection", label: "Stall detection", hint: "stops a run that stops making progress", field: "stallDetectionEnabled", get: (p) => p.stallDetectionEnabled },
    { key: "loop_detection", label: "Loop detection", hint: "stops a run stuck repeating the same actions", field: "loopDetectionEnabled", get: (p) => p.loopDetectionEnabled },
    { key: "output_transcript", label: "Save run transcript", hint: "keeps a log file of each run", field: "outputTranscript", get: (p) => p.outputTranscript },
    { key: "persist_session", label: "Keep session", hint: "holds the session so it can be resumed", field: "persistSession", get: (p) => p.persistSession },
    { key: "enabled", label: "Enabled", hint: "off = pi can no longer use this agent", field: "enabled", get: (p) => p.enabled },
];

/** Resolve the editable (live) profile for a chosen agent; built-ins are
 *  synced to a live copy first (the seed is never written). */
function resolveEditableAgent(ctx: ExtensionCommandContext, profile: SubAgentProfile): SubAgentProfile | null {
    if (profile.source !== "builtin") return profile;
    aftcConsole.warn(ctx, `Sub-agents: ${profile.name} is a shipped preset — copying it to your agents folder so you can edit it.`);
    syncAgentFromSeed(ctx, profile);
    const copyPath = path.join(getSubAgentLiveDir(), `${profile.name}.md`);
    if (!fs.existsSync(copyPath)) return null;
    return { ...profile, source: "user", filePath: copyPath };
}

async function openAgentOptionsMenu(ctx: ExtensionCommandContext, startProfile: SubAgentProfile): Promise<void> {
    let current = resolveEditableAgent(ctx, startProfile);
    if (!current) return;
    for (;;) {
        const items: Array<{ value: string; label: string; description?: string }> =
            AGENT_BOOL_OPTIONS.map((opt) => ({
                value: `toggle:${opt.key}`,
                label: `${opt.label} — ${opt.get(current) ? "On" : "Off"}`,
                description: opt.hint,
            }));
        items.push(
            { value: "raw", label: "Edit the raw file", description: "open this agent's definition in the editor" },
            { value: "reset", label: "Reset to default", description: "restore the original preset (discards your changes)" },
        );
        const choice = await showMenu(ctx, {
            title: `Sub-Agent Options — ${current.displayName}`,
            body: [current.description, `source: ${current.source} · model: ${String(current.model)}`],
            items,
            help: "Enter toggle/select   Esc back",
        });
        if (choice === null) return;
        if (choice === "raw") { await editAgentFile(ctx, current); return; }
        if (choice === "reset") {
            const ok = await showConfirm(ctx, {
                title: `Reset ${current.name} to the original preset?`,
                body: "Discards your changes and restores the shipped original.",
                yesLabel: "Reset",
            });
            if (!ok) continue;
            if (resetSubAgentBuiltIn(current.name)) {
                aftcConsole.emphasis(ctx, `Sub-agents: ${current.name} restored to the original preset`);
                current = { ...current, filePath: path.join(getSubAgentLiveDir(), `${current.name}.md`) };
                const fresh = discoverSubAgentProfiles().find((p) => p.name === current.name);
                if (fresh) current = fresh;
            } else {
                aftcConsole.warn(ctx, `Sub-agents: ${current.name} has no shipped original to restore.`);
            }
            continue;
        }
        if (choice.startsWith("toggle:")) {
            const opt = AGENT_BOOL_OPTIONS.find((o) => `toggle:${o.key}` === choice);
            if (!opt) continue;
            const next = !opt.get(current);
            current = setAgentFrontmatterFlag(ctx, current, opt.key, opt.field, next);
            continue;
        }
    }
}

/**
 * /007-edit flow: with a name, straight to that agent's options; without
 * one, an agent picker first (Esc cancels). The picker includes disabled
 * agents (marked as such) so they can be re-enabled from inside pi;
 * the name path only resolves discovered (enabled) agents, matching
 * the tool's roster.
 */
export async function openAgentEditMenu(ctx: ExtensionCommandContext, name: string | null): Promise<void> {
    let profile: SubAgentProfile | undefined;
    if (name) {
        profile = discoverSubAgentProfiles({ includeDisabled: true }).find((p) => p.name === name);
        if (!profile) {
            aftcConsole.warn(ctx, `Sub-agents: no agent named ${name}`);
            return;
        }
    } else {
        const profiles = discoverSubAgentProfiles({ includeDisabled: true });
        if (profiles.length === 0) {
            aftcConsole.warn(ctx, "Sub-agents: no agents found — run /007-install to seed the built-ins.");
            return;
        }
        const items = profiles.map((p) => ({
            value: p.name,
            label: `${SOURCE_DOT[p.source] ?? "?"} ${p.name}`,
            description: `${p.description.slice(0, 48)} [${p.source}]${p.enabled ? "" : " (disabled)"}`,
        }));
        const choice = await showMenu(ctx, {
            title: "Edit Sub-Agent",
            items,
            help: "Enter select   Esc back",
        });
        if (choice === null) return;
        profile = profiles.find((p) => p.name === choice);
        if (!profile) return;
    }
    await openAgentOptionsMenu(ctx, profile);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

function toggleLabel(on: boolean): string { return on ? "Enabled" : "Disabled"; }

async function openSettingsMenu(ctx: ExtensionCommandContext): Promise<void> {
    for (;;) {
        const items: Array<{ value: string; label: string; description?: string }> = [
            {
                value: "toggle",
                label: "Sub-agents",
                description: toggleLabel(getSubAgentPref("enabled", false)),
            },
            { value: "preset", label: "Preset", description: getSubAgentPref("preset", "standard") },
            { value: "maxConcurrent", label: "Max concurrent", description: String(getSubAgentPref("maxConcurrent", 4)) },
            { value: "maxQueued", label: "Max queued", description: String(getSubAgentPref("maxQueued", 16)) },
            { value: "maxRunsPerSession", label: "Max runs per session", description: String(getSubAgentPref("maxRunsPerSession", 20)) },
            { value: "defaultMaxTurns", label: "Default max turns", description: String(getSubAgentPref("defaultMaxTurns", 8)) },
            { value: "graceTurns", label: "Grace turns", description: String(getSubAgentPref("graceTurns", 5)) },
            { value: "defaultTimeoutSeconds", label: "Default timeout (s)", description: String(getSubAgentPref("defaultTimeoutSeconds", 300)) },
            {
                value: "allowanceGateEnabled",
                label: "Allowance gate",
                description: toggleLabel(getSubAgentPref("allowanceGateEnabled", true)),
            },
            { value: "allowanceWarnPercent", label: "Allowance warn %", description: String(getSubAgentPref("allowanceWarnPercent", 85)) },
            {
                value: "stallDetectionEnabled",
                label: "Stall detection",
                description: toggleLabel(getSubAgentPref("stallDetectionEnabled", true)),
            },
            { value: "stallTimeoutSeconds", label: "Stall timeout (s)", description: String(getSubAgentPref("stallTimeoutSeconds", 120)) },
            {
                value: "loopDetectionEnabled",
                label: "Loop detection",
                description: toggleLabel(getSubAgentPref("loopDetectionEnabled", true)),
            },
            { value: "loopThreshold", label: "Loop threshold", description: String(getSubAgentPref("loopThreshold", 4)) },
            {
                value: "footerLineEnabled",
                label: "Footer line",
                description: toggleLabel(getSubAgentPref("footerLineEnabled", true)),
            },
            {
                value: "outputTranscript",
                label: "Output transcript",
                description: toggleLabel(getSubAgentPref("outputTranscript", true)),
            },
        ];
        const choice = await showMenu(ctx, {
            title: "Sub-Agents — Settings",
            items,
            labelWidth: 24,
            help: "Enter change   Esc back",
        });
        if (choice === null) return;

        if (choice === "toggle") {
            const next = !getSubAgentPref("enabled", false);
            if (next) {
                try { seedSubAgentBuiltIns(); } catch (err) {
                    aftcConsole.error(ctx, `Sub-agents: cannot enable — seed failed: ${(err as Error).message}`);
                    continue;
                }
            }
            setSubAgentPref("enabled", next);
            aftcConsole.emphasis(ctx, `Sub-agents: ${toggleLabel(next)}`);
            continue;
        }
        if (choice === "preset") {
            const preset = await showMenu(ctx, {
                title: "Sub-Agents — Capacity preset",
                items: (Object.keys(SUB_AGENT_PRESETS) as Array<keyof typeof SUB_AGENT_PRESETS>).map((key) => ({
                    value: key,
                    label: key[0].toUpperCase() + key.slice(1),
                    description: `concurrent ${SUB_AGENT_PRESETS[key][0]} · queued ${SUB_AGENT_PRESETS[key][1]} · runs ${SUB_AGENT_PRESETS[key][2]}`,
                })),
            });
            if (preset) {
                setSubAgentPreset(preset as "light" | "standard" | "heavy");
                aftcConsole.emphasis(ctx, `Sub-agents: preset ${preset}`);
            }
            continue;
        }
        const toggles: Record<string, "allowanceGateEnabled" | "stallDetectionEnabled" | "loopDetectionEnabled" | "footerLineEnabled" | "outputTranscript"> = {
            allowanceGateEnabled: "allowanceGateEnabled",
            stallDetectionEnabled: "stallDetectionEnabled",
            loopDetectionEnabled: "loopDetectionEnabled",
            footerLineEnabled: "footerLineEnabled",
            outputTranscript: "outputTranscript",
        };
        if (toggles[choice]) {
            const key = toggles[choice];
            const next = !getSubAgentPref(key, false);
            setSubAgentPref(key, next);
            aftcConsole.emphasis(ctx, `Sub-agents: ${choice} ${toggleLabel(next)}`);
            continue;
        }
        const numbers: Record<string, { key: "maxConcurrent" | "maxQueued" | "maxRunsPerSession" | "defaultMaxTurns" | "graceTurns" | "defaultTimeoutSeconds" | "allowanceWarnPercent" | "stallTimeoutSeconds" | "loopThreshold"; min: number; max: number }> = {
            maxConcurrent: { key: "maxConcurrent", min: 1, max: 16 },
            maxQueued: { key: "maxQueued", min: 1, max: 64 },
            maxRunsPerSession: { key: "maxRunsPerSession", min: 1, max: 200 },
            defaultMaxTurns: { key: "defaultMaxTurns", min: 1, max: 100 },
            graceTurns: { key: "graceTurns", min: 0, max: 20 },
            defaultTimeoutSeconds: { key: "defaultTimeoutSeconds", min: 30, max: 3600 },
            allowanceWarnPercent: { key: "allowanceWarnPercent", min: 10, max: 100 },
            stallTimeoutSeconds: { key: "stallTimeoutSeconds", min: 15, max: 1800 },
            loopThreshold: { key: "loopThreshold", min: 2, max: 16 },
        };
        if (numbers[choice]) {
            const spec = numbers[choice];
            const value = await showIntInput(ctx, {
                title: `Sub-Agents — ${choice}`,
                initial: getSubAgentPref(spec.key, spec.min),
                min: spec.min,
                max: spec.max,
            });
            if (value !== null) {
                setSubAgentPref(spec.key, value);
                aftcConsole.emphasis(ctx, `Sub-agents: ${choice} ${value}`);
            }
            continue;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status table + kill menu
// ─────────────────────────────────────────────────────────────────────────────

export function buildSubAgentStatusLines(deps: SubAgentUiDeps): string[] {
    const snapshot = deps.getSnapshot();
    const runs = deps.supervisor.getRuns()
        .filter((r) => r.state !== "completed" || (r.endedAt ?? 0) > Date.now() - 60_000)
        .slice(-20);
    const lines: string[] = [
        `Sub-agents — ${snapshot.runningCount} running, ${snapshot.queuedCount} queued · session spend $${snapshot.sessionCost.toFixed(4)}`,
        "",
        "ID            AGENT        STATE      ELAPSED   CTX%    TOKENS   TOOLS",
    ];
    for (const run of runs) {
        const elapsed = run.startedAt
            ? `${Math.max(0, Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000))}s`
            : "—";
        const ctxPct = run.contextPercent !== null
            ? `${run.contextPercent}%${run.compactionCount > 0 ? ` (c${run.compactionCount})` : ""}`
            : "—";
        const tokens = run.usage.input + run.usage.output + run.usage.cacheWrite;
        lines.push(
            `${run.id.slice(0, 13).padEnd(14)}${run.operative.slice(0, 12).padEnd(13)}`
            + `${run.state.padEnd(11)}${elapsed.padEnd(10)}${ctxPct.padEnd(8)}`
            + `${String(tokens).padEnd(9)}${run.toolCallCount}`,
        );
    }
    if (runs.length === 0) lines.push("(no runs this session)");
    return lines;
}

export async function openStatusViewer(ctx: ExtensionCommandContext, deps: SubAgentUiDeps): Promise<void> {
    await showViewer(ctx, { title: "Sub-Agents — Status", lines: buildSubAgentStatusLines(deps) });
}

export async function openKillMenu(ctx: ExtensionCommandContext, deps: SubAgentUiDeps): Promise<void> {
    const selected = new Set<string>();
    for (;;) {
        const active = deps.supervisor.getRuns()
            .filter((r) => r.state === "running" || r.state === "starting" || r.state === "queued");
        if (active.length === 0) {
            aftcConsole.warn(ctx, "Sub-agents: no active runs to kill.");
            return;
        }
        const items = active.map((run) => ({
            value: run.id,
            label: `${selected.has(run.id) ? "[x]" : "[ ]"} ${run.id.slice(0, 13)} ${run.operative}`,
            description: run.state,
        }));
        items.push({ value: "__all", label: `(all ${active.length} active)` });
        const choice = await showMenu(ctx, {
            title: "Sub-Agents — Kill runs",
            items,
            help: "Enter toggle/select   Esc back",
        });
        if (choice === null) return;
        if (choice === "__all") {
            const ok = await showConfirm(ctx, {
                title: `Kill all ${active.length} runs?`,
                body: "Each goes through the full termination ladder.",
                yesLabel: "Kill all",
            });
            if (ok) {
                for (const run of active) await deps.supervisor.cancelRun(run.id, "kill all");
                aftcConsole.emphasis(ctx, `Sub-agents: killed ${active.length} run(s)`);
            }
            return;
        }
        if (selected.has(choice)) selected.delete(choice);
        else selected.add(choice);
        if (selected.size > 0) {
            const proceed = await showConfirm(ctx, {
                title: `Kill ${selected.size} selected run(s)?`,
                yesLabel: "Kill selected",
            });
            if (proceed) {
                for (const id of selected) await deps.supervisor.cancelRun(id, "kill menu");
                aftcConsole.emphasis(ctx, `Sub-agents: killed ${selected.size} run(s)`);
                return;
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guide, agents folder, sync, doctor
// ─────────────────────────────────────────────────────────────────────────────

export async function showGuide(ctx: ExtensionCommandContext): Promise<void> {
    const guidePath = path.join(getSubAgentLiveDir(), "README.md");
    if (!fs.existsSync(guidePath)) {
        try { seedSubAgentBuiltIns(); } catch { /* show the seeded-missing message below */ }
    }
    if (!fs.existsSync(guidePath)) {
        aftcConsole.warn(ctx, "Sub-agents: guide not found — run /007-install to seed the agents folder.");
        return;
    }
    await showViewer(ctx, {
        title: "Sub-Agents — Agent creation guide",
        lines: fs.readFileSync(guidePath, "utf8").split("\n"),
    });
}

/** Cross-platform folder opener (the /qd openInFileManager pattern). */
function openInFileManager(dir: string): void {
    const cmd = process.platform === "win32" ? "explorer.exe"
        : process.platform === "darwin" ? "open" : "xdg-open";
    try {
        const child = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
        child.unref();
    } catch { /* headless box — the printed path below still helps */ }
}

export function openAgentsFolder(ctx: ExtensionCommandContext): void {
    const dir = getSubAgentLiveDir();
    try {
        if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) seedSubAgentBuiltIns();
    } catch (err) {
        aftcConsole.warn(ctx, `Sub-agents: could not seed the agents folder: ${(err as Error).message}`);
    }
    openInFileManager(dir);
    aftcConsole.emphasis(ctx, `Sub-agents: agents folder ${dir}`);
}

export async function runSync(ctx: ExtensionCommandContext): Promise<void> {
    try {
        const result = syncSubAgentBuiltIns();
        const parts: string[] = [];
        if (result.added.length > 0) parts.push(`${result.added.length} added`);
        if (result.updated.length > 0) parts.push(`${result.updated.length} updated`);
        if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} kept (your edits)`);
        aftcConsole.emphasis(ctx, `Sub-agents: sync ${parts.join(", ") || "already up to date"}`);
        if (result.conflicts.length > 0) {
            aftcConsole.info(ctx, `Sub-agents: sync conflicts (untouched): ${result.conflicts.join(", ")}`);
        }
    } catch (err) {
        aftcConsole.error(ctx, `Sub-agents: sync failed: ${(err as Error).message}`);
    }
}

export async function openDoctor(ctx: ExtensionCommandContext, deps: SubAgentUiDeps): Promise<void> {
    const lines: string[] = [];
    const check = (ok: boolean, warn: boolean, label: string): void => {
        lines.push(`${ok ? "PASS" : warn ? "WARN" : "FAIL"}  ${label}`);
    };
    // Transport + spawn entry.
    try {
        const entry = resolvePiEntry();
        check(true, false, `pi entry resolves: ${entry.command} ${entry.preArgs.join(" ")}`);
    } catch (err) {
        check(false, false, `pi entry resolution failed: ${(err as Error).message}`);
    }
    check(getSubAgentPref("transport", "rpc") === "rpc", false, "transport: rpc");
    check(getSubAgentPref("enabled", false), true, "feature enabled");
    // Catalog health.
    const profiles = discoverSubAgentProfiles();
    check(profiles.length > 0, true, `frontmatter: ${profiles.length} agent(s) discovered`);
    const seedOk = !subAgentSeedMismatch();
    check(seedOk, true, seedOk ? "seed version current" : "seed mismatch — run /007-sync");
    // Run history: watchdog trips are surfaced so misconfiguration is visible.
    const runs = deps.supervisor.getRuns();
    const stallCount = runs.filter((r) => r.diagnostics.includes("stall")).length;
    const loopCount = runs.filter((r) => r.diagnostics.includes("loop")).length;
    const failed = runs.filter((r) => r.state === "failed").length;
    check(stallCount === 0, true, `stall watchdog trips this session: ${stallCount}`);
    check(loopCount === 0, true, `loop watchdog trips this session: ${loopCount}`);
    check(failed === 0, true, `failed runs this session: ${failed}`);
    check(true, false, "usage accounting: in-memory only (no database writes)");
    await showViewer(ctx, { title: "Sub-Agents — Doctor", lines });
}

// ─────────────────────────────────────────────────────────────────────────────
// Headless fallbacks
// ─────────────────────────────────────────────────────────────────────────────

/** Headless fallback: bounded text block, never blocks (print mode). */
export function printSubAgentSummary(deps: SubAgentUiDeps): void {
    const enabled = getSubAgentPref("enabled", false);
    if (!enabled) {
        aftcConsole.print("Sub-agents: DISABLED — run /007 in the TUI to enable.");
        return;
    }
    const snapshot = deps.getSnapshot();
    const agents = discoverSubAgentProfiles().map((a) => a.name).join(", ");
    aftcConsole.print(
        `Sub-agents: enabled · ${snapshot.runningCount} running, ${snapshot.queuedCount} queued`
        + ` · spend $${snapshot.sessionCost.toFixed(4)} · agents: ${agents || "(none)"}`
        + ` · live dir: ${getSubAgentLiveDir()}`);
}

export function printSubAgentStatus(deps: SubAgentUiDeps): void {
    for (const line of buildSubAgentStatusLines(deps)) aftcConsole.print(line);
}
