# JavaScript

## Rules

- [F8FqKP] Text find-replace engines: when a replacement STARTS or ENDS with a punctuation symbol (.md, /, -), consume the adjacent space in the regex (\\s* prefix/suffix) so the replacement fuses with the neighboring word - otherwise 'agents dot md' becomes 'agents .md' instead of 'agents.md'.

- [tZC2kW] When rendering from a source-of-truth variable, EVERY code path that changes the content must update that variable - a DOM-only update in one branch (eg 'not the current view' branch) is wiped by the next render from the stale variable.

## Gotchyas

- [tW5yQ9] Text-width measurement traps - a block/flex child's `getBoundingClientRect()` returns the STRETCHED box not the glyph width, canvas `measureText()` ignores `letter-spacing`, and a `Range` rect over the text node includes letter-spacing WITH a trailing gap after the last char; for unspaced text use canvas measureText, for letter-spaced text use a Range and subtract one spacing gap.

- [jpXm4X] textarea selectionStart/selectionEnd reset when it blurs (eg the user clicks a button) - save the caret position on blur/keyup/mouseup/select and use the SAVED values in the button handler, never the live ones.

## Issues & Solutions


- `[yWpNrY] arr.sort((a,b)=>Number(a)-Number(b))` silently returns the wrong order for filename arrays like `["99.html","100.html"]`
  Cause: `Number("99.html")` is `NaN`, so the comparator returns `NaN` and the sort is implementation-defined/unstable.
  Fix: strip the extension first: `Number(a.replace(/\.html$/,''))`. (2026-07)
- `[86UdJU] prefersReducedMotion()` silently disables features (autoplay timers, gsap transitions, any motion gated on it) with NO console error
  Cause: it returns true whenever the OS has reduce-motion ON (Windows: Settings > Accessibility > Visual effects > Animation effects OFF; very common on dev machines).
  Fix: Default per global rules: do NOT use it at all unless the user/docs explicitly ask, and then scope it (per feature or sitewide). If you ever must use it, never gate *logic/timers* on it - only decorative animation. When debugging "feature silently does nothing, no error", add console logging at init/tick/handlers FIRST to read the real `reducedMotion` value before reasoning about the code. (2026-07)
- `[28ZRLy] empty $_FILES and $_POST` on a multipart upload via fetch
  Cause: setting `Content-Type: multipart/form-data` manually drops the `boundary=...` parameter so PHP cannot parse the body.
  Fix: never set Content-Type when the body is FormData; the browser sets it with the boundary (delete it from any shared JSON headers object). (2026-07)
- `[kT9mW2] child.kill()` on a spawned shell/process does NOT kill its children - a timed-out/aborted `bash`/`sleep`/dev-server keeps running and holds the stdio pipes open, so the `close` event never fires (the "kill" appears to hang)
  Cause: `child.kill()` signals only the DIRECT child. Its descendants (eg the `sleep` a spawned `bash` started) are reparented and keep running, and while any of them still holds the stdout/stderr pipe, Node's `close` event (which waits for the pipes to end) does not fire - so a timeout/abort that kills only the parent seems to hang until the grandchild exits on its own.
  Fix: kill the whole process TREE. Windows: `spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"])`. Unix/mac: spawn with `detached: true` (the child becomes a process-group leader) then `process.kill(-child.pid, "SIGKILL")` to kill the group. Add a short grace timer that resolves anyway in case `close` is slow. A plain `child.kill("SIGKILL")` is not enough on either platform. (2026-07)
- [K7mN2P] A hash-router SPA's `<a href="#/page">` links work in development but the browser still loads a fresh full page on first click (and the back button breaks), losing the SPA's in-memory state
  Cause: the author forgot to (a) intercept the link click, (b) update `window.location.hash`, (c) call `history.pushState` to add a real history entry. Just changing `window.location.hash` to match the SPA's expectations does fire the `hashchange` event, but it does NOT create a separate history entry - so the back button may skip over multiple "views" the user saw.
  Fix: in the SPA, attach a single `click` listener on a stable parent (eg `document.body`) that uses `event.target.closest('a[data-link]')` to find the link, then `e.preventDefault()` + `history.pushState({}, '', a.getAttribute('href'))` + dispatch the render. The router listens to BOTH `popstate` (back/forward) AND `hashchange` (initial load) so the first click and the back button both work. Add the same `data-link` attribute to every SPA link so the listener knows what to intercept (external `<a href="https://...">` are left alone). (2026-07)
- [J4bV6M] `<svg class="i"><use href="#i-x"/></svg>` icons render as broken-image placeholders or show a "?" instead of the icon, even though `#i-x` is in the page's SVG sprite at the top of the body
  Cause: the `<symbol>` has a `viewBox` but no explicit `width`/`height`, AND the `<svg class="i">` parent has CSS `width: 1em` / `height: 1em`. Browsers vary on whether `<use>` of a symbol with a viewBox but no intrinsic size picks up the parent SVG's size (Chrome yes, Firefox yes, Safari historically no). When the parent is `1em` and the symbol has no size, Safari in particular may show a "?" because it cannot determine the intrinsic ratio.
  Fix: set BOTH `width="24"` AND `height="24"` on the `<symbol>` itself (matching the viewBox), and ALSO keep the `.i` class sizing on the parent SVG. This guarantees every browser has an intrinsic size to use. Alternatively, give the symbol `preserveAspectRatio="xMidYMid meet"` and a fill colour on the `<use>` element to be explicit. (2026-07)
- [qR7tY4] SVG viewBox pan/zoom hit-tests are offset vertically (or horizontally) even though rendering looks perfect - screenToWorld math is wrong when the viewBox aspect differs from the viewport aspect
  Cause: with `preserveAspectRatio="xMidYMin meet"` (or any meet/slice), the viewBox is scaled UNIFORMLY by `min(vw/vbW, vh/vbH)` and letterboxed; computing screen<->world with independent per-axis scales (`vbW/vw` for x, `vbH/vh` for y) is silently wrong on the non-binding axis. Worse: if app code and test code share the same wrong formula they are self-consistent, so gestures "pass" in tests while real users are off by the aspect factor.
  Fix: one shared conversion using the meet scale: `k = min(vw/vbW, vh/vbH)`, `offsetX = (vw - vbW*k)/2` for xMid (0 for xMin), `offsetY = (vh - vbH*k)/2` for yMid (0 for YMin); `world = vb + (client - rect.topLeft - offset)/k`. Use the same k for pan deltas. Unit-test round-trips with an aspect-mismatched viewport. (2026-07)
- [pHovR9] A pause-on-hover component that RE-RENDERS while the pointer is stationary over it silently loses its hover state - no `mouseenter`/`mouseleave` fires for the new element
  Cause: replacing the DOM node under a stationary pointer (innerHTML re-render) fires no hover events; those only fire on pointer MOVEMENT. A carousel that pauses autoplay on hover and re-renders per slide (eg an arrow click while hovering) un-pauses even though the pointer never left.
  Fix: after each re-render, restore the hover state explicitly with `newEl.matches(":hover")` (CSS :hover tracks the element under the pointer regardless of events) and start/stop the timer accordingly. Drive a pausable autoplay clock with requestAnimationFrame + accumulated elapsed ms (pause = bank the elapsed and cancel the rAF; resume = restart from the banked value) so a mid-slide pause resumes seamlessly and a progress bar can render from the same elapsed value. (2026-07)
- [wP2nB8] `preventDefault()` on `pointerdown` suppresses the compatibility mouse events, so `dblclick` never fires; and with `setPointerCapture`, puppeteer's `click(x,y,{clickCount:2})` doesn't produce a dblclick either
  Cause: canceling pointerdown kills the mousedown/mouseup compat stream that dblclick detection uses; pointer capture retargets events so the browser's double-click target matching breaks.
  Fix: don't rely on native dblclick for editor gestures - detect double-click in the gesture state machine (two pointer-ups on the same target within ~400ms). Deterministic and immune to capture/preventDefault quirks. (2026-07)
