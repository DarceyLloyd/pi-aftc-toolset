---
name: aftc-codex
description: >-
  Drive the pi-aftc-toolset aftc-codex knowledge base inside pi. Load curated
  conventions and gotchas for a language, library, framework, engine, or tool
  on demand with codex_load, record durable lessons back into the knowledge
  base, and use the structure-map documentation pattern. Use when the user
  enables, runs, syncs, or learns with aftc-codex, when you should consult the
  codex before relying on a technology's conventions, or when documenting a
  non-trivial hierarchical structure.
---

# aftc-codex (pi-aftc-toolset)

An opt-in knowledge base. When it is active, the codex rules, the thinking and
action guidance, and a generated resource list are already in your system prompt.
Use this skill to fetch topic docs on demand, to record lessons back, and to apply
the structure-map documentation pattern.

## How it works - read first

- The feature is off by default. The user enables it with /codex-enable and
  preps it with /codex-init. If the rules are not in your system prompt, the
  feature is not active - do not pretend it is.
- The stable rules and guidance ride the cached system-prompt prefix. Topic docs
  are NOT injected - you fetch the ones you need with codex_load. This keeps the
  context small.
- A marker message in the conversation tells you the codex is active and may name
  detected project topics. Load those first.
- Pruning (/codex-disable) removes codex docs from the context for the session.
  It never deletes stored history. /codex-init re-activates.

## codex_load - fetch a resource on demand

Call codex_load with a topic name. It searches across every category folder
(languages, libraries, frameworks, engines, tools) and the top-level guidance
files, so the folder does not matter.

- codex_load("typescript"), codex_load("docker"), codex_load("threejs")
- Aliases: ts, py, js, pine, gd
- Specials: codex_load("rules"), codex_load("guidance"), codex_load("list"),
  codex_load("markdown")
- codex_load("list") shows every available resource. Call it when you are unsure
  what exists.
- An unknown topic returns the full valid list - pick from it.
- An empty resource (headings, no entries) returns a one-line "no entries yet"
  answer - nothing to load, but a candidate for codex_add_entry when you learn
  a durable lesson about that topic.

Project stack pinning: a project can declare its stack with an
`<!-- AFTC-CODEX-STACK topics: typescript, vite, web-app -->` block in its
auto-inject file (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, ...).
Detection reads that block first - it is the only way design domains and target
OS get detected. Help maintain it when you notice the stack drift (the codex
rules define the format).

Load the relevant resource BEFORE you rely on a technology's conventions, and
before you edit a file in that technology. One load replaces many guess-and-check
round trips.

## Resource categories

- languages - css, html, javascript, php, pinescript, python, typescript
- libraries - chartjs, gradio, gsap, pytorch, threejs (mixed across languages)
- frameworks - aftc-framework
- engines - godot
- tools - apache, bun, composer, docker, ffmpeg, mysql, pi-extension, powershell,
  puppeteer, vite, webpack, winrar
- top-level guidance - codex-rules, thought-and-action-guidance, markdown-guidance,
  and the generated codex-resource-list

The folder is only organisation. Retrieval searches all of them.

## Recording lessons - /aftc-codex-learn

The user runs /aftc-codex-learn to start the self-education loop. Every write
goes through the codex entry tools - never hand-edit resource files and never
run a sync script (the tools handle [ID] generation, format validation, section
placement, topic/category creation, and the resource list internally):

**HARD LIMITS - every entry must be GLOBAL and SAFE (check BEFORE writing):**

1. GENERALITY: the entry must make sense to a session working on ANY project.
   No project names, no real paths/URLs, no terms only one project's docs or
   workflow use. Project facts are NEVER saved. Reword generically or drop.
   - BAD: "Add a References block and last-reviewed stamp to every deep doc;
     keep map IDs stable" (one project's documentation vocabulary).
   - GOOD: "When generating docs from source, verify every claimed
     file/endpoint exists in code before documenting it as live - a reference
     to a missing file means the feature is removed."
2. SECRETS: NEVER save passwords, API keys, tokens, private keys, connection
   strings or any credential - not even as examples. Describe the SHAPE only
   ("the API key env var"), never a value.
3. The write tools mechanically reject real absolute paths, URLs,
   credential-looking values and the current project's name. A refusal means
   reword generically - never try to force the entry through.

When in doubt: reword generically or drop - never save as-is.

1. Review the session for durable, general lessons (never project-specific).
2. Consult the resource list (in the system prompt, or codex_load("list")).
   Update the correct existing doc; create a new topic ("category/name", new
   categories allowed) only when nothing covers it.
3. codex_load each target topic and check the lesson is not already there. This
   is enforced: the write tools refuse a topic not loaded this session and
   reject exact duplicates.
4. Apply the HARD LIMITS above to each entry (generality + no secrets), then
   classify each lesson (first match wins): observed failure with a diagnosis
   -> kind "issue" (text = symptom lead, plus cause and fix - the tool appends
   the current date); a convention we choose -> kind "rule" (one line); a
   technology trap you can only avoid -> kind "gotcha" (one line with BOTH the
   trap and the countermeasure). Write with codex_add_entry (batch several
   entries for the same topic in ONE call). When propose-then-confirm is on,
   show the entries and wait for the user before calling the tool.
5. Correct or remove outdated entries with codex_edit_entry / codex_remove_entry
   (by [ID]).

The fixed top-level docs (codex-rules, thought-and-action-guidance,
markdown-guidance) are NEVER written by -learn. Record only durable, general
lessons - never project-specific facts. Prefer updating an existing doc over
creating a new one.

## Structure maps - documenting hierarchies

For a non-trivial hierarchical structure (a sitemap, a menu flow, a directory
layout, an API surface, a feature tree, a DB schema, a component tree), document
and understand it as a compact ID structure map: a tree with hierarchical IDs, then
per-ID detail. Reference nodes by ID elsewhere instead of re-describing them.

```text
1  Root
|- 1.1  Child A
|  \- 1.1.1  Grandchild
\- 1.2  Child B
```

Then per-ID detail:

```text
### 1 - Root: what it is
### 1.1 - Child A: detail
### 1.1.1 - Grandchild: detail
```

Principles:

- The ID is the path (1.2.1 = root, child 2, child 1). It stays stable even when
  descriptions change.
- Tree first (compact overview), then per-ID detail (referenceable).
- Auto-generated maps (dir listings, the codex resource list) come from a script,
  so they stay fresh.
- Hand-written maps go stale. Treat them as snapshots: verify against reality
  (ls, read, grep) before trusting one, and regenerate it if it has diverged. A
  stale map is worse than no map.
- Use judgment - map real hierarchies, not trivial things.

Load codex_load("markdown") for the template and the full how-to, or invoke
/skill:markdown.

## Command reference

- /aftc-codex - open the config menu
- /codex-enable - enable (persists; seeds on first enable)
- /codex-disable - disable (removes codex from the context)
- /codex-init - prep now: load the rules, fetch the relevant docs
- /codex-disable - remove codex from the context for this session
- /aftc-codex-learn - record durable lessons into the codex
- /aftc-codex-status - show status

## Safety

- The codex is a one-way copy: shipped seed -> your live data-dir copy. Your live
  edits (e.g. via /aftc-codex-learn) are never auto-overwritten by the seed.
- Start Fresh and re-install wipe the live copy and re-copy the seed; they are
  irreversible, so they confirm before running.
- Pruning is a non-destructive filter of what you see; it never deletes stored
  history or truncates a session.
