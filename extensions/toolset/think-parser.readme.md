# think-parser.ts

Converts inline `<think>...</think>` tags inside assistant text into
proper pi `ThinkingContent` blocks at message-finalize time.

## What it does

Registers one `message_end` handler that:

1. Walks `event.message.content` for assistant messages.
2. For each `TextContent` block, splits on `/<think>([\s\S]*?)<\/think>/g`
   and emits ordered segments:
   - text before → `TextContent`
   - matched inner content → `ThinkingContent { type: "thinking", thinking }`
   - text after → `TextContent`
3. Returns `{ message: { ...event.message, content: nextContent } }`
   when the content array changed; `undefined` otherwise (so the
   no-op case keeps the original message reference intact).

After this hook runs, the rendered assistant reply shows pi's standard
collapsible thinking block — theme `thinkingText` colour, `Ctrl+T`
toggles visibility, `hideThinkingBlock` setting hides them entirely.
The raw `<think>` / `</think>` markers never appear in the TUI once
the message has finalized.

## Why this exists

Some reasoning models emit their internal monologue as text wrapped in
`<think>...</think>` tags (the DeepSeek / Qwen convention). pi's
provider integrations for those models parse the tags out of the
stream into structured `ThinkingContent` blocks before they reach the
TUI. Models whose provider wrapper does NOT do that conversion
(including the active `minimax/MiniMax-M3` model) emit the tags as
plain text. Without this hook, every assistant reply shows literal
`<think>reasoning here</think>` markup in the conversation.

This hook is the client-side shim — it does the conversion at the
extension layer instead of waiting for an upstream provider fix.

## How it works

The `message_end` hook is the only message-lifecycle event that allows
returning a replacement message (`MessageEndEventResult.message`).
`message_start` and `message_update` are read-only — only the
finalized message at turn end can be rewritten. This means:

- During streaming, the raw `<think>...</think>` text IS visible
  briefly in the TUI. This is unavoidable without a custom message
  renderer that intercepts on every keystroke (significantly more
  complex, and not justified for a first cut).
- The moment the assistant message finalizes, this hook runs and the
  tags collapse into the proper thinking block. The user sees a brief
  flash and then the cleaned-up rendering.

That streaming flash matches the behaviour of every other
"strip-on-finalize" provider in the wild.

## Behaviour matrix

| Condition | Behaviour |
|---|---|
| Assistant message, `stopReason: "stop"` / `"length"` / `"toolUse"`, has `<think>…</think>` in text | Convert tags into thinking blocks; return replaced message |
| Assistant message, has no `<think>` tag in any text block | No-op — return `undefined`, original message unchanged |
| Assistant message, already has a `ThinkingContent` block | No-op — provider already produced native thinking, our work would conflict |
| Assistant message, `stopReason: "error"` or `"aborted"` | No-op — don't mangle partial/broken output |
| Text block carries `textSignature` | Pass through unchanged — splitting would invalidate the signature on next-turn replay |
| Non-text blocks (`ToolCall`, `ImageContent`, …) | Pass through unchanged |
| Multiple `<think>…</think>` pairs in one text block | All extracted in source order |
| Empty `<think></think>` (no inner content) | Skipped — no blank thinking block emitted |

## Edge cases handled

- **Multiple tags in one block:** `x<think>a</think>y<think>b</think>z`
  → `text "x"` + `thinking "a"` + `text "y"` + `thinking "b"` +
  `text "z"` (source order preserved).
- **Tag at start of block:** `<think>a</think>hello` → `thinking "a"` +
  `text "hello"`.
- **Tag at end of block:** `hello<think>a</think>` → `text "hello"` +
  `thinking "a"`.
- **Unclosed tag:** left untouched (regex requires the closing
  `</think>`; never swallows half a tag).
- **Empty thinking:** `<think></think>` produces no `ThinkingContent`
  block (avoids empty panels in the UI).
- **Signed text:** `textSignature`-bearing blocks are passed through
  to preserve next-turn replay validation for providers that use
  signatures.
- **Multiple text blocks** (e.g. after a tool call): each is scanned
  independently.

## Why a hook, not a custom message renderer

A `registerMessageRenderer` could hide the tags on the fly during
streaming, but it would also need to render the rest of the message
(including thinking blocks) — duplicating pi's built-in text rendering
for every assistant reply. The `message_end` hook is a 4-line rewrite
of the message, much simpler, and produces the right final result.

## Why a hook, not a system-prompt instruction

You cannot ask the model to "not emit `<think>` tags" — reasoning
models emit them as part of their chain-of-thought, the tag is a
structural delimiter of the model's own output format. The fix has to
be downstream of generation, which is exactly what this hook does.

## Events subscribed

- `message_end` — single handler. Returns `{ message }` to replace
  the finalized assistant message when content was modified; returns
  `undefined` otherwise.

No commands. No shortcuts. No state. No background resources.

## Public factory

```typescript
export function createThinkParser(pi: ExtensionAPI): void
```

Returns void — the module is self-contained and stateless. The
orchestrator (`index.ts`) calls this once at startup; the rest of the
lifecycle is per-message-end invocation.

## Failure modes

- **`event.message` undefined or wrong shape** — guarded. Runtime
  check `message && message.role === "assistant"` and
  `Array.isArray(message.content)`. Returns `undefined` on any miss.
- **Provider already produces native thinking** — guarded. Early
  return when any `ThinkingContent` block exists in the message; we
  never fight native provider output.
- **Streaming flash of raw tags** — accepted. Documented above;
  matches the rest of the ecosystem.

## See also

- pi docs: `docs/extensions.md` §"message_start / message_update /
  message_end" — the only replacement-capable message hook.
- pi docs: `docs/session-format.md` §"Content Blocks" — the
  `ThinkingContent` shape this hook emits.
- pi docs: `docs/settings.md` §"Model & Thinking" — the
  `hideThinkingBlock` setting that hides emitted thinking blocks
  globally.
- pi keybindings: `app.thinking.toggle` (`Ctrl+T`) — toggles
  visibility of emitted thinking blocks per session.
