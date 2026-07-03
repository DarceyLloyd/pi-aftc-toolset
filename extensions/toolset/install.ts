/**
 * pi-aftc-toolset — dependency installer feature module.
 *
 * Owns two responsibilities:
 *   1. `/aftc-install` command — runs `npm install` in the package root
 *      to fetch optional runtime dependencies (currently better-sqlite3,
 *      required for per-turn SQLite recording and /usage-report).
 *   2. `session_start` check — emits a single notification if
 *      better-sqlite3 is not loadable, pointing the user at
 *      /aftc-install. Runs once per session.
 *
 * Why this exists:
 *   `pi install <package>` does NOT run `npm install` for runtime
 *   dependencies. better-sqlite3 has a native binding so a real
 *   npm install is unavoidable — but the user shouldn't have to
 *   leave pi and run it by hand. /aftc-install does it from inside
 *   the TUI, in the correct directory.
 *
 * Package-root discovery:
 *   We walk up from this file's directory until we find a
 *   package.json. This works whether the package is installed
 *   globally (~/.pi/agent/git/...) or project-locally (.pi/...),
 *   because jiti sets __dirname to the file's actual disk
 *   location in both cases.
 *
 * Per rules.md §1.5, this is a self-contained feature module: it
 * owns no shared state with other feature modules and is wired
 * into pi by the orchestrator in index.ts.
 *
 * See `install.readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Generous: source build of better-sqlite3 can take 1-2 min on Windows; prebuilt is ~10s. */
const NPM_INSTALL_TIMEOUT_MS = 300_000; // 5 min

/** Cap on walking up to find package.json — protects against weird FS layouts. */
const MAX_PARENT_WALK = 8;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Walk up from startDir until we find a package.json. Returns the
 * directory containing package.json, or null if not found within
 * MAX_PARENT_WALK levels.
 */
function findPackageRoot(startDir: string): string | null {
    let dir = startDir;
    for (let i = 0; i < MAX_PARENT_WALK; i++) {
        if (fs.existsSync(path.join(dir, "package.json"))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
    return null;
}

/**
 * True if better-sqlite3 is resolvable from this process (i.e. it
 * is installed in some node_modules on the resolution path). Does
 * NOT actually load the module — just checks resolution.
 */
function isBetterSqliteInstalled(): boolean {
    try {
        require.resolve("better-sqlite3");
        return true;
    } catch {
        return false;
    }
}

// -----------------------------------------------------------------------------
// Python / SSH GUI helpers
// -----------------------------------------------------------------------------

/** Timeout for uv sync (Python download + PyQt6 install can take a while). */
const UV_SYNC_TIMEOUT_MS = 600_000; // 10 min

/** Max dirs to walk when looking for internal-python-gui. */
const MAX_GUI_WALK = 8;

/**
 * Walk up from startDir until we find internal-python-gui/.
 * Returns the absolute path, or null.
 */
function findGuiDir(startDir: string): string | null {
    let dir = startDir;
    for (let i = 0; i < MAX_GUI_WALK; i++) {
        const candidate = path.join(dir, "internal-python-gui");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
    return null;
}

/**
 * Resolve the uv executable. Prefer the bundled copy in
 * internal-python-gui/bin/uv.exe, fall back to system uv.
 * Returns the command (absolute path or "uv") or null if unavailable.
 */
function resolveUv(guiDir: string): string | null {
    const bundled = path.join(guiDir, "bin", "uv.exe");
    if (fs.existsSync(bundled)) return bundled;
    try {
        execSync("uv --version", { stdio: "pipe" });
        return "uv";
    } catch {
        return null;
    }
}

/**
 * True if the Python venv exists and PyQt6 is importable.
 */
function isPythonGuiReady(guiDir: string): boolean {
    const pythonExe = path.join(guiDir, ".venv", "Scripts", "python.exe");
    if (!fs.existsSync(pythonExe)) return false;
    try {
        execSync(`"${pythonExe}" -c "import PyQt6"`, { stdio: "pipe", timeout: 15_000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Download uv.exe from GitHub releases into internal-python-gui/bin/.
 * Returns true on success.
 */
async function downloadUvExe(guiDir: string): Promise<boolean> {
    const url = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.exe";
    const destDir = path.join(guiDir, "bin");
    const dest = path.join(destDir, "uv.exe");
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(dest, buf);
        return true;
    } catch {
        return false;
    }
}

// -----------------------------------------------------------------------------
// InstallModule
// -----------------------------------------------------------------------------

class InstallModule {
    /** Tracks whether the load-time warning has fired this session. */
    private warnedThisSession = false;

    constructor(private pi: ExtensionAPI) {}

    attach(): void {
        this.registerCommands();
        this.registerSessionStart();
    }

    /**
     * One-time notification on session_start if better-sqlite3 is
     * missing. Skipped if already installed or already warned in
     * this session (guards against /reload re-firing it).
     */
    private registerSessionStart(): void {
        this.pi.on("session_start", async (_event, ctx) => {
            if (this.warnedThisSession) return;
            if (isBetterSqliteInstalled()) return;
            this.warnedThisSession = true;
            ctx.ui.notify?.(
                "pi-aftc-toolset: runtime deps may be missing — run /aftc-install to install better-sqlite3 and Python SSH GUI deps",
                "warning",
            );
        });
    }

    private registerCommands(): void {
        this.pi.registerCommand("aftc-install", {
            description: "Install missing runtime dependencies — better-sqlite3 (npm) and Python SSH GUI deps (uv sync)",
            handler: async (_args: string, ctx: ExtensionCommandContext) => this.runInstall(ctx),
        });
    }

    private async runInstall(ctx: ExtensionContext): Promise<void> {
        // 1. Resolve the package root and GUI dir.
        const here = __dirname;
        const packageRoot = findPackageRoot(here);
        if (!packageRoot) {
            ctx.ui.notify?.(
                `Could not locate package.json by walking up from ${here}.`,
                "error",
            );
            return;
        }

        const guiDir = findGuiDir(here);

        // 2. Assess what's missing.
        const npmOk = isBetterSqliteInstalled();
        const pythonOk = guiDir ? isPythonGuiReady(guiDir) : false;

        if (npmOk && pythonOk) {
            ctx.ui.notify?.(
                "All dependencies are installed (better-sqlite3 + Python GUI).",
                "info",
            );
            return;
        }

        // 3. Summarise and confirm.
        const missing: string[] = [];
        if (!npmOk) missing.push("• better-sqlite3 (npm install)");
        if (!pythonOk) missing.push("• Python GUI deps — PyQt6, Flask, paramiko (uv sync)");

        if (ctx.hasUI) {
            const ok = await ctx.ui.confirm(
                "Install missing dependencies",
                `The following are missing:\n\n${missing.join("\n")}\n\n` +
                `Package root: ${packageRoot}\n` +
                (guiDir ? `GUI dir:      ${guiDir}\n` : "") +
                `\nProceed with install?`,
            );
            if (!ok) return;
        }

        // 4. Install npm deps if needed.
        if (!npmOk) {
            await this.installNpmDeps(ctx, packageRoot);
        }

        // 5. Install Python deps if needed.
        if (!pythonOk && guiDir) {
            await this.installPythonDeps(ctx, guiDir);
        }

        // 6. Final summary.
        const npmFinal = isBetterSqliteInstalled();
        const pythonFinal = guiDir ? isPythonGuiReady(guiDir) : false;
        const lines: string[] = ["Install complete:", ""];
        lines.push(`  better-sqlite3:    ${npmFinal ? "✓" : "✗"}`);
        lines.push(`  Python GUI deps:   ${pythonFinal ? "✓" : "✗"}`);
        lines.push("");
        if (npmFinal && !npmOk) {
            lines.push("Run /reload to load the newly installed better-sqlite3 module.");
        }
        if (pythonFinal && !pythonOk) {
            lines.push("Python GUI is ready — SSH tools will auto-launch it when needed.");
        }
        await this.showDialog(ctx, "Install complete", lines);
    }

    /** Run npm install for Node.js deps. */
    private async installNpmDeps(ctx: ExtensionContext, cwd: string): Promise<void> {
        const args = ["install", "--no-audit", "--no-fund"];
        const cmdPreview = `npm ${args.join(" ")}`;
        ctx.ui.notify?.(`Running ${cmdPreview} in ${cwd}…`, "info");

        let result: { stdout: string; stderr: string; code: number; killed: boolean };
        try {
            result = await this.pi.exec("npm", args, {
                cwd,
                timeout: NPM_INSTALL_TIMEOUT_MS,
            });
        } catch (err) {
            ctx.ui.notify?.(`✗ Failed to spawn npm: ${(err as Error).message}`, "error");
            return;
        }

        if (result.code !== 0) {
            const output = (result.stderr || result.stdout || "(no output)")
                .split("\n").filter((l) => l.length > 0).slice(-15).join("\n");
            ctx.ui.notify?.(`✗ npm install failed (code ${result.code}): ${output}`, "error");
        }
    }

    /** Run uv sync for Python deps, downloading uv.exe first if needed. */
    private async installPythonDeps(ctx: ExtensionContext, guiDir: string): Promise<void> {
        // Resolve uv, downloading bundled copy if neither local nor system uv exists.
        let uvExe = resolveUv(guiDir);
        if (!uvExe) {
            ctx.ui.notify?.("uv not found — downloading bundled uv.exe…", "info");
            const downloaded = await downloadUvExe(guiDir);
            if (!downloaded) {
                ctx.ui.notify?.("✗ Failed to download uv.exe. Check network and try again.", "error");
                return;
            }
            uvExe = resolveUv(guiDir);
            if (!uvExe) {
                ctx.ui.notify?.("✗ Downloaded uv.exe but still cannot resolve it.", "error");
                return;
            }
            ctx.ui.notify?.("uv.exe downloaded successfully.", "info");
        }

        ctx.ui.notify?.(`Running uv sync in ${guiDir}…`, "info");

        let result: { stdout: string; stderr: string; code: number; killed: boolean };
        try {
            result = await this.pi.exec(uvExe, ["sync"], {
                cwd: guiDir,
                timeout: UV_SYNC_TIMEOUT_MS,
            });
        } catch (err) {
            ctx.ui.notify?.(`✗ Failed to spawn uv: ${(err as Error).message}`, "error");
            return;
        }

        if (result.code !== 0) {
            const output = (result.stderr || result.stdout || "(no output)")
                .split("\n").filter((l) => l.length > 0).slice(-15).join("\n");
            ctx.ui.notify?.(`✗ uv sync failed (code ${result.code}): ${output}`, "error");
        }
    }

    /**
     * Show a scrollable dialog if UI is available, otherwise fall back
     * to console (headless / print mode).
     */
    private async showDialog(
        ctx: ExtensionContext,
        title: string,
        lines: string[],
    ): Promise<void> {
        if (ctx.hasUI) {
            await ctx.ui.select(title, lines, { timeout: 60000 });
        } else {
            for (const line of lines) console.log(`[aftc-toolset] ${line}`);
        }
    }
}

// -----------------------------------------------------------------------------
// Public factory — the orchestrator (index.ts) calls this. InstallModule
// is independent (doesn't need to be passed to other modules); it just
// needs to be instantiated so its /aftc-install command and session_start
// handler register.
// -----------------------------------------------------------------------------

export function createInstallModule(pi: ExtensionAPI): InstallModule {
    const m = new InstallModule(pi);
    m.attach();
    return m;
}