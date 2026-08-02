/**
 * pi-aftc-toolset / aftc-codex — project technology auto-detection (spec D5).
 *
 * Scans a working directory and maps signals to codex topic docs:
 *   - file extensions  (.ts -> typescript, .cpp -> cpp, .cs -> cs, .razor -> blazor,
 *                       .sh -> bash, .bat -> batch, .rs -> rs, ...)
 *   - package.json deps (three -> threejs, chart.js -> chartjs, electron, shoelace, ...)
 *     + scripts keys/values ("dev": "vite", "start": "bun run ...")
 *     — EVERY package.json in the bounded walk is parsed, not just the root one
 *   - marker files     (Dockerfile -> docker, deno.json -> deno, nginx.conf -> nginx,
 *                       CMakeLists.txt -> cmake, Cargo.toml -> rs, *.sln -> cs, ...)
 *   - marker dirs      (aftc-framework/ -> aftc-framework)
 *   - CONTENT scan     (bounded, small files only): *.csproj -> blazor/dotnet-maui,
 *                       CMakeLists.txt -> juce, docker-compose -> mysql/nginx images
 *   - AUTO-INJECT docs (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md,
 *                       GEMINI.md, .cursorrules, .windsurfrules):
 *                       the marked <!-- AFTC-CODEX-STACK topics: ... --> block
 *                       (explicit pins) + a strict whole-word keyword scan of the
 *                       full text (stoplisted against ambiguous English words)
 *   - implied topics   (any design domain -> design-common; mysql -> database-common)
 *
 * Results split in two: `topics` (a live resource exists — loadable) and
 * `missing` (mapped but no resource file yet — the model may bootstrap one with
 * codex_add_entry). Detection itself never touches the cached system-prompt
 * prefix (session-specific data stays out of it). Cached per cwd for the
 * session. Bounded walk: skips heavy dirs, caps depth + files visited (spec M-M3).
 *
 * See `codex-detect-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CodexContext, CodexDetectResult } from "./aftc-codex";

// ─────────────────────────────────────────────────────────────────────────────
// Signal maps
// ─────────────────────────────────────────────────────────────────────────────

/** File extension (lowercase, no dot) -> topic name. Topic names are the
 *  resource file basenames (extension-style: cs.md, rs.md, cpp.md). */
const EXT_MAP: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    py: "python", pyw: "python",
    php: "php",
    gd: "godot",
    pine: "pinescript",
    css: "css", scss: "scss", sass: "scss", less: "css",
    html: "html", htm: "html",
    ps1: "powershell", psm1: "powershell",
    vue: "vue",
    go: "go",
    // C++ (.h mapped to cpp — no plain-C resource; the grep hook forgives).
    cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp",
    hpp: "cpp", hh: "cpp", hxx: "cpp", h: "cpp",
    // .NET / C#.
    cs: "cs", csx: "cs", sln: "cs", csproj: "cs",
    razor: "blazor",
    // Shells / scripting.
    sh: "bash", bash: "bash",
    bat: "batch", cmd: "batch",
    // New-language resources (uncreated until their first entry — see `missing`).
    rs: "rs",
    java: "java",
    twig: "twig",
    // Misc tools by file type.
    wxs: "wix", wixproj: "wix",
    jucer: "juce",
};

/** package.json dependency name (or prefix) -> topic name. */
const DEP_MAP: Array<[string, string]> = [
    ["three", "threejs"],
    ["chart.js", "chartjs"],
    ["gsap", "gsap"],
    ["puppeteer", "puppeteer"],
    ["vite", "vite"],
    ["gradio", "gradio"],
    ["torch", "pytorch"],
    ["pytorch", "pytorch"],
    ["webpack", "webpack"],
    ["electron", "electron"],
    ["@shoelace-style/shoelace", "shoelace"],
];

/** Marker file name (lowercase) -> topic name(s). */
const MARKER_MAP: Record<string, string[]> = {
    "dockerfile": ["docker"],
    "docker-compose.yml": ["docker"],
    "docker-compose.yaml": ["docker"],
    "compose.yml": ["docker"],
    "compose.yaml": ["docker"],
    "composer.json": ["php", "composer"],
    "pyproject.toml": ["python"],
    "requirements.txt": ["python"],
    "project.godot": ["godot"],
    "webpack.config.js": ["webpack"],
    "webpack.config.ts": ["webpack"],
    "vite.config.js": ["vite"],
    "vite.config.ts": ["vite"],
    "bunfig.toml": ["bun"],
    "bun.lockb": ["bun"],
    "bun.lock": ["bun"],
    "deno.json": ["deno"],
    "deno.jsonc": ["deno"],
    "nginx.conf": ["nginx"],
    ".htaccess": ["apache"],
    "cmakelists.txt": ["cmake"],
    "cargo.toml": ["rs"],
    "pom.xml": ["java"],
    "build.gradle": ["java"],
    "build.gradle.kts": ["java"],
};

/** Directory name (lowercase) -> topic name(s). Presence of the dir is the signal. */
const DIR_MAP: Record<string, string[]> = {
    "aftc-framework": ["aftc-framework"],
};

/** Content scan of SMALL marker files (<= CONTENT_SCAN_MAX_BYTES): file name or
 *  extension -> [word regex, topic]. Reads are capped (CONTENT_SCAN_MAX_FILES). */
const CONTENT_SCAN_BY_NAME: Record<string, Array<[RegExp, string]>> = {
    "cmakelists.txt": [[/\bjuce/i, "juce"]],
    "docker-compose.yml": [[/\bmysql\b/i, "mysql"], [/\bnginx\b/i, "nginx"]],
    "docker-compose.yaml": [[/\bmysql\b/i, "mysql"], [/\bnginx\b/i, "nginx"]],
    "compose.yml": [[/\bmysql\b/i, "mysql"], [/\bnginx\b/i, "nginx"]],
    "compose.yaml": [[/\bmysql\b/i, "mysql"], [/\bnginx\b/i, "nginx"]],
};
const CONTENT_SCAN_BY_EXT: Record<string, Array<[RegExp, string]>> = {
    csproj: [[/blazor/i, "blazor"], [/maui/i, "dotnet-maui"]],
};
const CONTENT_SCAN_MAX_BYTES = 64 * 1024;
const CONTENT_SCAN_MAX_FILES = 24;

/** Recognised coding-agent auto-inject docs (root, plus .github/). The marked
 *  stack block is unioned across ALL of them; the keyword scan reads the same
 *  set. Lowercase names; directories are NOT walked for these. */
const AUTO_INJECT_FILES = [
    "agents.md",
    "claude.md",
    "gemini.md",
    ".cursorrules",
    ".windsurfrules",
    path.join(".github", "copilot-instructions.md"),
];
const AUTO_INJECT_MAX_BYTES = 64 * 1024;

/** The marked stack block: <!-- AFTC-CODEX-STACK \n topics: a, b, c \n --> */
const STACK_BLOCK_RE = /<!--\s*AFTC-CODEX-STACK([\s\S]*?)-->/i;

/** Topic names too ambiguous for free-text keyword scanning (common English
 *  words / too short). These stay pin-able via the explicit stack block. */
const KEYWORD_STOPLIST = new Set([
    "go", "deno", "vue", "batch", "bun", "twig", "cs", "rs", "composer", "windows",
]);

/** Implied companions: detecting a specific topic implies its common resource. */
const IMPLIED_TOPICS: Record<string, string[]> = {
    "web-app": ["design-common"],
    "web-page": ["design-common"],
    "web-backend": ["design-common"],
    "desktop-app": ["design-common"],
    "desktop-web-app": ["design-common"],
    "mobile-app": ["design-common"],
    "vst-plugin": ["design-common"],
    "mysql": ["database-common"],
};

/** Tool keywords scanned in package.json scripts keys AND values (word-boundary
 *  match, so "bundle" never matches "bun"). Covers tools that appear only in
 *  run scripts (eg "dev": "vite", "build": "webpack --mode production"). */
const SCRIPT_KEYWORDS: Array<[string, string]> = [
    ["bun", "bun"],
    ["bunx", "bun"],
    ["vite", "vite"],
    ["webpack", "webpack"],
    ["node", "nodejs"],
];
const SCRIPT_KEYWORD_RES: Array<[RegExp, string]> = SCRIPT_KEYWORDS.map(
    ([kw, topic]) => [new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`), topic],
);

/** Directories never worth scanning (spec M-M3). */
const SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "out", "coverage", ".venv", "venv",
    "__pycache__", ".next", ".nuxt", ".cache", ".idea", ".vscode", ".dev", ".bak",
    ".old", "target", "vendor",
]);

/** Guidance topics already injected via the system prompt — never suggest fetching. */
const GUIDANCE_TOPICS = new Set([
    "codex-rules", "thought-and-action-guidance", "codex-resource-list", "markdown-guidance",
]);

const MAX_DEPTH = 6;
const MAX_FILES = 8000;

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/** Detection result: topics with a live resource (loadable) and mapped topics
 *  with no resource file yet (bootstrap-able via codex_add_entry). */
export interface CodexDetectApi {
    /** Detect codex topics relevant to a cwd. Cached per cwd for the session. */
    detect(cwd: string): CodexDetectResult;
    /** Drop the per-session cache (call on session_start). */
    resetCache(): void;
}

export function createCodexDetect(ctx: CodexContext): CodexDetectApi {
    const { store } = ctx;
    let cache: { cwd: string; result: CodexDetectResult } | null = null;

    function resetCache(): void {
        cache = null;
    }

    function detect(cwd: string): CodexDetectResult {
        if (cache && cache.cwd === cwd) return cache.result;
        const result = scan(cwd);
        cache = { cwd, result };
        return result;
    }

    function scan(cwd: string): CodexDetectResult {
        const found = new Set<string>();
        let visited = 0;
        let contentScanned = 0;

        const contentScan = (absPath: string, pairs: Array<[RegExp, string]>): void => {
            if (contentScanned >= CONTENT_SCAN_MAX_FILES) return;
            try {
                const stat = fs.statSync(absPath);
                if (stat.size > CONTENT_SCAN_MAX_BYTES) return;
                contentScanned++;
                const text = fs.readFileSync(absPath, "utf8");
                for (const [re, topic] of pairs) {
                    if (re.test(text)) found.add(topic);
                }
            } catch { /* best-effort */ }
        };

        // Walk for extensions + marker files (bounded).
        const walk = (dir: string, depth: number): void => {
            if (depth > MAX_DEPTH || visited >= MAX_FILES) return;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (visited >= MAX_FILES) return;
                const name = entry.name;
                const lower = name.toLowerCase();
                if (entry.isDirectory()) {
                    if (SKIP_DIRS.has(lower) || lower.startsWith(".")) continue;
                    if (DIR_MAP[lower]) for (const t of DIR_MAP[lower]) found.add(t);
                    walk(path.join(dir, name), depth + 1);
                } else if (entry.isFile()) {
                    visited++;
                    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
                    if (ext && EXT_MAP[ext]) found.add(EXT_MAP[ext]);
                    if (MARKER_MAP[lower]) for (const t of MARKER_MAP[lower]) found.add(t);
                    if (CONTENT_SCAN_BY_NAME[lower]) contentScan(path.join(dir, name), CONTENT_SCAN_BY_NAME[lower]);
                    if (ext && CONTENT_SCAN_BY_EXT[ext]) contentScan(path.join(dir, name), CONTENT_SCAN_BY_EXT[ext]);
                    // Every package.json in the tree carries deps + scripts signals.
                    if (lower === "package.json") parsePackageJson(path.join(dir, name), found);
                }
            }
        };
        // Root package.json first — guaranteed parsed even if the walk budget runs out.
        parsePackageJson(path.join(cwd, "package.json"), found);
        walk(cwd, 0);
        scanAutoInjectDocs(cwd, found);

        // Implied companions (design domain -> design-common, mysql -> database-common).
        for (const t of [...found]) {
            for (const implied of IMPLIED_TOPICS[t] ?? []) found.add(implied);
        }

        // Split: topics with a live resource vs mapped-but-uncreated.
        const available = new Set(store.listTopics());
        const topics: string[] = [];
        const missing: string[] = [];
        for (const t of found) {
            if (GUIDANCE_TOPICS.has(t)) continue;
            (available.has(t) ? topics : missing).push(t);
        }
        return { topics: topics.sort(), missing: missing.sort() };
    }

    /** Auto-inject docs: the marked AFTC-CODEX-STACK block (explicit pins) +
     *  a strict whole-word keyword scan (stoplisted). Unioned across all files. */
    function scanAutoInjectDocs(cwd: string, found: Set<string>): void {
        const texts: string[] = [];
        for (const rel of AUTO_INJECT_FILES) {
            try {
                const abs = path.join(cwd, rel);
                const stat = fs.statSync(abs);
                if (!stat.isFile() || stat.size > AUTO_INJECT_MAX_BYTES) continue;
                texts.push(fs.readFileSync(abs, "utf8"));
            } catch { /* not present — fine */ }
        }
        if (texts.length === 0) return;

        // 1. Marked blocks: <!-- AFTC-CODEX-STACK \n topics: a, b, c \n -->
        for (const text of texts) {
            for (const m of text.matchAll(new RegExp(STACK_BLOCK_RE, "gi"))) {
                const body = m[1] ?? "";
                const topicsLine = /topics:\s*(.+)/i.exec(body);
                if (!topicsLine) continue;
                for (const raw of topicsLine[1].split(/[,\s]+/)) {
                    const t = raw.trim().toLowerCase().replace(/\.md$/, "");
                    if (t) found.add(t);
                }
            }
        }

        // 2. Whole-word keyword scan against the live topic list (stoplisted).
        const available = store.listTopics()
            .filter((t) => !GUIDANCE_TOPICS.has(t) && !KEYWORD_STOPLIST.has(t));
        const fullText = texts.join("\n").toLowerCase();
        for (const topic of available) {
            const re = new RegExp(`(^|[^a-z0-9])${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
            if (re.test(fullText)) found.add(topic);
        }
    }

    /** Parse one package.json: deps + scripts + pi-manifest signals into `found`.
     *  Best-effort — unreadable/malformed files are skipped. */
    function parsePackageJson(pkgPath: string, found: Set<string>): void {
        let pkg: {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            scripts?: Record<string, unknown>;
            pi?: unknown;
            bin?: unknown;
            engines?: { node?: unknown };
        };
        try {
            if (!fs.existsSync(pkgPath)) return;
            pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        } catch {
            return; // ignore malformed package.json
        }
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        for (const dep of Object.keys(deps)) {
            const dl = dep.toLowerCase();
            for (const [key, topic] of DEP_MAP) {
                if (dl === key || dl.startsWith(key + "-") || dl.startsWith("@" + key + "/")) {
                    found.add(topic);
                }
            }
        }
        // Scripts: tools often appear ONLY here (eg "dev": "vite", "start": "bun run .").
        for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
            const text = `${name} ${typeof value === "string" ? value : ""}`.toLowerCase();
            for (const [re, topic] of SCRIPT_KEYWORD_RES) {
                if (re.test(text)) found.add(topic);
            }
        }
        // A CLI/bin or an explicit node engine implies the nodejs runtime doc.
        if (pkg.bin || pkg.engines?.node) found.add("nodejs");
        // Working on a pi extension -> pi-extension doc.
        if (pkg.pi) found.add("pi-extension");
    }

    return { detect, resetCache };
}
