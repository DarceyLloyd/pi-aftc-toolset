/**
 * pi-aftc-toolset — subagents agent catalog (profiles).
 *
 * Discovery + parsing + resolution of agent `.md` files (markdown
 * with YAML frontmatter). Three tiers, highest precedence wins, no
 * silent shadowing (qualified ids prevent collision):
 *
 *   project  <cwd>/.pi/agents/*.md          (Phase 3 — approval gate;
 *                                             the tier slot exists, the
 *                                             gate lands with Phase 3)
 *   user     <dataDir>/subagents/agents/*.md + <piAgentDir>/agents/*.md
 *   builtin  <package>/data/subagents/agents/*.md
 *
 * Discovery skips README.md (the user guide) and `_*.md` scratch files.
 * Only `<name>.md` files with parseable frontmatter (or a plain body)
 * become agents. Frontmatter is AUTHORITATIVE: the model can never
 * override it from tool arguments (design principle 3 / invariant 8).
 *
 * See `subagent-catalog-readme.md`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { SubAgentProfile, SubAgentProfileSource } from "./types";
import { getDataDir, getPackageRoot } from "../paths";
import { getSubAgentPref } from "./subagent-config";

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter parsing
// ─────────────────────────────────────────────────────────────────────────────

/** Split a profile file into raw frontmatter lines + prompt body. */
export function splitSubAgentFrontmatter(raw: string): { frontmatter: string[]; body: string } {
    const normalized = raw.replace(/\r\n/g, "\n");
    if (!normalized.startsWith("---\n")) return { frontmatter: [], body: normalized };
    const end = normalized.indexOf("\n---", 4);
    if (end === -1) return { frontmatter: [], body: normalized };
    const frontmatter = normalized.slice(4, end).split("\n");
    let body = normalized.slice(end + 4);
    if (body.startsWith("\n")) body = body.slice(1);
    return { frontmatter, body };
}

function parseScalar(raw: string): string | number | boolean {
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (value === "true") return true;
    if (value === "false") return false;
    if (value !== "" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
}

/** Comma list OR inline [a, b] array -> string items. */
function parseList(raw: string): string[] {
    let value = raw.trim();
    if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
    return value.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** model: id | fuzzy | inherit | [fallback, chain]. */
function parseModel(raw: string): string | string[] {
    const value = raw.trim();
    if (value.startsWith("[") && value.endsWith("]")) return parseList(value);
    return value.replace(/^["']|["']$/g, "") || "inherit";
}

export interface SubAgentParseDefaults {
    maxTurns: number;
    timeoutSeconds: number;
}

/**
 * Parse one agent file into a SubAgentProfile. Returns null when the
 * file can't be read or has no usable content (logged by the caller).
 * Every frontmatter field is optional; sensible defaults apply. When a
 * `base` profile is supplied (the resolved `extends:` target), fields the
 * child does NOT set inherit the base's values, and an empty child body
 * falls back to the base body.
 */
export function parseSubAgentProfileFile(
    filePath: string,
    source: SubAgentProfileSource,
    defaults: SubAgentParseDefaults,
    base: SubAgentProfile | null = null,
): SubAgentProfile | null {
    let raw: string;
    try { raw = fs.readFileSync(filePath, "utf8"); } catch { return null; }
    const name = path.basename(filePath, ".md");
    const { frontmatter, body } = splitSubAgentFrontmatter(raw);

    const fields = new Map<string, string>();
    for (const line of frontmatter) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line.trim());
        if (match) fields.set(match[1], match[2]);
    }

    const asString = (key: string, fallback: string): string => {
        const value = fields.get(key);
        if (value === undefined) return fallback;
        return String(parseScalar(value));
    };
    const asBool = (key: string, fallback: boolean): boolean => {
        const value = fields.get(key);
        if (value === undefined) return fallback;
        return parseScalar(value) === true;
    };
    const asInt = (key: string, fallback: number): number => {
        const value = fields.get(key);
        if (value === undefined) return fallback;
        const parsed = parseScalar(value);
        return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
    };
    const asIntOrNull = (key: string): number | null => {
        const value = fields.get(key);
        if (value === undefined) return null;
        const parsed = parseScalar(value);
        return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
    };
    const asList = (key: string): string[] => {
        const value = fields.get(key);
        return value === undefined ? [] : parseList(value);
    };

    const contextFiles = fields.has("context_files")
        ? asString("context_files", "project")
        : (base?.contextFiles ?? "project");
    const promptMode = fields.has("prompt_mode")
        ? asString("prompt_mode", "replace")
        : (base?.promptMode ?? "replace");
    return {
        name: asString("name", name),
        source,
        filePath,
        description: fields.has("description") ? asString("description", name) : (base?.description ?? name),
        displayName: fields.has("display_name") ? asString("display_name", name) : (base?.displayName ?? name),
        model: fields.has("model") ? parseModel(fields.get("model")!) : (base?.model ?? "inherit"),
        modelTier: fields.has("model_tier") ? asString("model_tier", "") : (base?.modelTier ?? null),
        thinking: asString("thinking", base?.thinking ?? "inherit"),
        tools: fields.has("tools") ? asList("tools") : (base?.tools ?? []),
        disallowedTools: fields.has("disallowed_tools") ? asList("disallowed_tools") : (base?.disallowedTools ?? []),
        skills: fields.has("skills")
            ? (asString("skills", "false") === "true" ? [] : asList("skills"))
            : (base?.skills ?? []),
        contextFiles: contextFiles === "none" ? "none" : "project",
        inheritContext: asBool("inherit_context", base?.inheritContext ?? false),
        promptMode: promptMode === "append" ? "append" : "replace",
        maxTurns: asInt("max_turns", base?.maxTurns ?? defaults.maxTurns),
        timeoutSeconds: asInt("timeout_seconds", base?.timeoutSeconds ?? defaults.timeoutSeconds),
        stallTimeoutSeconds: fields.has("stall_timeout_seconds")
            ? asIntOrNull("stall_timeout_seconds") : (base?.stallTimeoutSeconds ?? null),
        stallDetectionEnabled: asBool("stall_detection", base?.stallDetectionEnabled ?? true),
        loopDetectionEnabled: asBool("loop_detection", base?.loopDetectionEnabled ?? true),
        codexEnabled: asBool("codex", base?.codexEnabled ?? true),
        codexWriteEnabled: asBool("codex_write", base?.codexWriteEnabled ?? false),
        persistSession: asBool("persist_session", base?.persistSession ?? false),
        outputTranscript: asBool("output_transcript", base?.outputTranscript ?? true),
        enabled: asBool("enabled", base?.enabled ?? true),
        tags: fields.has("tags") ? asList("tags") : (base?.tags ?? []),
        extendsName: fields.has("extends") ? asString("extends", "") : null,
        body: body.trim().length > 0 ? body.trim() : (base?.body ?? ""),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

function listAgentFiles(dir: string): string[] {
    try {
        return fs.readdirSync(dir)
            .filter((name) => name.endsWith(".md"))
            .filter((name) => name.toLowerCase() !== "readme.md" && !name.startsWith("_"))
            .map((name) => path.join(dir, name))
            .filter((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
    } catch {
        return [];
    }
}

/** Built-in (shipped seed) agents dir — pristine, never edited. */
export function getSubAgentSeedDir(): string {
    return path.join(getPackageRoot(), "extensions", "aftc-toolset", "data", "subagents", "agents");
}

/** Live user agents dir — seeded from built-ins, user-editable. */
export function getSubAgentLiveDir(): string {
    return path.join(getDataDir(), "subagents", "agents");
}

/** pi-native global agents dir. PI_CODING_AGENT_DIR replaces `~/.pi`,
 *  so the agents live at `<piAgentDir>/agent/agents`. */
export function getSubAgentGlobalDir(): string {
    const override = process.env.PI_CODING_AGENT_DIR;
    const piRoot = override && override.trim()
        ? path.resolve(override)
        : path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi");
    return path.join(piRoot, "agent", "agents");
}

/** Project agents dir (Phase 3 approval gate). */
export function getSubAgentProjectDir(cwd: string): string {
    return path.join(cwd, ".pi", "agents");
}

export interface SubAgentCatalogOptions {
    /** Include the project tier (gated until Phase 3 approval lands). */
    includeProject?: boolean;
    cwd?: string;
    /** Also return `enabled: false` agents (the /007-edit picker needs
     *  them so a disabled agent can be re-enabled from inside pi). */
    includeDisabled?: boolean;
}

/**
 * Discover every enabled agent across the tiers. All copies are
 * kept (a live `explorer` does NOT delete `builtin/explorer`): unqualified
 * names resolve by precedence (project > user > builtin — the seeded
 * live copy is authoritative over the pristine package copy), and
 * qualified ids (`user/explorer`, `builtin/explorer`) reach a specific tier,
 * so nothing is ever silently shadowed (design section 6).
 * `extends:` chains resolve across the set (depth-capped, cycle-safe).
 */
export function discoverSubAgentProfiles(options: SubAgentCatalogOptions = {}): SubAgentProfile[] {
    const defaults: SubAgentParseDefaults = {
        maxTurns: getSubAgentPref("defaultMaxTurns", 8),
        timeoutSeconds: getSubAgentPref("defaultTimeoutSeconds", 300),
    };
    const tiers: Array<{ source: SubAgentProfileSource; dir: string }> = [
        { source: "user", dir: getSubAgentLiveDir() },
        { source: "user", dir: getSubAgentGlobalDir() },
        { source: "builtin", dir: getSubAgentSeedDir() },
    ];
    if (options.includeProject) {
        tiers.unshift({ source: "project", dir: getSubAgentProjectDir(options.cwd ?? process.cwd()) });
    }

    // Every candidate file, precedence-ordered (project > user > builtin).
    const entries: Array<{ name: string; file: string; source: SubAgentProfileSource }> = [];
    const seenFile = new Set<string>();
    for (const tier of tiers) {
        for (const file of listAgentFiles(tier.dir)) {
            if (seenFile.has(file)) continue;
            seenFile.add(file);
            entries.push({ name: path.basename(file, ".md"), file, source: tier.source });
        }
    }

    // Build with extends resolution (memoised per file, depth-capped,
    // cycle-safe). An extends target resolves by precedence (first
    // matching name in this list).
    const built = new Map<string, SubAgentProfile | null>();
    function build(entry: { name: string; file: string; source: SubAgentProfileSource }, chain: string[]): SubAgentProfile | null {
        if (built.has(entry.file)) return built.get(entry.file)!;
        if (chain.includes(entry.file) || chain.length >= 5) return null; // cycle / depth cap
        let base: SubAgentProfile | null = null;
        try {
            const raw = fs.readFileSync(entry.file, "utf8");
            const { frontmatter } = splitSubAgentFrontmatter(raw);
            const extendsLine = frontmatter.find((l) => /^extends\s*:/.test(l.trim()));
            if (extendsLine) {
                const target = extendsLine.split(":")[1]?.trim().replace(/^["']|["']$/g, "");
                if (target && target !== entry.name) {
                    const baseEntry = entries.find((e) => e.name === target);
                    if (baseEntry) base = build(baseEntry, [...chain, entry.file]);
                }
            }
        } catch { /* unreadable — parse below returns null */ }
        const profile = parseSubAgentProfileFile(entry.file, entry.source, defaults, base);
        built.set(entry.file, profile);
        return profile;
    }

    const profiles: SubAgentProfile[] = [];
    for (const entry of entries) {
        const profile = build(entry, []);
        if (profile && (options.includeDisabled || profile.enabled)) profiles.push(profile);
    }
    if (getSubAgentPref("disableDefaultAgents", false)) {
        return profiles.filter((p) => p.source !== "builtin");
    }
    return profiles;
}

/**
 * Seed-to-live (codex pattern): copy every shipped built-in agent
 * (plus the README guide) into the live user dir. Idempotent copy-only —
 * an existing live file is NEVER overwritten (the user's edits are
 * sacred). Records a seed manifest (file -> content hash + seed version)
 * that /007-sync uses for conflict detection. Throws on I/O failure so
 * the caller can abort whatever the seed was gating (the /007 enable
 * flow).
 */
export function seedSubAgentBuiltIns(): { copied: string[]; skipped: string[] } {
    const seedDir = getSubAgentSeedDir();
    const liveDir = getSubAgentLiveDir();
    const copied: string[] = [];
    const skipped: string[] = [];
    fs.mkdirSync(liveDir, { recursive: true });
    const manifest = readSubAgentSeedManifest();
    for (const name of fs.readdirSync(seedDir)) {
        if (!name.endsWith(".md")) continue;
        if (name.startsWith("_")) continue;
        const src = path.join(seedDir, name);
        const dest = path.join(liveDir, name);
        if (fs.existsSync(dest)) { skipped.push(name); continue; }
        fs.copyFileSync(src, dest); // throws on failure -> enable aborts
        manifest.files[name] = hashFile(dest);
        copied.push(name);
    }
    manifest.seedVersion = getShippedSubAgentsSeedVersion();
    writeSubAgentSeedManifest(manifest);
    return { copied, skipped };
}

// ───────────────────────────────────────────────────────────────────────────
// Seed manifest + version lifecycle (the /007-sync machinery)
// ───────────────────────────────────────────────────────────────────────────

function hashFile(filePath: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

interface SubAgentSeedManifest {
    seedVersion: number;
    files: Record<string, string>;
}

function manifestPath(): string {
    return path.join(getSubAgentLiveDir(), ".subagents-seed-manifest.json");
}

function readSubAgentSeedManifest(): SubAgentSeedManifest {
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath(), "utf8")) as SubAgentSeedManifest;
        if (parsed && typeof parsed === "object" && parsed.files) return parsed;
    } catch { /* missing/corrupt -> fresh manifest */ }
    return { seedVersion: 0, files: {} };
}

function writeSubAgentSeedManifest(manifest: SubAgentSeedManifest): void {
    fs.mkdirSync(getSubAgentLiveDir(), { recursive: true });
    const tmp = manifestPath() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
    fs.renameSync(tmp, manifestPath());
}

/** The shipped seed version (data/extension-config.json subagentsSeedVersion). */
export function getShippedSubAgentsSeedVersion(): number {
    try {
        const file = path.join(getPackageRoot(), "extensions", "aftc-toolset", "data", "extension-config.json");
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { subagentsSeedVersion?: unknown };
        return typeof parsed.subagentsSeedVersion === "number" ? parsed.subagentsSeedVersion : 0;
    } catch {
        return 0;
    }
}

/** Live seed version recorded by the last seed/sync (0 = never seeded). */
export function getLiveSubAgentsSeedVersion(): number {
    return readSubAgentSeedManifest().seedVersion;
}

/** True when the shipped seed is newer than the live copy (menu notice). */
export function subAgentSeedMismatch(): boolean {
    return getShippedSubAgentsSeedVersion() > getLiveSubAgentsSeedVersion();
}

export interface SubAgentSyncResult {
    updated: string[];
    conflicts: string[];
    added: string[];
}

/**
 * Non-destructive file-level merge (/007-sync): a live file whose content
 * still matches the last-seeded hash is updated to the new shipped
 * version; a live file the user edited is reported as a conflict and left
 * untouched; missing files are added. Never auto-overwrites user edits.
 */
export function syncSubAgentBuiltIns(): SubAgentSyncResult {
    const seedDir = getSubAgentSeedDir();
    const liveDir = getSubAgentLiveDir();
    fs.mkdirSync(liveDir, { recursive: true });
    const manifest = readSubAgentSeedManifest();
    const result: SubAgentSyncResult = { updated: [], conflicts: [], added: [] };
    for (const name of fs.readdirSync(seedDir)) {
        if (!name.endsWith(".md") || name.startsWith("_")) continue;
        const src = path.join(seedDir, name);
        const dest = path.join(liveDir, name);
        if (!fs.existsSync(dest)) {
            fs.copyFileSync(src, dest);
            manifest.files[name] = hashFile(dest);
            result.added.push(name);
            continue;
        }
        const seededHash = manifest.files[name];
        if (seededHash && hashFile(dest) === seededHash) {
            fs.copyFileSync(src, dest); // untouched since seeding -> safe to update
            manifest.files[name] = hashFile(dest);
            result.updated.push(name);
        } else {
            result.conflicts.push(name); // user-modified -> never auto-overwrite
        }
    }
    manifest.seedVersion = getShippedSubAgentsSeedVersion();
    writeSubAgentSeedManifest(manifest);
    return result;
}

/**
 * /007-reset: discard live edits to ONE agent and re-copy the shipped
 * version. Returns false when the built-in does not exist.
 */
export function resetSubAgentBuiltIn(name: string): boolean {
    const src = path.join(getSubAgentSeedDir(), `${name}.md`);
    if (!fs.existsSync(src)) return false;
    const liveDir = getSubAgentLiveDir();
    fs.mkdirSync(liveDir, { recursive: true });
    const dest = path.join(liveDir, `${name}.md`);
    fs.copyFileSync(src, dest); // reset = overwrite is the point (confirmed by caller)
    const manifest = readSubAgentSeedManifest();
    manifest.files[`${name}.md`] = hashFile(dest);
    writeSubAgentSeedManifest(manifest);
    return true;
}

/**
 * Resolve an agent by name. Qualified ids (`user/explorer`,
 * `builtin/explorer`, `project/explorer`) reach a specific tier; an
 * unqualified name resolves by tier precedence (the discovery list is
 * already precedence-ordered, so the first match is the authoritative
 * one — the seeded live copy over the pristine package copy). A
 * leading `@` is stripped (some models add it).
 */
export function resolveSubAgentProfile(
    name: string,
    profiles: SubAgentProfile[],
): SubAgentProfile | null {
    const wanted = name.trim().replace(/^@/, "");
    if (!wanted) return null;
    const slash = wanted.indexOf("/");
    if (slash !== -1) {
        const source = wanted.slice(0, slash) as SubAgentProfileSource;
        const bare = wanted.slice(slash + 1);
        return profiles.find((p) => p.source === source && p.name === bare) ?? null;
    }
    return profiles.find((p) => p.name === wanted) ?? null;
}
