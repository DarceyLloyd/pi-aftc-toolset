# PROJECT-TYPE PACK: Generic / other (closest-match fallback)

Appended to the /docx core execution prompt. It defines how to apply the
core when no other type pack is a close match. This is NOT the old
all-in-one prompt - it is the slim, platform-neutral fallback. The core's
rules apply in full.

## How to adapt (do this FIRST in step 1)

- Identify the project's actual platform(s) from its manifests and entry
  points, then define the platform's EQUIVALENTS of the core's terms and
  write them into the generation plan:
  - "route table" = wherever the platform registers reachable surfaces
    (routes, window/screen constructors, menu/nav definitions, command
    registrations, plugin editor entry points, screen registries).
  - "template" = wherever surface CONTENT is defined (markup, designer
    files, component code, resource files).
  - "form field / control" = the platform's input elements and their
    validation.
  - "API" = the platform's data contracts (HTTP, IPC/RPC, function-level
    public API for libraries).
- If another type pack ALMOST fits, follow its spirit - but stay within
  this pack and the core (exactly one pack is injected).

## Surface rules

- Anything with a user-facing interface: map the FULL reachable surface
  tree (pages, screens, windows, dialogs, modals, popups, CLI screens) as
  branch nodes - modals and popups are pages with their own leaf docs.
- Projects with NO user interface (libraries, SDKs, frameworks, engines):
  the public API surface takes the place of pages - one leaf doc per API
  area/module (its public classes/functions with signatures, contracts and
  examples), organised as the UI branch would be.
- Mixed projects (app + embedded library) document both: surfaces for the
  app, API areas for the library.

## Per-surface / per-API-area leaf contract

- The file that defines it.
- What's on it / what it exposes: controls or public symbols (names, types,
  validation/contracts), from source.
- Data read/written, configuration, env vars.
- States (for surfaces) or error/edge behaviour (for APIs).
- The flow: how it is reached/used, with examples for APIs.

## Extra rules

- When a choice is genuinely ambiguous, prefer MORE leaf docs over fewer
  (the guide's drill-down rule) and note the ambiguity in the step-12
  report.
- Record what could not be classified confidently in docx/known-gaps.md
  with a follow-up plan.
