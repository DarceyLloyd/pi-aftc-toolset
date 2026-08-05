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
import { createCodexStore, type CodexStore } from "./codex-store";
import { createCodexInject, type CodexInjectApi, CODEX_READ_ENTRY } from "./codex-inject";
import { createCodexDetect } from "./codex-detect";
import { createCodexLearn, type CodexLearnApi } from "./codex-learn";
import { createCodexEntries, type CodexReadTracker } from "./codex-entries";
import { createCodexCommands } from "./codex-commands";
import { checkCodexCompatibility, type CodexCompatResult } from "./codex-compat";
import { runSeedToLiveUpdate } from "./codex-sync";
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
    pi.registerTool({
        name: "codex_load",
        label: "Codex Load",
        description:
            "Load an aftc-codex knowledge-base resource by topic name. Searches across " +
            "all category folders (languages, libraries, frameworks, engines, tools) and " +
            "the top-level guidance files, so a file's folder does not matter. Accepts " +
            "aliases (ts, py, js) and the special topics 'rules', 'guidance', 'list', " +
            "'markdown'. Use this to fetch the conventions/gotchas for a technology " +
            "before you rely on them.",
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
        async execute(_toolCallId, params) {
            // Version guard: an out-of-date live codex is updated by
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
            readTracker.sessionReads.add(read.relPath);
            // Track the read durably so /aftc-codex-status can count files read.
            // The entry survives /reload, resume and compaction; durableSeen only
            // avoids appending duplicate entries within this process (the count
            // is rebuilt from the entries themselves).
            if (!readTracker.durableSeen.has(read.relPath)) {
                readTracker.durableSeen.add(read.relPath);
                try { pi.appendEntry(CODEX_READ_ENTRY, { relPath: read.relPath }); } catch { /* fail-soft */ }
            }

            // Empty skeleton (headings but no entry bullets): a fixed one-liner
            // instead of the file content — no point spending context on an
            // empty doc. The read above still counts for the entry tools'
            // read-before-write guard (adding the FIRST entry needs it).
            if (!/^- \S/m.test(read.content)) {
                return {
                    content: [{ type: "text", text: `codex resource "${read.relPath}" exists but has no entries yet.` }],
                    details: { relPath: read.relPath, absPath: read.absPath, empty: true },
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

            return {
                content: [{ type: "text", text }],
                details: { relPath: read.relPath, absPath: read.absPath, truncated: truncation.truncated },
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

    // The /aftc-codex-* commands + config menu (sync-first wrapper).
    createCodexCommands(ctx, inject, learn);

    // ---- auto-sync (aftcCodexAutoSync, default ON) ----
    // When the shipped seed is newer than the live codex, merge it in
    // NON-DESTRUCTIVELY at the earliest opportunity (same engine as
    // /codex-sync) so the user never hits the out-of-date pause. Attempted ONCE
    // per extension load, on the FIRST session_start of ANY reason: a fresh
    // process start is the classic update path, but a /reload after an on-disk
    // package update surfaces a newer seed in-process too, and resuming an old
    // session in a new process must not be left stale either. The pref, seeded
    // and compat checks are all fresh disk reads, so a no-op attempt costs
    // nothing. Fire-and-forget: never blocks session start, never throws; on
    // any failure the version guard + its messages remain as the fallback.
    let autoSyncDone = false;
    pi.on("session_start", (event, sctx) => {
        try {
            if (autoSyncDone) return;
            if (!getPreference("aftcCodexAutoSync", true)) return;
            if (!store.isSeeded()) return; // nothing to sync into — /codex-install is the path
            if (ctx.checkCompat().isSafe) return;
            autoSyncDone = true;
            const liveBefore = getPreference("aftcCodexVersion", 0) ?? 0;
            void (async () => {
                const result = await runSeedToLiveUpdate(store);
                if (!result.output.trim()) return; // spawn failed — the guard stays as fallback
                const msg = `AFTC Codex auto-synced v${liveBefore} -> v${result.newVersion ?? "?"} — new shipped resources merged in; your learned entries were kept.`;
                if (sctx.hasUI) aftcConsole.emphasis(sctx, msg);
                else aftcConsole.print(msg);
            })();
        } catch { /* fail-soft */ }
    });

    aftcConsole.log("loaded — aftc-codex (off by default; /codex-enable to enable)");
}
