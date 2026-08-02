/**
 * pi-aftc-toolset / ssh / connection-store — local SSH connection metadata.
 *
 * Same NO-IN-MEMORY-CACHE rule as `config.ts` (see
 * `docs/working-with-config.md`): every read hits `ssh.json` on disk,
 * every write is a fresh read-modify-write. pi keeps extension modules
 * alive across `/new`, so a module-scoped cache would serve stale
 * values after a user hand-edits the file - and a later save would
 * flush the stale cache back, silently reverting the user's edits.
 *
 * `ssh.json` holds ONLY non-secret connection metadata: name,
 * username, host, port, timeout, optional key path, optional saved
 * password. Never exposed to the model. Managed exclusively through
 * `/ssh-cm`.
 *
 * The migration logic that the previous (cached) version ran on every
 * read (drop unknown fields, add default `ssh_session_auto_accept`,
 * normalise the file) is GONE. The file is exactly what the user /
 * a previous save wrote; we only return the parsed shape. If the user
 * hand-edits the file in a way that misses a field, the next save
 * fills it in via the read-modify-write.
 *
 * Atomic writes: every save writes `<file>.tmp` then `rename`. A crash
 * mid-write can't leave the file half-written.
 *
 * Self-contained module. Wired by `ssh/index.ts`.
 *
 * See `docs/ssh-documentation.md` for the security model and
 * `connection-store-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getSshJson } from "../paths";

export interface SshConnection {
    name: string;
    username: string;
    host: string;
    port?: number;
    connectTimeoutMs?: number;
    identityFile?: string;
    /** Optional saved password. Local-only: never exposed to model tools or
     * rendered SSH status, and always covered by the redaction layer. */
    password?: string;
}

interface SshStore {
    connections: SshConnection[];
    /** When true, new (never-before-seen) SSH host keys are approved without
     * the local confirmation dialog. Changed keys are still rejected. */
    ssh_session_auto_accept?: boolean;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporaryPath, filePath);
}

function isConnection(value: unknown): value is SshConnection {
    if (!value || typeof value !== "object") return false;
    const connection = value as Partial<SshConnection>;
    return typeof connection.name === "string" && connection.name.length > 0 &&
        typeof connection.username === "string" && connection.username.length > 0 &&
        typeof connection.host === "string" && connection.host.length > 0 &&
        (connection.port === undefined || (Number.isInteger(connection.port) && connection.port > 0 && connection.port <= 65535)) &&
        (connection.connectTimeoutMs === undefined || (Number.isInteger(connection.connectTimeoutMs) && connection.connectTimeoutMs > 0)) &&
        (connection.identityFile === undefined || typeof connection.identityFile === "string") &&
        (connection.password === undefined || typeof connection.password === "string");
}

/** Defensive copy: callers must not mutate the parsed-on-disk shape. */
function copyConnection(connection: SshConnection): SshConnection {
    return {
        host: connection.host,
        name: connection.name,
        username: connection.username,
        ...(connection.port === undefined ? {} : { port: connection.port }),
        ...(connection.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: connection.connectTimeoutMs }),
        ...(connection.identityFile === undefined ? {} : { identityFile: connection.identityFile }),
        ...(connection.password === undefined ? {} : { password: connection.password }),
    };
}

/**
 * Read `ssh.json` from disk fresh. Returns the parsed shape on disk
 * (sub-objects deep-copied, but the file itself is left untouched).
 * Never normalises, rewrites, or migrates the file on read — the user's
 * last-written file is the source of truth between calls.
 *
 * Fail-soft: a missing file yields an empty store; a corrupted file
 * yields an empty store (the file is left untouched on disk for the
 * user to hand-fix, never silently clobbered).
 */
function loadConnections(): { connections: SshConnection[]; autoAccept: boolean } {
    const empty = { connections: [] as SshConnection[], autoAccept: false };
    try {
        const sshPath = getSshJson();
        if (!fs.existsSync(sshPath)) return empty;
        const parsed = JSON.parse(fs.readFileSync(sshPath, "utf8")) as Partial<SshStore>;
        const rawConnections = Array.isArray(parsed.connections) ? parsed.connections : [];
        const connections = rawConnections.filter(isConnection).map(copyConnection);
        const autoAccept = parsed.ssh_session_auto_accept === true;
        return { connections, autoAccept };
    } catch {
        return empty;
    }
}

/**
 * Fresh read-modify-write of `ssh.json`. The current file is read on
 * every call (no in-memory cache to flush), the supplied `connections`
 * replaces the connections array, and the file is rewritten atomically.
 * Preserves any other top-level keys the user (or a future version)
 * may have added.
 */
function saveConnections(connections: SshConnection[], autoAccept: boolean): void {
    const sshPath = getSshJson();
    let existing: Record<string, unknown> = {};
    try {
        if (fs.existsSync(sshPath)) {
            existing = JSON.parse(fs.readFileSync(sshPath, "utf8")) as Record<string, unknown>;
        }
    } catch {
        // File missing or corrupt - start fresh; the next save will
        // overwrite the bad file with a clean one.
        existing = {};
    }
    existing.connections = connections.map(copyConnection);
    existing.ssh_session_auto_accept = autoAccept;
    writeJsonAtomic(sshPath, existing);
}

export function getSshConnections(): SshConnection[] {
    return loadConnections().connections.map(copyConnection);
}

export function findSshConnection(name: string): SshConnection | undefined {
    const connection = loadConnections().connections.find((item) => item.name === name);
    return connection ? copyConnection(connection) : undefined;
}

export function saveSshConnection(connection: SshConnection): void {
    const { connections, autoAccept } = loadConnections();
    const index = connections.findIndex((item) => item.name === connection.name);
    if (index >= 0) connections[index] = copyConnection(connection);
    else connections.push(copyConnection(connection));
    saveConnections(connections, autoAccept);
}

export function removeSshConnection(name: string): boolean {
    const { connections, autoAccept } = loadConnections();
    const next = connections.filter((connection) => connection.name !== name);
    if (next.length === connections.length) return false;
    saveConnections(next, autoAccept);
    return true;
}

/** Whether new SSH host keys are auto-approved (saved setting; default false). */
export function getSshSessionAutoAccept(): boolean {
    return loadConnections().autoAccept;
}

/** Persist the new-host-key auto-accept preference. */
export function setSshSessionAutoAccept(value: boolean): void {
    const { connections } = loadConnections();
    saveConnections(connections, value);
}
