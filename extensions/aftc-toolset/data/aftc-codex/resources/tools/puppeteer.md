# Puppeteer

## Rules

## Gotchyas

- [sjYzPL] CSS transition reads fine in source but is silently dead - a transition can be killed by a rule the source does not show (a global `@media (prefers-reduced-motion: reduce){*{transition-duration:.001ms!important}}` nuke, a `display:none` toggle, a transition-property mismatch) and "it should work" is unverifiable from a static read; prove it runs by sampling `getComputedStyle(el).opacity` (or the animated property) over time inside `page.evaluate` (a tight setTimeout loop) and asserting a mid-sample strictly between start and end - a snap jumps 0->1 in one tick, a real tween passes through intermediate values.

- [7JLylr] A suite that creates + CONSUMES a finite resource (serial numbers, single-use codes, stock) and cleans up only the UNUSED instances leaves the USED ones to accumulate across runs - they eventually exhaust or block the resource (eg a serial bank left at 0 unused fails the NEXT run's checkout with 'out of stock'/'out of serial codes', even though THIS run passed); cleanup must reach the consumed instances too (delete the parent order/record so they cascade, or a DB-level sweep at suite start - many APIs can't delete a 'used' row), or design the test so a consumed instance can never block a re-run (a fresh throwaway resource each run).

## Issues & Solutions


- [ADCp4i] Form submit never fires in e2e (no fetch, no error)
  Cause: the login template ships prefilled input values and `page.type` APPENDS, producing an invalid email so native HTML5 validation silently blocks the submit event.
  Fix: clear inputs via `page.evaluate(() => input.value = "")` before typing. (2026-07)
- `[4TrE0w] form.requestSubmit()` bypasses native HTML5 validation (submit event fires even with invalid fields) while button `.click()` does not
  Cause: requestSubmit submits programmatically and skips the browser's validation gate that `.click()` honours.
  Fix: do not use requestSubmit to "fix" a mysteriously dead submit; it hides the real cause. (2026-07)
- [Wyc4h1] Navigation timeout with `waitUntil: "networkidle0"` on SPA pages
  Cause: long-lived font/asset requests never reach 0 connections.
  Fix: use `waitUntil: "domcontentloaded"` plus an explicit sleep. (2026-07)
- [x4cc2D] Motion-dependent code (GSAP tilt/reveal/autoplay, anything gated on `matchMedia('(prefers-reduced-motion: reduce)')`) silently no-ops in tests
  Cause: headless Chrome reports `prefers-reduced-motion: reduce` as TRUE by default.
  Fix: `page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'no-preference' }])` before testing motion. (2026-07)
- [CLhG9A] WebGL canvas renders blank in headless screenshots / pixel reads
  Cause: headless Chrome has no GPU, so WebGL must use software rendering, which needs explicit flags and a preserved drawing buffer.
  Fix: software WebGL needs launch flags `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, and the renderer must be created with `preserveDrawingBuffer:true` to survive a screenshot/readback. (2026-07)
- [sl1jE0] Hover/tilt looks dead in e2e
  Cause: synthetic `el.dispatchEvent(new PointerEvent(...))` is unreliable (not trusted), and an off-screen element cannot be hovered because getBoundingClientRect returns viewport coords.
  Fix: use trusted `page.mouse.move(x,y,{steps:6})`, and `el.scrollIntoView()` first. (2026-07)
- [WD9bTK] Same e2e passes then fails with zero code change
  Cause: leaked state from a previous run (test created rows/files, another test's cleanup deleted or repointed them).
  Fix: API-seeded test data must be STATE-INDEPENDENT: explicitly set the state the test needs before seeding (eg restore a product's primary image via PUT) and restore it in cleanup, never assume the db still holds seed values. (2026-07)
- `[97QQsu] page.mouse.click(x,y)` does NOT scroll the target into view (unlike `elementHandle.click()`), so you click a moving target and miss
  Cause: under `scroll-behavior:smooth` a `scrollIntoView()`/`scrollTo()` is still animating when you read `boundingBox()`.
  Fix: for interaction probes inject `page.addStyleTag({content:'html{scroll-behavior:auto !important}'})` so programmatic scrolls are instant, then sample the box. (2026-07)
- [IY4RnI] A click "lands" but the handler never fires and `elementFromPoint` at the target's own centre returns an ANCESTOR or skips the element entirely
  Cause: the element is `visibility:hidden` (a scroll-reveal that sets GSAP `autoAlpha:0` leaves it laid out, so `getBoundingClientRect` looks fine, but hidden elements are absent from hit-testing/`elementsFromPoint`). A jump-scroll in a test may not fire the ScrollTrigger that would reveal it.
  Fix: Neutralise for the probe with `[data-reveal]{opacity:1 !important;visibility:visible !important;transform:none !important}` (keep the animation in the product). (2026-07)
- [0KJncD] After filtering/reordering a list, `page.$('.item .btn')` returns the first node in DOM order which may now be `display:none`
  Cause: its `boundingBox()` is `null` when hidden, so the click is silently skipped.
  Fix: select the first VISIBLE match (check `offsetParent !== null` / reset the filter to "all" first) before clicking. (2026-07)
- [E59Qtb] Theme / dark-mode screenshots come back in the wrong theme or flip mid-run
  Cause: pages opened in the SAME browser context share localStorage, so a theme toggle on page N persists to page N+1 (and a leftover 'light' from a prior run poisons the next), making `data-theme` non-deterministic.
  Fix: Open each page in its own incognito context (`browser.createBrowserContext()` then `ctx.newPage()`, and `ctx.close()` after) so storage starts empty and `data-theme` defaults to dark every time. Also PAUSE autoplay (click the carousel play/pause control) before screenshotting, or you capture a mid-crossfade frame with two slides' text overlapping and read it as a layout bug. (2026-07)
- [GaSCOg] Need to screenshot / visually QA a LOCAL html file (eg an extension-generated report) on a Windows box without polluting the project with a dep or a Chromium download
  Cause: a local html file needs runtime visual QA, but adding `puppeteer` (with its Chromium download) to the project pollutes it.
  Fix: install `puppeteer-core` (NOT `puppeteer`, so no browser download) into a scratch temp dir outside the repo, point `executablePath` at the already-installed system browser (`C:/Program Files/Google/Chrome/Application/chrome.exe`, or Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`), `puppeteer.launch({ executablePath, headless:"new", args:["--no-sandbox"] })`, then `page.goto("file:///C:/abs/path.html")`. To verify a resize/overflow bug, drive the EXACT sequence the user described as TWO scenarios (setViewport full→narrow→full on one page; load at narrow→full on a second page) and MEASURE `document.documentElement.scrollWidth > clientWidth` plus `getBoundingClientRect` of the suspect element instead of eyeballing; capture a full-page shot AND an element crop via `(await page.$(sel)).screenshot()`. This is what proves runtime layout that `node --check` and a static CSS read cannot see. (2026-07)

- [tM5vR2] e2e checks an async save/fetch result but intermittently fails - fixed `sleep(300)` loses the race
  Cause: keyboard/click-triggered async actions (a save PUT, a fetch) complete on the server's schedule, not the test's; a fixed sleep that "usually works" flakes under load and fails non-deterministically, sending you hunting for app bugs that don't exist.
  Fix: after triggering the action, `await page.waitForResponse((r) => r.url().includes("/api/...") && r.request().method() === "PUT")` (or waitForFunction on the DOM state) before asserting. Reserve fixed sleeps for animations only. (2026-07)
- [kP7wQ3] `Cannot read properties of null (reading 'getBoundingClientRect')` / `No element found for selector` in a script that passed before - page boot starved by parallel heavy processes
  Cause: fixed-sleep boot waits (`goto` then `sleep(2000)` then `querySelector`) pass in isolation but fail when the machine is under heavy parallel CPU load (eg two 6-build build-reports running alongside) - the SPA hasn't injected its markup when the selector runs.
  Fix: re-run the script SERIALLY with nothing heavy running before suspecting an app bug; for permanent robustness prefer `waitForSelector` over fixed sleeps (see [tM5vR2]). (2026-07)
- [cR2mX8] e2e cleanup deletes "the first row" and the suite becomes permanently self-failing
  Cause: a cleanup that deletes by POSITION (first row / first matching button) removes the wrong row whenever a previous (interrupted) run left a duplicate fixture row behind; the leftover then fails every later run's "removed" assertion.
  Fix: delete rows CONTAINING the fixture's unique text (find the tr whose textContent includes the fixture string, click ITS delete), never a positional row - and when duplicates can exist, LOOP the delete until no row matches; if a suite suddenly fails on removal checks with no code change, check the db for leftover fixture rows first. (2026-07)
- [qT8wN2] A flow that navigates to a NEW page mid-test reads baseline counts as 0 - the "back to baseline" assertion then fails
  Cause: baseline row/element counts captured AFTER clicking the button that navigates away read 0 (those elements don't exist on the new page), so `count === before` compares against 0.
  Fix: capture every baseline BEFORE the action that navigates; re-read only after the flow returns to the original page. (2026-07)
