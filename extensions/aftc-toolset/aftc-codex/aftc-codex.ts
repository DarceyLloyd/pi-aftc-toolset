/**
 * pi-aftc-toolset / aftc-codex — feature coordinator.
 *
 * An opt-in knowledge-base feature: injects the maintainer's unified codex rules +
 * thinking guidance + a generated resource list into the model's system prompt, and
 * gives the model a `codex_load` tool to fetch topic docs on demand. Off by default.
 *
 * Coordinator pattern (AGENTS.md): this file owns the shared closure state and wires
 * the sub-modules; sub-modules import shared types FROM this file (type-only) and
 * never import each other. Wired into the extension by ONE `createAftcCodex(pi)`
 * line in `extensions/aftc-toolset/index.ts`.
 *
 * Sub-modules:
 *   - codex-store.ts    — data-dir layout, seeding, resource reads, .sync.json, sync spawn
 *   - codex-compat.ts   — the central seed/live version guard (+ version bump helper)
 *   - codex-sync.ts     — the shared seed->live update core (manual /codex-sync + startup auto-sync)
 *   - codex-inject.ts   — before_agent_start injection + session lifecycle + marker
 *   - codex-commands.ts — the /aftc-codex-* commands (sync-first wrapper)
 *   - codex-detect.ts   — project technology auto-detection        (Phase 4)
 *   - codex-learn.ts    — /aftc-codex-learn                         (Phase 5)
 *   - codex-entries.ts  — codex_add_entry / codex_edit_entry / codex_remove_entry tools
 *   - codex-intent.ts   — planning/documentation intent suggestion (D14)
 *   - codex-migrate.ts  — legacy -> v1 structural resource migration (D18)
 *
 * This file also registers the `codex_load` model tool (step 2.4), owns the
 * shared read-tracker (durable read-entry dedup + the session-scoped set the
 * entry tools' read-before-write guard enforces), and runs the auto-sync
 * (aftcCodexAutoSync, default ON: once per extension load on the first
 * session_start of any reason, seeded + out of date -> runSeedToLiveUpdate in
 * the background).
 *
 * Production-safety (spec Part G): off by default; fail-soft everywhere; never
 * destroys user data; seeding is copy-only. See `aftc-codex-readme.md`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    truncateTail,
} from "@earendil-works/pi-coding-agent";
import { createCodexStore, type CodexStore, type CodexResourceRead } from "./codex-store";
import { createCodexInject, type CodexInjectApi, CODEX_READ_ENTRY } from "./codex-inject";
import { createCodexDetect } from "./codex-detect";
import { createCodexLearn, type CodexLearnApi } from "./codex-learn";
import { createCodexEntries, type CodexReadTracker } from "./codex-entries";
import { createCodexIntent } from "./codex-intent";
import { createCodexCommands } from "./codex-commands";
import { checkCodexCompatibility, type CodexCompatResult } from "./codex-compat";
import { runSeedToLiveUpdate } from "./codex-sync";
import { runCodexResourceMigration } from "./codex-migrate";
import { getPreference } from "../config";
import * as aftcConsole from "../ui/aftc-console";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types (sub-modules import these type-only from "./aftc-codex")
// ─────────────────────────────────────────────────────────────────────────────

/** Mutable per-session state owned by the coordinator closure. */
export interface CodexState {
    /** The AI has been prepped this session (rules inject when enabled). */
    prepped: boolean;
    /** Per-session suppression set by /codex-disable (cleared by -run). */
    silent: boolean;
    /** Per-session rules-only mode set by /codex-inject-rules: inject ONLY the
     *  Critical Global Rules section; init/refresh/learn refuse; a fresh
     *  session (/new) clears it. Works even when the feature is disabled. */
    rulesOnly: boolean;
    /** Guard so the fresh-session notice is appended once per session. */
    noticedThisSession: boolean;
}

/** Detection result: topics with a live resource (loadable) and mapped topics
 *  with no resource file yet (bootstrap-able via codex_add_entry). Defined here
 *  so codex-detect/inject/commands share it type-only via the coordinator. */
export interface CodexDetectResult {
    topics: string[];
    missing: string[];
}

/** Shared context handed to each sub-module factory. */
export interface CodexContext {
    pi: ExtensionAPI;
    store: CodexStore;
    state: CodexState;
    /** Detect codex topics relevant to a cwd (Phase 4). Set after detect is built. */
    detect?(cwd: string): CodexDetectResult;
    /** CENTRAL version-compatibility guard. Every codex feature calls this before
     *  touching the live codex: isSafe=false means the live copy is out of
     *  date — hold off, show `message`, and let /codex-sync merge (or
     *  /codex-install wipe + re-seed).
     *  Set by the coordinator. */
    checkCompat(): CodexCompatResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// codex_load tool (step 2.4)
// ─────────────────────────────────────────────────────────────────────────────

function registerCodexLoadTool(pi: ExtensionAPI, store: CodexStore, readTracker: CodexReadTracker, checkCompat: () => CodexCompatResult): void {
    /** Track a successful read (session set for the entry tools' guard +
     *  durable entry for /aftc-codex-status). */
    function trackRead(relPath: string): void {
        readTracker.sessionReads.add(relPath);
        if (!readTracker.durableSeen.has(relPath)) {
            readTracker.durableSeen.add(relPath);
            try { pi.appendEntry(CODEX_READ_ENTRY, { relPath }); } catch { /* fail-soft */ }
        }
    }

    /**
     * D10 cascade: loading a topic whose TOP-LEVEL category has a
     * `<category>-common.md` loads that common too, once per session. Scoped
     * by the top-level path segment (ui-ux/web/web-app.md cascades
     * ui-ux/ui-ux-common.md); root-level topics and the common itself never
     * cascade.
     */
    function cascadeCommon(read: CodexResourceRead): { text?: string; relPath?: string; absPath?: string } | null {
        const rel = read.relPath;
        if (!rel.includes("/")) return null; // root-level topic: no category common
        const topSeg = rel.split("/")[0]!;
        const commonRel = `${topSeg}/${topSeg}-common.md`;
        if (rel === commonRel) return null; // the common itself
        if (readTracker.sessionReads.has(commonRel)) return null; // already loaded this session
        const common = store.readResource(`${topSeg}/${topSeg}-common`);
        if (!common) return null; // the category has no common
        trackRead(common.relPath);
        return { text: common.content, relPath: common.relPath, absPath: common.absPath };
    }

    pi.registerTool({
        name: "codex_load",
        label: "Codex Load",
        description:
            "Load an aftc-codex knowledge-base resource by topic name. Searches across " +
            "all category folders (flat and nested) and the top-level guidance files, so a " +
            "file's folder does not matter. Accepts aliases (ts, py, js) and the special " +
            "topics 'rules', 'guidance', 'list', 'markdown'. Loading a topic also loads its " +
            "category's <category>-common.md once per session (when the category has one). " +
            "Use this to fetch the conventions/gotchas for a " +
            "technology before you rely on them.",
        promptSnippet: "Load an aftc-codex knowledge-base resource (topic doc) by name on demand",
        promptGuidelines: [
            "Use codex_load to fetch the conventions and gotchas for a language, library, framework, engine, or tool before relying on them (eg codex_load(\"typescript\")).",
            "Use codex_load(\"list\") to see every available aftc-codex resource, and codex_load(\"guidance\") for the thinking-and-action guidance.",
        ],
        parameters: Type.Object({
            topic: Type.String({
                description:
                    "Resource topic name (eg \"typescript\", \"docker\", \"threejs\"). " +
                    "Aliases: ts, py, js. Specials: rules, guidance, list, markdown.",
            }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ectx) {
            // Version guard FIRST (D24): an out-of-date live codex is updated by
            // /codex-sync (or wiped + re-seeded by /codex-install); until then
            // serve the guard message instead of stale docs (a normal result,
            // not a tool error, so the model can relay the instruction to the
            // user).
            const compat = checkCompat();
            if (!compat.isSafe) {
                return {
                    content: [{ type: "text", text: `${compat.message}\n\nTell the user to run /codex-sync (keeps their learned entries) or /codex-install (fresh copy), then try codex_load again.` }],
                    details: { compatBlocked: true },
                };
            }

            const read = store.readResource(params.topic);
            if (!read) {
                const topics = store.listTopics();
                const listStr = topics.length > 0 ? topics.join(", ") : "(no resources seeded yet)";
                throw new Error(
                    `Unknown codex topic "${params.topic}". Available topics: ${listStr}`,
                );
            }

            // Session-scoped read set: the codex entry tools (codex-entries.ts)
            // require a codex_load of the topic THIS session before any write.
            // The durable entry lets /aftc-codex-status count files read.
            trackRead(read.relPath);

            // D10 cascade: the category's <category>-common.md rides along once
            // per session.
            const cascade = cascadeCommon(read);
            let cascadeText = "";
            if (cascade?.text !== undefined) {
                const cTrunc = truncateTail(cascade.text, {
                    maxLines: DEFAULT_MAX_LINES,
                    maxBytes: DEFAULT_MAX_BYTES,
                });
                cascadeText =
                    `\n\n# codex resource (auto-loaded category common): ${cascade.relPath}\n# file: ${cascade.absPath}\n\n${cTrunc.content}` +
                    (cTrunc.truncated ? `\n\n[Truncated. Full file: ${cascade.absPath}]` : "");
            }

            // Empty skeleton (headings but no entry bullets): a fixed one-liner
            // instead of the file content — no point spending context on an
            // empty doc. The read above still counts for the entry tools'
            // read-before-write guard (adding the FIRST entry needs it).
            if (!/^- \S/m.test(read.content)) {
                return {
                    content: [{ type: "text", text: `codex resource "${read.relPath}" exists but has no entries yet.${cascadeText}` }],
                    details: { relPath: read.relPath, absPath: read.absPath, empty: true, cascaded: cascade?.relPath },
                };
            }

            const truncation = truncateTail(read.content, {
                maxLines: DEFAULT_MAX_LINES,
                maxBytes: DEFAULT_MAX_BYTES,
            });

            let text = `# codex resource: ${read.relPath}\n# file: ${read.absPath}\n\n${truncation.content}`;
            if (truncation.truncated) {
                text +=
                    `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines` +
                    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
                    ` Full file: ${read.absPath}]`;
            }
            text += cascadeText;

            return {
                content: [{ type: "text", text }],
                details: { relPath: read.relPath, absPath: read.absPath, truncated: truncation.truncated, cascaded: cascade?.relPath },
            };
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator
// ─────────────────────────────────────────────────────────────────────────────

export function createAftcCodex(pi: ExtensionAPI): void {
    const store = createCodexStore();
    const state: CodexState = { prepped: false, silent: false, rulesOnly: false, noticedThisSession: false };
    // Central version-compatibility guard (checkCompat): compares the shipped
    // seed version (data/extension-config.json) against the user's recorded live
    // version. Every codex feature calls it before touching the live codex.
    const ctx: CodexContext = {
        pi,
        store,
        state,
        checkCompat: () =>
            checkCodexCompatibility(store.getSeedDir(), getPreference("aftcCodexVersion", 0) ?? 0, store.isSeeded()),
    };

    // Project technology auto-detection (Phase 4). Wired onto ctx so inject/commands
    // can name detected topics without importing codex-detect directly.
    const detect = createCodexDetect(ctx);
    ctx.detect = (cwd: string) => detect.detect(cwd);

    // Injection + session lifecycle (+ marker). Registers the entry/message
    // renderers and the before_agent_start / session_start / context handlers.
    const inject: CodexInjectApi = createCodexInject(ctx, detect);

    // Self-education (-learn) (Phase 5).
    const learn: CodexLearnApi = createCodexLearn(ctx);

    // The codex_load model tool. readTracker.durableSeen dedupes the durable
    // read-tracking entries appended within this process (the count is rebuilt
    // from entries); readTracker.sessionReads backs the entry tools'
    // read-before-write guard (maintained per session by codex-entries).
    const readTracker: CodexReadTracker = { durableSeen: new Set<string>(), sessionReads: new Set<string>() };
    registerCodexLoadTool(pi, store, readTracker, ctx.checkCompat);

    // The codex entry write tools (add/edit/remove) — deterministic writes:
    // TS-generated [ID]s, per-kind validation, canonical section placement,
    // topic/category creation, internal list-sync on new topic files.
    createCodexEntries(ctx, readTracker);

    // Planning/documentation intent suggestion (D14 - the optional heuristic
    // layer; the D5 directive wording in the marker/rules stays the robust path).
    createCodexIntent(ctx, readTracker);

    // The /aftc-codex-* commands + config menu (sync-first wrapper).
    createCodexCommands(ctx, inject, learn);

    // ---- startup maintenance: structural migration, THEN auto-sync ----
    // Attempted ONCE per extension load, on the FIRST session_start of ANY
    // reason. Order is LOCKED (D18/D24): the structural migration (legacy ->
    // v1 live layout, learned entries preserved) runs BEFORE the seed sync /
    // removal list can touch old paths; when the migration ran but could not
    // finish, the sync is SKIPPED this run so removals can never delete
    // learned entries from not-yet-migrated files. Both are fire-and-forget:
    // never block session start, never throw.
    let startupMaintenanceDone = false;
    pi.on("session_start", (event, sctx) => {
        try {
            if (startupMaintenanceDone) return;
            startupMaintenanceDone = true;
            // pi can REPLACE the session (-p mode, /new) while this async work
            // is still running - a captured sctx then goes stale and THROWS on
            // any access. Capture primitives synchronously and never touch
            // sctx after an await (the notice is cosmetic; the work is not).
            const hasUI = sctx.hasUI;
            const notifyStartup = (msg: string): void => {
                try { if (hasUI) aftcConsole.emphasis(sctx, msg); else aftcConsole.print(msg); }
                catch { aftcConsole.log(`startup notice (session ctx stale): ${msg}`); }
            };
            void (async () => {
              try {
                // 1. Structural migration (idempotent, resumable).
                let migrationIncomplete = false;
                try {
                    if (store.isSeeded()) {
                        const mig = runCodexResourceMigration(store);
                        if (mig.ran && mig.moves.length > 0) {
                            await store.runSyncScript(); // the list reflects the new layout
                            notifyStartup(`AFTC Codex resources moved to the new layout (${mig.moves.length} change(s)); your learned entries were kept.`);
                        }
                        if (mig.ran && !mig.ok) {
                            migrationIncomplete = true;
                            aftcConsole.logError("[aftc-toolset] codex migration incomplete - retries on next start; auto-sync skipped this run.");
                        }
                    }
                } catch (err) {
                    migrationIncomplete = true;
                    aftcConsole.logError(`[aftc-toolset] codex migration error: ${(err as Error).message}`);
                }

                // 2. Auto-sync (aftcCodexAutoSync, default ON). When the shipped
                // seed is newer than the live codex, merge it in NON-DESTRUCTIVELY
                // (same engine as /codex-sync) so the user never hits the
                // out-of-date pause.
                if (migrationIncomplete) return;
                if (!getPreference("aftcCodexAutoSync", true)) return;
                if (!store.isSeeded()) return; // nothing to sync into — /codex-install is the path
                if (ctx.checkCompat().isSafe) return;
                const liveBefore = getPreference("aftcCodexVersion", 0) ?? 0;
                const result = await runSeedToLiveUpdate(store);
                if (!result.output.trim()) return; // spawn failed — the guard stays as fallback
                notifyStartup(`AFTC Codex auto-synced v${liveBefore} -> v${result.newVersion ?? "?"} — new shipped resources merged in${result.removed > 0 ? `, ${result.removed} obsolete resource(s) removed` : ""}; your learned entries were kept.`);
              } catch (err) {
                // The whole body is fire-and-forget - nothing here may escape
                // as an unhandled rejection (a stale session ctx throw used to
                // crash headless pi).
                aftcConsole.logError(`[aftc-toolset] codex startup maintenance error: ${(err as Error).message}`);
              }
            })();
        } catch { /* fail-soft */ }
    });

    aftcConsole.log("loaded — aftc-codex (off by default; /codex-enable to enable)");
}
