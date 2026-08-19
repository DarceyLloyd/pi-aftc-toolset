/**
 * pi-aftc-toolset / aftc-codex — the /aftc-codex-* commands + config menu.
 *
 * Commands:
 *   /aftc-codex          Open the config menu (AFTC UI) — the main config surface (Phase 7).
 *   /aftc-codex-enable   Enable the knowledge base (alias /codex-enable).
 *   /aftc-codex-disable  Disable + strip all codex from context (alias /codex-disable).
 *   /aftc-codex-install  Fresh install (or re-install) the codex to the user data dir.
 *   /aftc-codex-init     Primary prep: rules live + marker + doc fetch (alias /codex-init).
 *   /aftc-codex-refresh  Strip all codex from context, then re-init (clean restart).
 *   /aftc-codex-learn    Self-education prompt injection (Phase 5).
 *   /aftc-codex-status   Quick status viewer.
 *   /aftc-codex-list     List every available codex resource, alphabetically (alias /codex-list).
 *   /aftc-codex-load     Pick codex resources to load via a menu (alias /codex-load).
 *   /codex-inject-rules     Rules-only mode for this session (critical rules only).
 *
 * List-regeneration: a new topic file (codex_add_entry) and Start Fresh spawn
 * the list-regeneration script; pure toggles skip the spawn.
 *
 * Menus use ONLY the aftc-ui primitives (showMenu/showConfirm) -
 * never hand-built chrome (AGENTS.md AFTC UI rules). All guard ctx.hasUI / mode==="tui";
 * print mode falls back to printed summaries and never auto-merges destructively (M-I4).
 *
 * See `codex-commands-readme.md` for the full contract.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { getPreference, setPreference } from "../config";
import { showConfirm, showMenu } from "../ui/aftc-ui";
import * as aftcConsole from "../ui/aftc-console";
import { registerHelpEntry } from "../help-registry";
import type { CodexContext, CodexDetectResult } from "./aftc-codex";
import { type CodexInjectApi, CODEX_READ_ENTRY, CODEX_STATUS_ENTRY } from "./codex-inject";
import type { CodexLearnApi } from "./codex-learn";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function notify(ctx: ExtensionCommandContext, msg: string, level: "info" | "warning" | "error" = "info"): void {
    if (!ctx.hasUI) { aftcConsole.print(msg); return; }
    if (level === "warning") aftcConsole.warn(ctx, msg);
    else if (level === "error") aftcConsole.error(ctx, msg);
    else aftcConsole.emphasis(ctx, msg);
}

function isTui(ctx: ExtensionCommandContext): boolean {
    return !!ctx.hasUI && ctx.mode === "tui";
}

/** Command-context busy check (mirrors replay.ts). Returns true when
 *  the agent is currently processing. Used by the init/refresh/learn
 *  handlers to decide whether their marker should be queued (busy)
 *  or sent inline (idle). Lives here (not in codex-inject.ts) because
 *  the only caller is the command handlers - it has nothing to do
 *  with the injection pipeline. */
function isCommandBusy(ctx: ExtensionCommandContext | undefined): boolean {
    if (!ctx) return false;
    return ctx.isIdle ? !ctx.isIdle() : false;
}

/** When the auto-insert AGENTS.md setting is OFF but the project already
 *  declares an AFTC-CODEX-STACK block, tell the user it is being left
 *  untouched (codex never writes those files, but it may still read the
 *  block for detection). Warns once per init/refresh. */
function notifyStackBlockUntouched(ctx: CodexContext, cctx: ExtensionCommandContext): void {
    if (getPreference("aftcCodexAutoInsertAgentsEnabled", false)) return;
    if (!cctx.cwd) return;
    const file = ctx.stackBlockFile?.(cctx.cwd);
    if (!file) return;
    notify(cctx,
        `${file} already contains an AFTC-CODEX-STACK block (the codex resources to load). ` +
        "Auto-insert is OFF, so codex will not touch it - remove it by hand if you do not want it there.",
        "warning");
}

function detectedTopics(ctx: CodexContext, cctx: ExtensionCommandContext): CodexDetectResult | undefined {
    if (!getPreference("aftcCodexAutoLoad", true)) return undefined;
    if (!ctx.detect || !cctx.cwd) return undefined;
    try {
        const result = ctx.detect(cctx.cwd);
        return (result.topics.length > 0 || result.missing.length > 0) ? result : undefined;
    } catch {
        return undefined;
    }
}

/** Seed on first enable (copy the shipped fixed docs). Always succeeds
 *  (the fixed docs are the only shipped content). */
function ensureSeeded(ctx: CodexContext): boolean {
    const { store } = ctx;
    if (store.isSeeded()) return true;
    store.seed();
    return true;
}

/** Reads of these relPaths are NOT topic docs (fixed top-level guidance files
 *  at the codex root + the generated resource list). */
const NON_TOPIC_READS = new Set([
    "codex-rules.md",
    "thought-and-action-guidance.md",
    "markdown-guidance.md",
    "codex-resource-list.md",
]);

/**
 * Count distinct codex topic docs read this session by scanning the durable
 * read-tracking entries (CODEX_READ_ENTRY) the codex_load tool appends. Works
 * in fresh, resumed, reloaded and compacted sessions alike (custom entries
 * persist and survive compaction). Counts category topic docs (flat AND
 * nested) plus root-level loose topics (documentation-and-planning.md) so it
 * stays coherent with the available total (which excludes top-level guidance
 * + the generated resource list).
 */
function countReadTopicDocs(cctx: ExtensionCommandContext): number {
    const seen = new Set<string>();
    try {
        const entries = cctx.sessionManager.getEntries() as Array<{
            type?: string;
            customType?: string;
            data?: { relPath?: string };
        }>;
        for (const e of entries) {
            if (e.type === "custom" && e.customType === CODEX_READ_ENTRY && e.data?.relPath) {
                seen.add(e.data.relPath);
            }
        }
    } catch {
        // fail-soft: report 0 rather than throw
    }
    let n = 0;
    for (const rel of seen) {
        if (rel.includes("/") || !NON_TOPIC_READS.has(rel)) n++;
    }
    return n;
}



// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — config menu
// ─────────────────────────────────────────────────────────────────────────────

/** Open a directory in the OS file manager (detached; never blocks pi). */
function openDir(dir: string): void {
    let cmd: string;
    let args: string[];
    if (process.platform === "win32") { cmd = "explorer.exe"; args = [dir]; }
    else if (process.platform === "darwin") { cmd = "open"; args = [dir]; }
    else { cmd = "xdg-open"; args = [dir]; }
    try {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.unref();
    } catch (err) {
        aftcConsole.logError(`[aftc-toolset] codex openDir error: ${(err as Error).message}`);
    }
}


/** Screen 1.6 — Resources & updates (Start Fresh + open dir only). */
async function openResourcesMenu(ctx: CodexContext, cctx: ExtensionCommandContext): Promise<void> {
    const { store } = ctx;
    while (true) {
        const choice = await showMenu(cctx, {
            title: "Menu:",
            labelWidth: 24,
            items: [
                { value: "fresh", label: "Start Fresh", description: " Wipe users codex files and start fresh" },
                { value: "opendir", label: "Open Codex Resource Dir" },
            ],
        });
        if (!choice) return;
        if (choice === "fresh") {
            const ok = await showConfirm(cctx, {
                title: "Start fresh?",
                body: "Wipe ALL your codex files (the rules and guidance AND every resource doc you created) and restore the shipped basics? This cannot be undone.",
            });
            if (ok) {
                // Full wipe of the live codex dir, then a complete fresh seed copy.
                try { fs.rmSync(store.getRoot(), { recursive: true, force: true }); } catch { /* ignore */ }
                store.seed();
                notify(cctx, "Codex wiped and restored to the shipped basics (your resources folder starts empty).", "info");
            }
            return;
        }
        if (choice === "opendir") {
            const dir = store.getResourcesDir();
            try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
            openDir(dir);
            notify(cctx, `Opened ${dir}`, "info");
            return;
        }
    }
}

/** Screen 1 — main menu (inline toggles re-render). */
async function openMainMenu(ctx: CodexContext, cctx: ExtensionCommandContext, inject: CodexInjectApi): Promise<void> {
    const { store, state } = ctx;
    let selectedIndex = 0;
    while (true) {
        const enabled = getPreference("aftcCodexEnabled", false);
        const counts = store.getCounts();
        const sessionState = state.rulesOnly
            ? "Rules-only (start a new session, then /codex-init, for the full codex)"
            : state.prepped && !state.silent
                ? "Prepped"
                : "Not prepped (Run /codex-init to prep the AI)";
        const body = [
            `AFTC Codex: ${counts.total} resources available`,
            `Session state: ${sessionState}`,
        ];
        const yn = (b: boolean) => (b ? "Yes" : "No");
        const items = [
            { value: "enabled", label: "Codex Enabled", description: ` | ${yn(enabled)}` },
            { value: "guidance", label: "Inject Thought Guidance", description: ` | ${yn(getPreference("aftcCodexInjectGuidance", true))}` },
            { value: "autoload", label: "Auto-Detect & Load Docs", description: ` | ${yn(getPreference("aftcCodexAutoLoad", true))}` },
            { value: "agents", label: "Auto Insert Codex Skills to Load into AGENTS.md", description: ` | ${yn(getPreference("aftcCodexAutoInsertAgentsEnabled", false))}` },
            { value: "resources", label: "Resources & Updates" },
        ];
        const choice = await showMenu(cctx, {
            title: "Menu:",
            body,
            labelWidth: 48,
            initialIndex: selectedIndex,
            items,
        });
        if (!choice) return; // Esc closes the menu
        selectedIndex = Math.max(0, items.findIndex((i) => i.value === choice));

        if (choice === "enabled") {
            if (!enabled) {
                ensureSeeded(ctx);
                setPreference("aftcCodexEnabled", true);
                notify(cctx, "AFTC Codex enabled. Run /codex-init to prep the AI.", "info");
            } else {
                setPreference("aftcCodexEnabled", false);
                state.prepped = false;
                state.silent = false;
                inject.persistState();
                notify(cctx, "AFTC Codex disabled.", "info");
            }
        } else if (choice === "guidance") {
            setPreference("aftcCodexInjectGuidance", !getPreference("aftcCodexInjectGuidance", true));
        } else if (choice === "autoload") {
            setPreference("aftcCodexAutoLoad", !getPreference("aftcCodexAutoLoad", true));
        } else if (choice === "agents") {
            setPreference("aftcCodexAutoInsertAgentsEnabled", !getPreference("aftcCodexAutoInsertAgentsEnabled", false));
        } else if (choice === "resources") {
            await openResourcesMenu(ctx, cctx);
        }
        // loop re-renders screen 1 so state hints update
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createCodexCommands(ctx: CodexContext, inject: CodexInjectApi, learn: CodexLearnApi): void {
    const { pi, store, state } = ctx;

    // ---- /aftc-codex (config menu, alias /codex) ----
    const menuHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (!isTui(cctx)) {
            console.log("[aftc-toolset] codex: the config menu needs the TUI; use the /aftc-codex-* commands here (try /aftc-codex-status).");
            return;
        }
        await openMainMenu(ctx, cctx, inject);
    };
    registerHelpEntry({ command: "aftc-codex", description: "Open the aftc-codex config menu", category: "aftc-codex", aliases: ["codex"] });
    pi.registerCommand("aftc-codex", { description: "Open the aftc-codex config menu", handler: menuHandler });
    pi.registerCommand("codex", { description: "Open the aftc-codex config menu (alias)", handler: menuHandler });

    // ---- /aftc-codex-enable (alias /codex-enable) ----
    const enableHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (getPreference("aftcCodexEnabled", false)) {
            notify(cctx, "AFTC Codex is already enabled. Run /codex-init to prep the AI.", "info");
            return;
        }
        ensureSeeded(ctx);
        setPreference("aftcCodexEnabled", true);
        notify(cctx, "AFTC Codex enabled. Run /codex-init to prep the AI for this session.", "info");
    };
    registerHelpEntry({ command: "aftc-codex-enable", description: "Enable the knowledge base", category: "aftc-codex", aliases: ["codex-enable"] });
    pi.registerCommand("aftc-codex-enable", { description: "Enable the aftc-codex knowledge base", handler: enableHandler });
    pi.registerCommand("codex-enable", { description: "Enable the aftc-codex knowledge base (alias)", handler: enableHandler });

    // ---- /aftc-codex-disable (alias /codex-disable) ----
    const disableHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (!getPreference("aftcCodexEnabled", false) && !state.rulesOnly && !state.prepped) {
            notify(cctx, "AFTC Codex is already disabled.", "info");
            return;
        }
        setPreference("aftcCodexEnabled", false);
        state.prepped = false;
        state.rulesOnly = false; // off means off — clear a rules-only session too
        state.silent = true; // context filter strips ALL codex on next LLM call
        inject.persistState();
        notify(cctx, "AFTC Codex disabled and stripped from context/conversation. Run /codex-enable to turn it back on.", "warning");
    };
    registerHelpEntry({ command: "aftc-codex-disable", description: "Disable + strip from context", category: "aftc-codex", aliases: ["codex-disable"] });
    pi.registerCommand("aftc-codex-disable", { description: "Disable aftc-codex and strip from context", handler: disableHandler });
    pi.registerCommand("codex-disable", { description: "Disable aftc-codex and strip from context (alias)", handler: disableHandler });

    // ---- /aftc-codex-init (alias /codex-init) — primary prep command ----
    const initHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (state.rulesOnly) {
            notify(cctx, "AFTC Codex has been injected in RULES mode only, you will have to start a new session to use the full AFTC Codex via /codex-init", "warning");
            return;
        }
        // Refuse if not enabled.
        if (!getPreference("aftcCodexEnabled", false)) {
            notify(cctx, "AFTC-Codex is not running. Turn it on via /aftc-codex-enable or /codex-enable.", "warning");
            return;
        }
        // Already active in context? Warn and do nothing.
        if (state.prepped && !state.silent) {
            notify(cctx,
                "aftc-codex already initialised in this session. " +
                "Use /aftc-codex-refresh for a clean restart.",
                "warning");
            return;
        }
        ensureSeeded(ctx);
        state.prepped = true;
        state.silent = false;
        inject.persistState();
        const busy = isCommandBusy(cctx);
        const det = detectedTopics(ctx, cctx);
        inject.injectMarker(busy, true, det?.topics, det?.missing);
        notify(cctx,
            busy ? "aftc-codex initialised — marker queued (agent is busy)."
                : "aftc-codex initialised — rules + guidance loaded; the AI will fetch relevant docs.",
            "info");
        notifyStackBlockUntouched(ctx, cctx);
    };
    registerHelpEntry({ command: "aftc-codex-init", description: "Initialise: load rules + fetch relevant docs", category: "aftc-codex", aliases: ["codex-init"] });
    pi.registerCommand("aftc-codex-init", { description: "Initialise codex: load rules + fetch relevant docs for this project", handler: initHandler });
    pi.registerCommand("codex-init", { description: "Initialise codex (alias)", handler: initHandler });

    // ---- /aftc-codex-refresh (alias /codex-refresh) ----
    const refreshHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (state.rulesOnly) {
            notify(cctx, "AFTC Codex has been injected in RULES mode only, you will have to start a new session to use the full AFTC Codex via /codex-init", "warning");
            return;
        }
        if (!getPreference("aftcCodexEnabled", false)) {
            notify(cctx, "AFTC-Codex is not running. Turn it on via /codex-enable.", "warning");
            return;
        }
        state.silent = true;
        inject.persistState();
        ensureSeeded(ctx);
        state.prepped = true;
        state.silent = false;
        inject.persistState();
        const busy = isCommandBusy(cctx);
        const det = detectedTopics(ctx, cctx);
        inject.injectMarker(busy, true, det?.topics, det?.missing);
        notify(cctx, "aftc-codex refreshed — old codex stripped; fresh rules + marker injected.", "info");
        notifyStackBlockUntouched(ctx, cctx);
    };
    registerHelpEntry({ command: "aftc-codex-refresh", description: "Strip all codex, then re-init", category: "aftc-codex", aliases: ["codex-refresh"] });
    pi.registerCommand("aftc-codex-refresh", { description: "Strip all codex, then re-init (clean restart)", handler: refreshHandler });
    pi.registerCommand("codex-refresh", { description: "Strip all codex, then re-init (alias)", handler: refreshHandler });

    // ---- /aftc-codex-learn (alias /codex-learn) ----
    // NOT refused in rules-only mode: learning only injects a self-contained
    // instruction and the entry tools enforce their own guards (compat,
    // read-before-write, duplicates) - it needs no system-prompt codex context.
    const learnHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (!getPreference("aftcCodexEnabled", false)) {
            notify(cctx, "aftc-codex is OFF. Enable it with /codex-enable first.", "warning");
            return;
        }
        await store.runSyncScript();
        learn.injectLearnPrompt(isCommandBusy(cctx));
        notify(cctx, "aftc-codex-learn: instructions sent.", "info");
    };
    registerHelpEntry({ command: "aftc-codex-learn", description: "Record durable lessons into the codex", category: "aftc-codex", aliases: ["codex-learn"] });
    pi.registerCommand("aftc-codex-learn", { description: "Record durable lessons into the codex", handler: learnHandler });
    pi.registerCommand("codex-learn", { description: "Record durable lessons into the codex (alias)", handler: learnHandler });

    // ---- /aftc-codex-status (alias /codex-status) ----
    const statusHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        const enabled = getPreference("aftcCodexEnabled", false);
        const embedded = enabled && state.prepped && !state.silent;
        const total = store.getCategoryCount();
        const read = countReadTopicDocs(cctx);
        const yn = (b: boolean) => (b ? "Yes" : "No");
        const version = store.isSeeded() ? "installed" : "not installed - /codex-install";
        if (!isTui(cctx)) {
            console.log(`[aftc-toolset] AFTC Codex Enabled: ${yn(enabled)}`);
            console.log(`[aftc-toolset] Embedded in context/conversation window: ${yn(embedded)}`);
            console.log(`[aftc-toolset] No' of codex files read: ${read}/${total}`);
            console.log(`[aftc-toolset] Codex version: ${version}`);
            return;
        }
        pi.appendEntry(CODEX_STATUS_ENTRY, { enabled, embedded, read, total, version });
    };
    registerHelpEntry({ command: "aftc-codex-status", description: "Show aftc-codex status", category: "aftc-codex", aliases: ["codex-status"] });
    pi.registerCommand("aftc-codex-status", { description: "Show aftc-codex status", handler: statusHandler });
    pi.registerCommand("codex-status", { description: "Show aftc-codex status (alias)", handler: statusHandler });

    // ---- /aftc-codex-install (alias /codex-install) ----
    const installHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        const alreadyInstalled = store.isSeeded();
        if (alreadyInstalled) {
            if (isTui(cctx)) {
                const ok = await showConfirm(cctx, {
                    title: "Re-install AFTC Codex?",
                    body: "AFTC Codex is already installed. Re-installing will DELETE your current codex data (including any resources you created) and install a fresh copy. Continue?",
                });
                if (!ok) return;
            } else {
                notify(cctx, "AFTC Codex is already installed. Use the TUI to confirm a re-install.", "warning");
                return;
            }
            try {
                fs.rmSync(store.getRoot(), { recursive: true, force: true });
            } catch (err) {
                notify(cctx, `Failed to remove existing codex: ${(err as Error).message}`, "error");
                return;
            }
        }
        const result = store.seed();
        notify(cctx, `aftc-codex installed (${result.copied} files copied). Run /codex-enable to enable.`, "info");
    };
    registerHelpEntry({ command: "aftc-codex-install", description: "Fresh install the codex to the data dir", category: "aftc-codex", aliases: ["codex-install"] });
    pi.registerCommand("aftc-codex-install", { description: "Fresh install the codex to the data dir", handler: installHandler });

    pi.registerCommand("codex-install", { description: "Fresh install the codex (alias)", handler: installHandler });

    // ---- /codex-inject-rules ----
    // Per-session rules-only mode: inject ONLY the Critical Global Rules
    // section — no docs, list, guidance, marker or learn. Works even with the
    // feature disabled (never touches the enabled pref). One-way: a fresh
    // session (/new) clears it; init/refresh refuse while it is active
    // (learn still works - it only injects an instruction).
    const rulesOnlyHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (state.rulesOnly) {
            notify(cctx, "AFTC Codex rules-only mode is already active for this session.", "info");
            return;
        }
        state.rulesOnly = true;
        inject.persistState();
        notify(cctx,
            "AFTC Codex RULES-ONLY mode active for this session — only the Critical Global Rules inject " +
            "(no docs, list, guidance or /codex-learn). Start a new session, then /codex-init, for the full codex.",
            "info");
    };
    registerHelpEntry({ command: "codex-inject-rules", description: "Rules-only injection for this session (critical rules only)", category: "aftc-codex" });
    pi.registerCommand("codex-inject-rules", { description: "Rules-only codex injection for this session (critical rules only)", handler: rulesOnlyHandler });

    // ---- /aftc-codex-list (alias /codex-list) - list every resource ----
    // A scrollable FULL-SCREEN modal (first item highlighted; ↑/↓ to move,
    // Esc/Enter close) so the list stays browsable even at 60+ resources.
    // The documentation-and-planning guide is PINNED at the top (manual
    // insertion - it would otherwise sort into the middle); the rest keep
    // their alphabetical category/name structure. Headless prints the same
    // list to the console instead. Read-only; no gates.
    const listHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        const topics = store.listTopicPaths();
        if (topics.length === 0) {
            notify(cctx, "No codex resources installed yet - run /codex-enable (or /codex-install) to seed them.", "warning");
            return;
        }
        // Manual insertion: the documentation-and-planning topic rides the
        // top of the list (it is the planning/documentation topic users reach
        // for first); everything else keeps its alphabetical structure.
        const pinned = "documentation-and-planning";
        const ordered = [pinned, ...topics.filter((t) => t !== pinned)];
        if (!isTui(cctx)) {
            aftcConsole.print(`AFTC Codex resources available (${topics.length}):\n${ordered.map((t) => `  ${t}`).join("\n")}`);
            return;
        }
        await showMenu(cctx, {
            title: "AFTC Codex resources",
            body: [`${topics.length} available - up/down to move, Esc to close.`],
            filterable: true,
            items: ordered.map((t) => ({ value: t, label: t })),
        });
    };
    registerHelpEntry({ command: "aftc-codex-list", description: "List all available codex resources (alphabetical)", category: "aftc-codex", aliases: ["codex-list"] });
    pi.registerCommand("aftc-codex-list", { description: "List all available codex resources, alphabetically", handler: listHandler });
    pi.registerCommand("codex-list", { description: "List all available codex resources, alphabetically (alias)", handler: listHandler });

    // ---- /aftc-codex-load (alias /codex-load) - pick a resource to load ----
    // A picker menu (same pattern as /qd) with type-to-filter: Enter picks a
    // resource and the menu CLOSES - the marker instruction tells the AI to
    // codex_load that topic now (eager turn when idle). The same action as
    // the user typing "codex load <resource>". It is NOT a prep action, so
    // rules-only and un-prepped sessions are not refused (only the compat
    // guard + a seeded list apply, matching codex_load itself).
    const loadHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        const topics = store.listTopicPaths();
        if (topics.length === 0) {
            notify(cctx, "No codex resources installed yet - run /codex-enable (or /codex-install) to seed them.", "warning");
            return;
        }
        if (!isTui(cctx)) {
            notify(cctx, "The picker needs the TUI - list them with /codex-list and tell the AI which to codex_load here.", "warning");
            return;
        }
        const choice = await showMenu(cctx, {
            title: "Load codex resource",
            body: ["Pick a resource to load (Enter). Esc cancels."],
            filterable: true,
            items: topics.map((t) => ({ value: t, label: t })),
        });
        if (!choice) {
            notify(cctx, "Nothing selected - no codex resources loaded.", "info");
            return;
        }
        inject.injectMarker(isCommandBusy(cctx), true, [choice]);
        notify(cctx, `Loading codex resource into the chat (not the system prompt): ${choice}`, "info");
    };
    registerHelpEntry({ command: "aftc-codex-load", description: "Pick codex resources to load (menu)", category: "aftc-codex", aliases: ["codex-load"] });
    pi.registerCommand("aftc-codex-load", { description: "Pick codex resources to load into the session (menu)", handler: loadHandler });
    pi.registerCommand("codex-load", { description: "Pick codex resources to load into the session (menu, alias)", handler: loadHandler });

}
