/**
 * pi-aftc-toolset / run-script — reliable large-script execution.
 *
 * WHY THIS EXISTS
 * pi's built-in `bash` tool feeds an inline command to the shell through
 * standard input and, for a large command (a few KB+), silently truncates
 * it: the first part runs, everything after the cut does NOT, and no error
 * is reported (partial execution). This is an upstream pi bug (reported).
 *
 * `run_script` works around it: the model passes the whole script BODY as a
 * parameter, this tool writes it to a temporary file and runs `bash <file>`.
 * The only inline command is the tiny `bash /tmp/xyz.sh`, so there is NO
 * inline-size limit and nothing to truncate. The model gets the same bounded
 * output + exit code it expects from the bash tool.
 *
 * Bash-only by design (the model writes bash). On Windows it locates
 * git-bash; on Linux/mac it uses the system bash. If no bash is found it
 * errors clearly rather than running bash under some other shell.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EASY REMOVAL / DISABLE (deliberate — this is a workaround for an upstream
 * bug that pi may fix):
 *   - Disable without removing code: set `runScriptEnabled` to false in
 *     config.json (or run /run-script-off) then /reload. The tool is then
 *     fully absent from the model's tool list.
 *   - Remove entirely once pi ships a fix: delete this file +
 *     run-script.readme.md, remove the single `createRunScript(pi)` line
 *     (and its import) from index.ts, drop the `runScriptEnabled` preference
 *     from config.ts, and delete tests/run-script-check/. Nothing else
 *     references this module.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * See `run-script.readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    truncateTail,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getPreference, setPreference } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/** Default per-script timeout (seconds). The script is killed past this. */
const DEFAULT_TIMEOUT_SEC = 120;
/** Upper bound on a caller-supplied timeout (seconds) — guards against orphans. */
const MAX_TIMEOUT_SEC = 1800;

// ─────────────────────────────────────────────────────────────────────────────
// Bash resolution (cross-platform)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate a bash interpreter. Checks the common install locations first,
 * then falls back to "bash" on PATH (git-bash often adds itself to PATH).
 * Returns a path string usable with spawn(); the caller handles a spawn
 * ENOENT (no bash) with a clear error.
 */
function resolveBash(): string {
    const candidates: string[] = [];
    if (process.platform === "win32") {
        const pf = process.env.ProgramFiles || "C:\\Program Files";
        const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        const local = process.env.LOCALAPPDATA || "";
        candidates.push(
            path.join(pf, "Git", "bin", "bash.exe"),
            path.join(pf86, "Git", "bin", "bash.exe"),
        );
        if (local) candidates.push(path.join(local, "Programs", "Git", "bin", "bash.exe"));
    } else {
        candidates.push("/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash");
    }
    for (const c of candidates) {
        try {
            if (c && fs.existsSync(c)) return c;
        } catch {
            // ignore and try the next candidate
        }
    }
    // Fall back to PATH resolution by spawn.
    return "bash";
}

/** Strip a leading '@' some models prepend to path arguments. */
function cleanPath(p: string): string {
    return p.startsWith("@") ? p.slice(1) : p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Script execution
// ─────────────────────────────────────────────────────────────────────────────

interface RunResult {
    output: string;
    exitCode: number | null;
    timedOut: boolean;
}

/**
 * Write `script` to a temp file and run it with bash. Combines stdout and
 * stderr into one stream (like the bash tool). Enforces a timeout and honours
 * an abort signal. Always removes the temp script file.
 */
function runScriptFile(
    bashPath: string,
    script: string,
    cwd: string,
    timeoutSec: number,
    signal: AbortSignal | undefined,
): Promise<RunResult> {
    const tmpFile = path.join(os.tmpdir(), `aftc-run-script-${randomUUID()}.sh`);
    fs.writeFileSync(tmpFile, script, "utf8");
    // git-bash on Windows accepts a forward-slash path reliably.
    const bashArg = process.platform === "win32" ? tmpFile.replace(/\\/g, "/") : tmpFile;

    return new Promise<RunResult>((resolve, reject) => {
        let output = "";
        let settled = false;
        let timedOut = false;
        let exitCode: number | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = (): void => {
            if (timer) clearTimeout(timer);
            if (graceTimer) clearTimeout(graceTimer);
            try { fs.unlinkSync(tmpFile); } catch { /* ignore locked/missing */ }
        };
        const finish = (code: number | null): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ output, exitCode: code, timedOut });
        };

        let child: ReturnType<typeof spawn>;
        try {
            // detached on unix makes the child a process-group leader so a
            // timeout/abort can kill the WHOLE tree (bash + its children); on
            // Windows we use `taskkill /T` instead (see killTree).
            child = spawn(bashPath, [bashArg], {
                cwd, env: process.env, windowsHide: true,
                detached: process.platform !== "win32",
            });
        } catch (err) {
            cleanup();
            reject(new Error(`Failed to start bash (${bashPath}): ${(err as Error).message}`));
            return;
        }

        // Kill the entire process tree so a timed-out / aborted script and
        // everything it spawned actually dies. A plain child.kill() leaves
        // grandchildren (eg `sleep`) running and holding the pipes open, so
        // 'close' would wait for them instead of returning promptly.
        const killTree = (): void => {
            if (child.pid == null) {
                try { child.kill("SIGKILL"); } catch { /* ignore */ }
            } else if (process.platform === "win32") {
                try {
                    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
                } catch {
                    try { child.kill("SIGKILL"); } catch { /* ignore */ }
                }
            } else {
                try { process.kill(-child.pid, "SIGKILL"); }
                catch { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
            }
            // Safety net: if 'close' is slow to follow the kill (a grandchild
            // lingering on a pipe), resolve with what we have after a short grace.
            if (!graceTimer) graceTimer = setTimeout(() => finish(exitCode), 2000);
        };

        child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
        child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });
        child.on("error", (err: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(
                `Failed to run script with bash (${bashPath}): ${err.message}. ` +
                (process.platform === "win32" ? "Is Git for Windows (git-bash) installed?" : "Is bash installed?"),
            ));
        });
        child.on("exit", (code: number | null) => { exitCode = code; });
        child.on("close", (code: number | null) => finish(code !== null ? code : exitCode));

        timer = setTimeout(() => {
            timedOut = true;
            killTree();
        }, timeoutSec * 1000);

        if (signal) {
            const onAbort = (): void => killTree();
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator
// ─────────────────────────────────────────────────────────────────────────────

export function createRunScript(pi: ExtensionAPI): void {
    // Enable/disable commands are ALWAYS registered — they are how you turn
    // the tool back on after disabling it. The tool itself is registered
    // conditionally below so that, when disabled, it is fully absent from the
    // model's tool list (no wasted prompt tokens, no accidental calls).
    pi.registerCommand("run-script-on", {
        description: "Enable the run_script tool (reliable large-script execution). /reload to apply.",
        handler: async (_args, ctx) => {
            setPreference("runScriptEnabled", true);
            ctx.ui.notify("run_script enabled. Run /reload to apply.", "info");
        },
    });
    pi.registerCommand("run-script-off", {
        description: "Disable the run_script tool (eg if pi fixes the underlying bash bug). /reload to apply.",
        handler: async (_args, ctx) => {
            setPreference("runScriptEnabled", false);
            ctx.ui.notify("run_script disabled. Run /reload to apply.", "warning");
        },
    });

    // Disabled -> do not register the tool at all.
    if (!getPreference("runScriptEnabled", true)) return;

    pi.registerTool({
        name: "run_script",
        label: "Run Script",
        description:
            "Run a multi-line or large shell script reliably via bash. The script body is " +
            "written to a temporary file and executed with `bash <file>`, so there is NO " +
            "inline-size limit (unlike the bash tool, which silently truncates large inline " +
            "commands). Use this for any script that is multi-line or more than a couple of " +
            "kilobytes; use the bash tool for short one-liners. Returns the combined " +
            "stdout/stderr (truncated like the bash tool) and the exit code. Bash only " +
            "(git-bash on Windows).",
        promptSnippet:
            "Run a multi-line or large shell script reliably via bash (no inline-size limit)",
        promptGuidelines: [
            "Use run_script for any multi-line or large shell script — it has no inline-size limit; use the bash tool only for short one-liners.",
            "Pass the entire script as run_script's 'script' parameter; it runs with bash (git-bash on Windows) and returns the output plus exit code.",
        ],
        parameters: Type.Object({
            script: Type.String({
                description:
                    "The full bash script to run. Written to a temp file and executed with bash; no inline-size limit.",
            }),
            cwd: Type.Optional(Type.String({
                description: "Working directory to run the script in (default: the current directory).",
            })),
            timeout: Type.Optional(Type.Number({
                description:
                    `Timeout in seconds (default ${DEFAULT_TIMEOUT_SEC}, max ${MAX_TIMEOUT_SEC}). The script is killed if it runs longer.`,
            })),
        }),
        async execute(_toolCallId, params, signal) {
            const script = params.script;
            if (!script || !script.trim()) {
                throw new Error("run_script: the 'script' parameter is empty.");
            }

            const cwd = params.cwd ? path.resolve(cleanPath(params.cwd)) : process.cwd();
            if (!fs.existsSync(cwd)) {
                throw new Error(`run_script: working directory does not exist: ${cwd}`);
            }

            const timeoutSec = (typeof params.timeout === "number" && params.timeout > 0)
                ? Math.min(params.timeout, MAX_TIMEOUT_SEC)
                : DEFAULT_TIMEOUT_SEC;

            const bashPath = resolveBash();
            const result = await runScriptFile(bashPath, script, cwd, timeoutSec, signal);

            const truncation = truncateTail(result.output, {
                maxLines: DEFAULT_MAX_LINES,
                maxBytes: DEFAULT_MAX_BYTES,
            });

            let text = truncation.content;
            const footer: string[] = [];
            if (truncation.truncated) {
                // Save the full output so it can be inspected (mirrors the bash tool).
                let fullOut = "";
                try {
                    const outFile = path.join(os.tmpdir(), `aftc-run-script-out-${randomUUID()}.log`);
                    fs.writeFileSync(outFile, result.output, "utf8");
                    fullOut = ` Full output: ${outFile}`;
                } catch {
                    fullOut = "";
                }
                footer.push(
                    `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines` +
                    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).${fullOut}]`,
                );
            }
            if (result.timedOut) footer.push(`[Timed out after ${timeoutSec}s; process killed.]`);
            if (signal?.aborted) footer.push("[Aborted.]");
            footer.push(`[exit code: ${result.exitCode === null ? "(none)" : result.exitCode}]`);
            text = (text ? text + "\n" : "") + footer.join("\n");

            return {
                content: [{ type: "text", text }],
                details: {
                    exitCode: result.exitCode,
                    truncated: truncation.truncated,
                    timedOut: result.timedOut,
                },
            };
        },
    });
}
