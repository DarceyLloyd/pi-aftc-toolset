# keys.ts

Central home for every keyboard shortcut the toolset registers. Replaces
the old single-shortcut `input-clear.ts` (its `alt+c` moved here), adds
newline insertion, and owns the input cut-to-clipboard action (shortcut +
slash command share one handler).

## What it does

| Shortcut | Action |
| --- | --- |
| `alt+c` | Clear the input editor (start typing fresh) |
| `alt+n` | Insert a newline at the caret — multi-line formatting without submitting |
| `alt+x` | Cut ALL input-editor text to the system clipboard |

`alt+n` uses `ctx.ui.pasteToEditor("\n")`, which routes through the
editor's own paste handling and therefore inserts at the caret.
`setEditorText()` would replace the whole buffer and move the caret to
the end, so it is not used here.

All handlers are guarded by `ctx.hasUI`, so they are no-ops in modes
without an editor (print / JSON).

## Cut to clipboard (`alt+x` / `/aftc-cut-input`)

One shared handler (`cutInputToClipboard`) backs both the `alt+x`
shortcut and the `/aftc-cut-input` slash command:

1. Read the editor with `ctx.ui.getEditorText()`; empty (or whitespace
   only) → `aftcConsole.warn` ("nothing to cut") and stop.
2. Copy via pi's own `copyToClipboard` (exported from
   `@earendil-works/pi-coding-agent` — the same helper pi's built-in copy
   features use). It is cross-platform: native addon, then
   `pbcopy` (macOS) / `clip` (Windows) / `wl-copy` / `xclip` / `xsel` /
   `termux-clipboard-set` (Linux), then an OSC 52 fallback (also covers
   remote SSH sessions). It throws when every method fails.
3. Only AFTER the copy succeeds, clear the editor with
   `ctx.ui.setEditorText("")` — cut semantics: a failed copy must never
   lose the text (failure → `aftcConsole.error`, input left intact).
4. Success → `aftcConsole.emphasis` with the cut character count.

The slash command exists for discoverability (`/aftc-help`) and RPC mode
(where there is no key event stream). In the TUI a slash command consumes
the editor line it was typed on, so it usually finds an empty editor
there — day to day, use `alt+x`.

## Public factory

```typescript
export interface KeysDeps {
    copy?: (text: string) => Promise<void>; // tests only
}
export function createKeys(pi: ExtensionAPI, deps: KeysDeps = {}): void
```

No return value. Self-contained: registers three shortcuts and one slash
command (with its help-registry entry) and is done. `deps.copy` defaults
to pi's `copyToClipboard`; tests inject a fake so no real clipboard is
touched.

## Shortcuts registered (3)

- `alt+c` — clear the input editor
- `alt+n` — insert a newline at the caret
- `alt+x` — cut all input text to the clipboard

## Commands registered (1)

- `/aftc-cut-input` — cut all input-editor text to the clipboard
  (help category: General)
