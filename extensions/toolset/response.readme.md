# response.ts

Full-width themed horizontal rule injected just before each
assistant reply. The visual separator between turns.

## Architecture — three hooks cooperate

1. **`registerMessageRenderer` for `DIVIDER_TYPE`** — the renderer
   returns a Component whose `render(width)` emits a single
   themed line, so the rule is ALWAYS exactly the pane width — no
   hardcoded width, no wrapping, no truncation. The renderer reads
   the current active theme and applies it.

2. **`before_agent_start`** — injects a custom message of our type
   as the first thing in the turn. The message is:
   - Persisted to the session (survives `/resume` and `/compact`).
   - Rendered in the TUI (so the user sees it).
   - Filtered back out by the `context` handler before the LLM
     sees it (never pollutes the model's context).

3. **`context`** — strips our custom messages from the LLM-visible
   list. No-op when none are present (e.g. on tool-call follow-up
   turns).

## Configuration knobs

The file exposes three top-of-file constants:

- `HR_BG_COLOR` — set to a `*Bg` theme token (e.g. `selectedBg`,
  `toolPendingBg`, `customMessageBg`) for a solid color bar that
  spans the full pane width. Set to `""` for a character-based
  rule instead.
- `HR_COLOR` — foreground color used when `HR_BG_COLOR` is `""`
  (i.e. character mode). Good picks: `borderMuted`, `dim`,
  `border`, `mdHr`, `accent`.
- `HR_CHAR` — the character to repeat across the width in
  character mode. One cell per character; visible width = width
  × character-width. Common picks: `"─"`, `"━"`, `"═"`, `"▔"`,
  `"—"`, `" "` (invisible bar with bg only).

## Toggle

`/aftc-response-divider` (default: ON). When disabled:
- `before_agent_start` returns nothing → no new dividers
  injected.
- The renderer's `render(width)` returns `[]` → existing
  dividers collapse on the next TUI paint (forced via
  `setStatus` which triggers `requestRender`).

## Events subscribed

None directly — only `registerMessageRenderer` and
`registerCommand`.

## Commands registered (1)

- `/aftc-response-divider` — toggle the divider on/off.
