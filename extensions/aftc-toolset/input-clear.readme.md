# input-clear.ts

Single-purpose module - the `alt+c` keyboard shortcut to clear the
text in pi's input editor.

## What it does

Press `alt+c` while the editor has focus and the text is replaced
with `""`. The next keystroke starts a fresh prompt.

## Why a dedicated module for one shortcut

Because the project layout is "one feature per file" (.dev/dev_guide.md
section 1.4). Other shortcuts / commands live in their feature's file -
`alt+c` is the only shortcut this extension registers, so it
gets its own file.

## Public factory

```typescript
export function createInputClear(pi: ExtensionAPI): void
```

No return value. The module is fully self-contained - registers
the shortcut and is done.

## Shortcuts registered (1)

- `alt+c` - clear the input editor. Guarded by
  `ctx.ui.setEditorText` existence, so it's a no-op in modes that
  don't have an editor (RPC, JSON, print).
