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
 *   /aftc-codex-sync     Non-destructive shipped-seed -> live update (alias /codex-sync).
 *   /aftc-codex-list     List every available codex resource, alphabetically (alias /codex-list).
 *   /aftc-codex-load     Pick codex resources to load via a menu (alias /codex-load).
 *   /codex-inject-rules     Rules-only mode for this session (critical rules only).
 *   /codex-live-to-seed   Maintainer-only (dev-gated): port live codex entries
 *                            into the package seed (dry run + confirm; --apply).
 *
 * List-regeneration: Start Fresh (resources menu) and /aftc-codex-learn spawn
 * the list-regeneration script; pure toggles skip the spawn.
 *
 * Menus use ONLY the aftc-ui primitives (showMenu/showConfirm/showInput/showViewer) —
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
import { getPackageRoot } from "../paths";
import { showConfirm, showMenu, showViewer } from "../ui/aftc-ui";
import * as aftcConsole from "../ui/aftc-console";
import { registerHelpEntry } from "../help-registry";
import { readCodexSeedVersion, bumpCodexSeedVersion } from "./codex-compat";
import { runSeedToLiveUpdate } from "./codex-sync";
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

/** Seed on first enable with the pre-trained vs fresh choice (spec E1 / M-C6).
 *  Returns false if the user cancelled (the enabled flag stays as-is). */
async function ensureSeededWithChoice(ctx: CodexContext, cctx: ExtensionCommandContext): Promise<boolean> {
    const { store } = ctx;
    if (store.isSeeded()) return true;
    if (!isTui(cctx)) {
        store.seed("pretrained");
        await store.runEnsureIds();
        await store.runSyncScript();
        return true;
    }
    const seeded = await openSeedChoice(ctx, cctx);
    if (seeded) {
        await store.runEnsureIds();
        await store.runSyncScript();
    }
    return seeded;
}

/** Central version guard for commands (mirrors ctx.checkCompat). Returns true
 *  when the live codex matches the shipped version. When out of date, shows the
 *  guard message (aftc-ui modal in the TUI — Enter/Esc closes — a stdout line
 *  otherwise) and returns false: the caller MUST stop. /codex-sync and
 *  /codex-install are the fixes (unguarded); /codex-disable and /codex-status
 *  stay available. */
async function guardCompat(ctx: CodexContext, cctx: ExtensionCommandContext): Promise<boolean> {
    const compat = ctx.checkCompat();
    if (compat.isSafe) return true;
    if (isTui(cctx)) {
        const live = getPreference("aftcCodexVersion", 0) ?? 0;
        const seed = readCodexSeedVersion(ctx.store.getSeedDir());
        await showViewer(cctx, {
            title: "AFTC Codex — update available",
            lines: [
                `Your AFTC Codex is out of date (live v${live} -> shipped v${seed ?? "?"}).`,
                "",
                "  /codex-sync      Merge the new shipped resources into your codex.",
                "                   Non-destructive — your learned entries are kept.",
                "",
                "  /codex-install   Replace it with a full fresh copy of the shipped codex.",
                "                   Wipes your codex, including learned entries.",
                "",
                "Codex features are paused until you update.",
                "",
                "Press Enter / Esc to close.",
            ],
        });
    } else {
        console.log(`[aftc-toolset] ${compat.message}`);
    }
    return false;
}

/** Screen 1.9 — seed / re-seed choice. Returns true if seeded. */
async function openSeedChoice(ctx: CodexContext, cctx: ExtensionCommandContext): Promise<boolean> {
    const { store } = ctx;
    const choice = await showMenu(cctx, {
        title: "Menu:",
        body: [
            "Choose how to initialise your AFTC Codex knowledge base:",
            "(either way, /codex-sync later merges shipped updates in without wiping your learned entries)",
        ],
        labelWidth: 26,
        items: [
            { value: "pretrained", label: "Pre-trained (Recommended)", description: " rules + all shipped topic docs" },
            { value: "fresh", label: "Fresh Start", description: " rules + guidance only" },
        ],
    });
    if (!choice) return false;
    store.seed(choice === "fresh" ? "fresh" : "pretrained");
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
                body: "Wipe ALL your codex files (rules, guidance and every resource doc, including your learned entries) and restore the full shipped defaults? This cannot be undone.",
            });
            if (ok) {
                // Full wipe of the live codex dir, then a complete fresh seed copy.
                try { fs.rmSync(store.getRoot(), { recursive: true, force: true }); } catch { /* ignore */ }
                store.seed("pretrained");
                await store.runEnsureIds();
                await store.runSyncScript();
                notify(cctx, "Codex wiped and restored to the shipped defaults.", "info");
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
            { value: "autosync", label: "Auto Sync Codex Update on Startup", description: ` | ${yn(getPreference("aftcCodexAutoSync", true))}` },
            { value: "agents", label: "Auto Insert Codex Skills to Load into AGENTS.md", description: ` | ${yn(getPreference("aftcCodexAutoInsertAgentsEnabled", false))}` },
            { value: "cloud", label: "Codex Cloud Resource Contribution", description: ` | ${yn(getPreference("aftcCodexCloudContribution", true))}` },
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
                const seeded = await ensureSeededWithChoice(ctx, cctx);
                if (!seeded) { notify(cctx, "Seed cancelled — AFTC Codex left disabled.", "warning"); continue; }
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
        } else if (choice === "autosync") {
            setPreference("aftcCodexAutoSync", !getPreference("aftcCodexAutoSync", true));
        } else if (choice === "agents") {
            setPreference("aftcCodexAutoInsertAgentsEnabled", !getPreference("aftcCodexAutoInsertAgentsEnabled", false));
        } else if (choice === "resources") {
            await openResourcesMenu(ctx, cctx);
        } else if (choice === "cloud") {
            setPreference("aftcCodexCloudContribution", !getPreference("aftcCodexCloudContribution", true));
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
        if (!(await guardCompat(ctx, cctx))) return;
        await openMainMenu(ctx, cctx, inject);
    };
    registerHelpEntry({ command: "aftc-codex", description: "Open the aftc-codex config menu", category: "aftc-codex", aliases: ["codex"] });
    pi.registerCommand("aftc-codex", { description: "Open the aftc-codex config menu", handler: menuHandler });
    pi.registerCommand("codex", { description: "Open the aftc-codex config menu (alias)", handler: menuHandler });

    // ---- /aftc-codex-enable (alias /codex-enable) ----
    const enableHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (!(await guardCompat(ctx, cctx))) return;
        if (getPreference("aftcCodexEnabled", false)) {
            notify(cctx, "AFTC Codex is already enabled. Run /codex-init to prep the AI.", "info");
            return;
        }
        const seeded = await ensureSeededWithChoice(ctx, cctx);
        if (!seeded) { notify(cctx, "aftc-codex: seed cancelled — not enabled.", "warning"); return; }
        await store.runEnsureIds();
        await store.runSyncScript();
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
        if (!(await guardCompat(ctx, cctx))) return;
        // Already active in context? Warn and do nothing.
        if (state.prepped && !state.silent) {
            notify(cctx,
                "aftc-codex already initialised in this session. " +
                "Use /aftc-codex-refresh for a clean restart.",
                "warning");
            return;
        }
        const seeded = await ensureSeededWithChoice(ctx, cctx);
        if (!seeded) { notify(cctx, "aftc-codex: seed cancelled — not initialised.", "warning"); return; }
        await store.runEnsureIds();
        await store.runSyncScript();
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
        if (!(await guardCompat(ctx, cctx))) return;
        state.silent = true;
        inject.persistState();
        const seeded = await ensureSeededWithChoice(ctx, cctx);
        if (!seeded) { notify(cctx, "aftc-codex: seed cancelled.", "warning"); return; }
        await store.runSyncScript();
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
        if (!(await guardCompat(ctx, cctx))) return;
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
        // Version state: not installed / up to date / update available (with
        // the fix command named, matching every other out-of-date surface).
        const seeded = store.isSeeded();
        const liveVersion = getPreference("aftcCodexVersion", 0) ?? 0;
        const seedVersion = readCodexSeedVersion(store.getSeedDir());
        const version = !seeded
            ? "not installed — /codex-install"
            : seedVersion === null
                ? `v${liveVersion} (shipped version unknown)`
                : ctx.checkCompat().isSafe
                    ? `v${liveVersion} (up to date)`
                    : `v${liveVersion} -> v${seedVersion} available — run /codex-sync`;
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
            // Out of date (live version != shipped version): the guard has
            // been telling the user to run exactly this command, so typing it
            // IS the confirmation — wipe + re-seed without the modal, in TUI
            // and headless alike. Matching versions = a destructive re-install
            // for no reason, so the confirm stays.
            const versionMismatch = !ctx.checkCompat().isSafe;
            if (versionMismatch) {
                notify(cctx, "Your AFTC Codex is out of date — re-installing a fresh copy (no confirmation needed on a version mismatch). Tip: /codex-sync updates WITHOUT wiping your learned entries.", "info");
            } else if (isTui(cctx)) {
                const ok = await showConfirm(cctx, {
                    title: "Re-install AFTC Codex?",
                    body: "AFTC Codex is already installed. Re-installing will DELETE your current codex data and install a fresh copy. Continue?",
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
        const result = store.seed("pretrained");
        await store.runEnsureIds();
        await store.runSyncScript();
        notify(cctx, `aftc-codex installed (${result.copied} files copied). Run /codex-enable to enable.`, "info");
    };
    registerHelpEntry({ command: "aftc-codex-install", description: "Fresh install the codex to the data dir", category: "aftc-codex", aliases: ["codex-install"] });
    pi.registerCommand("aftc-codex-install", { description: "Fresh install the codex to the data dir", handler: installHandler });

    // ---- /aftc-codex-sync (alias /codex-sync) — non-destructive update ----
    // The recommended fix for the version guard's "out of date" state: merges
    // what the shipped seed gained into the live codex (new topics copied,
    // new entries appended, top-level docs updated) WITHOUT wiping anything —
    // learned entries are kept, conflicts keep the live version. Applies
    // directly (nothing here is destructive, so no dry-run/confirm dance).
    const syncHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (!store.isSeeded()) {
            notify(cctx, "No live codex installed yet — run /codex-install first (a fresh install is already the latest).", "warning");
            return;
        }
        if (ctx.checkCompat().isSafe) {
            notify(cctx, "Your AFTC Codex is already up to date — nothing to sync.", "info");
            return;
        }
        const result = await runSeedToLiveUpdate(store);
        if (!result.output.trim()) {
            notify(cctx, "codex sync produced no output (script missing or failed to spawn) — /codex-install remains available.", "error");
            return;
        }
        if (isTui(cctx)) {
            await showViewer(cctx, { title: "seed -> live sync", lines: result.output.trim().split("\n") });
        } else {
            console.log(result.output.trim());
        }
        if (result.updated > 0) {
            notify(cctx, `${result.updated} shipped entr${result.updated === 1 ? "y" : "ies"} updated to the latest wording (your copy had not been edited).`, "info");
        }
        if (result.conflicts) {
            notify(cctx, "Conflicts reported (same [ID], different text) — YOUR live versions were kept; review them by hand.", "warning");
        }
        const enabled = getPreference("aftcCodexEnabled", false);
        if (!enabled) {
            notify(cctx, "CODEX Resources updated. Codex is disabled — run /codex-enable to turn it on, then /codex-init to prep the AI.", "info");
        } else if (state.prepped && !state.silent) {
            notify(cctx, "CODEX Resources updated. Run /codex-refresh to reload the codex in this session.", "info");
        } else {
            notify(cctx, "CODEX Resources updated. You can now use /codex-init to prep the AI.", "info");
        }
    };
    registerHelpEntry({ command: "aftc-codex-sync", description: "Merge new shipped codex resources into your live codex (non-destructive)", category: "aftc-codex", aliases: ["codex-sync"] });
    pi.registerCommand("aftc-codex-sync", { description: "Non-destructive codex update: merge new shipped resources into your live codex (learned entries kept)", handler: syncHandler });
    pi.registerCommand("codex-sync", { description: "Non-destructive codex update (alias)", handler: syncHandler });

    // ---- /codex-live-to-seed [--apply] (dev-gated maintainer sync) ----
    // Ports live-only codex entries into the PACKAGE SEED, so it only makes
    // sense in the maintainer's dev checkout (the seed of an installed copy
    // is wiped on pi update). Gated by the .dev marker folder, same as the
    // retired /qd toolset-dir option.
    const liveToSeedHandler = async (args: string, cctx: ExtensionCommandContext) => {
        const pkgRoot = getPackageRoot();
        if (!fs.existsSync(path.join(pkgRoot, ".dev"))) {
            notify(cctx, "/codex-live-to-seed is a maintainer tool (writes the package seed) and only runs in the dev checkout — .dev marker not found.", "warning");
            return;
        }
        const apply = args.trim().split(/\s+/).includes("--apply");
        const dry = await store.runLiveToSeedSync(false);
        if (!dry.trim()) {
            notify(cctx, "live-to-seed sync produced no output (script missing or failed to spawn).", "error");
            return;
        }
        const nothingPending = /0 new topic file\(s\), 0 entr\(ies\) to merge, 0 entr\(ies\) updated/.test(dry);
        if (nothingPending) {
            notify(cctx, "live codex and package seed are already in sync — nothing to port. (This is the maintainer release tool; to UPDATE your codex after a shipped update, run /codex-sync.)", "info");
            return;
        }
        if (isTui(cctx)) {
            await showViewer(cctx, { title: "live -> seed (dry run)", lines: dry.trim().split("\n") });
        } else {
            console.log(dry.trim());
        }
        const updatedMatches = dry.match(/^UPDATED\s+\S+\s+\[[^\]]+\]/gm) ?? [];
        if (updatedMatches.length > 0) {
            notify(cctx, `${updatedMatches.length} entr${updatedMatches.length === 1 ? "y" : "ies"} differ between live and seed — your LIVE text will win and replace the seed version (auto-resolved; the AI will be asked to review after applying).`, "info");
        }
        if (!apply) {
            if (!isTui(cctx)) {
                notify(cctx, "Dry run only — re-run as /codex-live-to-seed --apply to write.", "info");
                return;
            }
            const ok = await showConfirm(cctx, {
                title: "Apply live -> seed sync?",
                body: "Port the live-only entries shown above into the package seed? (Where the same entry differs, your live text replaces the seed version.)",
            });
            if (!ok) return;
        }
        const applied = await store.runLiveToSeedSync(true);
        // Bump the shipped codexVersion ONLY when the apply actually changed
        // the seed (new topics copied or entries merged) — a no-op sync must
        // not push an out-of-date notice at users for nothing.
        const changed = /APPLIED — wrote [1-9]\d* seed file\(s\)/.test(applied);
        const newVersion = changed ? bumpCodexSeedVersion(store.getSeedDir()) : null;
        if (changed && newVersion !== null) {
            // The dev checkout's live codex IS the source of the sync — stamp
            // it to the new version too, or the maintainer's own guard
            // immediately reports a false "out of date".
            setPreference("aftcCodexVersion", newVersion);
        }
        if (!isTui(cctx)) {
            console.log(applied.trim());
        }
        // Auto-resolved entries: ask the AI to review the merged seed files
        // and correct anything the merge got wrong (same injection pattern as
        // /codex-learn - queued as a follow-up when the agent is busy).
        const appliedUpdates = applied.match(/^UPDATED\s+(\S+)\s+\[([^\]]+)\]/gm) ?? [];
        if (appliedUpdates.length > 0) {
            const list = appliedUpdates.map((l) => l.replace(/^UPDATED\s+/, "")).join(", ");
            const prompt = [
                "The /codex-live-to-seed sync just auto-resolved same-ID differences by porting the LIVE codex text into the package seed (live is the maintainer's learning copy and wins).",
                `Entries replaced in the seed: ${list}.`,
                "Please review the merged result: codex_load each affected topic, read the listed entries in their seed files under extensions/aftc-toolset/data/aftc-codex/resources/, and confirm the auto-merge produced sane, complete entries (no truncation, no duplicated or mangled text, correct section).",
                "If anything is wrong, fix the SEED file entry with codex_edit_entry (or a direct edit of the seed file if the tool cannot target the seed) and say what you corrected. If everything is fine, just say the merge checked out.",
            ].join("\n");
            try {
                if (isCommandBusy(cctx)) {
                    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
                } else {
                    pi.sendUserMessage(prompt);
                }
            } catch (err) {
                aftcConsole.logError(`[aftc-toolset] codex live-to-seed review prompt failed: ${(err as Error).message}`);
            }
        }
        // TUI: done — exit straight after the confirm (no second viewer).
        if (changed) {
            notify(cctx, newVersion !== null
                ? `live -> seed sync applied. Shipped codexVersion bumped to ${newVersion} — users get the out-of-date notice (and /codex-sync) on their next update.`
                : "live -> seed sync applied, but bumping codexVersion FAILED (extension-config.json write) — bump it by hand or users never receive the new content.",
                newVersion !== null ? "info" : "warning");
        } else {
            notify(cctx, "live -> seed sync applied (no seed changes — codexVersion left as-is).", "info");
        }
    };
    registerHelpEntry({ command: "codex-live-to-seed", args: "[--apply]", description: "Maintainer: port live codex entries into the package seed (dev checkout only)", category: "aftc-codex" });
    pi.registerCommand("codex-live-to-seed", { description: "Maintainer: port live codex entries into the package seed (dev checkout only). Dry run first; --apply writes without the confirm.", handler: liveToSeedHandler });
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
        if (!(await guardCompat(ctx, cctx))) return;
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
