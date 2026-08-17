/**
 * pi-aftc-toolset / file search — pure CLI argument construction.
 *
 * Ported from the upstream fd/rg wrapper (my-pi-setup) without Effect: this
 * module is synchronous and side-effect free so the exact argv can be
 * asserted in tests. Patterns are always placed AFTER a `--` separator so
 * model-provided input can never be parsed as a flag; paths have a leading
 * `@` stripped and `~` expanded; numeric options are clamped.
 *
 * See file-search-args-readme.md for the contract.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const FD_DEFAULT_LIMIT = 1000;
export const FD_MAX_LIMIT = 10_000;
export const FD_MAX_DEPTH_LIMIT = 64;
export const RG_DEFAULT_COUNT_LIMIT = 100;
export const RG_MAX_COUNT_LIMIT = 1000;
export const RG_MAX_CONTEXT = 20;

/** Some models prefix path arguments with '@'; built-in tools strip it, so do we. */
export function normalizeSearchPath(raw: string): string {
    let p = raw.trim();
    if (p.startsWith("@")) p = p.slice(1);
    if (p === "~") return homedir();
    if (p.startsWith("~/")) return join(homedir(), p.slice(2));
    return p;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function optionalPath(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const normalized = normalizeSearchPath(raw);
    return normalized === "" ? undefined : normalized;
}

export type FdEntryType = "file" | "directory" | "symlink";

export interface FdToolParams {
    pattern?: string;
    path?: string;
    type?: FdEntryType;
    extension?: string;
    glob?: boolean;
    hidden?: boolean;
    max_depth?: number;
    limit?: number;
}

const FD_TYPE_FLAGS: Record<FdEntryType, string> = {
    file: "f",
    directory: "d",
    symlink: "l",
};

export function buildFdArgs(params: FdToolParams): string[] {
    const args = ["--color=never"];
    if (params.hidden) args.push("--hidden");
    if (params.glob) args.push("--glob");
    if (params.type) args.push("--type", FD_TYPE_FLAGS[params.type]);
    if (params.extension) {
        args.push("--extension", params.extension.replace(/^\.+/, ""));
    }
    if (params.max_depth !== undefined) {
        args.push("--max-depth", String(clamp(params.max_depth, 1, FD_MAX_DEPTH_LIMIT)));
    }
    args.push("--max-results", String(clamp(params.limit ?? FD_DEFAULT_LIMIT, 1, FD_MAX_LIMIT)));
    // An empty pattern matches everything, keeping `path` usable without one.
    args.push("--", params.pattern ?? "");
    const path = optionalPath(params.path);
    if (path) args.push(path);
    return args;
}

export interface RgToolParams {
    pattern: string;
    path?: string;
    glob?: string;
    file_type?: string;
    case_sensitive?: boolean;
    fixed_strings?: boolean;
    hidden?: boolean;
    context?: number;
    limit?: number;
}

export function buildRgArgs(params: RgToolParams): string[] {
    const args = [
        "--line-number",
        "--color=never",
        "--no-heading",
        "--with-filename",
    ];
    if (params.case_sensitive === true) args.push("--case-sensitive");
    else if (params.case_sensitive === false) args.push("--ignore-case");
    else args.push("--smart-case");
    if (params.fixed_strings) args.push("--fixed-strings");
    if (params.hidden) args.push("--hidden");
    if (params.context !== undefined) {
        args.push("--context", String(clamp(params.context, 0, RG_MAX_CONTEXT)));
    }
    if (params.glob) args.push("--glob", params.glob);
    if (params.file_type) args.push("--type", params.file_type);
    args.push("--max-count", String(clamp(params.limit ?? RG_DEFAULT_COUNT_LIMIT, 1, RG_MAX_COUNT_LIMIT)));
    args.push("--", params.pattern);
    const path = optionalPath(params.path);
    if (path) args.push(path);
    return args;
}
