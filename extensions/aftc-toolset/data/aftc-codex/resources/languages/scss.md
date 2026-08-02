# SCSS

## Rules

- [kR7mQ2] Non-trivial SCSS projects (anything past a tiny single-purpose sheet): split styles into partials compiled from ONE manifest entry - monolithic .scss files become uneditable long before they become unbuildable.
- [pW4nT8] The entry `index.scss` is a manifest ONLY: `@use` statements, no rules - load order stays explicit and the cascade predictable.
- [hF3sD6] Order the manifest `@use` list: includes (tokens/reset) → template (chrome + shared atoms) → components (reusable UI) → pages - foundations first so everything later builds on them.
- [mZ9cV5] Folder split: `includes/` (design tokens, reset), `template/` (site chrome: header/footer + tiny shared atoms like buttons/icons), `components/` (reusable feature UI detached from any one page), `pages/` (ONE file per page/view).
- [tB2xN8] Adding a page = create `pages/<name>.scss` + one `@use` line in the manifest - never pile page styles into a shared partial.
- [qL6yP3] Reusable UI not tied to a single page goes in `components/`; site-wide chrome and tiny atoms stay in `template/` - misfiled partials are how monoliths re-grow.
- [wD8kR4] Co-locate media queries: each partial ends with its OWN `@media` blocks - no central responsive file; keep a selector's breakpoint blocks in cascade order (at overlapping widths the LATER block wins).
- [jN5tM7] Theme with CSS custom properties (`var(--*)`) declared in the tokens partial instead of Sass variables scattered through partials - runtime theme switching (`[data-theme="..."]` overrides) needs no recompile.
- [cV3bH9] Start each partial with a section banner comment naming its feature - keeps the compiled CSS greppable back to its source partial.

## Gotchyas

- [rE4wQ1] Sass `@use` emits a partial's CSS ONCE, at its first `@use` - re-`@use`ing a partial later to re-order its output does nothing; control the cascade solely via manifest order.
- [gH7uY2] Co-located `@media` blocks do not merge - the same selector in two breakpoint blocks cascades by document order and the LATER block wins at overlapping widths, so preserve block order when restructuring partials.
- [cM8kR2] `sass.compile()` default output style - dart-sass's JS API emits EXPANDED css unless told otherwise, so a "dist" build that never passes a style ships unminified css while reporting success; pass `{ style: "compressed" }` for production builds (and `"expanded"` explicitly for dev).

## Issues & Solutions

- [xC9mQ4] Restructuring/splitting CSS or scss partials - how to PROVE the cascade didn't change (a byte diff is useless: rules legitimately move between files)
  Cause: when rules move between files the compiled output reorders, so a text diff is all false positives; but an accidental order change for the SAME selector silently flips which declaration wins, and no compiler warns you.
  Fix: compile before AND after, parse both outputs into flat (media-context, selector, body) rules with a small brace-depth walker, then assert (1) the same multiset of rules and (2) for every selector the ORDERED sequence of (media, body) entries is unchanged - same-selector rules are the only ones whose relative order affects the cascade. When co-locating media queries into component files, keep each component's blocks in the original document order (at overlapping widths the LATER block wins). (2026-07)
