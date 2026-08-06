# PROJECT-TYPE PACK: Basic website (static HTML/CSS/JS)

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers static sites with no framework and no backend: plain
.html pages, .css/.scss, and vanilla .js/.mjs - including small brochure
sites, landing pages and docs sites.

## Sources of truth (recon - read these, never the old docs)

- PAGES: every .html file IS a page. Index/list them all from disk - the
  page inventory comes from the file listing, not from the old docs or the
  nav (a page missing from the nav is still a page).
- NAV: header/nav markup (repeated or included) - the site's surface tree
  as the user sees it; verify every nav link resolves to a real file.
- MODALS/POPUPS: <dialog> elements, hidden divs toggled by JS (classList,
  display), lightboxes, cookie banners, signup/contact popups. Search the
  JS for the toggling code. Each one is a PAGE with its own leaf doc.
- FORMS: every <form> and its fields (name/id, label, type, required,
  pattern), its action (mailto:, third-party endpoint, JS-handled) and its
  JS validation.
- JS MODULES: every .js/.mjs file - which pages load it, what behaviour it
  adds (menus, sliders, galleries, theme toggle, animations).
- PARTIALS/SHARED MARKUP: header/footer/sidebar blocks duplicated across
  pages or injected by JS - document them once, referenced by every page.

## Surface rules for this stack

- One leaf doc per .html page (or a sitemap entry only, when the page is
  simple) under the site branch; one leaf per modal/popup.
- Multi-page flows (a multi-step form, a gallery lightbox shared by pages)
  get their own leaf docs.
- There is no backend: document external dependencies explicitly (form
  endpoints, embeds, analytics, fonts, CDNs) - each with what breaks when
  it is unreachable.

## Per-surface leaf contract (what the core's contract means here)

- The .html file that defines the page.
- What's on it: sections/regions of the markup, every form field (name/id,
  label, type, validation), every JS-driven widget on the page with the
  script file that drives it.
- Data: none stored locally - note forms and their submission target.
- States: JS-off fallback, validation errors, submitted/success state,
  popup open/closed.
- Functionality: the interaction flow per widget (menu open/close, slider,
  filter), responsive behaviour found in the CSS/JS.

## Extra rules

- Responsive behaviour (breakpoints found in the CSS) belongs in the
  sitemap/design doc, not repeated per page.
- A build step (scss compile, bundler) is documented under setup with its
  exact commands from package.json/scripts when present.
