/**
 * pi-aftc-toolset / copy-all — copy the conversation to the clipboard.
 *
 * `/copy-all` copies every previous user and assistant message in the current
 * thread to the system clipboard, separated by "---" rules, each prefixed
 * with USER: / ASSISTANT:. Assistant thinking blocks and tool-call/tool-result
 * entries are excluded (only the visible text + a placeholder for images).
 *
 * Always available (a simple read + clipboard command, like /theme or /kis) —
 * no enable flag, no model tool, no background work. Uses pi's own
 * `copyToClipboard` helper (cross-platform; throws when no clipboard exists).
 *
 * See copy-all-readme.md for the full contract.
 */

import {
    copyToClipboard,
    type ExtensionAPI,
    type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { registerHelpEntry } from "./help-registry";
import * as aftcConsole from "./ui/aftc-console";

/** Upper bound on the copied text (2M chars ≈ 2 MB). A clipboard with a
 *  multi-megabyte payload is unwieldy and some clipboards reject it. */
const MAX_COPY_CHARS = 2_000_000;

/** Extract visible text from a message content (string | block array). */
function textFromContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
        .map((block) => {
            if (!block || typeof block !== "object" || !("type" in block)) return "";
            const type = (block as { type?: string }).type;
            if (type === "text") {
                const text = (block as { text?: unknown }).text;
                return typeof text === "string" ? text : "";
            }
            if (type === "image") return "[image]";
            // thinking / tool_use / tool_result blocks are deliberately
            // skipped: copy the visible conversation, not the reasoning.
            return "";
        })
        .filter(Boolean)
        .join("\n");
}

/** Pull role + content out of an entry, tolerant of the wrapped message
 *  shape (`{ type: "message", message: { role, content } }`) and the flat
 *  shape (`{ role, content }`). */
function messageFromEntry(entry: unknown): { role: string; content: unknown } | null {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    if (e.type === "message" && e.message && typeof e.message === "object") {
        return e.message as { role: string; content: unknown };
    }
    if (typeof e.role === "string" && "content" in e) {
        return { role: e.role, content: e.content };
    }
    return null;
}

export function createCopyAll(pi: ExtensionAPI): void {
    registerHelpEntry({
        command: "copy-all",
        description: "Copy all user and assistant messages in this thread to the clipboard",
        category: "General",
    });

    pi.registerCommand("copy-all", {
        description:
            "Copy all previous user and assistant messages in this thread to the clipboard (assistant thinking is excluded).",
        handler: async (_args, ctx: ExtensionCommandContext) => {
            await ctx.waitForIdle();

            let entries: unknown[] = [];
            try {
                const session = ctx.sessionManager as {
                    getBranch?: () => unknown[];
                    getEntries?: () => unknown[];
                };
                entries =
                    (typeof session?.getBranch === "function"
                        ? session.getBranch()
                        : typeof session?.getEntries === "function"
                            ? session.getEntries()
                            : []) ?? [];
            } catch {
                // Fall through to an empty result below.
            }

            const sections = entries
                .map(messageFromEntry)
                .filter(
                    (msg): msg is { role: string; content: unknown } =>
                        msg !== null &&
                        (msg.role === "user" || msg.role === "assistant"),
                )
                .map((msg) => ({
                    role: msg.role,
                    content: textFromContent(msg.content).trim(),
                }))
                .filter((section) => section.content.length > 0)
                .map((section) => `${section.role.toUpperCase()}:\n${section.content}`);

            if (sections.length === 0) {
                aftcConsole.info(ctx, "No user or assistant messages to copy.");
                return;
            }

            let text = sections.join("\n\n---\n\n");
            let truncated = false;
            if (text.length > MAX_COPY_CHARS) {
                truncated = true;
                text = text.slice(0, MAX_COPY_CHARS);
            }

            try {
                await copyToClipboard(text);
            } catch (err) {
                aftcConsole.error(
                    ctx,
                    `Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}`,
                );
                return;
            }

            aftcConsole.emphasis(
                ctx,
                `Copied ${sections.length} message${sections.length === 1 ? "" : "s"} to clipboard${truncated ? " (truncated to 2 MB)" : ""}.`,
            );
        },
    });
}
