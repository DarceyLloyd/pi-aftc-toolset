/**
 * pi-aftc-toolset — help registry (single source of truth for /aftc-help).
 *
 * Every feature module that registers slash commands with pi ALSO records
 * them here, next to the pi.registerCommand call. help.ts renders
 * /aftc-help from this registry, so the help screen can never drift from
 * the commands that actually exist.
 *
 * This is a utility module, NOT a feature module (same class as db.ts /
 * paths.ts): feature modules are free to import it. It has no pi
 * dependency and no side effects beyond module state.
 *
 * Contract (enforced by tests/help-registry-check/):
 *   - one entry per PRIMARY command; aliases go in `aliases`
 *   - every pi.registerCommand name appears as either `command` or an
 *     alias in exactly one entry
 *   - every entry maps to a real registered command
 *
 * See `help-registry-readme.md` and `docs/help-registry.md` for the full
 * contract and the create/edit/delete checklist.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Categories — canonical display order for /aftc-help sections
// ─────────────────────────────────────────────────────────────────────────────

export const HELP_CATEGORY_ORDER = [
    "General",
    "Response",
    "Interrupt",
    "Navigation",
    "Footer / cache / timing",
    "Usage report",
    "SSH",
    "Replay",
    "Keep it short",
    "aftc-codex",
    "Sub-agents",
    "Background terminals",
    "Thinking",
    "Audio notification",
    "Providers",
] as const;

export type HelpCategory = (typeof HELP_CATEGORY_ORDER)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Entry shape
// ─────────────────────────────────────────────────────────────────────────────

export interface HelpEntry {
    /** Primary command name, NO leading slash (eg "aftc-stop"). */
    command: string;
    /** Usage hint shown after the command (eg "[path]", "<n>"). */
    args?: string;
    /** One-line description. Do NOT embed "(alias …)" — use `aliases`. */
    description: string;
    category: HelpCategory;
    /** Alias command names, NO leading slash (eg ["stfu"]). */
    aliases?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry state
// ─────────────────────────────────────────────────────────────────────────────

const entries: HelpEntry[] = [];

/**
 * Record a slash command for /aftc-help. Call it immediately after the
 * pi.registerCommand block for the same command (one call per primary,
 * aliases included in the entry).
 *
 * A duplicate `command` REPLACES the earlier entry. pi keeps extension
 * modules alive and re-runs the factories on /reload, so an IDENTICAL
 * re-registration is the normal reload path and stays silent; only a
 * duplicate with DIFFERENT content logs (two modules genuinely fighting
 * over the same name — a real bug, never gated by the debug flag).
 */
export function registerHelpEntry(entry: HelpEntry): void {
    const existing = entries.findIndex((e) => e.command === entry.command);
    if (existing >= 0) {
        const prev = entries[existing];
        const identical =
            prev.description === entry.description &&
            prev.category === entry.category &&
            JSON.stringify(prev.aliases ?? []) === JSON.stringify(entry.aliases ?? []);
        if (!identical) {
            console.log(
                `[aftc-toolset] help-registry: conflicting entry for /${entry.command} — replacing`,
            );
        }
        entries[existing] = entry;
        return;
    }
    entries.push(entry);
}

/** All registered entries, in registration order. Returns a copy. */
export function getHelpEntries(): HelpEntry[] {
    return [...entries];
}

/** Clear the registry. Test harnesses only — production never calls this. */
export function resetHelpRegistry(): void {
    entries.length = 0;
}
