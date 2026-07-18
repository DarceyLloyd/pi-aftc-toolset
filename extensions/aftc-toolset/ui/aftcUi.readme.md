# aftcUi.ts

Shared AFTC UI toolkit — reusable overlay-screen primitives used by the
toolset's full-screen screens (currently the `/ssh-cm` connection manager
and its new-connection dialog).

This module is a **leaf utility**: it imports only from
`@earendil-works/pi-tui` and nothing from other aftc-toolset modules, so
feature modules may import it freely without violating the
"features must not import each other" rule.

## Look and feel

GRUB-style full-screen takeover with a fixed, theme-independent palette:

| Role | Colour |
|---|---|
| Screen / panel background | `#000000` black |
| Primary text | `#ffffff` white |
| Titles, values, active markers | `#fca02f` orange |
| Inactive box / panel borders | `#555555` grey |
| Selection bar (active row / input) | `#2d1d08` (much darker `#fca02f`) |
| Hints / help text | `#999999` grey |
| Validation errors | `#ff5555` red |

The takeover composer paints **every terminal cell** with the background
colour, centres a bordered panel horizontally and vertically, and renders
hint lines below the box — underlying pi content never bleeds through.

## Active-element contract (readability rules)

- Exactly ONE element looks active at any time.
- Active menu rows / actions: full-width selection bar with a bold
  accent `❯` marker.
- Active input fields: accent `❯` label, boxed input row whose borders
  turn accent, full-width selection bar behind the value, and the ONLY
  live typing cursor on screen. Inactive inputs render their value as
  plain accent text inside `#555555` borders with no cursor.

## Exports

- Palette: `AftcPalette`, `AFTC_UI_DEFAULTS`, `defaultAftcPalette()`,
  `hexToRgb(hex)`, `darken(hex, factor)`.
- Spans: `AftcSpan`, `renderSpan(span)`, `spansWidth(spans)`,
  `fitSpans(spans, width)`, `renderSpans(spans, width, palette)`,
  `blankRun(count, palette)`.
- Panel chrome: `panelTopBorder(title, innerW, palette)`,
  `panelBottomBorder`, `panelRow(spans, innerW, palette, fillBg?)`,
  `panelSeparator`, `panelBlank`.
- Takeover: `composeTakeover(opts)`, `terminalRows(fallback?)`.
- `AftcUi` — palette-bound facade with `span()`, `panelTop()`,
  `panelBottom()`, `panelSeparator()`, `panelBlank()`, `panelRow()`,
  `menuRow(label, description, { selected, labelWidth? }, innerW)`,
  `fieldLabel(label, active, innerW)`,
  `inputRow(content, active, innerW)`, and `takeover(opts)`.

## Rendering rules (pi TUI safety)

- Every returned line is exactly `width` visible columns — never more
  (over-wide lines crash the TUI). Overflow is truncated, shortfall is
  padded with background-painted spaces.
- Every span is independently styled and terminated with an SGR reset.
  Spans are never nested, so colours cannot bleed across segments.
- Screens read `terminalRows()` for height (`process.stdout.rows`, 24
  fallback) and must cap scrolling content so the panel never overflows
  short terminals.

## Interactive screens (menus, confirms, forms)

The public surface most callers want: **define what goes in, await what
comes out.** All three helpers are GRUB-style full-screen takeovers and
resolve a cancel-safe value outside the TUI (`null` / `null`), except
`showConfirm` which falls back to `ctx.ui.confirm`.

### `showMenu(ctx, options)` → `string | null`

Selectable list. Navigation follows the /cd contract: ↑/↓ wrap,
PgUp/PgDn jump by the visible viewport, Home/End jump to edges. Enter
resolves the highlighted item's value, Escape resolves null.

```typescript
const value = await showMenu(ctx, {
    title: "SSH connections",
    items: [{ value: "new", label: "NEW", description: "Create one" }, ...],
    initialIndex: 0,          // optional
    body: ["Pick one:"],      // optional lines above the list
    help: "...",               // optional footer override
    onHighlight: (item, i) => {}, // optional, fires on every move
});
```

Component class `AftcMenu` is exported for tests/custom hosts.

### `showConfirm(ctx, options)` → `boolean`

Two-choice confirm. The safe option (no) is highlighted by default;
Escape resolves false. Non-TUI falls back to `ctx.ui.confirm`.

```typescript
const sure = await showConfirm(ctx, {
    title: "Replace saved connection?",
    body: "A saved connection already uses this name.",
    yesLabel: "Yes", noLabel: "No",   // optional, defaults Yes/No
});
```

### `showForm(ctx, options)` → `values | null`

Declarative input form with built-in required handling, typed fields,
live numeric keyup filtering, and inline validation. Tab/Shift+Tab cycle
fields and the bottom submit action (wrapping); Enter advances or
submits; Escape resolves null. The active field follows the
active-element contract (accent ❯ label, boxed input with accent borders
on the selection bar, the only live cursor).

```typescript
const values = await showForm(ctx, {
    title: "New server",
    submitLabel: "[ SAVE ]",            // optional, default "[ SUBMIT ]"
    fields: [
        { id: "name", label: "Name (required)", required: true },
        { id: "port", label: "Port", type: "int", min: 1, max: 65535 },
        { id: "ratio", label: "Ratio", type: "float" },
        { id: "auth", label: "Auth method", type: "choice",
          options: ["Password", "Private key"], initial: "Password" },
    ],
    // optional cross-field validation:
    validate: (raw) => raw.auth === "Private key" && !raw.key?.trim()
        ? { fieldId: "key", message: "A private-key path is required." }
        : null,
});
// values: { name: "my box", port: 22, ratio: 0.5, auth: "Password" }
//   - int/float fields resolve as numbers (optional empty → undefined)
//   - choice fields resolve as the selected option string
//   - string fields resolve VERBATIM (whitespace preserved — secrets)
//   - null on Escape
```

Field contract:

- `type: "string"` (default) | `"int"` | `"float"` | `"choice"`.
- `required: true` blocks submit with `A <field> is required.` and jumps
  focus to the offender.
- int/float fields filter characters on keyup: digits always pass, a
  single `-` and (float) a single `.` are allowed; every other character
  never enters the input. Pasted text is backstopped by submit-time
  validation (`<Field> must be a whole number from <min> to <max>.`).
- `min`/`max` range-check numeric fields; `validate(value)` adds custom
  per-field errors; the form-level `validate(raw)` handles cross-field
  rules.
- Choice fields cycle with ←/→/↑/↓/Space and render `‹ value ›`.
- `type: "password"` masks the value with bullets (value still resolves
  verbatim; the fake cursor stays at the end so even the cursor position
  leaks nothing).
- `submitOnEnter: true` (form option) makes Enter inside any field submit
  immediately — used by the single-input helpers.
- Short terminals (< 30 rows) drop the blank line between fields so the
  submit action never overflows.

Component class `AftcForm` is exported for tests/custom hosts.

### `showInput(ctx, options)` → `string | null`

One text input; Enter submits, Escape resolves null. Options: `label?`,
`initial?`, `required?`, `password?` (bullet-masked), `validate?`.

### `showIntInput(ctx, options)` / `showFloatInput(ctx, options)` → `number | null`

One numeric input with the live keyup filter and optional `min`/`max`.
`required` defaults to true (these helpers exist to return a number);
an empty optional field resolves null.

### Menu presentation

`showMenu` defaults to the takeover. `fullscreen: false` renders a
floating centred panel (same palette/chrome, 60% width) so the
surrounding pi UI stays visible — required for live previews (`/theme`).
Menus also bind Ctrl+PgUp/Ctrl+PgDn to first/last alongside Home/End.

### `showViewer(ctx, options)` → `void`

Read-only scrollable text screen (command output, reports, help). ↑/↓
scroll one row, PgUp/PgDn by the viewport, Home/End and Ctrl+PgUp/PgDn
jump to the edges; Esc, Enter, or q closes. **Long lines word-wrap
inside the panel** — nothing is truncated. Outside the TUI the lines
are printed with the `[aftc-toolset]` prefix.

```typescript
// Plain rows:
await showViewer(ctx, { title: "SSH command output", lines });

// Toned rows (accent titles, muted hints, optional bold):
await showViewer(ctx, { title: "/aftc-help", rows: [
    { text: "General", tone: "accent", bold: true },
    { text: "/cd", tone: "accent" },
    { text: "Description: Switch directory" },
    { text: "" },
] });
```

Component class `AftcViewer` is exported for tests/custom hosts.

## Custom screens: build only from these primitives

Standard dialogs (menus, confirms, forms, single inputs, viewers) are
owned ENTIRELY by this module — callers pass data, await the result.
Custom screens with unique interaction models (the `/cd` directory
browser, the `/ssh-cm` connection manager) assemble their own layouts
but ONLY from this module's primitives: `AftcUi.panelTop/panelBottom/
panelRow/panelBlank/menuRow/fieldLabel/inputRow` for layout,
`AftcUi.panelWidth()` + `AftcUi.listViewport()` for screen geometry, and
`AftcUi.takeover()` for the full-screen frame. Changing the palette,
borders, selection bar, hints, or geometry rules means editing THIS one
file — every screen follows.

## Usage

```typescript
const ui = new AftcUi();
render(width: number): string[] {
    const panelW = Math.min(78, width);
    const innerW = panelW - 2;
    const panel = [
        ui.panelTop("My screen", innerW),
        ui.menuRow("item one", "description", { selected: true }, innerW),
        ui.panelBottom(innerW),
    ];
    return ui.takeover({
        termWidth: width,
        termHeight: terminalRows(),
        panelWidth: panelW,
        panel,
        footer: [[ui.span("esc closes", { fg: ui.palette.muted })]],
    });
}
```

Open it with `ctx.ui.custom(factory, { overlay: true, overlayOptions:
{ anchor: "center", width: "100%", maxHeight: "100%" } })` and call
`done()` to close — pi's UI is restored untouched.

## Tests

`node tests/aftc-ui-check/aftc-ui-check.mjs`
