---
name: web-frontend
description: Web frontend development: HTML5, CSS3, SCSS, Tailwind, accessibility, and performance. Use when working on full web frontend projects, choosing between CSS approaches, or auditing accessibility/performance.
---

# Web Frontend

### HTML5
- Use semantic elements: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`
- Every page must have `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Include `<meta charset="UTF-8">` and descriptive `<title>`
- Images must have `alt` attributes. Decorative images use `alt=""`.
- Form inputs must have associated `<label>` elements
- Use `loading="lazy"` on below-fold images
- ARIA landmarks where appropriate: `role="banner"`, `role="navigation"`, `role="main"`

### CSS3
- Mobile-first responsive design with `@media` breakpoints at 480px, 768px, 1024px
- Use CSS custom properties (`--var`) for theme colors, spacing, and typography
- Prefer `rem`/`em` over `px` for typography and spacing
- Use `display: grid` for layouts, `flexbox` for components
- Avoid `!important`. Use specificity instead.
- Dark theme: use `prefers-color-scheme: dark` media query + CSS variables

### SCSS
- Nest selectors max 3 levels deep
- Use `$variables` for colors, spacing, breakpoints
- Use `@mixin` for repeated patterns (e.g., media queries, button styles)
- Compile to compressed CSS for production

### Tailwind CSS
- Use utility classes over custom CSS where possible
- Responsive prefixes: `sm:`, `md:`, `lg:`, `xl:`
- Dark mode: `dark:` prefix with `class` strategy
- Custom theme in `tailwind.config.js` under `extend`
- Use `@apply` in component classes sparingly - prefer composition

### Accessibility
- Color contrast ratio: minimum 4.5:1 for normal text, 3:1 for large text
- All interactive elements must be keyboard-navigable (Tab, Enter, Escape)
- Focus indicators must be visible (never `outline: none` without replacement)
- Screen reader text: `.sr-only` class for visually hidden labels
- `aria-label` on icon-only buttons and links
- `aria-expanded` on toggle elements
- `role="status"` or `aria-live` for dynamic content updates

### Performance
- Minify HTML, CSS, JS for production
- Use `rel="preload"` for critical fonts and above-fold images
- Defer non-critical JS with `defer` or `async`
- Image formats: WebP with JPEG/PNG fallback
- CSS containment: `contain: layout style paint` for off-screen content
