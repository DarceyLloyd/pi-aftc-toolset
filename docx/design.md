# Design

Global design language of pi-aftc-toolset: the AFTC TUI look, focus model,
key conventions and output-severity rules. Every surface in the
[sitemap](1_extension_source/1_tui_sitemap.md) follows this; per-surface
docs reference it instead of repeating it.

<!-- last-reviewed: 2026-08-05 22:05 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## Overview

Two visual systems coexist: (1) the AFTC overlay system (1.3.2) — fixed
palette, GRUB-style full-screen takeovers; (2) theme-aware inline output
(footer widget, transcript entries) which retones with pi's active theme.

## AFTC overlay palette (fixed, frozen)

| Token | Hex | Use |
| --- | --- | --- |
| background | #000000 | every screen/panel cell — nothing bleeds through |
| text | #ffffff | primary text |
| accent | #fca02f | titles, values, active markers, `❯` |
| border | #555555 | inactive borders |
| selectionBg | #2d1d08 | active row/input bar (accent darkened) |
| muted | #999999 | hints/help below the panel |
| error | #ff5555 | inline validation errors |

## Layout conventions

- GRUB-style takeover: paint every cell with background; centre a bordered
  panel; hints BELOW the box (never competing with chrome).
- Panel widths: 78 (connection manager) / 110 (SSH terminal); narrower
  terminals render full-bleed. Viewports cap against terminal rows minus
  chrome lines.
- Lines are width-exact (over-wide output crashes pi's TUI); spans never
  nest; `truncateToWidth` is ANSI-aware.

## Focus / active-element contract (normative)

- Exactly ONE element looks active at any time.
- Active menu row / action: full-width selectionBg bar + bold accent `❯`.
- Active input: accent `❯` label, boxed row with accent borders, full-width
  selectionBg behind the value, the ONLY live typing cursor on screen;
  inactive inputs render plain accent text in #555555 borders, no cursor.

## Key conventions (all overlays)

| Key | Action |
| --- | --- |
| ↑ / ↓ | move by 1 (wraps) |
| PageUp / PageDown | one viewport |
| Ctrl+PageUp/PageDown or Home/End | first / last |
| Enter | commit / activate focused control |
| Esc | cancel / back / close |
| Tab / Shift+Tab | focus areas on composite screens (1.6.5) / fields on forms (1.6.6) |
| Ctrl+] | LOCAL exit from the SSH terminal only (1.6.9) — Esc there belongs to the remote program |

Global editor shortcuts (1.5.1): alt+c clear, alt+n newline at caret,
alt+x cut all to clipboard.

## Settings-hub convention

Menus that toggle preferences (footer menu, notification hub, codex menu):
stable label + ` | value` aligned column; Enter flips; selection preserved
across toggles; Esc closes; loop re-renders so values stay current.

## Theme-aware output

- Footer: three logical colours — c1 accent+bold (highlights), c2 text
  (labels/units), c3 dim (values/dividers); every line `customMessageBg`
  bar, width-padded (1.4.2).
- Transcript severities (1.3.1): emphasis = theme accent entry; warn =
  yellow notify; error = red notify; info = dim notify. Diagnostic stdout
  is `[aftc-toolset]`-prefixed and gated (default off).
- Inline cards (/dir, /cwd): Box with `customMessageBg`, emoji title.

## Report design

`report.html` (1.4.5): dark palette `#0f1115` + orange `#fca02f` brand bar
and title mark; tab navigation; money formatting rules shared with the
footer ($0.00 / 4dp under $1 / 2dp / thousands separators).

## Naming conventions (code-visible design)

- Enable flags: `featureNameEnabled` (never "master").
- Commands: `/aftc-*` namespaced + short aliases where speed matters;
  aliases share one handler.
- Every command has a help-registry entry next to its registration.

## Related

- Framework: [1_extension_source/1.3_ui/1.3.2_aftc_ui.md](1_extension_source/1.3_ui/1.3.2_aftc_ui.md) · Surfaces: [1_extension_source/1_tui_sitemap.md](1_extension_source/1_tui_sitemap.md)
