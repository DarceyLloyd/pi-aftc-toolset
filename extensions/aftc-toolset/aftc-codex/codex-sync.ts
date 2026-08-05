/**
 * pi-aftc-toolset / aftc-codex — the shared seed -> live update core.
 *
 * Pure logic module (no pi imports). ONE implementation of the
 * non-destructive codex update, used by every caller:
 *
 *   - /codex-sync (codex-commands.ts) — manual, adds viewer + messages.
 *   - Startup auto-sync (aftc-codex.ts) — aftcCodexAutoSync, default ON.
 *
 * The steps are always the same and must never drift apart: run the
 * seed-to-live merge script, stamp the live version to the shipped one (so
 * the version guard clears), backfill entry IDs, regenerate the resource
 * list. NEVER throws — a failed spawn yields an empty output and callers
 * treat that as "sync failed, the version guard stays as the fallback".
 *
 * See `codex-sync-readme.md` for the full contract.
 */

import { setPreference } from "../config";
import { readCodexSeedVersion } from "./codex-compat";
import type { CodexStore } from "./codex-store";

/** Outcome of one seed -> live update run. */
export interface CodexSyncResult {
    /** Merge-script stdout. Empty string = spawn/script failure (nothing done). */
    output: string;
    /** The version stamped onto the live codex (null = seed version unknown,
     *  pref untouched, or the script never ran). */
    newVersion: number | null;
    /** The merge reported same-[ID]-different-text conflicts (live kept). */
    conflicts: boolean;
}

/**
 * Run the non-destructive seed -> live update end to end. Callers decide
 * WHEN it is appropriate (seeded? out of date? pref on?) and how to present
 * `output`; this function owns only the mechanics. Never throws.
 */
export async function runSeedToLiveUpdate(store: CodexStore): Promise<CodexSyncResult> {
    try {
        const output = await store.runSeedToLiveSync();
        if (!output.trim()) return { output, newVersion: null, conflicts: false };
        // The live copy now carries everything the shipped seed has: stamp it
        // as the shipped version so the version guard clears (same as a seed).
        const newVersion = readCodexSeedVersion(store.getSeedDir());
        if (newVersion !== null) setPreference("aftcCodexVersion", newVersion);
        await store.runEnsureIds();
        await store.runSyncScript();
        return { output, newVersion, conflicts: /CONFLICT/.test(output) };
    } catch {
        return { output: "", newVersion: null, conflicts: false };
    }
}
