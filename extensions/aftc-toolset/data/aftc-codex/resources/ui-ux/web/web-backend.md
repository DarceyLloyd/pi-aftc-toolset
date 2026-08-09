# Web Backend Design

*Scope: VISUAL design of back-end / back-office web interfaces (admin panels, CMS screens,
settings consoles, data tables, forms) - the look and usability ONLY, never API design or
server mechanics. For user-facing web apps see web-app.md; for content pages see web-page.md.*

## Rules

- [9ITLKx] Admin/back-office users are operators, not developers - never surface internal identifiers or file paths in editors (a "primary image path" text input is the classic mistake); show a rendered PREVIEW plus an action that does the work (upload-and-replace, make-primary), and auto-generate machine fields left blank (slugs, SKUs) instead of making the user invent them.

## Gotchyas

## Issues & Solutions
