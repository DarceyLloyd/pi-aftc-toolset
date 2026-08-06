/**
 * pi-aftc-toolset / aftc-codex — shipped-seed resource removals.
 *
 * The seed -> live merge (scripts/seed-to-live-sync.mjs) is strictly
 * additive: it never deletes anything from the user's live codex. When a
 * maintainer removes or renames a topic in the SEED, the stale live file
 * would linger forever (and keep appearing in the regenerated
 * codex-resource-list.md). This module closes that gap.
 *
 * The SEED ships `codex-resource-removal-list.json` — a cumulative JSON
 * array of resource paths relative to `resources/` (forward slashes on
 * every platform), eg ["frameworks/aftc-framework.md"]. Deletion is
 * idempotent, so the list only ever grows and needs no history tracking:
 * an already-removed file is a silent no-op.
 *
 * Applied by runSeedToLiveUpdate (codex-sync.ts) — the ONE code path
 * behind BOTH startup auto-sync and /codex-sync. NOT applied by
 * /codex-live-to-seed (opposite direction) or /codex-install (wipe +
 * re-seed; nothing survives anyway).
 *
 * Safety (fail-soft, never throws, never escapes the live resources dir):
 *   - only `.md` files under `<live>/resources/` can be removed;
 *   - absolute paths, drive letters, `..` segments and empty segments are
 *     rejected, and the resolved target is re-checked to stay inside the
 *     resources dir;
 *   - an invalid/missing list file yields an empty result;
 *   - a category folder left empty by a removal is removed too;
 *   - learned entries inside a removed file are deleted with it (an
 *     explicit maintainer decision — the topic is gone).
 *
 * See `codex-removals-readme.md` for the full contract.
 */

import fs from "node:fs";
import path from "node:path";
import type { CodexStore } from "./codex-store";

/** The shipped list file name (lives in the SEED dir, never copied live). */
export const REMOVAL_LIST_FILE = "codex-resource-removal-list.json";

/** Outcome of one removal pass. */
export interface CodexRemovalResult {
    /** Number of live files actually deleted. */
    removed: number;
    /** One report line per deleted file (for the sync output/viewer). */
    lines: string[];
}

/**
 * Read the seed's removal list and delete every listed resource from the
 * LIVE copy. Idempotent (missing files are silent no-ops) and fail-soft:
 * any error — missing list, bad JSON, non-array entry, unsafe path,
 * fs failure — never throws. Cross-platform: list paths use forward
 * slashes and are validated before being joined with node:path, so they
 * resolve correctly on Windows, Linux and macOS.
 */
export function applySeedRemovals(store: CodexStore): CodexRemovalResult {
    const result: CodexRemovalResult = { removed: 0, lines: [] };
    try {
        const entries = readRemovalList(path.join(store.getSeedDir(), REMOVAL_LIST_FILE));
        if (entries.length === 0) return result;

        const resourcesDir = path.resolve(store.getResourcesDir());
        for (const rel of entries) {
            const target = resolveRemovalTarget(resourcesDir, rel);
            if (!target) continue; // rejected (unsafe path) or already gone
            try {
                fs.unlinkSync(target);
            } catch {
                continue; // fail-soft: file vanished mid-run or unreadable
            }
            result.removed++;
            result.lines.push(`REMOVED    ${rel} (obsolete shipped resource)`);
            pruneEmptyParent(resourcesDir, path.dirname(target));
        }
    } catch { /* fail-soft — removals never break a sync */ }
    return result;
}

/** Parse the removal list file. Returns only non-empty strings; any parse
 *  problem (missing file, bad JSON, non-array) yields []. */
function readRemovalList(listPath: string): string[] {
    try {
        const raw = fs.readFileSync(listPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    } catch {
        return [];
    }
}

/**
 * Validate one list entry and resolve it to an absolute live path.
 * Returns null when the entry is unsafe (never touch those) or when the
 * target file does not exist (idempotent no-op).
 *
 * Entries are stored with forward slashes; split on both separators so a
 * hand-edited Windows-style path is handled too.
 */
function resolveRemovalTarget(resourcesDir: string, rel: string): string | null {
    const segments = rel.replace(/\\/g, "/").split("/").map((s) => s.trim());
    if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
    if (/^[a-zA-Z]:/.test(segments[0] ?? "")) return null; // drive letter
    const last = segments[segments.length - 1] ?? "";
    if (!last.toLowerCase().endsWith(".md")) return null;

    const target = path.resolve(resourcesDir, ...segments);
    // Belt and braces: the resolved path must stay inside resources/.
    if (target !== resourcesDir && !target.startsWith(resourcesDir + path.sep)) return null;
    try {
        if (!fs.statSync(target).isFile()) return null;
    } catch {
        return null; // does not exist -> idempotent no-op
    }
    return target;
}

/** Remove now-empty category folders between the deleted file and the
 *  resources dir (never touches resources/ itself or non-empty folders). */
function pruneEmptyParent(resourcesDir: string, dir: string): void {
    let current = path.resolve(dir);
    while (current !== resourcesDir && current.startsWith(resourcesDir + path.sep)) {
        try {
            const remaining = fs.readdirSync(current);
            if (remaining.length > 0) return;
            fs.rmdirSync(current);
            current = path.dirname(current);
        } catch {
            return; // fail-soft
        }
    }
}
