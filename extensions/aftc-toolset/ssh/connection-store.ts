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

let cachedConnections: SshConnection[] | undefined;
let cachedAutoAccept: boolean | undefined;

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

function loadConnections(): SshConnection[] {
    if (cachedConnections) return cachedConnections;
    try {
        const sshPath = getSshJson();
        if (!fs.existsSync(sshPath)) return cachedConnections = [];
        const parsed = JSON.parse(fs.readFileSync(sshPath, "utf8")) as Partial<SshStore>;
        const rawConnections = Array.isArray(parsed.connections) ? parsed.connections : [];
        cachedConnections = rawConnections.filter(isConnection).map(copyConnection);
        cachedAutoAccept = parsed.ssh_session_auto_accept === true;
        // Remove unknown / legacy credential fields written by older versions
        // (anything outside the SshConnection shape) as soon as the local-only
        // store is read. Saved passwords are part of the current shape and are
        // preserved. Files written before the auto-accept preference existed
        // are migrated too: the entry is added, defaulting to false (off).
        if (JSON.stringify(rawConnections) !== JSON.stringify(cachedConnections) || parsed.ssh_session_auto_accept === undefined) {
            writeJsonAtomic(sshPath, { connections: cachedConnections, ssh_session_auto_accept: cachedAutoAccept });
        }
        return cachedConnections;
    } catch {
        cachedConnections = [];
        cachedAutoAccept = false;
        return cachedConnections;
    }
}

function saveConnections(connections: SshConnection[]): void {
    cachedConnections = connections.map(copyConnection);
    writeJsonAtomic(getSshJson(), { connections: cachedConnections, ssh_session_auto_accept: cachedAutoAccept === true });
}

export function getSshConnections(): SshConnection[] {
    return loadConnections().map(copyConnection);
}

export function findSshConnection(name: string): SshConnection | undefined {
    const connection = loadConnections().find((item) => item.name === name);
    return connection ? copyConnection(connection) : undefined;
}

export function saveSshConnection(connection: SshConnection): void {
    const connections = loadConnections();
    const index = connections.findIndex((item) => item.name === connection.name);
    if (index >= 0) connections[index] = copyConnection(connection);
    else connections.push(copyConnection(connection));
    saveConnections(connections);
}

export function removeSshConnection(name: string): boolean {
    const connections = loadConnections();
    const next = connections.filter((connection) => connection.name !== name);
    if (next.length === connections.length) return false;
    saveConnections(next);
    return true;
}

/** Whether new SSH host keys are auto-approved (saved setting; default false). */
export function getSshSessionAutoAccept(): boolean {
    loadConnections();
    return cachedAutoAccept === true;
}

/** Persist the new-host-key auto-accept preference. */
export function setSshSessionAutoAccept(value: boolean): void {
    const connections = loadConnections();
    cachedAutoAccept = value;
    saveConnections(connections);
}
