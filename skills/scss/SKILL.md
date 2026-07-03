---
name: scss
description: SCSS/Sass preprocessing with variables, mixins, modules, and BEM naming. Use when writing or editing .scss files, Sass mixins, variables, or modular stylesheets.
---

# SCSS

- Use SCSS syntax (`.scss`), not indented Sass (`.sass`).
- Variables for colors, spacing, breakpoints: `$primary: #333;`.
- Mixins for reusable patterns: `@mixin flex-center { display: flex; align-items: center; justify-content: center; }`.
- Nest max 3 levels deep - deeper nesting creates specificity problems.
- Use `&` for parent selector references (BEM naming): `&__element`, `&--modifier`.
- `@use` over `@import` (modern Sass module system).
- Keep partials focused: `_buttons.scss`, `_typography.scss`, `_layout.scss`.
- Compile to compressed CSS for production.
