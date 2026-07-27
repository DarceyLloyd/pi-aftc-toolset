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

The user runs /aftc-codex-learn to start the self-education loop. You then:

1. Sync first - run the sync script named in the injected instructions.
2. Read codex-resource-list.md before editing or creating anything. Update the
   correct existing doc; never duplicate an existing entry.
3. Propose the new entries and WAIT for the user to confirm before writing. Use the
   established entry format exactly:

   ```text
   - LEAD_TOKEN - one-line symptom
     Cause: why it happens.
     Fix: what to do. (YYYY-MM)
   ```

   - Thinking, verification, and process lessons go in
     thought-and-action-guidance.md.
   - Technology gotchas go in the correct category doc
     (languages|libraries|frameworks|engines|tools/<topic>.md). Create the file in
     the right category folder if it is missing.
4. After the user confirms and you have written, run the sync script again.

Record only durable, general lessons - never project-specific facts. Prefer
updating an existing doc over creating a new one.

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
