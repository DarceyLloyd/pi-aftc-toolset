/**
 * pi-aftc-toolset — think-tag parser feature module.
 *
 * Converts inline `<think>...</think>` tags inside assistant text into
 * proper pi `ThinkingContent` blocks. Without this, models that emit
 * thinking as text-tags (the DeepSeek / Qwen convention) show the raw
 * `<think>` markers in the TUI. With this hook active, the tags are
 * stripped at message-finalize time and replaced with pi's standard
 * collapsible thinking rendering (theme `thinkingText`, `Ctrl+T` toggle,
 * `hideThinkingBlock` setting — all native, no UI work here).
 *
 * Architecture — single hook, no shared state, no commands:
 *
 *   pi.on("message_end", …) walks `event.message.content`. For each
 *   TextContent block, every `<think>…</think>` substring is split out
 *   into a sibling ThinkingContent block, in source order. Non-text
 *   blocks (ToolCall, existing ThinkingContent) pass through unchanged.
 *
 * Idempotent / safe:
 *   - Skips when the message already contains a ThinkingContent block
 *     (don't fight native reasoning providers like Anthropic).
 *   - Skips when stopReason is "error" or "aborted" (don't mangle
 *     partial output).
 *   - Skips text blocks that carry `textSignature` (preserves
 *     provider-side signature replay — modifying a signed text block
 *     would invalidate the signature on the next turn).
 *
 * Streaming caveat:
 *   `message_end` is the only message-replacement hook (`message_update`
 *   does not support `{ message }`). During streaming, raw `<think>`
 *   tags are visible in the TUI until the assistant turn finalizes, at
 *   which point this hook collapses them into proper blocks. Acceptable
 *   for a first cut — matches the behaviour of every other "strip on
 *   finalize" provider in the wild (DeepSeek, Qwen via openrouter, etc.).
 *
 * Per rules.md §1.5, this is a self-contained feature module: no
 * commands, no shared state, no dependencies on other feature modules,
 * wired into pi by the orchestrator in index.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TextContent, ThinkingContent } from "@earendil-works/pi-ai";
import { getPreference, setPreference } from "./state";

// ─────────────────────────────────────────────────────────────────────────────
// Regex — global, non-greedy, requires closing tag. Unclosed `<think>` is
// left as plain text (we never swallow half a tag).
// ─────────────────────────────────────────────────────────────────────────────

const THINK_RE = /<think>([\s\S]*?)<\/think>/g;

// ─────────────────────────────────────────────────────────────────────────────
// Block-type guards — narrowed locally to avoid pulling `AgentMessage`
// (not exported from `@earendil-works/pi-coding-agent`'s public surface).
// Matches the same shape `event.message.content` has at runtime for an
// assistant message: (TextContent | ThinkingContent | ToolCall)[].
// ─────────────────────────────────────────────────────────────────────────────

interface AssistantContentBlock {
    type: string;
}

function isTextBlock(b: AssistantContentBlock): b is TextContent {
    return b.type === "text";
}

function isThinkingBlock(b: AssistantContentBlock): b is ThinkingContent {
    return b.type === "thinking";
}

function hasThinkingSignature(b: TextContent): boolean {
    // textSignature is optional; presence means a provider (Anthropic,
    // etc.) attached a signature for replay validation. Don't touch it.
    return typeof b.textSignature === "string" && b.textSignature.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Split one TextContent block into an ordered list of TextContent /
// ThinkingContent blocks. Adjacent text and thinking segments are kept in
// source order so the rendered output reads identically to the original
// minus the literal `<think>` / `</think>` markers.
// ─────────────────────────────────────────────────────────────────────────────

function splitTextBlock(block: TextContent): Array<TextContent | ThinkingContent> {
    const text = block.text;
    if (!text.includes("<think>")) {
        // Common case — no tag present, return the original block
        // reference unchanged so we don't allocate a copy.
        return [block];
    }

    const out: Array<TextContent | ThinkingContent> = [];
    let lastIndex = 0;
    THINK_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = THINK_RE.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index);
        if (before.length > 0) {
            out.push({ type: "text", text: before });
        }
        const thinking = match[1];
        if (thinking.length > 0) {
            out.push({ type: "thinking", thinking });
        }
        lastIndex = match.index + match[0].length;
    }

    const after = text.slice(lastIndex);
    if (after.length > 0) {
        out.push({ type: "text", text: after });
    }

    // If we didn't extract any thinking blocks (e.g. text contained
    // `<think>` but no matching `</think>` — an unclosed tag), return
    // the original block reference so the caller can detect "no real
    // change happened" and avoid an unnecessary message replacement.
    if (out.length === 0) {
        return [block];
    }
    const extractedThinking = out.some(
        (b) => b.type === "thinking",
    );
    if (!extractedThinking) {
        return [block];
    }

    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Walk an assistant message's content array and return a transformed
// copy with think-tags extracted, or `undefined` if no change was made
// (signals the hook to leave the message alone — keeps `event.message`
// referentially equal in the no-op case).
// ─────────────────────────────────────────────────────────────────────────────

type ContentBlock = TextContent | ThinkingContent | AssistantContentBlock;

function transformContent(
    content: ContentBlock[],
): Array<TextContent | ThinkingContent | AssistantContentBlock> | undefined {
    // Skip if the message already has a thinking block — the provider
    // already produced proper structured thinking; our text-tag work
    // would only conflict.
    for (const b of content) {
        if (isThinkingBlock(b)) return undefined;
    }

    let changed = false;
    const next: ContentBlock[] = [];

    for (const block of content) {
        if (!isTextBlock(block)) {
            // ToolCall, ImageContent, anything else — pass through.
            next.push(block);
            continue;
        }

        // Don't touch signed text blocks — splitting would invalidate
        // the signature on next-turn replay.
        if (hasThinkingSignature(block)) {
            next.push(block);
            continue;
        }

        if (!block.text.includes("<think>")) {
            next.push(block);
            continue;
        }

        const split = splitTextBlock(block);
        // splitTextBlock always returns at least one element when
        // called with a block that contains `<think>`; the array is
        // never empty here.
        if (split.length === 1 && split[0] === block) {
            // splitTextBlock short-circuits in this case but be defensive.
            next.push(block);
            continue;
        }

        changed = true;
        for (const seg of split) next.push(seg);
    }

    return changed ? next : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createThinkParser(pi: ExtensionAPI): void {
    // Opt-in: off by default. Users enable it with
    // /aftc-enable-think-processing. State persists in state.json
    // (a USER PREFERENCE that survives /reload, /new, and fresh pi
    // startup). Reading once at startup avoids a per-turn
    // preference lookup; toggling requires /reload to take effect.
    const enabled = getPreference("thinkProcessingEnabled", false);
    if (enabled) registerThinkParserHook(pi);

    pi.registerCommand("aftc-enable-think-processing", {
        description: "Enable the <think>…</think> → ThinkingContent hook (requires /reload to take effect)",
        handler: async (_args: string, ctx: { ui: { notify?: (m: string, l: string) => void; hasUI?: boolean } }) => {
            setPreference("thinkProcessingEnabled", true);
            if (ctx.ui?.notify) ctx.ui.notify("Think-tag processing ON. Run /reload to activate.", "info");
        },
    });

    pi.registerCommand("aftc-disable-think-processing", {
        description: "Disable the <think>…</think> → ThinkingContent hook (requires /reload to take effect)",
        handler: async (_args: string, ctx: { ui: { notify?: (m: string, l: string) => void; hasUI?: boolean } }) => {
            setPreference("thinkProcessingEnabled", false);
            if (ctx.ui?.notify) ctx.ui.notify("Think-tag processing OFF. Run /reload to deactivate.", "info");
        },
    });

    if (enabled) {
        console.log(
            "[aftc-toolset] loaded — /aftc-enable-think-processing, /aftc-disable-think-processing (think-tag parsing: ON)",
        );
    } else {
        console.log(
            "[aftc-toolset] loaded — /aftc-enable-think-processing, /aftc-disable-think-processing (think-tag parsing: OFF; opt-in)",
        );
    }
}

/** The actual hook. Split out so the toggle commands can re-register
 *  it after a /reload once the preference flips. */
function registerThinkParserHook(pi: ExtensionAPI): void {
    pi.on("message_end", async (event, _ctx) => {
        // `event` is typed as `MessageEndEvent` by the `pi.on("message_end", ...)`
        // overload (see `@earendil-works/pi-coding-agent` extensions types).
        // `event.message` is `AgentMessage` whose runtime shape for assistant
        // messages is `{ role: "assistant", content: [...], stopReason, ... }`.
        // We narrow at runtime (rather than importing AgentMessage, which isn't
        // re-exported from the public API surface) — same pattern as core.ts.
        const message = event.message;
        if (!message || message.role !== "assistant") return undefined;
        if (message.stopReason === "error" || message.stopReason === "aborted") {
            return undefined;
        }
        if (!Array.isArray(message.content)) return undefined;

        const nextContent = transformContent(
            message.content as ContentBlock[],
        );
        if (!nextContent) return undefined;

        // Replace the message; pi requires the role to be preserved,
        // which it is (we only mutated `content`).
        return {
            message: {
                ...message,
                content: nextContent,
            },
        };
    });
}
