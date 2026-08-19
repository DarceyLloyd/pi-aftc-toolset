/**
 * pi-aftc-toolset / aftc-codex — data-dir layout, seeding, and resource access.
 *
 * Pure data module (no pi imports, no event subscriptions). Owns the live
 * copy side of the codex:
 *
 *   - SHIPPED SEED (source only):  <packageRoot>/extensions/aftc-toolset/data/aftc-codex/
 *   - USER LIVE COPY (per-user):   <codexRoot>/  (default <dataDir>/aftc-codex/)
 *
 * The seed ships ONLY the 3 fixed maintainer docs (codex-rules.md,
 * markdown-guidance.md, thought-and-action-guidance.md). Those copy into the
 * live codex root on first seed, and re-copy when the package version changes.
 * User topic resources live under `<root>/resources/` and are NEVER touched by
 * the seed - users generate them with the codex entry tools. The live copy
 * survives `pi update` because it lives in the persistent OS data dir.
 *
 * Responsibilities:
 *   - Resolve the codex root: always <dataDir>/aftc-codex.
 *   - seed(): copy the shipped fixed docs + stamp the installed package version.
 *   - Read resources on demand (codex_load + injection): search ACROSS ALL
 *     category folders + top-level, fuzzy aliases, strip a leading "@".
 *   - Spawn the sync script (regenerate codex-resource-list.md).
 *
 * Production-safety: every I/O op is best-effort try/catch -> fall back to a
 * safe default / no-op; user resources are never overwritten.
 *
 * See `codex-store-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { setPreference } from "../config";
import { getDataDir, getPackageRoot } from "../paths";
import * as aftcConsole from "../ui/aftc-console";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The well-known category folders (listed first; ANY other folder found
 *  on disk, eg a community-created category, is appended after — retrieval
 *  never ignores folders). Category folders may nest topics one level deep
 *  (eg ui-ux/web/web-app.md — spec D7); loose root-level topics (eg
 *  documentation-and-planning.md) sit directly in resources/. */
export const CODEX_CATEGORIES = [
    "languages", "libraries", "frameworks", "engines", "runtimes",
    "tools", "servers-and-containers", "database", "os", "file-formats", "ui-ux",
] as const;
export type CodexCategory = (typeof CODEX_CATEGORIES)[number];

/** All category folders: known order first, then any extra dirs (sorted). */
function listCategoryFolders(resourcesDir: string): string[] {
    let extras: string[] = [];
    try {
        extras = fs.readdirSync(resourcesDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .filter((name) => !(CODEX_CATEGORIES as readonly string[]).includes(name))
            .sort();
    } catch {
        // fall through — known order only
    }
    return [...CODEX_CATEGORIES, ...extras];
}

/** Top-level guidance files that are not category docs. */
const TOP_LEVEL_RESOURCES = [
    "codex-rules.md",
    "thought-and-action-guidance.md",
    "markdown-guidance.md",
] as const;

/** A resolved resource read result. */
export interface CodexResourceRead {
    /** Absolute path to the file on disk. */
    absPath: string;
    /** Path relative to the resources dir (forward slashes). */
    relPath: string;
    /** Full file content. */
    content: string;
}

/** Resource counts by category + totals. */
export interface CodexCounts {
    languages: number;
    libraries: number;
    frameworks: number;
    engines: number;
    runtimes: number;
    tools: number;
    "servers-and-containers": number;
    database: number;
    os: number;
    "file-formats": number;
    "ui-ux": number;
    topLevel: number;
    total: number;
}

export interface CodexStore {
    /** Resolved live codex root (<dataDir>/aftc-codex; one-way seed -> live). */
    getRoot(): string;
    /** <root>/resources. */
    getResourcesDir(): string;
    /** Shipped seed dir (<packageRoot>/extensions/aftc-toolset/data/aftc-codex). */
    getSeedDir(): string;
    /** True when the live copy exists and has a rules file. */
    isSeeded(): boolean;
    /** Copy the shipped fixed docs (rules/guidance/markdown) into the live copy,
     *  create the empty resources dir, and stamp the installed package version.
     *  Never touches user resources or the SQLite DB. */
    seed(): { copied: number };
    /** Seed if not already seeded. Returns true if seeded now. */
    ensureSeeded(): boolean;
    /** Read a topic doc by name/alias across all folders + top-level. Null if unknown. */
    readResource(topic: string): CodexResourceRead | null;
    /** All valid topic names (basename without .md), sorted. */
    listTopics(): string[];
    /** All loadable topic paths (relPath without ".md": category topics,
     *  recursive + loose root-level topics), sorted. Excludes the generated
     *  resource list and the top-level always-on guidance files. */
    listTopicPaths(): string[];
    /** Read the always-on rules file ("" if missing). */
    readRules(): string;
    /** Read the SEED rules file ("" if missing) — rules-only mode fallback when
     *  the live copy was never seeded. */
    readSeedRules(): string;
    /** Read thought-and-action-guidance.md ("" if missing). */
    readGuidance(): string;
    /** Read the generated codex-resource-list.md ("" if missing). */
    readList(): string;
    /** All category folders under resources/ (known order first, extras sorted). */
    listCategories(): string[];
    /** Resource counts by category. */
    getCounts(): CodexCounts;
    /** Sum of category docs (excludes top-level guidance + the
     *  generated resource list). Lasts only as long as the
     *  match-condition `CODEX_CATEGORIES` covers known categories;
     *  when a new category is added, the sum grows automatically
     *  because the call here does not enumerate field names. */
    getCategoryCount(): number;
    /** Spawn the sync script to regenerate codex-resource-list.md. Never throws. */
    runSyncScript(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy topic aliases (spec D6)
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_ALIASES: Record<string, string> = {
    ts: "typescript",
    typescript: "typescript",
    py: "python",
    python: "python",
    js: "javascript",
    javascript: "javascript",
    pine: "pinescript",
    pinescript: "pinescript",
    gd: "godot",
    gdscript: "godot",
    godot: "godot",
    // Special topics.
    rules: "codex-rules",
    guidance: "thought-and-action-guidance",
    thinking: "thought-and-action-guidance",
    list: "codex-resource-list",
    resources: "codex-resource-list",
    markdown: "markdown-guidance",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeRead(absPath: string): string | null {
    try {
        return fs.readFileSync(absPath, "utf8");
    } catch {
        return null;
    }
}

function listMarkdownNames(dir: string): string[] {
    try {
        return fs.readdirSync(dir)
            .filter((n) => n.toLowerCase().endsWith(".md"))
            .filter((n) => {
                try { return fs.statSync(path.join(dir, n)).isFile(); } catch { return false; }
            })
            .sort();
    } catch {
        return [];
    }
}

/** All *.md files under a dir, RECURSIVE (nested topics, depth 2), as
 *  forward-slash paths relative to `base` (deterministic order: a folder's
 *  direct files first, then sub-folders sorted). */
function listMarkdownRecursive(dir: string, base: string): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    const sorted = entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of sorted) {
        if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
            out.push(path.relative(base, path.join(dir, e.name)).replace(/\\/g, "/"));
        }
    }
    for (const e of sorted) {
        if (e.isDirectory()) {
            out.push(...listMarkdownRecursive(path.join(dir, e.name), base));
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createCodexStore(): CodexStore {
    function getRoot(): string {
        return path.join(getDataDir(), "aftc-codex");
    }

    function getResourcesDir(): string {
        return path.join(getRoot(), "resources");
    }

    function getSeedDir(): string {
        return path.join(getPackageRoot(), "extensions", "aftc-toolset", "data", "aftc-codex");
    }

    function isSeeded(): boolean {
        try {
            // Top-level rules file lives at the codex ROOT (not in resources/).
            const rulesPath = path.join(getRoot(), "codex-rules.md");
            return fs.existsSync(rulesPath);
        } catch {
            return false;
        }
    }

    function seed(): { copied: number } {
        const root = getRoot();
        const resourcesDir = getResourcesDir();
        const seedDir = getSeedDir();
        let copied = 0;
        try {
            fs.mkdirSync(root, { recursive: true });
            fs.mkdirSync(resourcesDir, { recursive: true });
            // Copy the shipped fixed docs (always the latest) into the live
            // copy. User resources under resources/ are NEVER touched here.
            for (const name of TOP_LEVEL_RESOURCES) {
                const src = path.join(seedDir, name);
                const dest = path.join(root, name);
                try {
                    if (fs.existsSync(src)) {
                        fs.copyFileSync(src, dest);
                        copied++;
                    }
                } catch (err) {
                    aftcConsole.logError(`[aftc-toolset] codex seed: copy ${name} failed: ${(err as Error).message}`);
                }
            }
            // Stamp the installed package version so the startup override only
            // re-copies the fixed docs when the package actually changes.
            setPreference("aftcCodexInstalledVersion", readPackageVersion());
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex seed: error: ${(err as Error).message}`);
        }
        return { copied };
    }

    function ensureSeeded(): boolean {
        if (isSeeded()) return false;
        seed();
        return true;
    }

    /** Resolve a topic name to an absolute file path across all folders + top-level. */
    function resolveTopicPath(topic: string): { absPath: string; relPath: string } | null {
        // Strip a leading "@" (some models add it) and normalise.
        let raw = topic.trim();
        if (raw.startsWith("@")) raw = raw.slice(1);
        raw = raw.trim();
        if (!raw) return null;
        // Drop a trailing .md if supplied.
        if (raw.toLowerCase().endsWith(".md")) raw = raw.slice(0, -3);
        const lower = raw.toLowerCase();

        // Explicit path form: "category/name" or "category/sub/name" (nested).
        if (lower.includes("/")) {
            const absPath = path.join(getResourcesDir(), `${raw}.md`);
            if (fs.existsSync(absPath)) return { absPath, relPath: `${raw}.md`.replace(/\\/g, "/") };
            return null;
        }

        const alias = TOPIC_ALIASES[lower] ?? lower;
        const fileName = `${alias}.md`;
        const resourcesDir = getResourcesDir();

        // Top-level guidance files live at the codex ROOT (not in resources/).
        const rootLevel = path.join(getRoot(), fileName);
        if (fs.existsSync(rootLevel)) return { absPath: rootLevel, relPath: fileName };

        // Then the resources dir (generated list + category docs).
        const resLevel = path.join(resourcesDir, fileName);
        if (fs.existsSync(resLevel)) return { absPath: resLevel, relPath: fileName };

        // Then each category folder, RECURSIVE (nested topics resolve by
        // basename too — retrieval is folder-agnostic).
        for (const cat of listCategoryFolders(resourcesDir)) {
            for (const rel of listMarkdownRecursive(path.join(resourcesDir, cat), resourcesDir)) {
                if (path.basename(rel).toLowerCase() === fileName) {
                    return { absPath: path.join(resourcesDir, rel), relPath: rel };
                }
            }
        }
        return null;
    }

    function readResource(topic: string): CodexResourceRead | null {
        const resolved = resolveTopicPath(topic);
        if (!resolved) return null;
        const content = safeRead(resolved.absPath);
        if (content === null) return null;
        return { absPath: resolved.absPath, relPath: resolved.relPath, content };
    }

    function listTopics(): string[] {
        const names = new Set<string>();
        // Top-level guidance files at the codex root.
        for (const name of listMarkdownNames(getRoot())) {
            names.add(name.slice(0, -3));
        }
        // Resources dir (generated list + category docs).
        const resourcesDir = getResourcesDir();
        for (const name of listMarkdownNames(resourcesDir)) {
            names.add(name.slice(0, -3));
        }
        for (const cat of listCategoryFolders(resourcesDir)) {
            for (const rel of listMarkdownRecursive(path.join(resourcesDir, cat), resourcesDir)) {
                names.add(path.basename(rel).slice(0, -3));
            }
        }
        return [...names].sort();
    }

    function listTopicPaths(): string[] {
        const resourcesDir = getResourcesDir();
        const out: string[] = [];
        // Loose root-level topic docs in resources/ (eg documentation-and-planning.md).
        for (const name of listMarkdownNames(resourcesDir)) {
            if (name === "codex-resource-list.md") continue;
            out.push(name.slice(0, -3));
        }
        // Category topics, RECURSIVE (nested topics included) - a topic's
        // folder does not matter for codex_load, but the path disambiguates
        // same-named topics across categories.
        for (const cat of listCategoryFolders(resourcesDir)) {
            for (const rel of listMarkdownRecursive(path.join(resourcesDir, cat), resourcesDir)) {
                out.push(rel.slice(0, -3));
            }
        }
        return out.sort();
    }

    function readRules(): string {
        return safeRead(path.join(getRoot(), "codex-rules.md")) ?? "";
    }

    function readSeedRules(): string {
        return safeRead(path.join(getSeedDir(), "codex-rules.md")) ?? "";
    }

    function readGuidance(): string {
        return safeRead(path.join(getRoot(), "thought-and-action-guidance.md")) ?? "";
    }

    function readList(): string {
        return safeRead(path.join(getResourcesDir(), "codex-resource-list.md")) ?? "";
    }

    function listCategories(): string[] {
        try {
            return listCategoryFolders(getResourcesDir()).filter((c) => {
                try { return fs.statSync(path.join(getResourcesDir(), c)).isDirectory(); } catch { return false; }
            });
        } catch {
            return [...CODEX_CATEGORIES];
        }
    }

    function getCounts(): CodexCounts {
        const counts: CodexCounts = {
            languages: 0, libraries: 0, frameworks: 0, engines: 0, runtimes: 0,
            tools: 0, "servers-and-containers": 0, database: 0, os: 0,
            "file-formats": 0, "ui-ux": 0,
            topLevel: 0, total: 0,
        };
        // Top-level guidance files at the codex root.
        counts.topLevel = listMarkdownNames(getRoot()).length;
        const resourcesDir = getResourcesDir();
        // Known categories report into their named fields (recursive: nested
        // topics count towards their top-level category); extra folders added
        // in future count towards the total only.
        let allFolders = 0;
        for (const cat of listCategoryFolders(resourcesDir)) {
            const n = listMarkdownRecursive(path.join(resourcesDir, cat), resourcesDir).length;
            allFolders += n;
            if ((CODEX_CATEGORIES as readonly string[]).includes(cat)) {
                counts[cat as CodexCategory] = n;
            }
        }
        counts.total = counts.topLevel + allFolders;
        return counts;
    }

    /** Sum of category docs (excludes topLevel guidance + the
     *  generated resource list). Computed directly from the
     *  resources dir walk so adding a new category grows the
     *  total automatically (no enumeration of fixed fields). */
    function getCategoryCount(): number {
        const resourcesDir = getResourcesDir();
        let n = 0;
        for (const cat of listCategoryFolders(resourcesDir)) {
            n += listMarkdownRecursive(path.join(resourcesDir, cat), resourcesDir).length;
        }
        // Loose root-level topics (eg documentation-and-planning.md) count too;
        // the generated list itself does not.
        n += listMarkdownNames(resourcesDir).filter((name) => name !== "codex-resource-list.md").length;
        return n;
    }

    /**
     * Kill a spawned child AND its entire process tree. On Windows
     * `child.kill()` only kills the direct child, so a stalled Node
     * that has spawned its own subprocess would survive; we use
     * `taskkill /T /F` for the whole tree. On POSIX, the child is
     * a process-group leader (we spawn it detached when we care),
     * and `process.kill(-pid, "SIGKILL")` kills the whole group.
     */
    function killTree(child: ReturnType<typeof spawn>): void {
        if (child.pid == null) {
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
            return;
        }
        if (process.platform === "win32") {
            try {
                spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                    stdio: "ignore",
                    windowsHide: true,
                });
            } catch {
                try { child.kill("SIGKILL"); } catch { /* ignore */ }
            }
        } else {
            try { process.kill(-child.pid, "SIGKILL"); }
            catch { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
        }
    }

    function runSyncScript(): Promise<void> {
        return new Promise<void>((resolve) => {
            try {
                const scriptPath = path.join(
                    getPackageRoot(), "extensions", "aftc-toolset", "aftc-codex",
                    "scripts", "sync-codex-resources.mjs",
                );
                if (!fs.existsSync(scriptPath)) {
                    resolve();
                    return;
                }
                // M-M9: try `node`, fall back to the current executable. Arg array,
                // no shell, so spaces in the path are safe.
                const nodeExe = process.platform === "win32" ? "node.exe" : "node";
                const child = spawn(nodeExe, [scriptPath], {
                    stdio: "ignore",
                    env: process.env,
                });
                const fallback = setTimeout(() => {
                    killTree(child);
                    resolve();
                }, 10_000);
                fallback.unref(); // do not keep the parent alive if pi exits
                child.on("error", () => {
                    // `node` not on PATH — retry with the running executable.
                    clearTimeout(fallback);
                    try {
                        const retry = spawn(process.execPath, [scriptPath], {
                            stdio: "ignore",
                            env: process.env,
                        });
                        retry.on("error", () => resolve());
                        retry.on("close", () => resolve());
                    } catch {
                        resolve();
                    }
                });
                child.on("close", () => {
                    clearTimeout(fallback);
                    resolve();
                });
            } catch (err) {
                aftcConsole.logError(`[aftc-toolset] codex sync spawn error: ${(err as Error).message}`);
                resolve();
            }
        });
    }

    return {
        getRoot,
        getResourcesDir,
        getSeedDir,
        isSeeded,
        seed,
        ensureSeeded,
        readResource,
        listTopics,
        listTopicPaths,
        readRules,
        readSeedRules,
        readGuidance,
        readList,
        listCategories,
        getCounts,
        getCategoryCount,
        runSyncScript,
    };
}

/** Read the package.json version ("" when unreadable). */
export function readPackageVersion(): string {
    try {
        const pkgPath = path.join(getPackageRoot(), "package.json");
        const raw = fs.readFileSync(pkgPath, "utf8");
        const parsed = JSON.parse(raw) as { version?: unknown };
        return typeof parsed.version === "string" ? parsed.version : "";
    } catch {
        return "";
    }
}
