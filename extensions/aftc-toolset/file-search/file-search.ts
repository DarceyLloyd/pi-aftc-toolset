/**
 * pi-aftc-toolset / file search — first-class `fd` + `rg` model tools.
 *
 * Thin plain-TS wrapper over the Rust `fd` (sharkdp) and `rg`/ripgrep
 * (BurntSushi) binaries. The model shells out to the FAST, accurate,
 * cross-platform, gitignore-aware tools instead of hand-writing `find` /
 * `grep` through the bash tool — the source of most search mistakes. The
 * TypeScript here is only plumbing: binary resolution, arg building,
 * bounded output, and clear error feedback.
 *
 * LEAN by design (no Effect, no auto-download): the binary is resolved from
 * PATH (fd / fdfind, rg) with a `--version` probe; when missing the tool
 * returns a clear error with platform install hints. Every failed run flows
 * into the tool-error tracker (core.ts tool_result hook → tool_errors
 * table → the report's Errors tab) so repeated misuse is visible.
 *
 * See file-search-readme.md for the full contract.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { getPreference, setPreference } from "../config";
import { registerHelpEntry } from "../help-registry";
import * as aftcConsole from "../ui/aftc-console";
import {
    buildFdArgs,
    buildRgArgs,
    FD_MAX_DEPTH_LIMIT,
    FD_MAX_LIMIT,
    RG_MAX_CONTEXT,
    RG_MAX_COUNT_LIMIT,
    type FdToolParams,
    type RgToolParams,
} from "./file-search-args";

const EXEC_TIMEOUT_MS = 60_000;
/** In-memory capture cap per run (a firehose must not grow unbounded). */
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const STDERR_MAX_BYTES = 64 * 1024;

type SearchTool = "fd" | "rg";

// ---------------------------------------------------------------------------
// Binary resolution (lean: PATH probe, no auto-download)
// ---------------------------------------------------------------------------

let fdBinary: string | null | undefined; // undefined = not probed yet
let rgBinary: string | null | undefined;

function probe(command: string): Promise<boolean> {
    return new Promise((resolve) => {
        let child: ChildProcess;
        try {
            child = spawn(command, ["--version"], { stdio: "ignore", windowsHide: true });
        } catch {
            resolve(false);
            return;
        }
        const timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
            resolve(false);
        }, 5_000);
        timer.unref?.();
        child.once("error", () => {
            clearTimeout(timer);
            resolve(false);
        });
        child.once("exit", (code) => {
            clearTimeout(timer);
            resolve(code === 0);
        });
    });
}

export async function resolveBinary(tool: SearchTool): Promise<string | null> {
    if (tool === "fd") {
        if (fdBinary !== undefined) return fdBinary;
        const candidates = process.platform === "linux" ? ["fd", "fdfind"] : ["fd"];
        for (const c of candidates) {
            if (await probe(c)) {
                fdBinary = c;
                return c;
            }
        }
        fdBinary = null;
        return null;
    }
    if (rgBinary !== undefined) return rgBinary;
    rgBinary = (await probe("rg")) ? "rg" : null;
    return rgBinary;
}

function installHint(tool: SearchTool): string {
    if (process.platform === "win32") {
        return tool === "fd"
            ? "winget install sharkdp.fd (or scoop install fd / choco install fd)"
            : "winget install BurntSushi.ripgrep.GNU (or scoop install ripgrep / choco install ripgrep)";
    }
    if (process.platform === "darwin") return `brew install ${tool === "fd" ? "fd" : "ripgrep"}`;
    return tool === "fd" ? "apt install fd-find (then it runs as fdfind)" : "apt install ripgrep";
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

interface SearchRun {
    stdout: string;
    stderr: string;
    code: number;
}

function killChild(child: ChildProcess): void {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
}

export function executeSearch(
    command: string,
    args: string[],
    cwd: string,
    signal: AbortSignal | undefined,
): Promise<SearchRun> {
    return new Promise<SearchRun>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        let child: ChildProcess;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = (): void => {
            if (timer) clearTimeout(timer);
        };
        const fail = (err: Error): void => {
            if (settled) return;
            settled = true;
            cleanup();
            killChild(child);
            reject(err);
        };

        try {
            child = spawn(command, args, {
                cwd,
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
        } catch (err) {
            reject(new Error(`Failed to start ${command}: ${err instanceof Error ? err.message : String(err)}`));
            return;
        }

        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk;
        });
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => {
            if (stderr.length < STDERR_MAX_BYTES) stderr += chunk;
        });

        child.once("error", (err) => fail(new Error(`Failed to run ${command}: ${err.message}`)));
        child.once("close", (code) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ stdout, stderr, code: code ?? 0 });
        });

        timer = setTimeout(() => fail(new Error(`${command} timed out after ${EXEC_TIMEOUT_MS / 1000}s`)), EXEC_TIMEOUT_MS);
        timer.unref?.();

        if (signal) {
            const onAbort = (): void => fail(new Error(`${command} search was cancelled.`));
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
        }
    });
}

// ---------------------------------------------------------------------------
// Output shaping
// ---------------------------------------------------------------------------

export function formatOutput(stdout: string): { text: string; truncated: boolean } {
    const trimmed = stdout.replace(/\n+$/, "");
    const truncation = truncateHead(trimmed, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
    });
    if (!truncation.truncated) return { text: trimmed, truncated: false };

    // Persist the full output when cut, so nothing is lost.
    let fullPath = "";
    try {
        const file = path.join(os.tmpdir(), `aftc-search-${randomUUID()}.log`);
        fs.writeFileSync(file, trimmed, "utf8");
        fullPath = file;
    } catch {
        fullPath = "";
    }
    const note =
        `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
        `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
        (fullPath ? ` Full output: ${fullPath}]` : "]");
    return { text: `${truncation.content}\n\n${note}`, truncated: true };
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

const FD_TOOL_DESCRIPTION =
    "Find files and directories by name with fd (a fast, gitignore-aware file finder). " +
    "Results are limited to 1000 entries unless a higher limit is given; output is limited to 2000 lines or 50KB, and complete truncated output is saved to a temporary file.";
const FD_PROMPT_SNIPPET = "Find files and directories by name with fd (fast, gitignore-aware)";
const FD_PROMPT_GUIDELINES = [
    "Use fd as the primary tool for discovering files and directories by name, extension, or glob instead of bash with find or ls -R.",
    "Use rg instead of fd when searching file contents rather than file names.",
    "Keep using bash for complex multi-step workflows that pipe or post-process file listings.",
];

const RG_TOOL_DESCRIPTION =
    "Search file contents with ripgrep (a fast regex content search). Uses smart-case matching, respects .gitignore by default, and returns at most 100 matches per file unless a different limit is given. Output is limited to 2000 lines or 50KB; complete truncated output is saved to a temporary file.";
const RG_PROMPT_SNIPPET = "Search file contents with ripgrep (fast regex content search)";
const RG_PROMPT_GUIDELINES = [
    "Use rg as the primary tool for searching file contents instead of bash with grep.",
    "Use fd instead of rg when looking for files by name rather than content.",
    "Set fixed_strings on rg when searching for literal code snippets containing regex metacharacters.",
    "Keep using bash for complex multi-step workflows that combine searching with other commands.",
];

export function createFileSearch(pi: ExtensionAPI): void {
    registerHelpEntry({
        command: "file-search-on",
        description: "Enable the fd + rg search tools (/reload to apply)",
        category: "General",
    });
    pi.registerCommand("file-search-on", {
        description: "Enable the fd + rg file-search tools. /reload to apply.",
        handler: async (_args, ctx) => {
            setPreference("fileSearchEnabled", true);
            aftcConsole.emphasis(ctx, "fd + rg search tools enabled. Run /reload to apply.");
        },
    });
    registerHelpEntry({
        command: "file-search-off",
        description: "Disable the fd + rg search tools (/reload to apply)",
        category: "General",
    });
    pi.registerCommand("file-search-off", {
        description: "Disable the fd + rg file-search tools. /reload to apply.",
        handler: async (_args, ctx) => {
            setPreference("fileSearchEnabled", false);
            aftcConsole.emphasis(ctx, "fd + rg search tools disabled. Run /reload to apply.");
        },
    });

    if (!getPreference("fileSearchEnabled", true)) return;

    async function runTool(
        tool: SearchTool,
        args: string[],
        ctx: ExtensionContext,
        signal: AbortSignal | undefined,
    ): Promise<string> {
        const command = await resolveBinary(tool);
        if (!command) {
            throw new Error(
                `${tool} is not installed. Install it and retry: ${installHint(tool)}.`,
            );
        }
        const result = await executeSearch(command, args, ctx.cwd ?? process.cwd(), signal);

        // ripgrep exits 1 for "no matches"; fd exits 0 with no output.
        if (tool === "rg" && result.code === 1 && result.stdout === "") {
            return "No matches found.";
        }
        if (result.code !== 0) {
            const detail = result.stderr.trim() || `exit code ${result.code}`;
            throw new Error(`${tool} failed: ${detail}`);
        }
        const trimmed = result.stdout;
        if (trimmed === "") return tool === "fd" ? "No files found." : "No matches found.";
        return formatOutput(trimmed).text;
    }

    pi.registerTool({
        name: "fd",
        label: "Find Files",
        description: FD_TOOL_DESCRIPTION,
        promptSnippet: FD_PROMPT_SNIPPET,
        promptGuidelines: FD_PROMPT_GUIDELINES,
        parameters: Type.Object({
            pattern: Type.Optional(Type.String({
                description: "Regex matched against file names (or a glob when glob is true). Omit to list everything under path.",
            })),
            path: Type.Optional(Type.String({
                description: "Directory to search. Defaults to the current working directory.",
            })),
            type: Type.Optional(StringEnum(["file", "directory", "symlink"] as const, {
                description: "Only return entries of this type: file, directory, or symlink.",
            })),
            extension: Type.Optional(Type.String({
                description: "Only return files with this extension, e.g. 'ts' or 'md'.",
            })),
            glob: Type.Optional(Type.Boolean({
                description: "Treat pattern as a glob (e.g. '*.test.ts') instead of a regex.",
            })),
            hidden: Type.Optional(Type.Boolean({
                description: "Include hidden files and directories. Defaults to false.",
            })),
            max_depth: Type.Optional(Type.Integer({
                description: `Maximum directory depth to descend (1-${FD_MAX_DEPTH_LIMIT}).`,
                minimum: 1,
                maximum: FD_MAX_DEPTH_LIMIT,
            })),
            limit: Type.Optional(Type.Integer({
                description: `Maximum number of results (1-${FD_MAX_LIMIT}). Defaults to 1000.`,
                minimum: 1,
                maximum: FD_MAX_LIMIT,
            })),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const text = await runTool("fd", buildFdArgs(params as FdToolParams), ctx, signal);
            return { content: [{ type: "text", text }] };
        },
    });

    pi.registerTool({
        name: "rg",
        label: "Search Content",
        description: RG_TOOL_DESCRIPTION,
        promptSnippet: RG_PROMPT_SNIPPET,
        promptGuidelines: RG_PROMPT_GUIDELINES,
        parameters: Type.Object({
            pattern: Type.String({
                description: "Regex to search for (literal text when fixed_strings is true).",
            }),
            path: Type.Optional(Type.String({
                description: "File or directory to search. Defaults to the current working directory.",
            })),
            glob: Type.Optional(Type.String({
                description: "Only search files matching this glob, e.g. '*.ts' or 'src/**'.",
            })),
            file_type: Type.Optional(Type.String({
                description: "Only search files of this ripgrep type, e.g. 'ts', 'js', 'py'.",
            })),
            case_sensitive: Type.Optional(Type.Boolean({
                description: "true forces case-sensitive matching, false forces case-insensitive. Defaults to smart-case.",
            })),
            fixed_strings: Type.Optional(Type.Boolean({
                description: "Treat pattern as a literal string instead of a regex.",
            })),
            hidden: Type.Optional(Type.Boolean({
                description: "Search hidden files and directories. Defaults to false.",
            })),
            context: Type.Optional(Type.Integer({
                description: `Lines of context to show around each match (0-${RG_MAX_CONTEXT}).`,
                minimum: 0,
                maximum: RG_MAX_CONTEXT,
            })),
            limit: Type.Optional(Type.Integer({
                description: `Maximum matches per file (1-${RG_MAX_COUNT_LIMIT}). Defaults to 100.`,
                minimum: 1,
                maximum: RG_MAX_COUNT_LIMIT,
            })),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const text = await runTool("rg", buildRgArgs(params as RgToolParams), ctx, signal);
            return { content: [{ type: "text", text }] };
        },
    });
}
