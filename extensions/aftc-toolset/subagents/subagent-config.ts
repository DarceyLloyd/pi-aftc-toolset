/**
 * pi-aftc-toolset — subagents configuration (subagents-config.json).
 *
 * The 007 feature keeps ALL of its preferences in its OWN file —
 * `<dataDir>/subagents-config.json` — deliberately NOT in the shared
 * config.json, so the whole feature is self-contained and can be
 * dropped from a release without touching the main config (the
 * `ssh.json` precedent). Keys are UNPREFIXED — the file is the
 * namespace; the prefixed code identifiers (subAgentsEnabled, ...) map
 * onto them here and only here.
 *
 * NO IN-MEMORY CACHE (same binding rule as config.ts): every read hits
 * the file on disk. pi keeps extension modules alive across /new, so a
 * cache would serve stale values after a hand edit and a later write
 * would flush the stale cache back over the user's edits. The file is
 * tiny and local; reading it each time is free.
 *
 * Contract:
 *   - created from DEFAULT_SUBAGENTS_CONFIG on first access
 *   - existing values are sacred: the load-merge backfills only
 *     MISSING / wrong-type keys (write-back migration) and never
 *     overwrites a saved value
 *   - setSubAgentPref is a fresh read-modify-write, saved atomically
 *     (tmp + rename)
 *   - optional project override `<cwd>/.pi/subagents-config.json` is
 *     merged on load with project values winning (read-only for the
 *     extension — writes always go to the live file)
 *   - `enabled` ships FALSE: the whole feature is off until the user
 *     opts in via /007 (AGENTS.md new-feature rule)
 *
 * All operations are best-effort: errors are logged via aftc-console's
 * logError-style fallback (console.log — this module is imported by
 * config-free contexts, so it keeps zero feature imports) and callers
 * fall back to defaults rather than crashing pi.
 *
 * See `subagent-config-readme.md`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getDataDir } from "../paths";

// ─────────────────────────────────────────────────────────────────────────────
// Types + defaults
// ─────────────────────────────────────────────────────────────────────────────

export interface SubAgentsConfig {
    /** TOP-LEVEL feature switch. Off until the user enables via /007. */
    enabled: boolean;
    /** "rpc" (preferred, the only transport wired in v1) | "json-print"
     *  (documented fallback value only). */
    transport: "rpc" | "json-print";
    /** Token budget for the tool prompt: full | compact | custom. */
    toolDescriptionMode: "full" | "compact" | "custom";

    /** Capacity preset: light (2/8/10) | standard (4/16/20) | heavy (8/32/40). */
    preset: "light" | "standard" | "heavy";
    /** Active children per session. */
    maxConcurrent: number;
    /** Queue cap. */
    maxQueued: number;
    /** Hard stop on new spawns per session. */
    maxRunsPerSession: number;
    /** Default max agentic turns. */
    defaultMaxTurns: number;
    /** Wrap-up turns granted after max turns before hard abort. */
    graceTurns: number;
    /** Hard wall-clock cap per run. */
    defaultTimeoutSeconds: number;

    /** Confirm spawn when an allowance window is near used-up. */
    allowanceGateEnabled: boolean;
    /** Gate fires at/above this % of any allowance window (5h or weekly). */
    allowanceWarnPercent: number;
    /** Steer-then-abort a run with no progress events. */
    stallDetectionEnabled: boolean;
    /** No-progress window before the stall watchdog fires. */
    stallTimeoutSeconds: number;
    /** Steer-then-abort on repeated tool-call signatures. */
    loopDetectionEnabled: boolean;
    /** Signature repeat count that trips loop detection. */
    loopThreshold: number;

    /** Background completion batching (Phase 2; inert in v1). */
    joinMode: "smart" | "async" | "group";
    /** Nesting cap (0 or 1 = off; Phase 3). */
    maxSubagentDepth: number;
    /** Unknown-agent fallback: "none" = strict error, or an agent name. */
    fallbackOperative: string;
    /** Hide the built-in core roster. */
    disableDefaultAgents: boolean;
    /** Restrict agent models to pi's enabledModels allowlist. */
    scopeModels: boolean;
    /** Cron/interval/one-shot spawn (Phase 5; inert in v1). */
    schedulingEnabled: boolean;

    /** The integrated footer line (always visible while the feature is enabled). */
    footerLineEnabled: boolean;
    /** Write each run's transcript file. */
    outputTranscript: boolean;

    /** Capability exposure: sub-agents may access aftc-codex (kill switch). */
    codexAccessEnabled: boolean;
    /** Capability exposure: sub-agents may write codex entries (per-agent
     *  codex_write still required too). */
    codexWriteEnabled: boolean;
}

/** Single source of truth for a fresh subagents-config.json. */
export const DEFAULT_SUBAGENTS_CONFIG: SubAgentsConfig = {
    enabled: false,
    transport: "rpc",
    toolDescriptionMode: "full",
    preset: "standard",
    maxConcurrent: 4,
    maxQueued: 16,
    maxRunsPerSession: 20,
    defaultMaxTurns: 8,
    graceTurns: 5,
    defaultTimeoutSeconds: 300,
    allowanceGateEnabled: true,
    allowanceWarnPercent: 85,
    stallDetectionEnabled: true,
    stallTimeoutSeconds: 120,
    loopDetectionEnabled: true,
    loopThreshold: 4,
    joinMode: "smart",
    maxSubagentDepth: 2,
    fallbackOperative: "none",
    disableDefaultAgents: false,
    scopeModels: false,
    schedulingEnabled: false,
    footerLineEnabled: true,
    outputTranscript: true,
    codexAccessEnabled: true,
    codexWriteEnabled: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

/** Live config file: <dataDir>/subagents-config.json. */
export function getSubAgentsConfigJson(): string {
    return path.join(getDataDir(), "subagents-config.json");
}

/** Optional project override: <cwd>/.pi/subagents-config.json. */
export function getProjectSubAgentsConfigJson(cwd: string = process.cwd()): string {
    return path.join(cwd, ".pi", "subagents-config.json");
}

// ─────────────────────────────────────────────────────────────────────────────
// Load / save (NO cache)
// ─────────────────────────────────────────────────────────────────────────────

function readJsonObject(filePath: string): Record<string, unknown> | null {
    try {
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function ensureSubAgentsConfigFile(): void {
    const filePath = getSubAgentsConfigJson();
    try {
        if (fs.existsSync(filePath)) return;
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = filePath + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(DEFAULT_SUBAGENTS_CONFIG, null, 2), "utf-8");
        fs.renameSync(tmp, filePath);
    } catch (err) {
        console.log(`[aftc-toolset] subagents-config ensure error: ${(err as Error).message}`);
    }
}

/**
 * Fresh read on EVERY call. Merges defaults <- live file <- project
 * override (project wins), backfilling only MISSING/wrong-type keys in
 * the LIVE file (the project override file is never written).
 */
function loadSubAgentsConfigInternal(): SubAgentsConfig {
    ensureSubAgentsConfigFile();
    const live = readJsonObject(getSubAgentsConfigJson()) ?? {};

    // Write-back migration: backfill missing/wrong-type keys so a file
    // from any older release becomes complete in one pass. Existing
    // values are sacred.
    const backfilled: Record<string, unknown> = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_SUBAGENTS_CONFIG)) {
        if (typeof live[key] !== typeof defaultValue) backfilled[key] = defaultValue;
    }
    if (Object.keys(backfilled).length > 0) {
        saveSubAgentsConfigInternal({ ...DEFAULT_SUBAGENTS_CONFIG, ...live, ...backfilled } as SubAgentsConfig);
    }

    const project = readJsonObject(getProjectSubAgentsConfigJson());
    const merged: Record<string, unknown> = {
        ...DEFAULT_SUBAGENTS_CONFIG,
        ...live,
        ...(project ?? {}),
    };
    return merged as unknown as SubAgentsConfig;
}

function saveSubAgentsConfigInternal(config: SubAgentsConfig): void {
    const filePath = getSubAgentsConfigJson();
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = filePath + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf-8");
        fs.renameSync(tmp, filePath);
    } catch (err) {
        console.log(`[aftc-toolset] subagents-config write error: ${(err as Error).message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read one preference (project override included). Falls back to the
 * supplied default when missing. Fresh disk read on every call.
 */
export function getSubAgentPref<K extends keyof SubAgentsConfig>(
    key: K,
    defaultValue: SubAgentsConfig[K],
): SubAgentsConfig[K] {
    try {
        const config = loadSubAgentsConfigInternal();
        const value = config[key];
        return (value === undefined ? defaultValue : value) as SubAgentsConfig[K];
    } catch (err) {
        console.log(`[aftc-toolset] subagents-config read error: ${(err as Error).message}`);
        return defaultValue;
    }
}

/**
 * Persist one preference. Fresh read-modify-write of the LIVE file
 * (never the project override), saved atomically. Best-effort: errors
 * are logged, never thrown.
 */
export function setSubAgentPref<K extends keyof SubAgentsConfig>(
    key: K,
    value: SubAgentsConfig[K],
): void {
    try {
        ensureSubAgentsConfigFile();
        const live = readJsonObject(getSubAgentsConfigJson()) ?? {};
        const merged = { ...DEFAULT_SUBAGENTS_CONFIG, ...live, [key]: value } as SubAgentsConfig;
        saveSubAgentsConfigInternal(merged);
    } catch (err) {
        console.log(`[aftc-toolset] subagents-config set error: ${(err as Error).message}`);
    }
}

/** Capacity presets: maxConcurrent / maxQueued / maxRunsPerSession. */
export const SUB_AGENT_PRESETS: Record<SubAgentsConfig["preset"], [number, number, number]> = {
    light: [2, 8, 10],
    standard: [4, 16, 20],
    heavy: [8, 32, 40],
};

/** Apply a capacity preset (the three caps together). */
export function setSubAgentPreset(preset: SubAgentsConfig["preset"]): void {
    const caps = SUB_AGENT_PRESETS[preset];
    if (!caps) return;
    setSubAgentPref("preset", preset);
    setSubAgentPref("maxConcurrent", caps[0]);
    setSubAgentPref("maxQueued", caps[1]);
    setSubAgentPref("maxRunsPerSession", caps[2]);
}
