/**
 * pi-aftc-toolset / aftc-codex — the /aftc-codex-* commands + config menu.
 *
 * Commands:
 *   /aftc-codex          Open the config menu (AFTC UI) — the main config surface (Phase 7).
 *   /aftc-codex-enable   Enable the knowledge base (alias /codex-enable).
 *   /aftc-codex-disable  Disable + strip all codex from context (alias /codex-disable).
 *   /aftc-codex-install  Fresh install (or re-install) the codex to the user data dir.
 *   /aftc-codex-init     Primary prep: rules live + marker + doc fetch (alias /codex-init).
 *   /aftc-codex-refresh  Prune all codex from context, THEN re-prep (clean restart).
 *   /aftc-codex-refresh  Strip all codex from context, then re-init (clean restart).
 *   /aftc-codex-learn    Self-education prompt injection (Phase 5).
 *   /aftc-codex-status   Quick status viewer.
 *   /aftc-codex-sync     Merge new seed entries into the live codex (alias /codex-sync).
 *   /aftc-codex-status   Quick status viewer.
 *
 * Sync-first wrapper (spec C4 / M-I1): the resources menu and /aftc-codex-learn
 * spawn the list-regeneration script first; pure toggles skip the spawn.
 *
 * Menus use ONLY the aftcUi primitives (showMenu/showConfirm/showInput/showViewer) —
 * never hand-built chrome (AGENTS.md AFTC UI rules). All guard ctx.hasUI / mode==="tui";
 * print mode falls back to printed summaries and never auto-merges destructively (M-I4).
 *
 * See `codex-commands.readme.md` for the full contract.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { getPreference, setPreference } from "../config";
import { showConfirm, showMenu, showViewer } from "../ui/aftcUi";
import type { CodexContext } from "./aftc-codex";
import { isCommandBusy, type CodexInjectApi, CODEX_READ_ENTRY, CODEX_STATUS_ENTRY } from "./codex-inject";
import type { CodexLearnApi } from "./codex-learn";
import { mergeCodexSeedIntoLive } from "./codex-merge";
import { CODEX_CATEGORIES } from "./codex-store";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function notify(ctx: ExtensionCommandContext, msg: string, level: "info" | "warning" | "error" = "info"): void {
    if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(msg, level);
    else console.log(`[aftc-toolset] ${msg}`);
}

function isTui(ctx: ExtensionCommandContext): boolean {
    return !!ctx.hasUI && ctx.mode === "tui";
}

function detectedTopics(ctx: CodexContext, cctx: ExtensionCommandContext): string[] | undefined {
    if (!getPreference("aftcCodexAutoLoad", true)) return undefined;
    if (!ctx.detectTopics || !cctx.cwd) return undefined;
    try {
        const topics = ctx.detectTopics(cctx.cwd);
        return topics.length > 0 ? topics : undefined;
    } catch {
        return undefined;
    }
}

/** Seed on first enable with the pre-trained vs fresh choice (spec E1 / M-C6).
 *  Returns false if the user cancelled (master stays as-is). */
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

/** Screen 1.9 — seed / re-seed choice. Returns true if seeded. */
async function openSeedChoice(ctx: CodexContext, cctx: ExtensionCommandContext): Promise<boolean> {
    const { store } = ctx;
    const choice = await showMenu(cctx, {
        title: "Menu:",
        body: ["Choose how to initialise your AFTC Codex knowledge base:"],
        labelWidth: 26,
        items: [
            { value: "pretrained", label: "Pre-trained (Recommended)", description: " rules + ~27 topic docs" },
            { value: "fresh", label: "Fresh Start", description: " rules + guidance only" },
        ],
    });
    if (!choice) return false;
    store.seed(choice === "fresh" ? "fresh" : "pretrained");
    return true;
}

/**
 * Count distinct codex topic docs read this session by scanning the durable
 * read-tracking entries (CODEX_READ_ENTRY) the codex_load tool appends. Works
 * in fresh, resumed, reloaded and compacted sessions alike (custom entries
 * persist and survive compaction). Counts only category topic docs so it stays
 * coherent with the available total (which excludes top-level guidance + the
 * generated resource list).
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
        if (CODEX_CATEGORIES.some((cat) => rel.startsWith(`${cat}/`))) n++;
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
        console.log(`[aftc-toolset] codex openDir error: ${(err as Error).message}`);
    }
}

/** Screen 1.6 — Resources & updates. */
async function openResourcesMenu(ctx: CodexContext, cctx: ExtensionCommandContext): Promise<void> {
    const { store } = ctx;
    while (true) {
        const choice = await showMenu(cctx, {
            title: "Menu:",
            labelWidth: 24,
            items: [
                { value: "reseed", label: "Re-Seed Resources", description: " copy-only, never overwrites" },
                { value: "fresh", label: "Start Fresh", description: " Clear and restore default codex resources" },
                { value: "opendir", label: "Open Codex Resource Dir" },
            ],
        });
        if (!choice) return;
        if (choice === "reseed") {
            const seeded = await openSeedChoice(ctx, cctx);
            if (seeded) { await store.runSyncScript(); notify(cctx, "Re-seeded (copy-only).", "info"); }
            return;
        }
        if (choice === "fresh") {
            const ok = await showConfirm(cctx, {
                title: "Start fresh?",
                body: "Wipe your current codex resources and restore the shipped defaults? This cannot be undone.",
            });
            if (ok) {
                // Wipe resources + top-level guidance, then seed fresh.
                try { fs.rmSync(store.getResourcesDir(), { recursive: true, force: true }); } catch { /* ignore */ }
                // Remove top-level guidance files so they get re-seeded clean.
                for (const name of ["codex-rules.md", "thought-and-action-guidance.md", "markdown-guidance.md"]) {
                    try { fs.rmSync(path.join(store.getRoot(), name), { force: true }); } catch { /* ignore */ }
                }
                setPreference("aftcCodexSeeded", false);
                store.seed("fresh");
                await store.runSyncScript();
                notify(cctx, "Codex resources cleared and restored to defaults.", "info");
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

const HELP_LINES = [
    "aftc-codex — an opt-in knowledge base for pi.",
    "",
    "Commands:",
    "  /aftc-codex              Open this config menu",
    "  /aftc-codex-enable       Enable the knowledge base (alias /codex-enable)",
    "  /aftc-codex-disable      Disable + strip from context (alias /codex-disable)",
    "  /aftc-codex-init         Initialise: load rules + fetch relevant docs (alias /codex-init)",
    "  /aftc-codex-refresh      Strip all codex, then re-init (clean restart)",
    "  /aftc-codex-install      Fresh install (or re-install) the codex to the data dir",
    "  /aftc-codex-learn        Record durable lessons into the codex",
    "  /aftc-codex-sync         Merge new seed entries into your codex (alias /codex-sync)",
    "  /aftc-codex-status       Show status",
    "  /aftc-codex-status       Show status",
    "",
    "Model tool:",
    "  codex_load(topic)        Load a resource on demand (eg codex_load(\"typescript\"))",
    "",
    "Record durable lessons with /aftc-codex-learn (auto, or via the menu).",
];

/** Screen 1 — main menu (inline toggles re-render). */
async function openMainMenu(ctx: CodexContext, cctx: ExtensionCommandContext, inject: CodexInjectApi): Promise<void> {
    const { store, state } = ctx;
    let selectedIndex = 0;
    while (true) {
        const enabled = getPreference("aftcCodexEnabled", false);
        const counts = store.getCounts();
        const body = enabled
            ? [`AFTC Codex is active — ${counts.total} resources loaded`]
            : ["AFTC Codex is disabled — enable to activate"];
        const items = [
            { value: "master", label: "AFTC Codex Enabled", description: enabled ? " | Yes" : " | No" },
            { value: "guidance", label: "Thinking Guidance Injection", description: ` | ${getPreference("aftcCodexInjectGuidance", true) ? "ON" : "OFF"}` },
            { value: "autoload", label: "Auto-Detect & Load Docs", description: ` | ${getPreference("aftcCodexAutoLoad", true) ? "ON" : "OFF"}` },
            { value: "autoadd", label: "Task Addition Approval", description: ` | ${getPreference("aftcCodexAutoAddEntries", true) ? "Auto add" : "Manual"}` },
            { value: "resources", label: "Resources & Updates" },
            { value: "help", label: "Help & Commands" },
        ];
        const choice = await showMenu(cctx, {
            title: "Menu:",
            body,
            labelWidth: 28,
            initialIndex: selectedIndex,
            items,
        });
        if (!choice) return; // Esc closes the menu
        selectedIndex = Math.max(0, items.findIndex((i) => i.value === choice));

        if (choice === "master") {
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
        } else if (choice === "autoadd") {
            const autoAdd = await showMenu(cctx, {
                title: "Menu:",
                body: ["Would you like to approve task additions to aftc-codex resources or have them automatically added?"],
                labelWidth: 23,
                items: [
                    { value: "auto", label: "Auto add (Recommended)", description: " write directly with uniqueness checks" },
                    { value: "manual", label: "Manual", description: " propose entries, wait for confirmation" },
                ],
            });
            if (autoAdd === "auto") setPreference("aftcCodexAutoAddEntries", true);
            else if (autoAdd === "manual") setPreference("aftcCodexAutoAddEntries", false);
        } else if (choice === "resources") {
            await openResourcesMenu(ctx, cctx);
        } else if (choice === "help") {
            await showViewer(cctx, { title: "aftc-codex help", lines: HELP_LINES });
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
    pi.registerCommand("aftc-codex", { description: "Open the aftc-codex config menu", handler: menuHandler });
    pi.registerCommand("codex", { description: "Open the aftc-codex config menu (alias)", handler: menuHandler });

    // ---- /aftc-codex-enable (alias /codex-enable) ----
    const enableHandler = async (_args: string, cctx: ExtensionCommandContext) => {
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
    pi.registerCommand("aftc-codex-enable", { description: "Enable the aftc-codex knowledge base", handler: enableHandler });
    pi.registerCommand("codex-enable", { description: "Enable the aftc-codex knowledge base (alias)", handler: enableHandler });

    // ---- /aftc-codex-disable (alias /codex-disable) ----
    const disableHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        setPreference("aftcCodexEnabled", false);
        state.prepped = false;
        state.silent = true; // context filter strips ALL codex on next LLM call
        inject.persistState();
        notify(cctx, "AFTC Codex disabled and stripped from context/conversation.", "warning");
    };
    pi.registerCommand("aftc-codex-disable", { description: "Disable aftc-codex and strip from context", handler: disableHandler });
    pi.registerCommand("codex-disable", { description: "Disable aftc-codex and strip from context (alias)", handler: disableHandler });

    // ---- /aftc-codex-init (alias /codex-init) — primary prep command ----
    const initHandler = async (_args: string, cctx: ExtensionCommandContext) => {
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
        const seeded = await ensureSeededWithChoice(ctx, cctx);
        if (!seeded) { notify(cctx, "aftc-codex: seed cancelled — not initialised.", "warning"); return; }
        await store.runEnsureIds();
        await store.runSyncScript();
        state.prepped = true;
        state.silent = false;
        inject.persistState();
        const busy = isCommandBusy(cctx);
        inject.injectMarker(busy, true, detectedTopics(ctx, cctx));
        notify(cctx,
            busy ? "aftc-codex initialised — marker queued (agent is busy)."
                : "aftc-codex initialised — rules + guidance loaded; the AI will fetch relevant docs.",
            "info");
    };
    pi.registerCommand("aftc-codex-init", { description: "Initialise codex: load rules + fetch relevant docs for this project", handler: initHandler });
    pi.registerCommand("codex-init", { description: "Initialise codex (alias)", handler: initHandler });

    // ---- /aftc-codex-refresh (alias /codex-refresh) ----
    const refreshHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (!getPreference("aftcCodexEnabled", false)) {
            notify(cctx, "AFTC-Codex is not running. Turn it on via /codex-enable.", "warning");
            return;
        }
        state.silent = true;
        inject.persistState();
        const seeded = await ensureSeededWithChoice(ctx, cctx);
        if (!seeded) { notify(cctx, "aftc-codex: seed cancelled.", "warning"); return; }
        await store.runSyncScript();
        state.prepped = true;
        state.silent = false;
        inject.persistState();
        const busy = isCommandBusy(cctx);
        inject.injectMarker(busy, true, detectedTopics(ctx, cctx));
        notify(cctx, "aftc-codex refreshed — old codex stripped; fresh rules + marker injected.", "info");
    };
    pi.registerCommand("aftc-codex-refresh", { description: "Strip all codex, then re-init (clean restart)", handler: refreshHandler });
    pi.registerCommand("codex-refresh", { description: "Strip all codex, then re-init (alias)", handler: refreshHandler });

    // ---- /aftc-codex-learn (alias /codex-learn) ----
    const learnHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        if (!getPreference("aftcCodexEnabled", false)) {
            notify(cctx, "aftc-codex is OFF. Enable it with /codex-enable first.", "warning");
            return;
        }
        await store.runSyncScript();
        learn.injectLearnPrompt(isCommandBusy(cctx));
        notify(cctx, "aftc-codex-learn: instructions sent.", "info");
    };
    pi.registerCommand("aftc-codex-learn", { description: "Record durable lessons into the codex", handler: learnHandler });
    pi.registerCommand("codex-learn", { description: "Record durable lessons into the codex (alias)", handler: learnHandler });

    // ---- /aftc-codex-status (alias /codex-status) ----
    const statusHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        const enabled = getPreference("aftcCodexEnabled", false);
        const embedded = enabled && state.prepped && !state.silent;
        const counts = store.getCounts();
        const total = counts.languages + counts.libraries + counts.frameworks +
            counts.engines + counts.tools;
        const read = countReadTopicDocs(cctx);
        const yn = (b: boolean) => (b ? "Yes" : "No");
        if (!isTui(cctx)) {
            console.log(`[aftc-toolset] AFTC Codex Enabled: ${yn(enabled)}`);
            console.log(`[aftc-toolset] Embedded in context/conversation window: ${yn(embedded)}`);
            console.log(`[aftc-toolset] No' of codex files read: ${read}/${total}`);
            return;
        }
        pi.appendEntry(CODEX_STATUS_ENTRY, { enabled, embedded, read, total });
    };
    pi.registerCommand("aftc-codex-status", { description: "Show aftc-codex status", handler: statusHandler });
    pi.registerCommand("codex-status", { description: "Show aftc-codex status (alias)", handler: statusHandler });

    // ---- /aftc-codex-install (alias /codex-install) ----
    const installHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        const alreadyInstalled = store.isSeeded();
        if (alreadyInstalled) {
            if (isTui(cctx)) {
                const ok = await showConfirm(cctx, {
                    title: "Re-install aftc-codex?",
                    body: "aftc-codex is already installed. Re-installing will DELETE your current codex data and copy a fresh set from the package. Continue?",
                });
                if (!ok) return;
            } else {
                notify(cctx, "aftc-codex is already installed. Use the TUI to confirm a re-install.", "warning");
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
    pi.registerCommand("aftc-codex-install", { description: "Fresh install the codex to the data dir", handler: installHandler });
    pi.registerCommand("codex-install", { description: "Fresh install the codex (alias)", handler: installHandler });

    // ---- /aftc-codex-sync (alias /codex-sync) — seed -> live merge ----
    const syncHandler = async (_args: string, cctx: ExtensionCommandContext) => {
        const report = mergeCodexSeedIntoLive(store.getSeedDir(), store.getRoot());
        // Always regenerate the resource list, even when nothing changed.
        await store.runSyncScript();

        const totalMerged = report.merged.reduce((n, m) => n + m.ids.length, 0);
        const lines: string[] = [];
        if (report.createdLiveDir) lines.push("Codex dir was missing — full seed copied over.");
        if (report.createdResourcesDir) lines.push("resources/ was missing — full seed resources copied over.");
        if (report.copiedFiles.length > 0) {
            lines.push(`Files copied (${report.copiedFiles.length}):`);
            for (const f of report.copiedFiles) lines.push(`  ${f}`);
        }
        if (report.merged.length > 0) {
            lines.push(`Entries merged (${totalMerged}):`);
            for (const m of report.merged) lines.push(`  ${m.file}: +${m.ids.length} (${m.ids.join(", ")})`);
        }
        if (report.errors.length > 0) {
            lines.push("Errors:");
            for (const e of report.errors) lines.push(`  ${e}`);
        }
        if (lines.length === 0) lines.push("Already up to date — no files copied, no entries merged.");
        lines.push("Resource list regenerated.");

        const summary = report.createdLiveDir
            ? `aftc-codex sync: full seed installed (${report.copiedFiles.length} files).`
            : `aftc-codex sync: ${report.copiedFiles.length} files copied, ${totalMerged} entries merged.`;

        if (isTui(cctx)) {
            notify(cctx, summary, report.errors.length > 0 ? "warning" : "info");
            await showViewer(cctx, { title: "aftc-codex sync", lines });
        } else {
            for (const line of lines) console.log(`[aftc-toolset] ${line}`);
        }
    };
    pi.registerCommand("aftc-codex-sync", { description: "Merge new seed entries into the live codex", handler: syncHandler });
    pi.registerCommand("codex-sync", { description: "Merge new seed entries into the live codex (alias)", handler: syncHandler });

    pi.registerCommand("codex-install", { description: "Fresh install the codex (alias)", handler: installHandler });

}
