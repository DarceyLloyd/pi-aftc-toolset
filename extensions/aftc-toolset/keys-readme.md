# keys.ts

Central home for every keyboard shortcut the toolset registers. Replaces
the old single-shortcut `input-clear.ts` (its `alt+c` moved here) and adds
newline insertion.

## What it does

| Shortcut | Action |
| --- | --- |
| `alt+c` | Clear the input editor (start typing fresh) |
| `alt+n` | Insert a newline at the caret — multi-line formatting without submitting |

`alt+n` uses `ctx.ui.pasteToEditor("\n")`, which routes through the
editor's own paste handling and therefore inserts at the caret.
`setEditorText()` would replace the whole buffer and move the caret to
the end, so it is not used here.

Both handlers are guarded by `ctx.hasUI`, so they are no-ops in modes
without an editor (print / JSON).

## Public factory

```typescript
export function createKeys(pi: ExtensionAPI): void
```

No return value. Self-contained: registers two shortcuts and is done.

## Shortcuts registered (2)

- `alt+c` — clear the input editor
- `alt+n` — insert a newline at the caret
