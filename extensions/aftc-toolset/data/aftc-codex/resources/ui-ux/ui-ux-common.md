# UI-UX Common (All Domains)

*Scope: VISUAL design lessons that hold on EVERY platform (web, mobile, desktop, plugin) -
colour, contrast, typography, spacing, sizing, usability universals. A lesson that only fits one
domain goes to that domain's file instead (web-app.md, web-page.md, web-backend.md,
desktop-web-app.md, desktop-app.md, mobile-app.md, vst-plugin.md). Never duplicate an entry in
both this file and a domain file.*

## Rules

- [dU4kT9] Always put DARK ink on bright accent button fills on dark UIs, and make the filled button clearly brighter than the surface behind it - white text on a mid-tone gradient over a dark tinted background fails contrast and reads washed-out.
- [oL5bN2] Always separate a hint/parenthetical from its option label with a space - write `None (No sound will be played)`, never `None(No sound will be played)`; applies to EVERY list, menu and dropdown option in any UI.

- [dh1Xp0] Dark theme, but not too dark - form elements and buttons must stand out clearly from the background (user preference; washed-out controls on near-black are rejected).

- [SedQep] Uniform controls: all buttons one size/style, all form inputs one size/style, and button heights MUST equal input heights - consistency is essential; only free-form text output areas are exempt (user preference).

- [yqeRDh] Never heavily round buttons or elements - use one shared 1 px border-radius value for all elements (user preference; heavy rounding 'looks bad').

- [ExMlDW] Every user-facing string (menu option, toggle, confirm, warning) must be self-explanatory to a first-time user with zero internal knowledge: state the current value, add a one-line plain description of what changing it does, phrase actions as outcomes for the user, and never use bare internal jargon (seed, live copy, frontmatter, built-in) — if a newcomer could read it and ask "what does this do?", it is not finished.

- [LNoa7N] Never pack a menu's title/header straight onto its option list - keep them visually separated with a blank line between the header and the items, align the option labels and their descriptions into columns (pad the labels to a shared width), and end with a help/footer line naming the keys (eg "enter select, esc cancel").

- [mEDzsA] Always centre icons inside their box/container on both axes (eg display:grid + place-items:center), and centre the icon BOX itself against the content it accompanies - an icon box top-aligned beside a taller text block reads as broken/misaligned; vertical centring is the standard default for icon-in-a-container rows.

- [HO4oT3] All main titles/headings across a site must use ONE shared title colour token (eg --title) - per-page heading colour drift breaks basic UI/UX consistency; exempt only a feature that explicitly requests it or a deliberately artistic site (a shop/standard web page is never exempt).

## Gotchyas

## Issues & Solutions
