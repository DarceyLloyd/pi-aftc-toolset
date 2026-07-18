import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { verifySshCarrierReady } from "./ssh/carrier";
import { showConfirm, showViewer } from "./ui/aftcUi";

const NPM_INSTALL_TIMEOUT_MS = 300_000;
const UV_SYNC_TIMEOUT_MS = 600_000;
const UV_CHECK_TIMEOUT_MS = 30_000;
const MAX_PARENT_WALK = 8;

interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
}

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

function findCarrierDir(startDir: string): string | null {
    const packageRoot = findPackageRoot(startDir);
    if (!packageRoot) return null;
    const carrierDir = path.join(packageRoot, "extensions", "aftc-toolset", "ssh", "carrier");
    return fs.existsSync(path.join(carrierDir, "pyproject.toml")) ? carrierDir : null;
}

function isDependencyInstalled(name: string): boolean {
    try {
        require.resolve(name);
        return true;
    } catch {
        return false;
    }
}

/** Read the runtime dependency names from the package's own package.json. */
function readPackageDependencyNames(startDir: string): string[] {
    const packageRoot = findPackageRoot(startDir);
    if (!packageRoot) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { dependencies?: unknown };
        if (!parsed.dependencies || typeof parsed.dependencies !== "object") return [];
        return Object.keys(parsed.dependencies);
    } catch {
        return [];
    }
}

class InstallModule {
    private warnedThisSession = false;
    private installPromise: Promise<void> | undefined;

    constructor(private readonly pi: ExtensionAPI) {}

    public attach(): void {
        this.registerCommands();
        this.registerSessionStart();
    }

    private registerSessionStart(): void {
        this.pi.on("session_start", async (_event, ctx) => {
            if (this.warnedThisSession) return;
            this.warnedThisSession = true;
            const missing = await this.findMissingRuntimeDependencies();
            // Intelligent gate: stay silent when every runtime dependency
            // (npm deps + the SSH carrier Python env) is already installed.
            if (missing.length === 0) return;
            ctx.ui.notify?.(
                `pi-aftc-toolset: runtime dependencies may be missing (${missing.join(", ")}) - run /aftc-install.`,
                "warning",
            );
        });
    }

    /**
     * Detect what is actually missing: every dependency declared in
     * package.json (resolvable via require.resolve) plus the packaged SSH
     * carrier's Python environment (uv present AND the locked env synced,
     * checked with `uv run --no-sync` so the probe never installs anything).
     */
    private async findMissingRuntimeDependencies(): Promise<string[]> {
        const missing = readPackageDependencyNames(__dirname).filter((name) => !isDependencyInstalled(name));
        if (!await this.isCarrierEnvReady()) {
            missing.push("SSH carrier Python environment");
        }
        return missing;
    }

    private async isCarrierEnvReady(): Promise<boolean> {
        const carrierDir = findCarrierDir(__dirname);
        if (!carrierDir) return false;
        const uvExecutable = await this.resolveUv(carrierDir);
        if (!uvExecutable) return false;
        try {
            // --no-sync: the probe must never trigger an install; the import
            // fails when the environment is missing or out of date.
            const result = await this.pi.exec(
                uvExecutable,
                ["run", "--no-sync", "--project", carrierDir, "python", "-c", "import paramiko, aftc_ssh_carrier"],
                { cwd: carrierDir, timeout: UV_CHECK_TIMEOUT_MS },
            ) as ExecResult;
            return result.code === 0;
        } catch {
            return false;
        }
    }

    private registerCommands(): void {
        this.pi.registerCommand("aftc-install", {
            description: "Install better-sqlite3 and the packaged SSH carrier dependencies.",
            handler: async (_args: string, ctx: ExtensionCommandContext) => {
                if (this.installPromise) {
                    ctx.ui.notify?.("Dependency installation is already in progress.", "info");
                    await this.installPromise;
                    return;
                }

                this.installPromise = this.runInstall(ctx).finally(() => {
                    this.installPromise = undefined;
                });
                await this.installPromise;
            },
        });
    }

    private async runInstall(ctx: ExtensionContext): Promise<void> {
        const packageRoot = findPackageRoot(__dirname);
        const carrierDir = findCarrierDir(__dirname);
        if (!packageRoot || !carrierDir) {
            ctx.ui.notify?.(
                "The packaged SSH carrier could not be located. Reinstall pi-aftc-toolset and try again.",
                "error",
            );
            return;
        }

        const npmInstalled = isDependencyInstalled("better-sqlite3");
        const uvExecutable = await this.resolveUv(carrierDir);
        const pythonAvailable = uvExecutable ? await this.resolvePython() : false;
        const missing = [
            ...(!npmInstalled ? ["- better-sqlite3"] : []),
            ...(uvExecutable ? [] : ["- uv (required for the packaged SSH carrier)"]),
            ...(!pythonAvailable && uvExecutable ? ["- Python (required by the packaged SSH carrier)"] : []),
            "- packaged SSH carrier environment verification",
        ];

        if (ctx.hasUI) {
            const confirmed = await showConfirm(ctx, {
                title: "Install runtime dependencies",
                body: `${missing.join("\n")}\n\nThis runs npm install and uv sync --locked in the installed package. Continue?`,
            });
            if (!confirmed) return;
        }

        if (!npmInstalled) await this.installNpmDeps(ctx, packageRoot);
        if (!uvExecutable) {
            ctx.ui.notify?.(this.uvInstallGuidance(), "error");
            await this.showDialog(ctx, "Dependency install", ["better-sqlite3 installation was attempted.", "", this.uvInstallGuidance()]);
            return;
        }
        if (!pythonAvailable) {
            const pythonGuidance = this.pythonInstallGuidance();
            ctx.ui.notify?.(pythonGuidance, "error");
            await this.showDialog(ctx, "Dependency install", ["better-sqlite3 installation was attempted.", "", pythonGuidance]);
            return;
        }

        const carrierInstalled = await this.installCarrierDeps(ctx, carrierDir, uvExecutable);
        const npmFinal = isDependencyInstalled("better-sqlite3");
        const lines = [
            "Install complete:",
            "",
            `  better-sqlite3: ${npmFinal ? "ready" : "not ready"}`,
            `  Python:         ${pythonAvailable ? "ready" : "not ready"}`,
            `  SSH carrier:    ${carrierInstalled ? "ready" : "not ready"}`,
            "",
        ];
        if (npmFinal && !npmInstalled) lines.push("Run /reload to load better-sqlite3.");
        if (!carrierInstalled) lines.push("Review the safe error above, then run /aftc-install again.");
        await this.showDialog(ctx, "Dependency install", lines);
    }

    private async resolveUv(carrierDir: string): Promise<string | null> {
        const executableName = process.platform === "win32" ? "uv.exe" : "uv";
        const bundled = path.join(carrierDir, "bin", executableName);
        const candidates = fs.existsSync(bundled) ? [bundled, executableName] : [executableName];

        for (const candidate of candidates) {
            try {
                const result = await this.pi.exec(candidate, ["--version"], {
                    cwd: carrierDir,
                    timeout: UV_CHECK_TIMEOUT_MS,
                }) as ExecResult;
                if (result.code === 0) return candidate;
            } catch {
                // Try the next portable candidate.
            }
        }
        return null;
    }

    private uvInstallGuidance(): string {
        if (process.platform === "win32") {
            return "uv was not found. Install uv for Windows, restart Pi, then run /aftc-install again.";
        }
        if (process.platform === "darwin") {
            return "uv was not found. Install uv for macOS, restart Pi, then run /aftc-install again.";
        }
        return "uv was not found. Install uv for Linux, restart Pi, then run /aftc-install again.";
    }

    private async resolvePython(): Promise<boolean> {
        const candidates = process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
        for (const candidate of candidates) {
            try {
                const result = await this.pi.exec(candidate, ["--version"], {
                    timeout: UV_CHECK_TIMEOUT_MS,
                }) as ExecResult;
                if (result.code === 0) return true;
            } catch {
                // Try the next interpreter candidate.
            }
        }
        return false;
    }

    private pythonInstallGuidance(): string {
        if (process.platform === "win32") {
            return "Python was not found. Install Python 3 for Windows, restart Pi, then run /aftc-install again.";
        }
        if (process.platform === "darwin") {
            return "Python was not found. Install Python 3 for macOS, restart Pi, then run /aftc-install again.";
        }
        return "Python was not found. Install python3 for Linux, restart Pi, then run /aftc-install again.";
    }

    private async installNpmDeps(ctx: ExtensionContext, cwd: string): Promise<void> {
        ctx.ui.notify?.("Installing Node.js runtime dependencies...", "info");
        try {
            const result = await this.pi.exec("npm", ["install", "--no-audit", "--no-fund"], {
                cwd,
                timeout: NPM_INSTALL_TIMEOUT_MS,
            }) as ExecResult;
            if (result.code !== 0) {
                ctx.ui.notify?.("npm install failed. Ensure Node.js and npm are installed, then run /aftc-install again.", "error");
            }
        } catch {
            ctx.ui.notify?.("npm could not be started. Ensure Node.js and npm are installed.", "error");
        }
    }

    private async installCarrierDeps(ctx: ExtensionContext, carrierDir: string, uvExecutable: string): Promise<boolean> {
        ctx.ui.notify?.("Installing packaged SSH carrier dependencies...", "info");
        try {
            const sync = await this.pi.exec(uvExecutable, ["sync", "--locked"], {
                cwd: carrierDir,
                timeout: UV_SYNC_TIMEOUT_MS,
            }) as ExecResult;
            if (sync.code !== 0) {
                ctx.ui.notify?.("SSH carrier install failed. Check uv and Python, then run /aftc-install again.", "error");
                return false;
            }

            // An import-only check can pass while the stdio carrier cannot
            // start. Verify the same ready handshake used by the runtime.
            await verifySshCarrierReady();
            return true;
        } catch {
            ctx.ui.notify?.("The SSH carrier could not be started. Check uv and Python, then run /aftc-install again.", "error");
            return false;
        }
    }

    private async showDialog(ctx: ExtensionContext, title: string, lines: string[]): Promise<void> {
        if (ctx.hasUI) {
            await showViewer(ctx, { title, lines });
            return;
        }
        for (const line of lines) console.log(`[aftc-toolset] ${line}`);
    }
}

export function createInstallModule(pi: ExtensionAPI): InstallModule {
    const module = new InstallModule(pi);
    module.attach();
    return module;
}
