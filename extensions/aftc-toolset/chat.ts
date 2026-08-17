/**
 * pi-aftc-toolset / chat — peer chat between pi instances over a shared file.
 *
 * WHY THIS EXISTS
 * Two or more pi instances (and the humans using them) talk to each other
 * through ONE shared append-only text file (chat.log). The extension owns
 * ALL transport: a watcher detects new records, filters them by the addressed
 * name, and injects matching ones into this pi instance as real user messages
 * (pi.sendUserMessage). The model never polls, never parses the file and
 * never spends tokens on transport; it just sees incoming peer messages
 * appear in its chat and answers them.
 *
 * PARTICIPANTS & IDENTITY
 * Every participant (AI or human) is a pi instance with a NAME and a ROLE.
 * An AI cannot act in the chat (send/done/claim) until both are set. Name and
 * role are PER-PROCESS and live ONLY in this pi process's environment
 * (AFTC_CHAT_NAME / AFTC_CHAT_ROLE): the tools/commands/menu set them for
 * THIS window, or they can be pre-set before launching pi. They are never
 * written to config.json — two pi windows on one machine keep separate
 * identities and can never overwrite each other. Identity resets when the
 * pi process exits (set it again or launch with the env vars). The shared
 * file resolves as AFTC_CHAT_FILE -> <dataDir>/chat/chat.log
 * (getChatLogFile()).
 *
 * RECORD FORMAT (chat.log, append-only, one record per message)
 *   [aftc_to:bob][aftc_from:alice][aftc_id:8f3a21c4][aftc_kind:message][aftc_message]
 *   <multi-line content — code, PowerShell, anything — never regex-matched>
 *   [/aftc_message]
 *   (blank line between records)
 * kind: message | done | claim. to:all broadcasts to every participant.
 * Optional [aftc_auto:1] token (after aftc_kind) marks an auto-reply engine
 * record — the loop guard: auto records are delivered but NEVER auto-answered.
 * Cross-platform: LF-only writes; CRLF + UTF-8 BOM stripped on read; Windows
 * EBUSY/EPERM append retries; names sanitized (no brackets / CR / LF /
 * control chars); content never passes through a shell.
 *
 * COORDINATION
 * - A message addressed to me is auto-answered (the final reply is sent back
 *   flagged aftc_auto:1, chatAutoReplyEnabled). Messages to "all" are
 *   injected but NEVER auto-replied — respond only if you have something
 *   to add. Auto peer replies are NEVER auto-answered (loop guard: at most
 *   one automatic round per human message).
 * - NO_REPLY: a reply starting with the single word NO_REPLY is swallowed
 *   (nothing sent) — the sanctioned silent acknowledgement; the rules block
 *   bans bare acks / small talk (every sent message costs allowance).
 * - Done silencing: after chat_done, done/claim notices are no longer
 *   injected (chat_status shows them on demand); a real message addressed
 *   to me re-engages delivery.
 * - chat_claim(task) COMMITS to a broadcast job: the first claim in the log
 *   wins; a later claimer sees the winner and stands down, then verifies.
 *   Claims are commitments, not offers — claiming means doing.
 * - chat_done(note) marks "finished my part". Completion is always signalled
 *   explicitly — there is no silent stoppage; done/claim notices are injected
 *   to everyone as informational ("no reply needed").
 *
 * See `chat-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getChatDir, getChatLogFile } from "./paths";
import { getPreference } from "./config";
import * as aftcConsole from "./ui/aftc-console";
import { registerHelpEntry } from "./help-registry";
import { showConfirm, showInput, showMenu } from "./ui/aftc-ui";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ENV_NAME = "AFTC_CHAT_NAME";
const ENV_ROLE = "AFTC_CHAT_ROLE";
const ENV_FILE = "AFTC_CHAT_FILE";

/** Stat-poll fallback interval — fs.watch misses some filesystems (SMB). */
const POLL_MS = 10_000;
/** Cap on dedup ids kept per chat file. */
const IDS_CAP = 500;
/** Max sanitized name/role length. */
const NAME_MAX = 24;
/** Cap on an auto-replied assistant message length. */
const REPLY_MAX = 8000;
/** Line window scanned for status/claims. */
const SCAN_WINDOW = 500;
/** Startup guard: a log untouched for this long is a finished conversation. */
const STALE_LOG_MS = 60 * 60 * 1000; // 1 hour
/** Startup prune keeps at most this many newest records per sender. */
const PRUNE_KEEP_PER_SENDER = 6;

export type ChatKind = "message" | "done" | "claim";

export interface ChatRecord {
    to: string;
    from: string;
    id: string;
    kind: ChatKind;
    /** True on records written by the auto-reply engine (loop guard). */
    auto?: boolean;
    content: string;
    /** Absolute line index of the header line. */
    startLine: number;
    /** Absolute line index of the closer line. */
    endLine: number;
}

export interface ScanResult {
    records: ChatRecord[];
    /** Absolute line index where the next scan should resume. */
    nextLine: number;
}

export interface ChatState {
    lastLine: number;
    processedIds: string[];
    /** last peer who messaged ME (per-instance state file, so a plain string) */
    lastPeer: string;
    /** keyed by sender name (lowercased) -> last done note I have seen */
    doneBy: Record<string, string>;
    /** for /chat-check: line up to which records were shown */
    lastCheckedLine: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure protocol helpers (unit-testable, no pi dependency)
// ─────────────────────────────────────────────────────────────────────────────

/** Strip markup-hostile + control chars from a participant name / role. */
export function sanitizeName(raw: string): string {
    return raw
        .replace(/[[\]\r\n\t]/g, "")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, NAME_MAX);
}

/** Random short record id (32 bits — plenty for a chat log, dedup guards the rest). */
export function newId(): string {
    return randomBytes(4).toString("hex");
}

/** Parse a header line into record fields, or null when malformed. */
export function parseHeader(line: string): Pick<ChatRecord, "to" | "from" | "id" | "kind" | "auto"> | null {
    const fields: Record<string, string> = {};
    let idx = 0;
    while (idx < line.length) {
        if (line[idx] !== "[") return null;
        const close = line.indexOf("]", idx);
        if (close < 0) return null;
        const token = line.slice(idx + 1, close);
        if (token === "aftc_message") break;
        const m = /^aftc_(to|from|id|kind|auto):(.+)$/.exec(token);
        if (!m) return null;
        if (fields[m[1]] !== undefined) return null; // duplicate field
        fields[m[1]] = m[2];
        idx = close + 1;
    }
    if (!fields.to || !fields.from || !fields.id) return null;
    const kind: ChatKind =
        fields.kind === "done" || fields.kind === "claim" ? fields.kind : "message";
    return { to: fields.to, from: fields.from, id: fields.id, kind, auto: fields.auto === "1" };
}

/**
 * Parse a chat log text into complete records starting at `startLine`.
 * Line-based (immune to multibyte offset issues). Malformed/stray lines at
 * record boundaries are skipped; a valid header whose closer is missing is an
 * incomplete tail and is NOT consumed (re-read on the next scan). Content is
 * opaque — never regex-matched — only a lone `[/aftc_message]` line closes it.
 */
export function parseRecords(text: string, startLine = 0): ScanResult {
    if (!text.trim()) return { records: [], nextLine: startLine };
    const lines = text.split("\n");
    // A trailing newline makes split() emit a phantom "" element that is not a
    // real line. Exclude it, or nextLine advances past the true line count and
    // the NEXT record's header (which lands one line earlier) is skipped forever.
    const realLines = text.endsWith("\n") ? lines.length - 1 : lines.length;
    const records: ChatRecord[] = [];
    let nextLine = startLine;
    let i = startLine;
    while (i < realLines) {
        const line = lines[i].replace(/\r$/, "");
        if (line.startsWith("[aftc_to:")) {
            const header = parseHeader(line);
            if (header) {
                let closer = -1;
                for (let j = i + 1; j < realLines; j++) {
                    if (lines[j].replace(/\r$/, "") === "[/aftc_message]") { closer = j; break; }
                }
                if (closer < 0) {
                    // incomplete tail — re-read from here next time
                    nextLine = i;
                    break;
                }
                const content = lines.slice(i + 1, closer).join("\n").replace(/\r/g, "");
                records.push({ ...header, content, startLine: i, endLine: closer });
                i = closer + 1;
                // skip one blank separator line if present
                if (i < realLines && lines[i].replace(/\r$/, "") === "") i++;
                nextLine = i;
                continue;
            }
        }
        // stray / malformed line at a record boundary — consume it
        i++;
        nextLine = i;
    }
    return { records, nextLine };
}

/** Build the on-disk text for one record (LF-only). */
export function formatRecord(kind: ChatKind, to: string, from: string, id: string, content: string, auto = false): string {
    const body = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const head = `[aftc_to:${to}][aftc_from:${from}][aftc_id:${id}][aftc_kind:${kind}]${auto ? "[aftc_auto:1]" : ""}[aftc_message]`;
    return `${head}\n${body}\n[/aftc_message]\n\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State + log file I/O
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State file lives NEXT TO the log, PER INSTANCE (keyed by the participant
 * name) so two instances sharing one log never race on a shared state file:
 * each tracks its own resume line, dedup set, last peer and seen-done map.
 * Falls back to "anon" when the name is not set yet.
 */
export function statePathFor(chatFile: string, name?: string): string {
    const key = name ? sanitizeName(name).toLowerCase() : "anon";
    return `${chatFile}.state-${key}.json`;
}

export function emptyState(): ChatState {
    return { lastLine: 0, processedIds: [], lastPeer: "", doneBy: {}, lastCheckedLine: 0 };
}

export function loadState(chatFile: string, name?: string): ChatState {
    try {
        const raw = fs.readFileSync(statePathFor(chatFile, name), "utf8");
        const parsed = JSON.parse(raw) as Partial<ChatState>;
        return {
            lastLine: typeof parsed.lastLine === "number" ? parsed.lastLine : 0,
            processedIds: Array.isArray(parsed.processedIds)
                ? parsed.processedIds.filter((s): s is string => typeof s === "string").slice(-IDS_CAP)
                : [],
            lastPeer: typeof parsed.lastPeer === "string" ? parsed.lastPeer : "",
            doneBy: parsed.doneBy && typeof parsed.doneBy === "object" ? parsed.doneBy : {},
            lastCheckedLine: typeof parsed.lastCheckedLine === "number" ? parsed.lastCheckedLine : 0,
        };
    } catch {
        return emptyState();
    }
}

export function saveState(chatFile: string, state: ChatState, name?: string): void {
    try {
        fs.mkdirSync(path.dirname(statePathFor(chatFile, name)), { recursive: true });
        fs.writeFileSync(statePathFor(chatFile, name), JSON.stringify(state, null, 2), "utf8");
    } catch (err) {
        aftcConsole.logError(`[aftc-toolset] chat state save failed: ${(err as Error).message}`);
    }
}

/** Read the log as UTF-8, stripping a leading BOM (Notepad adds one). */
export function readLog(chatFile: string): string {
    try {
        const raw = fs.readFileSync(chatFile, "utf8");
        return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw err;
    }
}

/** Append a record block atomically-ish, retrying Windows lock errors. */
export function appendRecord(chatFile: string, text: string): void {
    fs.mkdirSync(path.dirname(chatFile), { recursive: true });
    const data = Buffer.from(text, "utf8");
    const sab = new Int32Array(new SharedArrayBuffer(4));
    let attempts = 0;
    for (;;) {
        try {
            fs.appendFileSync(chatFile, data, { flag: "a" });
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if ((code === "EBUSY" || code === "EPERM" || code === "EAGAIN") && attempts < 4) {
                attempts++;
                Atomics.wait(sab, 0, 0, 40 * attempts); // tiny sync sleep, then retry
                continue;
            }
            throw err;
        }
    }
}

/** Move the log aside (backup) and reset every instance's read-state for it.
 *  Also drops a rotation marker so running instances know the log was cleared
 *  (and treat content arriving after it as new, not replayable history). */
export function rotateLog(chatFile: string): void {
    try {
        if (fs.existsSync(chatFile)) {
            fs.renameSync(chatFile, `${chatFile}.bak-${Date.now()}`);
        }
    } catch (err) {
        aftcConsole.logError(`[aftc-toolset] chat rotate failed: ${(err as Error).message}`);
    }
    try {
        fs.writeFileSync(`${chatFile}.rotated`, String(Date.now()), "utf8");
    } catch { /* ignore */ }
    const dir = path.dirname(chatFile);
    const base = path.basename(chatFile);
    try {
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith(`${base}.state-`)) {
                try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
            }
        }
    } catch { /* ignore */ }
}

/** Read the rotation marker (timestamp ms of the last clear), 0 when absent. */
export function rotationMarkerTime(chatFile: string): number {
    try {
        const t = Number(fs.readFileSync(`${chatFile}.rotated`, "utf8").trim());
        return Number.isFinite(t) && t > 0 ? t : 0;
    } catch { return 0; }
}

/**
 * Rewrite the log keeping only the newest `keepPerSender` records per sender
 * (chronological order preserved). Aborts (returns false) when an append or a
 * partial record lands between the read and the replace - retried next time.
 */
export function pruneLog(chatFile: string, keepPerSender: number): boolean {
    try {
        const text = readLog(chatFile);
        if (!text.trim()) return false;
        const { records, nextLine } = parseRecords(text, 0);
        if (records.length === 0) return false;
        const lines = text.split("\n");
        const realLines = text.endsWith("\n") ? lines.length - 1 : lines.length;
        if (nextLine < realLines) return false; // incomplete tail mid-write
        const counts = new Map<string, number>();
        const kept: ChatRecord[] = [];
        for (let i = records.length - 1; i >= 0; i--) {
            const key = records[i].from.toLowerCase();
            const n = counts.get(key) || 0;
            if (n < keepPerSender) {
                counts.set(key, n + 1);
                kept.push(records[i]);
            }
        }
        if (kept.length === records.length) return false; // nothing to prune
        kept.reverse();
        const rebuilt = kept.map((r) => formatRecord(r.kind, r.to, r.from, r.id, r.content, r.auto)).join("");
        if (readLog(chatFile) !== text) return false; // concurrent append
        const tmp = `${chatFile}.prune-tmp`;
        fs.writeFileSync(tmp, rebuilt, "utf8");
        fs.renameSync(tmp, chatFile);
        return true;
    } catch (err) {
        aftcConsole.logError(`[aftc-toolset] chat prune failed: ${(err as Error).message}`);
        return false;
    }
}

/** Scan the last SCAN_WINDOW lines for the most recent records (status/claims). */
export function scanRecent(chatFile: string, max = 10): ChatRecord[] {
    const text = readLog(chatFile);
    const lines = text.split("\n");
    const start = Math.max(0, lines.length - SCAN_WINDOW);
    const { records } = parseRecords(text, start);
    return records.slice(-max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Identity is per-process: this pi process's env is the ONLY store (never
 *  config.json — two windows on one machine must keep separate identities). */
function resolveChatName(): string {
    return (process.env[ENV_NAME] || "").trim();
}

function resolveChatRole(): string {
    return (process.env[ENV_ROLE] || "").trim();
}

/** Set this window's chat identity for the lifetime of this pi process. */
function setIdentityName(name: string): void {
    process.env[ENV_NAME] = name;
}

function setIdentityRole(role: string): void {
    process.env[ENV_ROLE] = role;
}

function resolveChatFile(): string {
    const env = (process.env[ENV_FILE] || "").trim();
    if (env) return env;
    return getChatLogFile();
}

function autoReplyEnabled(): boolean {
    return getPreference("chatAutoReplyEnabled", true) !== false;
}

/** Whether this instance has fully entered the chat (name + role). */
function isEntered(): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!resolveChatName()) missing.push("a chat name");
    if (!resolveChatRole()) missing.push("a role");
    return { ok: missing.length === 0, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine — watcher, injection, auto-reply
// ─────────────────────────────────────────────────────────────────────────────

export function createChat(pi: ExtensionAPI): void {
    let watcher: fs.FSWatcher | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let processing = false;
    let agentActive = false;
    /** When this session's watcher started (rotation-marker comparisons). */
    let sessionStartedAt = Date.now();
    /** Whether the log already had content when this session's watcher started. */
    let logHadContentAtStart = false;
    /** Peers owed an auto-reply (every addressed sender in a batch, not just the last). */
    const pendingRecipients = new Set<string>();
    /** True after chat_done: done/claim notices are no longer injected (they
     *  cost a whole turn each and are coordination metadata — chat_status /
     *  /chat-check show them on demand). A real message addressed to me
     *  re-engages (resets the flag). */
    let iAmDone = false;

    const isTui = (cctx: ExtensionCommandContext): boolean => cctx.mode === "tui";

    // ── core engine ─────────────────────────────────────────────────────────

    function processLog(): void {
        if (processing) return;
        processing = true;
        try {
            const chatFile = resolveChatFile();
            const myName = resolveChatName();
            const text = readLog(chatFile);
            if (!text.trim()) return; // empty log — never advance state on nothing
            const lines = text.split("\n");
            const hadState = fs.existsSync(statePathFor(chatFile, myName));
            const state = loadState(chatFile, myName);
            if (!hadState) {
                // First read of this log under this name MID-session (identity
                // changed after startup). Pre-existing content is somebody
                // else's history - skip to the end. Exceptions: the log was
                // empty when this session started (everything in it is new),
                // or it was cleared during this session (rotation marker at/
                // after our start).
                const clearedSinceStart = rotationMarkerTime(chatFile) >= sessionStartedAt;
                if (!clearedSinceStart && logHadContentAtStart) {
                    state.lastLine = text.endsWith("\n") ? lines.length - 1 : lines.length;
                    saveState(chatFile, state, myName);
                    return;
                }
            }
            if (state.lastLine > lines.length) state.lastLine = 0; // rotation/clear
            const { records, nextLine } = parseRecords(text, state.lastLine);
            let changed = false;
            let resumeLine = nextLine;
            for (const rec of records) {
                if (state.processedIds.includes(rec.id)) continue;
                // Deliver BEFORE marking processed: if delivery fails the id
                // stays unmarked and lastLine stops at this record's header,
                // so the next scan re-reads it instead of dropping it forever.
                let delivered = true;
                try {
                    delivered = handleRecord(rec, state, chatFile);
                } catch (err) {
                    aftcConsole.logError(`[aftc-toolset] chat handle error: ${(err as Error).message}`);
                    delivered = false;
                }
                if (!delivered) {
                    resumeLine = rec.startLine;
                    break;
                }
                state.processedIds.push(rec.id);
                if (state.processedIds.length > IDS_CAP) {
                    state.processedIds.splice(0, state.processedIds.length - IDS_CAP);
                }
                changed = true;
            }
            if (changed || resumeLine !== state.lastLine) {
                state.lastLine = resumeLine;
                saveState(chatFile, state, myName);
                aftcConsole.log(
                    `[chat] ${myName || "(anon)"}: processed ${records.length} records (${records.map((r) => r.id).join(",")}) ` +
                    `lastLine ${state.lastLine}/${lines.length} ids ${state.processedIds.length}`, 0,
                );
            }
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] chat process error: ${(err as Error).message}`);
        } finally {
            processing = false;
        }
    }

    /** Returns false when the record could not be delivered (retry next scan). */
    function handleRecord(rec: ChatRecord, state: ChatState, _chatFile: string): boolean {
        const myName = resolveChatName();
        const from = rec.from.toLowerCase();
        const to = rec.to.toLowerCase();
        // my own records (I wrote them) — never react
        if (myName && from === myName.toLowerCase()) return true;
        const addressed = to === "all" || (myName !== "" && to === myName.toLowerCase());

        if (rec.kind === "done") {
            state.doneBy[from] = rec.content || "(no note)";
            if (addressed && !iAmDone) {
                return inject(`From ${rec.from} [chat] (done): ${rec.content || "(no note)"}\nNo reply needed — informational.`, null);
            }
            return true;
        }
        if (rec.kind === "claim") {
            if (addressed && !iAmDone) {
                return inject(`From ${rec.from} [chat] (claim): ${rec.content || "(no task)"}\nNo reply needed — informational.`, null);
            }
            return true;
        }
        // message
        if (!addressed) return true;
        // a real message re-engages me after chat_done
        iAmDone = false;
        const entered = isEntered();
        if (to === "all") {
            const hint = !entered.ok
                ? `\n(Broadcast — you are NOT entered yet: set ${entered.missing.join(" and ")} with chat_set_name / chat_set_role to join.)`
                : "\n(Broadcast — reply only if you have something to add.)";
            return inject(`From ${rec.from} [chat]:\n${rec.content}${hint}`, null);
        }
        if (!entered.ok) {
            return inject(`From ${rec.from} [chat]:\n${rec.content}\n(You are NOT entered yet: set ${entered.missing.join(" and ")} with chat_set_name / chat_set_role before answering or sending.)`, null);
        }
        // Auto-sent peer reply (loop guard): deliver but NEVER owe an
        // auto-reply back — two AIs can exchange at most one automatic round.
        if (rec.auto) {
            return inject(`From ${rec.from} [chat] (auto-reply):\n${rec.content}\n(Automated reply — respond only if it asks you something or reports a problem; otherwise your entire reply must be the single word NO_REPLY.)`, null);
        }
        state.lastPeer = rec.from;
        return inject(`From ${rec.from} [chat]:\n${rec.content}`, rec.from);
    }

    /** Deliver a chat message into this pi as a user message (always triggers
     *  a turn). Returns false when delivery failed so the caller retries. */
    function inject(text: string, autoReplyTo: string | null): boolean {
        try {
            if (agentActive) {
                pi.sendUserMessage(text, { deliverAs: "followUp" });
            } else {
                pi.sendUserMessage(text);
            }
        } catch {
            // race: agent became active between check and call — retry queued
            try {
                pi.sendUserMessage(text, { deliverAs: "followUp" });
            } catch {
                return false; // undelivered — the record stays unprocessed and is retried next scan
            }
        }
        if (autoReplyTo && autoReplyEnabled()) {
            pendingRecipients.add(autoReplyTo);
        }
        return true;
    }

    function maybeAutoReply(cctx: ExtensionCommandContext): void {
        if (pendingRecipients.size === 0) return;
        const recipients = [...pendingRecipients];
        pendingRecipients.clear();
        if (!autoReplyEnabled()) return;
        const myName = resolveChatName();
        if (!myName) return;
        const text = lastAssistantText(cctx);
        if (!text) return;
        // Suppression token: the model opted out of sending (bare acks,
        // small talk, nothing to add). Costs this one local turn only.
        if (/^NO_REPLY\b/.test(text.trim())) {
            aftcConsole.log(`[chat] auto-reply suppressed (NO_REPLY) for ${recipients.join(", ")}`, 0);
            return;
        }
        const reply = text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX)}\n…(truncated)` : text;
        const chatFile = resolveChatFile();
        for (const to of recipients) {
            try {
                appendRecord(chatFile, formatRecord("message", to, myName, newId(), reply, true));
            } catch (err) {
                aftcConsole.logError(`[aftc-toolset] chat auto-reply to ${to} failed: ${(err as Error).message}`);
            }
        }
    }

    function lastAssistantText(cctx: ExtensionCommandContext): string {
        try {
            const entries = cctx.sessionManager.getEntries() as Array<{
                type?: string;
                role?: string;
                message?: { role?: string; content?: string | Array<{ type?: string; text?: string }> };
                content?: string | Array<{ type?: string; text?: string }>;
            }>;
            for (let i = entries.length - 1; i >= 0; i--) {
                const e = entries[i];
                const isAssistant = e.type === "assistant" || e.role === "assistant" || e.message?.role === "assistant";
                if (!isAssistant) continue;
                const c = e.message?.content ?? e.content;
                if (typeof c === "string") return c;
                if (Array.isArray(c)) {
                    return c
                        .filter((p) => p && p.type === "text" && typeof p.text === "string")
                        .map((p) => (p.text as string))
                        .join("\n");
                }
                return "";
            }
        } catch { /* ignore */ }
        return "";
    }

    // ── watcher lifecycle (pi-sanctioned: session_start / session_shutdown) ─

    function startWatcher(ctx?: ExtensionCommandContext): void {
        stopWatcher();
        sessionStartedAt = Date.now();
        const chatFile = resolveChatFile();
        const dir = path.dirname(chatFile);
        const base = path.basename(chatFile);
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
        startupLogGuard(chatFile, ctx);
        const startText = readLog(chatFile);
        logHadContentAtStart = startText.trim() !== "";
        // Joining a log that already has history: snapshot the CURRENT end as
        // the read baseline so pre-existing records are never replayed, while
        // everything appended from this moment on is delivered normally.
        if (logHadContentAtStart && !fs.existsSync(statePathFor(chatFile, resolveChatName()))) {
            const state = loadState(chatFile, resolveChatName());
            const startLines = startText.split("\n");
            // exclude the phantom element a trailing newline emits, or the
            // baseline lands PAST the next record's header and skips it
            state.lastLine = startText.endsWith("\n") ? startLines.length - 1 : startLines.length;
            saveState(chatFile, state, resolveChatName());
        }
        try {
            watcher = fs.watch(dir, (_evt, filename) => {
                if (!filename || filename === base) processLog();
            });
        } catch { watcher = null; }
        pollTimer = setInterval(() => processLog(), POLL_MS);
        if (typeof pollTimer.unref === "function") pollTimer.unref();
    }

    /** Startup guard: a log untouched for over an hour is a finished
     *  conversation - clear it (backup kept) so a new pi session never resumes
     *  it. A fresher log is pruned down to the newest records per sender. */
    function startupLogGuard(chatFile: string, ctx?: ExtensionCommandContext): void {
        try {
            const st = fs.statSync(chatFile);
            if (Date.now() - st.mtimeMs > STALE_LOG_MS) {
                rotateLog(chatFile);
                aftcConsole.log("[chat] cleared stale chat log (untouched for over an hour)", 0);
                if (ctx) {
                    aftcConsole.emphasis(ctx, "Cleared the peer-chat log at startup - the conversation was untouched for over an hour (a backup was kept).");
                }
                return;
            }
        } catch { return; /* no log yet */ }
        if (pruneLog(chatFile, PRUNE_KEEP_PER_SENDER)) {
            aftcConsole.log(`[chat] pruned chat log to the last ${PRUNE_KEEP_PER_SENDER} records per sender`, 0);
        }
    }

    function stopWatcher(): void {
        if (watcher) {
            try { watcher.close(); } catch { /* ignore */ }
            watcher = null;
        }
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    // ── pi events ────────────────────────────────────────────────────────────

    pi.on("session_start", (_event, ctx) => { startWatcher(ctx as ExtensionCommandContext); });
    pi.on("session_shutdown", () => {
        stopWatcher();
        pendingRecipients.clear();
        agentActive = false;
    });
    pi.on("agent_start", () => { agentActive = true; });
    pi.on("agent_end", () => { agentActive = false; });
    pi.on("agent_settled", (_event, ctx) => {
        agentActive = false;
        try { maybeAutoReply(ctx as ExtensionCommandContext); } catch { /* ignore */ }
    });
    pi.on("input", (event) => {
        // The user (typed or via RPC) taking over cancels any pending auto-reply.
        if (event.source !== "extension") pendingRecipients.clear();
    });

    // Chat rules block — injected into the system prompt (chat is always on).
    pi.on("before_agent_start", (event) => {
        const rules = buildRulesBlock();
        if (!rules) return;
        return { systemPrompt: `${event.systemPrompt}\n\n${rules}` };
    });

    function buildRulesBlock(): string {
        const name = resolveChatName();
        const role = resolveChatRole();
        const file = resolveChatFile();
        const entered = isEntered();
        const who = name ? (role ? `${name} (${role})` : `${name} (no role yet)`) : "(no name yet)";
        const lines = [
            "Peer chat rules:",
            `- You are "${who}" in the shared peer chat (log: ${file}).`,
        ];
        if (!entered.ok) {
            lines.push(
                `- You are NOT entered in the chat yet: you need ${entered.missing.join(" and ")}. Call chat_set_name and/or chat_set_role now. Until then you may read broadcasts but must not send or answer messages.`,
            );
            return lines.join("\n");
        }
        lines.push(
            `- Incoming peer messages arrive as "From <name> [chat]:" user messages. done/claim notices are informational — never reply to them mechanically (and after your own chat_done they are no longer injected at all — use chat_status to check on peers).`,
            `- Auto-reply: a message addressed to you is answered automatically — your final reply is sent back to the sender, flagged as automated. Automated replies from peers ("(auto-reply)" messages) are NEVER auto-answered — the loop guard caps AI-to-AI exchanges at one automatic round. Messages addressed to "all" are NOT auto-replied: respond only if you have something to add.`,
            `- NO_REPLY: if an incoming chat message needs no response (bare acknowledgement, status confirmation, small talk), your ENTIRE reply must be the single word NO_REPLY — the extension then sends nothing. Every message sent costs the user's allowance.`,
            `- Discipline: never send bare acknowledgements ("noted", "standing by", "understood", emoji) and no playful chit-chat. Put status into chat_done's note instead of separate messages. Consolidate: one information-dense message beats several small ones.`,
            `- Asking peers: when you are unsure about something a peer owns or can check (their server, their code, their findings), ask them directly with chat_send_message — a targeted question to a named peer beats guessing or broadcasting.`,
            `- Scope hard rule: do ONLY what your user asked. If a task (from your user or a peer) would require modifying features, functionality or files outside the scope of what your user requested, STOP before starting that work: the AI that detects the scope expansion tells the requester it is out of scope, and the AI whose user owns the overall task asks that user for a decision. All AIs pause the out-of-scope work until the user answers.`,
            `- Sending: use chat_send_message(recipient, message) for one peer. Use chat_claim(task) to COMMIT to a broadcast job — a claim means you will do it. Use chat_done(note) when you have finished everything — always signal completion explicitly, never stop silently. IMPORTANT: your auto-sent final reply is NOT a completion signal — completion requires calling chat_done explicitly.`,
            `- Job coordination: before claiming a broadcast job, check chat_status for an existing claim of the same task — the FIRST claim in the log wins. If another participant claimed it, stand down and let them finish, then verify their work.`,
            `- Assignment: when a job fits no one in particular, assign it by NAME (chat_status lists participants and roles) — never leave a job to "whoever answers"; that makes everyone wait for each other.`,
            `- Stopping: when your assigned work is complete, call chat_done with a short summary. If nothing is asked of you and everyone relevant has said done, call chat_done too and stop.`,
        );
        return lines.join("\n");
    }

    // ── shared identity guard for tools ──────────────────────────────────────

    function requireEntered(): string {
        const entered = isEntered();
        if (!entered.ok) {
            throw new Error(
                `You are not entered in the chat yet — set ${entered.missing.join(" and ")} first ` +
                `(chat_set_name and/or chat_set_role).`,
            );
        }
        return resolveChatName();
    }

    function appendAs(kind: ChatKind, to: string, content: string): string {
        const myName = requireEntered();
        const id = newId();
        appendRecord(resolveChatFile(), formatRecord(kind, to, myName, id, content));
        return id;
    }

    // ── model tools (registered only when the feature is enabled at load) ────

    function registerTools(): void {
        pi.registerTool({
            name: "chat_set_name",
            label: "Chat Set Name",
            description:
                "Set this pi instance's participant NAME in the peer chat — the name peers address you by and the sender shown on messages you send. Applies to THIS pi window only (never affects other windows) and lasts until this pi session ends. Call this (and chat_set_role) BEFORE sending any messages: an AI cannot act in the chat without a name AND a role.",
            promptSnippet: "Set your peer-chat name (required, with chat_set_role, before sending)",
            promptGuidelines: [
                "Use chat_set_name when the user tells you their chat name (eg 'set chat name bob') or before you send your first chat message.",
            ],
            parameters: Type.Object({
                name: Type.String({ description: "Your participant name in the peer chat (eg 'bob')." }),
            }),
            async execute(_id, params: { name?: string }) {
                const name = sanitizeName(String(params.name ?? ""));
                if (!name) throw new Error("chat_set_name: the name cannot be empty.");
                setIdentityName(name);
                return {
                    content: [{ type: "text", text: `Chat name set to "${name}" for this pi window (other windows are not affected). You send and receive as ${name} in the peer chat until this session ends.` }],
                    details: { name },
                };
            },
        });

        pi.registerTool({
            name: "chat_set_role",
            label: "Chat Set Role",
            description:
                "Set this pi instance's ROLE in the peer chat (eg 'php programmer', 'project planner', 'designer'). Applies to THIS pi window only (never affects other windows) and lasts until this pi session ends. Combined with chat_set_name it enters you into the chat — an AI cannot act in the chat without a name AND a role.",
            promptSnippet: "Set your peer-chat role (required, with chat_set_name, before sending)",
            promptGuidelines: [
                "Use chat_set_role when the user tells you your role in the chat (eg 'you are the php programmer') or before your first chat message.",
            ],
            parameters: Type.Object({
                role: Type.String({ description: "Your role in the peer chat (eg 'php programmer')." }),
            }),
            async execute(_id, params: { role?: string }) {
                const role = sanitizeName(String(params.role ?? ""));
                if (!role) throw new Error("chat_set_role: the role cannot be empty.");
                setIdentityRole(role);
                return {
                    content: [{ type: "text", text: `Chat role set to "${role}" for this pi window (other windows are not affected). It lasts until this session ends.` }],
                    details: { role },
                };
            },
        });

        pi.registerTool({
            name: "chat_send_message",
            label: "Chat Send Message",
            description:
                "Send a message to one peer in the shared chat. The sender is ALWAYS your own saved chat name (set with chat_set_name). The recipient receives it as a normal chat message and may answer automatically. For broadcast jobs addressed to everyone, use chat_claim or address the message to recipient 'all'.",
            promptSnippet: "Send a peer-chat message to a named participant",
            promptGuidelines: [
                "Use chat_send_message to message a specific peer (eg when the user says 'tell dave the server is fixed').",
            ],
            parameters: Type.Object({
                recipient: Type.String({ description: "The recipient's chat name (case-insensitive)." }),
                message: Type.String({ description: "The message text (multi-line allowed)." }),
            }),
            async execute(_id, params: { recipient?: string; message?: string }) {
                requireEntered();
                const recipient = sanitizeName(String(params.recipient ?? ""));
                if (!recipient) throw new Error("chat_send_message: the recipient cannot be empty.");
                const message = String(params.message ?? "").trim();
                if (!message) throw new Error("chat_send_message: the message cannot be empty.");
                const id = appendAs("message", recipient, message);
                return {
                    content: [{ type: "text", text: `Message sent to ${recipient} (id ${id}). They receive it when their chat watcher picks it up.` }],
                    details: { recipient, id },
                };
            },
        });

        pi.registerTool({
            name: "chat_status",
            label: "Chat Status",
            description:
                "Show the current peer-chat state: your name and role, the shared log file, whether the watcher is running, recent activity (who sent what to whom), who has marked themselves done, and recent participants. Use it before claiming a job or when you need to know who is in the chat.",
            promptSnippet: "Show peer-chat state (name, role, participants, who is done, recent activity)",
            promptGuidelines: [
                "Use chat_status before claiming a broadcast job (to check for an existing claim) and when you need to know who is participating or who has finished.",
            ],
            parameters: Type.Object({}),
            async execute() {
                const name = resolveChatName();
                const role = resolveChatRole();
                const file = resolveChatFile();
                const state = loadState(file, name);
                const recent = scanRecent(file, 8);
                const lines: string[] = [
                    `Chat name: ${name || "(not set — call chat_set_name)"}`,
                    role ? `Role: ${role}` : "Role: (not set — call chat_set_role)",
                    `Log file: ${file}`,
                    `Watcher: ${watcher ? "running" : "starting"}`,
                    `Auto-reply: ${autoReplyEnabled() ? "on" : "off"}`,
                ];
                const done = Object.entries(state.doneBy);
                if (done.length) {
                    lines.push(`Done: ${done.map(([n, note]) => `${n}: ${note}`).join(" | ")}`);
                }
                const participants = [
                    ...new Set(recent.map((r) => r.from).filter((f) => f && f.toLowerCase() !== name.toLowerCase())),
                ];
                if (participants.length) lines.push(`Recent participants: ${participants.join(", ")}`);
                if (recent.length) {
                    lines.push("Recent activity (newest last):");
                    for (const r of recent) {
                        const preview = r.content.split("\n")[0].slice(0, 100);
                        lines.push(`  ${r.from} -> ${r.to} [${r.kind}] ${preview}`);
                    }
                } else {
                    lines.push("Recent activity: none yet.");
                }
                return {
                    content: [{ type: "text", text: lines.join("\n") }],
                    details: { name, role, file },
                };
            },
        });

        pi.registerTool({
            name: "chat_done",
            label: "Chat Done",
            description:
                "Mark that you have finished your part of the current exchange. Writes a visible done notice to the shared chat log addressed to everyone (with an optional summary), cancels any pending auto-reply, and shows in other participants' chat_status. It does NOT disconnect you — you still receive and may answer future messages. Always call this when your work is complete: completion is never silent.",
            promptSnippet: "Mark your part of the peer chat complete (always call when finished)",
            promptGuidelines: [
                "Use chat_done with a short summary whenever you have finished everything asked of you — never stop silently.",
            ],
            parameters: Type.Object({
                note: Type.Optional(Type.String({ description: "Optional short summary of what you finished." })),
            }),
            async execute(_id, params: { note?: string }) {
                requireEntered();
                const note = String(params.note ?? "").trim();
                const id = appendAs("done", "all", note);
                pendingRecipients.clear();
                iAmDone = true;
                return {
                    content: [{ type: "text", text: `Marked yourself done${note ? ` — note: ${note}` : ""}. Peers see it as an informational notice (id ${id}).` }],
                    details: { id },
                };
            },
        });

        pi.registerTool({
            name: "chat_claim",
            label: "Chat Claim",
            description:
                "COMMIT to a broadcast job in the peer chat. Writes a claim notice to everyone: the first claim in the log wins, so before claiming check chat_status (or scan recent activity) for an existing claim of the same task — if one exists, stand down and let the claimer finish, then verify their work. A claim is a commitment: once you claim, do the work, then call chat_done.",
            promptSnippet: "Commit to a broadcast job in the peer chat (first claim wins)",
            promptGuidelines: [
                "Use chat_claim when you decide to take a job broadcast to everyone — after checking chat_status that nobody else claimed it already.",
            ],
            parameters: Type.Object({
                task: Type.String({ description: "Short name of the job you are committing to (eg 'contact form')." }),
            }),
            async execute(_id, params: { task?: string }) {
                const myName = requireEntered();
                const task = String(params.task ?? "").trim();
                if (!task) throw new Error("chat_claim: the task cannot be empty.");
                const matches = (claimText: string): boolean =>
                    claimText.toLowerCase().includes(task.toLowerCase()) ||
                    task.toLowerCase().includes(claimText.toLowerCase());
                const file = resolveChatFile();
                const claims = scanRecent(file, 20).filter((r) => r.kind === "claim");
                // my own earlier claim — idempotent, no duplicate record
                const own = claims.find((c) => c.from.toLowerCase() === myName.toLowerCase() && matches(c.content));
                if (own) {
                    return {
                        content: [{ type: "text", text: `You already claimed "${own.content}" — no need to claim again. Do the work, then call chat_done.` }],
                        details: { task: own.content },
                    };
                }
                for (const c of claims) {
                    if (matches(c.content)) {
                        throw new Error(
                            `Another participant (${c.from}) has already claimed "${c.content}". Stand down and let them finish, then verify their work when they report done.`,
                        );
                    }
                }
                const id = appendAs("claim", "all", task);
                return {
                    content: [{ type: "text", text: `Claimed "${task}" (id ${id}) — you are committed to doing it. Peers have been told. Call chat_done when finished.` }],
                    details: { id, task },
                };
            },
        });

        pi.registerTool({
            name: "chat_clear",
            label: "Chat Clear",
            description:
                "Clear the shared chat log: moves the current contents to a .bak file and resets all read-state. This deletes the conversation history for EVERY participant. Only use it when the user explicitly asks to wipe the chat.",
            promptSnippet: "Clear the shared chat log (destructive — user request only)",
            promptGuidelines: [
                "Use chat_clear ONLY when the user explicitly asks to clear/wipe the chat log.",
            ],
            parameters: Type.Object({}),
            async execute() {
                rotateLog(resolveChatFile());
                return {
                    content: [{ type: "text", text: "Chat log cleared — previous contents moved to a .bak file, all read-state reset." }],
                    details: {},
                };
            },
        });
    }

    // ── slash commands (always registered) ───────────────────────────────────

    const menuHandler = async (_args: string, cctx: ExtensionCommandContext): Promise<void> => {
        if (!isTui(cctx)) {
            aftcConsole.print(
                "Chat commands: /chat-to <name> <msg>, /chat-set-name <name>, /chat-set-role <role>, /chat-status, /chat-check. The menu needs the TUI.",
            );
            return;
        }
        const choice = await showMenu(cctx, {
            title: "Chat options",
            body: ["Please choose:", ""],
            labelWidth: 26,
            help: "↑↓ navigate   Enter confirm   Esc cancel",
            items: [
                { value: "opendir", label: "Open chat log dir" },
                {
                    value: "name",
                    label: "Set your chat name",
                    ...(resolveChatName() ? { description: ` currently "${resolveChatName()}"` } : {}),
                },
                {
                    value: "role",
                    label: "Set your role",
                    ...(resolveChatRole() ? { description: ` currently "${resolveChatRole()}"` } : {}),
                },
                { value: "clear", label: "Clear chat log" },
            ],
        });
        if (!choice) return;
        switch (choice) {
            case "opendir":
                openDir(getChatDir());
                break;
            case "name": {
                const v = await showInput(cctx, {
                    title: "Set your chat name",
                    label: `Name (max ${NAME_MAX} characters)`,
                    required: true,
                    maxLength: NAME_MAX,
                    ...(resolveChatName() ? { initial: resolveChatName() } : {}),
                });
                if (v) {
                    const n = sanitizeName(v);
                    if (n) {
                        setIdentityName(n);
                        aftcConsole.emphasis(cctx, `Chat name set to "${n}" for this pi window (until this session ends).`);
                    }
                }
                break;
            }
            case "role": {
                const v = await showInput(cctx, {
                    title: "Set your role",
                    label: `Role (max ${NAME_MAX} characters)`,
                    required: true,
                    maxLength: NAME_MAX,
                    ...(resolveChatRole() ? { initial: resolveChatRole() } : {}),
                });
                if (v) {
                    const r = sanitizeName(v);
                    if (r) {
                        setIdentityRole(r);
                        aftcConsole.emphasis(cctx, `Chat role set to "${r}" for this pi window (until this session ends).`);
                    }
                }
                break;
            }
            case "clear": {
                const ok = await showConfirm(cctx, {
                    title: "Clear chat log?",
                    body: "This deletes the whole conversation from the shared chat log for every participant (a backup .bak file is kept).",
                });
                if (ok) {
                    rotateLog(resolveChatFile());
                    aftcConsole.emphasis(cctx, "Chat log cleared (backup kept).");
                }
                break;
            }
        }
    };

    const sendToPeer = async (recipient: string, message: string, cctx: ExtensionCommandContext): Promise<void> => {
        const entered = isEntered();
        if (!entered.ok) {
            aftcConsole.warn(cctx, `Set ${entered.missing.join(" and ")} first: /chat-set-name <name> and /chat-set-role <role> (or ask the AI).`);
            return;
        }
        const safe = sanitizeName(recipient);
        if (!safe) {
            aftcConsole.warn(cctx, "The recipient name is empty.");
            return;
        }
        try {
            const id = appendAs("message", safe, message);
            aftcConsole.emphasis(cctx, `Message sent to ${safe} (id ${id}).`);
        } catch (err) {
            aftcConsole.error(cctx, `Could not send: ${(err as Error).message}`);
        }
    };

    pi.registerCommand("chat", {
        description: "Peer chat options menu (sending is done with /chat-to <name> <message> or by asking the AI)",
        handler: async (args, cctx) => {
            if ((args ?? "").trim()) {
                aftcConsole.warn(cctx, "The /chat menu takes no arguments — to send a message use /chat-to <name> <message> (or just ask the AI).");
                return;
            }
            await menuHandler("", cctx);
        },
    });
    registerHelpEntry({ command: "chat", description: "Peer chat options menu", category: "chat" });

    pi.registerCommand("chat-to", {
        description: "Send a peer-chat message to a named participant: /chat-to <name> <message> (multi-word names recognised when the peer is in recent chat activity)",
        handler: async (args, cctx) => {
            const raw = (args ?? "").trim();
            // Tokenize keeping exact end offsets so the message text survives verbatim.
            const tokens: string[] = [];
            const ends: number[] = [];
            let pos = 0;
            while (tokens.length < 5) {
                const m = /^\s*(\S+)/.exec(raw.slice(pos));
                if (!m) break;
                pos += m[0].length;
                tokens.push(m[1]);
                ends.push(pos);
            }
            if (tokens.length < 2) {
                aftcConsole.warn(cctx, "Usage: /chat-to <name> <message>");
                return;
            }
            // Multi-word recipient: the longest leading token run (up to 4
            // words) that matches a known participant wins; otherwise the
            // first word is the recipient.
            const known = new Set(scanRecent(resolveChatFile(), 20).map((r) => r.from.toLowerCase()));
            const myName = resolveChatName();
            if (myName) known.add(myName.toLowerCase());
            let nTokens = 1;
            for (let n = Math.min(4, tokens.length - 1); n >= 2; n--) {
                if (known.has(tokens.slice(0, n).join(" ").toLowerCase())) { nTokens = n; break; }
            }
            const recipient = tokens.slice(0, nTokens).join(" ");
            const message = raw.slice(ends[nTokens - 1]).replace(/^\s+/, "");
            if (!message) {
                aftcConsole.warn(cctx, "Usage: /chat-to <name> <message>");
                return;
            }
            await sendToPeer(recipient, message, cctx);
        },
    });
    registerHelpEntry({ command: "chat-to", description: "Send a peer-chat message to a named participant", category: "chat" });

    pi.registerCommand("chat-set-name", {
        description: "Set your peer-chat participant name: /chat-set-name <name>",
        handler: async (args, cctx) => {
            const n = sanitizeName(args ?? "");
            if (!n) { aftcConsole.warn(cctx, "Usage: /chat-set-name <name>"); return; }
            setIdentityName(n);
            aftcConsole.emphasis(cctx, `Chat name set to "${n}" for this pi window (until this session ends).`);
        },
    });
    registerHelpEntry({ command: "chat-set-name", description: "Set your peer-chat name", category: "chat" });

    pi.registerCommand("chat-set-role", {
        description: "Set your peer-chat role: /chat-set-role <role>",
        handler: async (args, cctx) => {
            const r = sanitizeName(args ?? "");
            if (!r) { aftcConsole.warn(cctx, "Usage: /chat-set-role <role>"); return; }
            setIdentityRole(r);
            aftcConsole.emphasis(cctx, `Chat role set to "${r}" for this pi window (until this session ends).`);
        },
    });
    registerHelpEntry({ command: "chat-set-role", description: "Set your peer-chat role", category: "chat" });

    // /chat-set — guided identity setup: two questions in pi's own input
    // area (ctx.ui.input), name first, then role. pi's native input has no
    // length cap, so over-long answers are truncated to NAME_MAX and the
    // user is told.
    pi.registerCommand("chat-set", {
        description: "Set up your peer-chat identity (asks for this AI's name, then its role)",
        handler: async (_args, cctx) => {
            if (!cctx.hasUI) {
                aftcConsole.warn(cctx, "/chat-set needs the TUI. Use /chat-set-name <name> and /chat-set-role <role> instead.");
                return;
            }
            const ask = async (title: string, current: string): Promise<string | null> => {
                const v = await cctx.ui.input(title, current ? `current: ${current}` : "");
                if (v === undefined) return null; // cancelled
                const clean = sanitizeName(v);
                if (!clean) {
                    aftcConsole.warn(cctx, "Nothing usable entered — keeping the current value.");
                    return null;
                }
                if (clean.length < v.trim().length || v.trim().length > NAME_MAX) {
                    aftcConsole.info(cctx, `Names and roles are capped at ${NAME_MAX} characters — saved as "${clean}".`);
                }
                return clean;
            };
            const n = await ask("What is this AI's name?", resolveChatName());
            if (n === null) return;
            const r = await ask("What is this AI's role?", resolveChatRole());
            if (r === null) return;
            setIdentityName(n);
            setIdentityRole(r);
            aftcConsole.emphasis(cctx, `Chat identity set for this pi window: "${n}" (${r}) — until this session ends.`);
        },
    });
    registerHelpEntry({ command: "chat-set", description: "Set up your peer-chat name and role (guided)", category: "chat" });

    pi.registerCommand("chat-clear", {
        description: "Clear the shared chat log (moves contents to a .bak and resets read-state)",
        handler: async (_args, cctx) => {
            if (isTui(cctx)) {
                const ok = await showConfirm(cctx, {
                    title: "Clear chat log?",
                    body: "This deletes the whole conversation from the shared chat log for every participant (a backup .bak file is kept).",
                });
                if (!ok) return;
            }
            rotateLog(resolveChatFile());
            aftcConsole.emphasis(cctx, "Chat log cleared (backup kept).");
        },
    });
    registerHelpEntry({ command: "chat-clear", description: "Clear the shared chat log", category: "chat" });

    pi.registerCommand("chat-check", {
        description: "Check the peer chat for new messages since your last check (also shows who has marked themselves done)",
        handler: async (_args, cctx) => {
            const file = resolveChatFile();
            const state = loadState(file, resolveChatName());
            const text = readLog(file);
            const lines = text.split("\n");
            const startLine = Math.min(state.lastCheckedLine, lines.length);
            const { records, nextLine } = parseRecords(text, startLine);
            // Resume at the parser's boundary (end of the last COMPLETE record),
            // NOT lines.length — the split phantom element would push the next
            // check past the following record's header and skip it forever.
            state.lastCheckedLine = Math.max(state.lastCheckedLine, nextLine);
            for (const r of records) {
                if (r.kind === "done") state.doneBy[r.from.toLowerCase()] = r.content || "(no note)";
            }
            saveState(file, state, resolveChatName());
            if (records.length === 0) {
                aftcConsole.emphasis(cctx, "No new chat messages.");
            } else {
                for (const r of records) {
                    const preview = r.content.split("\n")[0].slice(0, 100);
                    aftcConsole.info(cctx, `[${r.kind}] ${r.from} -> ${r.to}: ${preview}`);
                }
            }
            const done = Object.entries(state.doneBy);
            if (done.length) {
                aftcConsole.info(cctx, `Done: ${done.map(([n, note]) => `${n}: ${note}`).join(" | ")}`);
            }
        },
    });
    registerHelpEntry({ command: "chat-check", description: "Check the chat for new messages", category: "chat" });

    pi.registerCommand("chat-status", {
        description: "Show peer-chat state: name, role, log file, watcher, recent activity, who is done",
        handler: async (_args, cctx) => {
            const name = resolveChatName();
            const role = resolveChatRole();
            const file = resolveChatFile();
            const state = loadState(file, resolveChatName());
            const recent = scanRecent(file, 8);
            aftcConsole.emphasis(cctx, `Chat name: ${name || "(not set)"}${role ? `  Role: ${role}` : ""}`);
            aftcConsole.info(cctx, `Log file: ${file}`);
            aftcConsole.info(cctx, `Watcher: ${watcher ? "running" : "starting"}   Auto-reply: ${autoReplyEnabled() ? "on" : "off"}`);
            const done = Object.entries(state.doneBy);
            if (done.length) {
                aftcConsole.info(cctx, `Done: ${done.map(([n, note]) => `${n}: ${note}`).join(" | ")}`);
            }
            if (recent.length) {
                aftcConsole.info(cctx, "Recent activity:");
                for (const r of recent) {
                    const preview = r.content.split("\n")[0].slice(0, 100);
                    aftcConsole.info(cctx, `  ${r.from} -> ${r.to} [${r.kind}] ${preview}`);
                }
            } else {
                aftcConsole.info(cctx, "No chat activity yet.");
            }
        },
    });
    registerHelpEntry({ command: "chat-status", description: "Show peer-chat state", category: "chat" });

    // Chat is ALWAYS ON (user decision) — no enable/disable switch anywhere.
    registerTools();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Open a directory in the OS file manager (detached; never blocks pi). */
export function openDir(dir: string): void {
    let cmd: string;
    let args: string[];
    if (process.platform === "win32") { cmd = "explorer.exe"; args = [dir]; }
    else if (process.platform === "darwin") { cmd = "open"; args = [dir]; }
    else { cmd = "xdg-open"; args = [dir]; }
    try {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.unref();
    } catch (err) {
        aftcConsole.logError(`[aftc-toolset] chat openDir error: ${(err as Error).message}`);
    }
}
