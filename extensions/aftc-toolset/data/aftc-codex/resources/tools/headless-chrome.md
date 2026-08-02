# Headless Chrome / Edge (browser automation CLI)

The `--headless` mode of Chrome and Edge (Chromium) is the cheapest way to take a
screenshot of a page without a display server. Same flags work for both - the Edge
binary lives at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` and
Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`.

## Rules

## Gotchyas

## Issues & Solutions

- [sV7gR4] Headless screenshot of an SVG comes out zoomed-in / clipped to the top-left corner instead of the whole icon
  Cause: `--screenshot --window-size=W,H` does NOT scale the SVG to the window - the browser renders it at its INTRINSIC width/height attributes and the window just clips the oversized render.
  Fix: generate a per-size COPY of the SVG with `width`/`height` set to the target pixels (keep the viewBox unchanged so it scales), then screenshot that file at the matching --window-size. (2026-08)

- [Q8rK2c] `msedge.exe --headless --screenshot=foo.png URL` exits with `Failed to write file foo.png: The system cannot find the path specified` even though `foo.png` is in the cwd
  Cause: the `--screenshot=PATH` flag is parsed against the file-system CWD at the moment the browser starts, AND a relative `PATH` is resolved by the browser, not by your shell - if your shell CWD differs from the browser's CWD (different drive on Windows, sandboxed Chromium), the relative path 404s silently. The browser logs the failure and exits with no rendered screenshot.
  Fix: pass an ABSOLUTE Windows path to `--screenshot`, e.g. `--screenshot="C:\Users\me\Desktop\out.png"`. Quote it because the backslashes are otherwise consumed by the shell. On bash, forward slashes work too (`/c/Users/me/out.png`) as long as the path is absolute. (2026-07)
- [tB3mP7] The screenshot is taken before the SPA finishes hydrating - the page is rendered as the empty HTML shell (white screen, no JS-rendered content) even though `setTimeout(load, 3000)` was added
  Cause: the default screenshot timing fires on the `domcontentloaded` event, before any `script type="module"` import has finished downloading / executing.
  Fix: add `--virtual-time-budget=5000` (milliseconds of "virtual time" to advance before capture) - Chrome fast-forwards timers, microtasks and requestAnimationFrame callbacks by that many ms and then takes the shot. 3000-5000ms is enough for most SPAs. Note `--virtual-time-budget` and `--screenshot` cannot be combined with each other across process restarts, so always pass them in the same single command. (2026-07)
- [eD5nQ9] The browser launches but prints `chrome\browser\task_manager\providers\fallback_task_provider.cc:126 Every renderer should have at least one task provided by a primary task provider` to stderr and the screenshot is BLANK
  Cause: by default the browser starts an interactive renderer even in headless mode; on Windows + some sandbox configs that renderer fails to start and the screenshot is taken from a blank tab.
  Fix: use the NEW headless mode (`--headless=new`, Chromium only) and add `--no-sandbox --disable-gpu` (the GPU process is useless for screenshots and frequently blocks the render). For a one-shot capture these flags are safe: `"msedge" --headless=new --no-sandbox --disable-gpu --window-size=1400,1100 --hide-scrollbars --screenshot=... --virtual-time-budget=5000 https://...`. (2026-07)
- [rP6nL1] `pwsh` and `bash` quoting breaks the multi-flag headless command: the browser launches with the wrong URL or no flags at all
  Cause: in PowerShell double-quoted strings expand `$(...)` BEFORE the args reach the browser, and bash interprets `!` in single-quoted strings. Nested quotes around URLs containing `&` are the commonest foot-gun.
  Fix: prefer the array form of invocation from PowerShell: `& "C:\Path\msedge.exe" @("--headless=new","--no-sandbox","--disable-gpu","--window-size=1400,1100","--hide-scrollbars","--virtual-time-budget=5000","--screenshot=C:\out.png","https://example.com/")`. From bash: quote the whole URL with double-quotes and the whole flag list with single-quotes; the URL's `&` is fine inside double-quotes. (2026-07)
- [V4kN8m] You need to screenshot a route that is loaded after a click / scroll / hash change, but the screenshot only shows the initial page
  Cause: `--screenshot` captures the CURRENT page state at capture time. JS navigation via `window.location.hash = "#/foo"` does not trigger a network request, so the `--virtual-time-budget` only fast-forwards the current DOM, not the post-click DOM.
  Fix: append the route to the URL itself: `--screenshot=out.png "http://localhost:5173/#/some/route"` for hash routing. For pushState routers, navigate by URL with a query string the app reads on boot. Capture AFTER a known login (set a `Cookie:` via `--user-data-dir=...` or run an interactive auth once and reuse the profile) - anonymous-only captures are fine for unauthenticated pages, but authenticated routes need a session cookie. (2026-07)
- [c9Lm4Q] `--screenshot` with `--window-size=393,800` renders a clipped/desktop-ish layout even though the page is responsive and fits fine at that width
  Cause: the one-shot CLI screenshot does not reliably apply the requested size as the layout viewport the way a real browser session does, so responsive checks from CLI shots can show phantom overflow/clipped elements that do not exist.
  Fix: for responsive verification drive Chrome via puppeteer (`page.setViewport()` + `page.screenshot()`) and MEASURE (`document.documentElement.scrollWidth` vs `innerWidth`) instead of trusting CLI screenshots. (2026-07)
