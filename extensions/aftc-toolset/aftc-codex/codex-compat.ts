/**
 * pi-aftc-toolset / aftc-codex — codex version compatibility guard.
 *
 * Pure data module (no pi imports, no store imports): compares the shipped
 * seed's version against the version the user's live copy was seeded
 * from, and reports whether codex features may run.
 *
 * Codex versioning: the shipped seed's version lives in
 * <packageRoot>/extensions/aftc-toolset/data/extension-config.json (codexVersion,
 * an integer). The user's live version is a config.json preference
 * (aftcCodexVersion),
 * stamped by every full seed. checkCodexCompatibility() compares them; on a
 * mismatch the user runs /codex-install (or Start Fresh in the /codex menu),
 * which deletes the live codex dir and installs a full fresh copy of the seed
 * (no backup, by design). A missing or unreadable seed version disables
 * version logic entirely (fail-soft: never block when unsure).
 *
 * Production-safety: every I/O op is best-effort try/catch.
 * See `codex-compat-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Result of the central compatibility guard (see checkCodexCompatibility). */
export interface CodexCompatResult {
    /** true = live codex matches the shipped version (or version unknown) — safe to use. */
    isSafe: boolean;
    /** User-facing message when unsafe (show in an aftc-ui modal / notice). */
    message: string;
}

function safeRead(absPath: string): string | null {
    try {
        return fs.readFileSync(absPath, "utf8");
    } catch {
        return null;
    }
}

/**
 * Read the shipped codex version. It lives in the package's data
 * extension-config.json (<data>/extension-config.json — one level UP from the codex
 * seed dir), never copied to the live side. Returns null when missing/unreadable/not a
 * number — callers MUST treat null as "version unknown" and skip all version
 * logic (fail-soft: never block when unsure).
 *
 * Read fresh from disk on every call (no cache — same rule as config.json,
 * see docs/working-with-config.md).
 */
export function readCodexSeedVersion(seedDir: string): number | null {
    try {
        const configPath = path.join(path.dirname(seedDir), "extension-config.json");
        const raw = safeRead(configPath);
        if (raw === null) return null;
        const parsed = JSON.parse(raw) as { codexVersion?: unknown };
        return typeof parsed.codexVersion === "number" ? parsed.codexVersion : null;
    } catch {
        return null;
    }
}

/**
 * The central compatibility guard every codex feature calls before touching
 * the live codex. Compares the shipped seed version against the user's
 * recorded live version (the aftcCodexVersion preference).
 *
 * isSafe = true when the seed version is unknown (fail-soft), the live copy
 * was never seeded, or both versions match. isSafe = false means the live
 * AFTC Codex is out of date: features should hold off, show `message`, and
 * the user runs /codex-install, which wipes the live codex and installs a
 * full fresh copy of the seed.
 */
export function checkCodexCompatibility(seedDir: string, liveVersion: number, liveSeeded: boolean): CodexCompatResult {
    // Never seeded = nothing stale to wipe: first-time enable/seed must proceed
    // (the seed itself then records the version). Unknown seed version or a
    // version match are likewise safe (fail-soft: never block when unsure).
    const seedVersion = readCodexSeedVersion(seedDir);
    if (!liveSeeded || seedVersion === null || seedVersion === liveVersion) {
        return { isSafe: true, message: "" };
    }
    return {
        isSafe: false,
        message:
            `Your AFTC Codex is out of date (v${liveVersion} -> v${seedVersion}). ` +
            `Run /codex-install to replace it with a full fresh copy of the shipped codex ` +
            `(this wipes your current codex, including any learned entries). ` +
            `Codex features are paused until then.`,
    };
}
