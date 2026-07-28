/**
 * pi-aftc-toolset / aftc-codex — project technology auto-detection (spec D5).
 *
 * Scans a working directory and maps signals to codex topic docs:
 *   - file extensions  (.ts -> typescript, .py -> python, .gd -> godot, ...)
 *   - package.json deps (three -> threejs, chart.js -> chartjs, gsap, puppeteer, ...)
 *   - marker files     (Dockerfile -> docker, composer.json -> php+composer,
 *                       pyproject.toml -> python, project.godot -> godot, ...)
 *
 * The result is intersected with the resources actually present (store.listTopics)
 * so only fetchable docs are suggested, and the always-injected guidance files are
 * excluded (they ride the system prompt, no need to codex_load them). Cached per cwd
 * for the session. Bounded walk: skips heavy dirs (node_modules/.git/dist/.venv/
 * __pycache__/build/...), caps depth + files visited (spec M-M3) so a big tree can't
 * hang a command.
 *
 * autoLoad (aftcCodexAutoLoad) is honoured by the caller: when on, the -run marker
 * names the detected topics (step 4.2). Detection itself never touches the cached
 * system-prompt prefix (session-specific data stays out of it).
 *
 * See `codex-detect-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CodexContext } from "./aftc-codex";

// ─────────────────────────────────────────────────────────────────────────────
// Signal maps
// ─────────────────────────────────────────────────────────────────────────────

/** File extension (lowercase, no dot) -> topic name. */
const EXT_MAP: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    py: "python", pyw: "python",
    php: "php",
    gd: "godot",
    pine: "pinescript",
    css: "css", scss: "css", sass: "css", less: "css",
    html: "html", htm: "html",
    ps1: "powershell", psm1: "powershell",
    vue: "vue",
    go: "go",
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
];

/** Marker file/dir name (lowercase) -> topic name(s). */
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
};

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

export interface CodexDetectApi {
    /** Detect codex topics relevant to a cwd. Cached per cwd for the session. */
    detectTopics(cwd: string): string[];
    /** Drop the per-session cache (call on session_start). */
    resetCache(): void;
}

export function createCodexDetect(ctx: CodexContext): CodexDetectApi {
    const { store } = ctx;
    let cache: { cwd: string; topics: string[] } | null = null;

    function resetCache(): void {
        cache = null;
    }

    function detectTopics(cwd: string): string[] {
        if (cache && cache.cwd === cwd) return cache.topics;
        const topics = scan(cwd);
        cache = { cwd, topics };
        return topics;
    }

    function scan(cwd: string): string[] {
        const found = new Set<string>();
        let visited = 0;

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
                    walk(path.join(dir, name), depth + 1);
                } else if (entry.isFile()) {
                    visited++;
                    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
                    if (ext && EXT_MAP[ext]) found.add(EXT_MAP[ext]);
                    if (MARKER_MAP[lower]) for (const t of MARKER_MAP[lower]) found.add(t);
                }
            }
        };
        walk(cwd, 0);

        // Root package.json dependencies + pi-extension marker.
        try {
            const pkgPath = path.join(cwd, "package.json");
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
                    dependencies?: Record<string, string>;
                    devDependencies?: Record<string, string>;
                    pi?: unknown;
                };
                const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
                for (const dep of Object.keys(deps)) {
                    const dl = dep.toLowerCase();
                    for (const [key, topic] of DEP_MAP) {
                        if (dl === key || dl.startsWith(key + "-") || dl.startsWith("@" + key + "/")) {
                            found.add(topic);
                        }
                    }
                }
                // Working on a pi extension -> pi-extension doc.
                if (pkg.pi) found.add("pi-extension");
            }
        } catch {
            // ignore malformed package.json
        }

        // Intersect with resources actually present; drop always-injected guidance.
        const available = new Set(store.listTopics());
        const result = [...found]
            .filter((t) => !GUIDANCE_TOPICS.has(t))
            .filter((t) => available.has(t))
            .sort();
        return result;
    }

    return { detectTopics, resetCache };
}
