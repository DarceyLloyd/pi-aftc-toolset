# copy-all — copy the conversation to the clipboard

`/copy-all` copies every previous user and assistant message in the current
thread to the system clipboard, joined with `---` separators and prefixed
`USER:` / `ASSISTANT:`.

## What it copies

- User and assistant **message** entries only (tool calls, tool results and
  other entry kinds are excluded).
- Visible **text** blocks; images become an `[image]` placeholder.
- **Thinking blocks are excluded** — the clipboard gets the visible
  conversation, not the reasoning.

## Behaviour

- Always available (a simple read + clipboard command, like `/theme` or
  `/kis`) — no enable flag, no model tool, no background work.
- Uses pi's own `copyToClipboard` (cross-platform; throws when no clipboard
  exists — caught and reported via aftc-console).
- `await ctx.waitForIdle()` so the copy reflects the settled transcript.
- Entries are read via `sessionManager.getBranch()` (falls back to
  `getEntries()`), and the extractor tolerates both the wrapped
  (`{ type: "message", message: {...} }`) and flat (`{ role, content }`)
  shapes.
- Bounded at `MAX_COPY_CHARS` (2,000,000) — oversized threads are truncated
  and the confirmation says so.
