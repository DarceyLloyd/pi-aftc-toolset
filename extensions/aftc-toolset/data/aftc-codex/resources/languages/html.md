# HTML

## Rules

## Gotchyas

- [hT6rD4] <option> without a value attribute - the browser silently uses the option's TEXT as its value, so a "Please select" / empty choice submits its label instead of ""; always write `value=""` explicitly for placeholder or empty options.

- [ZT45zF] Nested <form> tags - the inner <form> start tag is dropped by the HTML parser and the inner </form> then CLOSES THE OUTER form, orphaning every control after it (e.g. a submit button, or a whole product-picker row) OUTSIDE the form; the submit event then never fires so 'the save button does nothing' with zero console errors; never nest a <form> - group controls inside a form with a <div class="toolbar"> / <fieldset> instead (and give inner buttons type="button" so they can't submit).

## Issues & Solutions


- [cLvCqV] SVG embedded as base64 (in `<img src>` or injected via JavaScript)
  Cause: base64 inflates size ~33%, cannot be cached, cannot be styled, trashes readability.
  Fix: never do it. If the SVG must be animated or manipulated (GSAP/CSS/JS targeting its elements) write the SVG code inline in the HTML so it lives in the DOM (an `<img>` tag SVG is not in the DOM and cannot be animated). If the SVG is static, create a real .svg file and reference it via `<img src>` or CSS `url()` so it caches. (2026-07)
- [01k8yP] Google Fonts silently drops the 2nd+ family (no error)
  Cause: a bare `&` (`family=A&B`) loads only the first.
  Fix: each family needs its own `&family=`, joined as `...&family=Cormorant+Garamond:wght@500;700&family=Space+Grotesk:wght@500;700&display=swap`. (2026-07)
- [AKXHMG] Web page slows, flickers or crashes the browser tab - the HTML embeds many `<iframe>` previews, each running WebGL animations
  Cause: every `<iframe>` boots a full page (JS + WebGL), multiplying memory/GPU/CPU; the browser enforces a per-process WebGL context cap, so once it's exhausted later iframes render blank and the tab can crash.
  Fix: pick per project - (1) paged list of iframes: mount only a handful at a time and destroy old ones (remove the element / blank its `src`) before creating new ones, keeping live previews under the context cap; (2) plain HTML links (simplest, no iframes); (3) static thumbnails. A `?preview=1` flag only helps if every embedded page is edited to check for it and skip its heavy init (rendering a static fallback) - the flag alone does nothing, it needs per-page cooperation and the preview is no longer live, so prefer (1)–(3). (2026-07)
