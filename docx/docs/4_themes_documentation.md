# 4 - Themes

themes/ — the three shipped pi themes.

<!-- last-reviewed: 2026-08-04 20:37 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Purpose

**Owns:** `aftc-black-n-blue`, `aftc-orange-viz` (the toolset's GRUB-style signature: `#fca02f` accent), and `cache-viz` theme JSON files.
**Does not own:** theme switching UX (1.5's `/theme` uses pi's picker).
**Depends on:** pi's theme loader (1.1). **Dependents:** none.

## Public API & contracts

pi theme JSON (`vars` raw hex + `colors` semantic key → var). Shipped via the `pi` manifest (`"themes": ["./themes"]`); selected with `/theme`.

## Internal architecture & data flow

Static assets; pi discovers and applies them. `theme.fg("accent", ...)` and friends resolve against the active theme's `colors` map.

## Configuration

None.

## Setup, seeding & first run

Nothing.

## Testing

Manual (visual).

## Operational notes & known limitations

- The aftc-ui dialog palette (1.3) is fixed by design and does not follow the active pi theme.

## Related

- 1.3 UI Framework, 1.5 Feature Modules (`/theme`)
