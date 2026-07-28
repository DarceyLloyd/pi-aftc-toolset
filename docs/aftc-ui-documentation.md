# AFTC UI Dialogs (`extensions/aftc-toolset/ui/aftc-ui.ts`)

Single source for every interactive screen in the toolset. Callers pass data
and await the result. Never hand-build dialog chrome (borders, selection bars,
hints, geometry) inside feature modules — call these helpers or compose the
exported `AftcUi` primitives.

**Shared contract:** GRUB-style full-screen takeover (black background,
`#555555` borders, `#fca02f` titles/values, `#2d1d08` selection bar).
Exactly one visibly active element at a time. Escape cancels to `null`/`false`.

**Non-TUI guards:** `showMenu`/`showForm`/`showInput*` resolve `null`,
`showConfirm` falls back to `ctx.ui.confirm`, `showViewer` prints lines with
the `[aftc-toolset]` prefix.

---

## Menu values, current item, and selection (BINDING)

Three distinct things — never conflate them:

1. **A setting's current *value*** (ON/OFF, Yes/No, a path, a mode).
2. **A picker's current *effective item*** (the active theme / depth / sound).
3. **The moving `>` highlight** — owned by `aftc-ui`; never replicate it.

### Rules

- **Never append a value or marker directly onto a label.** No `SomeOptionOn`,
  no `AnotherOption[default]`. Always separate label from value/marker.
- **Settings screen** (list of preferences): stable label + value in an aligned
  column via `labelWidth`, separated by ` | `:
  `{ label: "AFTC Codex Enabled", description: " | Yes" }`.
  Use Yes/No for "Enabled"-style labels, ON/OFF for feature toggles, the
  literal value otherwise. Reference: `codex-commands.ts`.
- **Picker with a persistent effective value** (theme, depth, sound): mark that
  row with **`(current)`** in the description column, state `Current: X` in the
  body, AND pre-select with `initialIndex`. Use the word **`current`**, never
  `selected` (collides with the arrow-key highlight).
- **Pure navigation list** (eg `/cd` browser): NO current marker. `description`
  may carry a hint (path, id) but never a fake "current".
- **Preserve the highlighted row across in-place re-renders.** A menu that
  re-renders after toggling a value (STABLE listing) must track the highlighted
  index and pass it back as `initialIndex`. Reset to top ONLY when listing
  CONTENT changes (eg navigating into a different folder).

### Code patterns

```ts
// Settings screen — aligned value column + selection preserved across toggles
const items = [
    { value: "master", label: "AFTC Codex Enabled", description: enabled ? " | Yes" : " | No" },
    { value: "guidance", label: "Thinking Guidance Injection", description: ` | ${on ? "ON" : "OFF"}` },
];
let selectedIndex = 0;
while (true) {
    const choice = await showMenu(ctx, { title: "Menu:", labelWidth: 28, initialIndex: selectedIndex, items });
    if (!choice) return;
    selectedIndex = Math.max(0, items.findIndex((i) => i.value === choice));
    // ...toggle the chosen preference; loop re-renders with fresh values...
}

// Picker — mark the effective item, pre-select it
const items = themes.map((t) => ({
    value: t.name, label: t.name,
    description: t.name === currentName ? " (current)" : undefined,
}));
await showMenu(ctx, { title: "Select theme", labelWidth: maxNameLen + 1, initialIndex: currentIndex, items });
```

---

## API Reference

### `showMenu(ctx, options) -> string | null`

Selectable list. Up/Down wrap, PgUp/PgDn page, Home/End and Ctrl+PgUp/Ctrl+PgDn
jump to edges, Enter selects, Esc resolves null. `body` lines word-wrap
automatically.

```ts
const value = await showMenu(ctx, {
    title: "Pick a server",
    items: [{ value: "a", label: "alpha", description: "optional" }],
    initialIndex: 0,        // optional
    body: ["Choose one:"], // optional lines above the list
    help: "...",            // optional footer override
    fullscreen: false,      // optional: floating panel instead of takeover
    onHighlight: (item, i) => {}, // optional; fires on real moves only
    labelWidth: 24,         // optional: pad labels so descriptions align
});
```

### `showConfirm(ctx, options) -> boolean`

Two-choice confirm. Safe option (no) highlighted by default. Esc resolves false.

```ts
const sure = await showConfirm(ctx, {
    title: "Forget SSH connection?",
    body: "Remove this saved local SSH connection?",
    yesLabel: "Yes", noLabel: "No", // optional, defaults Yes/No
});
```

### `showForm(ctx, options) -> Record<string, string | number | undefined> | null`

Declarative multi-field form. Tab/Shift+Tab cycle fields + submit action
(wrapping). Enter advances (or submits on the action). Escape resolves null.

```ts
const values = await showForm(ctx, {
    title: "New server",
    submitLabel: "[ SAVE ]",     // optional, default "[ SUBMIT ]"
    submitOnEnter: false,         // optional: Enter submits from any field
    fields: [
        { id: "name", label: "Name (required)", required: true },
        { id: "port", label: "Port", type: "int", min: 1, max: 65535 },
        { id: "ratio", label: "Ratio", type: "float" },
        { id: "auth", label: "Auth method", type: "choice",
          options: ["Password", "Private key"], initial: "Password" },
        { id: "secret", label: "Password", type: "password" },
    ],
    validate: (raw) => raw.auth === "Private key" && !raw.key?.trim()
        ? { fieldId: "key", message: "A private-key path is required." }
        : null,
});
```

**Field types:**
- `string` (default): resolves VERBATIM (whitespace preserved).
- `int` / `float`: live keyup filter (digits, one `-`, float one `.`);
  `min`/`max` range checks; resolve as `number`, empty as `undefined`.
- `choice`: cycles `options` with arrows/Space, renders `< value >`.
- `password`: bullet-masked, resolves verbatim.
- `required: true` blocks submit and jumps focus to the offender.

### `showInput` / `showIntInput` / `showFloatInput`

One-shot inputs. Enter submits, Esc resolves null.

```ts
const name = await showInput(ctx, { title: "Rename", label: "New name",
    initial: oldName, required: true, password: false, validate: (v) => null });
const port = await showIntInput(ctx, { title: "Port", min: 1, max: 65535 });
const ratio = await showFloatInput(ctx, { title: "Ratio" });
```

### `showViewer(ctx, options) -> void`

Read-only scrollable text. Up/Down scroll, PgUp/PgDn page, Home/End edges.
Esc, Enter, or q closes. Long lines word-wrap.

```ts
await showViewer(ctx, { title: "Output", lines });
await showViewer(ctx, { title: "/aftc-help", rows: [
    { text: "General", tone: "accent", bold: true },
    { text: "", divider: true },
    { text: "/cd", tone: "accent" },
    { text: "Switch directory" },
] });
```

---

## Custom screens

Unique interaction models (`/cd` browser, `/ssh-cm` manager) may own their
layouts but must compose ONLY these primitives: `AftcUi.panelTop / panelBottom /
panelSeparator / panelBlank / panelRow / menuRow / fieldLabel / inputRow`.
Geometry via `AftcUi.panelWidth()` and `AftcUi.listViewport()`. Framing via
`AftcUi.takeover()`. Open with:

```ts
ctx.ui.custom(factory, { overlay: true, overlayOptions:
    { anchor: "center", width: "100%", maxHeight: "100%" } })
```
