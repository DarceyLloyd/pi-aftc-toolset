/**
 * pi-aftc-toolset — subagents command surface (codename 007).
 *
 * Registers `/007` + the `/007-*` family ONLY — no aliases (design Q3:
 * pi has no pre-registration collision check and silently suffixes
 * colliding names as `/name:1`, so distinctive names are the only safe
 * policy). Every command guards ctx.hasUI: headless mode prints a
 * bounded text block via aftcConsole.print and never blocks.
 *
 *   /007                  main menu (enable/disable, agents, ...)
 *   /007-status           live run table
 *   /007-kill             kill menu (multi-select, kill all)
 *   /007-edit [name]      edit an agent (picker + On/Off options + raw file)
 *   /007-reset <name>     restore an agent to its original preset
 *   /007-install          (re)seed the agents folder (idempotent)
 *   /007-sync             non-destructive merge of improved presets
 *   /007-open-agent-dir   open the live agents folder in the file manager
 *   /007-guide            render the agent-creation guide
 *   /007-settings         settings menu
 *   /007-doctor           diagnostics
 *
 * See `subagent-commands-readme.md`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerHelpEntry } from "../help-registry";
import * as aftcConsole from "../ui/aftc-console";
import { showConfirm, showViewer } from "../ui/aftc-ui";
import * as path from "node:path";
import {
    discoverSubAgentProfiles, getSubAgentLiveDir, resetSubAgentBuiltIn,
    seedSubAgentBuiltIns, syncSubAgentBuiltIns,
} from "./subagent-catalog";
import type { SubAgentSupervisor } from "./subagent-supervisor";
import type { SubAgentStatusSnapshot } from "./types";
import {
    buildSubAgentStatusLines,
    openAgentEditMenu, openAgentsFolder, openDoctor, openKillMenu,
    openSettingsMenu, openSubAgentMainMenu, printSubAgentStatus,
    printSubAgentSummary, showGuide,
} from "./subagent-ui";

export interface SubAgentCommandDeps {
    supervisor: SubAgentSupervisor;
    getSnapshot(): SubAgentStatusSnapshot;
}

const CATEGORY = "Sub-agents" as const;

function cleanArg(args: string | undefined): string {
    return String(args ?? "").trim().replace(/^@/, "");
}

export function registerSubAgentCommands(pi: ExtensionAPI, deps: SubAgentCommandDeps): void {
    const uiDeps = { supervisor: deps.supervisor, getSnapshot: deps.getSnapshot };

    // ── /007 — main menu ──────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007",
        description: "Sub-agents: main menu (enable/disable, agents, settings, help)",
        category: CATEGORY,
    });
    pi.registerCommand("007", {
        description: "Sub-agents: main menu",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) { printSubAgentSummary(uiDeps); return; }
            await openSubAgentMainMenu(ctx, uiDeps);
        },
    });

    // ── /007-status — live run table ──────────────────────────────────────
    registerHelpEntry({
        command: "007-status",
        description: "Live run table: counts, elapsed, context %, tokens, state",
        category: CATEGORY,
    });
    pi.registerCommand("007-status", {
        description: "Sub-agents: live run table",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) { printSubAgentStatus(uiDeps); return; }
            await showViewer(ctx, { title: "Sub-Agents — Status", lines: buildSubAgentStatusLines(uiDeps) });
        },
    });

    // ── /007-kill — bulk termination ─────────────────────────────────────────
    registerHelpEntry({
        command: "007-kill",
        description: "Kill menu: stop one, several, or all active runs",
        category: CATEGORY,
    });
    pi.registerCommand("007-kill", {
        description: "Sub-agents: kill active runs",
        handler: async (args, ctx) => {
            const target = cleanArg(args);
            if (!ctx.hasUI) {
                // Headless fallback: /007-stop-style single kill by id.
                if (!target) { aftcConsole.print("Sub-agents kill: pass a run id in headless mode."); return; }
                const ok = await deps.supervisor.cancelRun(target, "headless kill");
                aftcConsole.print(ok ? `Sub-agents: killed ${target}` : `Sub-agents: no active run ${target}`);
                return;
            }
            if (target) {
                const ok = await deps.supervisor.cancelRun(target, "killed by user");
                if (ok) aftcConsole.emphasis(ctx, `Sub-agents: killed ${target}`);
                else aftcConsole.warn(ctx, `Sub-agents: no active run ${target}`);
                return;
            }
            await openKillMenu(ctx, uiDeps);
        },
    });

    // ── /007-edit [name] ──────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-edit",
        args: "[name]",
        description: "Edit a sub-agent: pick an agent, flip its On/Off options, or open its raw file",
        category: CATEGORY,
    });
    pi.registerCommand("007-edit", {
        description: "Sub-agents: edit an agent (picker + per-agent On/Off options + raw file)",
        handler: async (args, ctx) => {
            const name = cleanArg(args);
            if (!ctx.hasUI) {
                if (name) {
                    const profile = discoverSubAgentProfiles().find((p) => p.name === name);
                    if (!profile) { aftcConsole.print(`Sub-agents: no agent named ${name}`); return; }
                    aftcConsole.print(`007-edit: ${profile.filePath}`);
                    return;
                }
                aftcConsole.print(`007-edit: agents: ${discoverSubAgentProfiles().map((p) => p.name).join(", ") || "(none)"}`);
                return;
            }
            await openAgentEditMenu(ctx, name || null);
        },
    });

    // ── /007-reset <name> ─────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-reset",
        args: "<name>",
        description: "Restore an agent to its original preset (discards your changes)",
        category: CATEGORY,
    });
    pi.registerCommand("007-reset", {
        description: "Sub-agents: restore an agent to its original preset",
        handler: async (args, ctx) => {
            const name = cleanArg(args);
            if (!name) { aftcConsole.warn(ctx, "007-reset: usage /007-reset <name>"); return; }
            if (ctx.hasUI) {
                const ok = await showConfirm(ctx, {
                    title: `Reset ${name} to the original preset?`,
                    body: "Discards your changes and restores the shipped original.",
                    yesLabel: "Reset",
                });
                if (!ok) return;
            }
            if (resetSubAgentBuiltIn(name)) aftcConsole.emphasis(ctx, `Sub-agents: ${name} restored to the original preset`);
            else aftcConsole.warn(ctx, `Sub-agents: ${name} has no shipped original to restore.`);
        },
    });

    // ── /007-install ──────────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-install",
        description: "(Re)install the original presets into your agents folder (safe to repeat)",
        category: CATEGORY,
    });
    pi.registerCommand("007-install", {
        description: "Sub-agents: install the original presets into your agents folder",
        handler: async (_args, ctx) => {
            try {
                const { copied, skipped } = seedSubAgentBuiltIns();
                aftcConsole.emphasis(ctx,
                    `Sub-agents: install ${copied.length} seeded, ${skipped.length} kept`
                    + (copied.length > 0 ? ` (${copied.join(", ")})` : ""));
            } catch (err) {
                aftcConsole.error(ctx, `Sub-agents: install failed: ${(err as Error).message}`);
            }
        },
    });

    // ── /007-sync ─────────────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-sync",
        description: "Pull improved presets into your folder (never overwrites your changes)",
        category: CATEGORY,
    });
    pi.registerCommand("007-sync", {
        description: "Sub-agents: merge improved presets without touching your changes",
        handler: async (_args, ctx) => {
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
        },
    });

    // ── /007-open-agent-dir ───────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-open-agent-dir",
        description: "Open your live agents folder in the file manager",
        category: CATEGORY,
    });
    pi.registerCommand("007-open-agent-dir", {
        description: "Sub-agents: open the live agents folder",
        handler: async (_args, ctx) => {
            openAgentsFolder(ctx);
        },
    });

    // ── /007-guide ────────────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-guide",
        description: "Read the agent-creation guide inside pi",
        category: CATEGORY,
    });
    pi.registerCommand("007-guide", {
        description: "Sub-agents: read the agent-creation guide",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                aftcConsole.print(`Sub-agents guide: ${path.join(getSubAgentLiveDir(), "README.md")}`);
                return;
            }
            await showGuide(ctx);
        },
    });

    // ── /007-settings ─────────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-settings",
        description: "Settings: presets, concurrency, budgets, safety watchdogs, footer line",
        category: CATEGORY,
    });
    pi.registerCommand("007-settings", {
        description: "Sub-agents: settings menu",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) { printSubAgentSummary(uiDeps); return; }
            await openSettingsMenu(ctx);
        },
    });

    // ── /007-doctor ───────────────────────────────────────────────────────────
    registerHelpEntry({
        command: "007-doctor",
        description: "Diagnostics: pi entry, transport, seed version, watchdog trips",
        category: CATEGORY,
    });
    pi.registerCommand("007-doctor", {
        description: "Sub-agents: diagnostics",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                aftcConsole.print(`Sub-agents doctor: ${discoverSubAgentProfiles().length} agents discovered`);
                return;
            }
            await openDoctor(ctx, uiDeps);
        },
    });
}
