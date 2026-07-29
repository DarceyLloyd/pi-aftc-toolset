# Codex Rules

> Unified always-on rules for the aftc-codex knowledge base: the critical global rules
> plus the self-learning / usage process, combined into one file (there is no separate
> rules file to read). The resource index lives in the auto-generated
> `codex-resource-list.md` (`codex_load('list')`), not here.
>
> NOTE: the sync command below appears as a double-brace placeholder token named
> CODEX_SYNC_COMMAND, replaced at injection time with the runtime-resolved
> `node "<path>/sync-codex-resources.mjs"` command. If you ever see that placeholder
> unsubstituted, locate `sync-codex-resources.mjs` under the aftc-codex extension and
> run it with `node`.

## Critical Global Rules

- AFTER READING THIS FILE you MUST also read and understand the `## Self-Learning & Usage Guidelines` section below. Do NOT start any project work — no thinking, no file changes, nothing — until you have read these rules AND loaded the relevant codex resources for the project you are about to work on. Skipping that is a hard fail.
- See `(*D)` on any rule means it does not apply to creative tasks such as image creation (svg, jpg, png, webp etc), designing frontend websites, rendering, screen capturing, etc (Non programming related tasks).
- IMPORTANT: Never use the character '§' in any code comment, file or documentation (excluding in this line, do not remove the character '§' from this line).
- Never create NUL files.
- Any script or command you run must be self-terminating: add exit/escape timers (or timeouts) to tests, servers, watchers and one-off scripts so they can never hold the session in an infinite
 wait. Never run anything that blocks on stdin or runs indefinitely without a guaranteed exit path.
- Got a problem or question ask immediately
- Never read or use any files in the following folders ".bak", ".old", ".git", ".dev". Unless specifically asked to or instructed to in another rule or documentation after this.
- Keep your answers, short and to the point, only when asked or discussing/planning give detailed responses (but not overly long winded). Remember it's fine to just say, ok, done, finished, ready etc. But never leave the user wondering if you are done without telling them. If you need to ask a question ask, dont assume. If you are responding to the user never be vague, if there are many features to the project, detail what you are talking about and what feature precisely and simply.
- Do not over engineer (*D)
- The simplest solutions are the best (*D)
- KISS (*D)
- ensure variables, functions and methods are named exactly what they are for eg hemiLightColor, enableVisualDevConsole
- When appending a description, hint or parenthetical after a list/menu/dropdown option label (or any label text), ALWAYS separate it from the label with a space — write `None (No sound will be played)`, never `None(No sound will be played)`. This applies to EVERY list/option you generate, not just any one option.
- When using Object Orientated capable languages (OOP) and using OOP, define variables above the constructor
- When defining variables that the user/developer may want to adjust often place them at the top of the script
- When working with threejs and babylonjs, WebGPU first and ensure fallback to WebGL2 unless specifically asked to
- When working with WebGPU / WebGL it is important that you inspect the users requirements in detail and ensure no errors in console occur and that features render and animate as requested.
- If you encounter an issue or are requested to fix an issue, before doing anything it is critical that you evaluate if its relevant or feasible to add logging to what you are working on. When you do add logging I typically have in place a log class/function which can be enabled/disabled via a bool and can be used per file. My logs to console or file read like a story of how an application initialises and runs at every step, event, timer completion etc. Then when I read this I often find an issue very quickly, you should do the same. Ensure you never interfere or break logging features of technologies standard practice/functionality or any project designed logging features. Ensure you clean up or disable this logging after the issue or fix has been completed. Be intelligent and adaptive with how you implement this and clean up after.
- For frontend runtime issues (something not rendering, an event not firing, a timer/animation not running, state not updating): add console logging at every relevant point (each function entry, event handler, timer tick, init) and read the browser console to observe the real runtime values and execution flow BEFORE doing a deep code analysis. Observe first, reason second — it is faster and more reliable than reading code blind. Gate the logs behind a debug flag or remove them once the issue is resolved.
- Never base64-embed an SVG (via img src or JS injection). Either inline the SVG code in the HTML (best for accessing its dom for animation) or use a real .svg file
- Image data is to never be stored in the database unless last resort or instructed to by project documentation or the user (store files on disk, paths in the db only)
- If you need to build anything for testing use the `tests` folder and document each in the projects AGENTS.md `Testing` section, if it doesn't exist then create it
- Keep `tests` folder organised, place tests in named sub folders
- Do not use `prefersReducedMotion()` (or otherwise auto-disable/suppress animations, timers or motion) unless the project docs or the user explicitly ask for it. When they do, scope it to exactly what was requested (one feature/component, or sitewide). Default stance: ship the motion. It is an OS-level setting frequently enabled on developer machines that silently no-ops features with zero console output.
- Done-criterion for visual / interactive / frontend work: passing compile + DOM-presence + zero-console-error checks is NOT done — those cannot see a canvas that doesn't fill its band, scroll leaking into the wrong scene, dead smooth scroll, or 50 recoloured clones. Before reporting such work done, open it in a real browser and verify the *rendered behaviour and look*: screenshot at the user's stated viewports (their desktop down to ~393px mobile) and actually look at them against the brief, and drive real interaction (trusted pointer clicks — not programmatic `.click()` — plus scroll, resize, theme toggle). Green tests are necessary, not sufficient. (See support-doc thought-and-action-guidance.md.)
- Turn the brief into an explicit acceptance checklist BEFORE coding and tick every item before done — including NEGATIVE constraints ("X must NOT react to scroll", "never a radial shine on cards", "only the background parallaxes", "cart from the right only"), which are the easiest to violate and produce no error. Re-read the brief verbatim at the end and confirm each line. (See support-doc thought-and-action-guidance.md.)

## Self-Learning & Usage Guidelines

There is a self-improvement process for you to follow on every project — it is all in
this file now (no separate rules file). The codex is a shared knowledge base of hard-won
fixes, gotchyas and rules: one markdown file per technology/topic under `resources/`, organised
into `languages/`, `libraries/`, `frameworks/`, `engines/`, `tools/`, `runtimes/`, plus the
top-level guidance files. The file name is the topic. Read the relevant resource when you hit a
problem; add an entry when you solve a non-obvious one.

### The codex resources (how to read them)

- The available resources are listed in `codex-resource-list.md` (auto-generated; load it
  with `codex_load('list')`). Trust the list — pick the resource to open from it; no
  folder scan needed.
- Load a resource on demand with the `codex_load` tool: `codex_load('typescript')`,
  `codex_load('docker')`, `codex_load('threejs')`. Fuzzy aliases work (`ts`, `py`, `js`).
  Special topics: `codex_load('rules')` (this file), `codex_load('guidance')`
  (`thought-and-action-guidance.md`), `codex_load('list')` (the resource list).
- `codex_load` searches across ALL category folders, so a file's folder does not matter
  for retrieval.

### Where you WRITE (the live copy, not the package seed)

The codex lives in TWO places. The package's `extensions/aftc-toolset/data/aftc-codex/`
is a READ-ONLY ship-time seed — never write there. Your writable knowledge base is the
LIVE per-user copy in the OS data dir (eg `%APPDATA%\pi-aftc-toolset\data\aftc-codex` on
Windows); `codex_load` and the sync script both read the live copy. Always add and edit
entries in the LIVE copy. If a sync reports "no changes" right after you wrote a file,
you almost certainly wrote to the read-only seed by mistake. The seed is also the
pristine restore baseline (a restore re-copies seed -> live), so writing to it would
pollute the very thing a restore relies on.

### MANDATORY first step before ANY project work

Identify the project's technologies/languages/tools, then load the relevant codex
resources for those technologies via `codex_load` (plus `thought-and-action-guidance.md`
always — `codex_load('guidance')`). This happens BEFORE exploring project files, BEFORE
planning, BEFORE any implementation. No exceptions.

### Before you edit or create a resource (check stale first)

Consult `codex-resource-list.md` (`codex_load('list')`) BEFORE editing or creating a
resource: update the RIGHT existing doc; never duplicate an existing entry; create a new
file in the correct category folder only when the topic genuinely does not exist yet.

### Sync the resource list (before and after resource changes)

The resource list is generated by a sync script. Run it:
- **Sync first** — before any resource work, so the list is current:
  `{{CODEX_SYNC_COMMAND}}`
- **Sync after** — after adding/editing/removing/renaming any resource, so the list
  reflects the change: `{{CODEX_SYNC_COMMAND}}`

The script is idempotent and prints "no changes" when nothing moved; it never throws, so
a sync can't break anything.

### Look up an issue (max 3 steps)

1. Have an error/message? Load the resource list, then string-search the obvious resource
   for the unique part of the message; read the match.
2. No match? Open the ONE obvious resource — a tool/extension file wins (`vite`,
   `pi-extension`, `ffmpeg` …); else a framework file when the behaviour is
   framework-specific (`aftc-framework` …); else the language file (`typescript`,
   `javascript`).
3. Judge resource names before loading — context is precious; never load the whole
   folder. If a documented fix fails, solve the issue, then correct or replace that entry.

### Correcting a wrong or outdated entry (immediate)

When the user tells you a codex entry is wrong, outdated, or has a better fix:
1. Update the entry in the resource file IMMEDIATELY — do NOT wait for `/aftc-codex-learn`.
2. Edit the entry in place, keeping it under its section and in its kind's format (Rule /
   Gotcha single line, or Issue lead + Cause + Fix). Keep the `[ID]`.
3. If it is an Issue entry, update the Fix date to current (YYYY-MM). If completely wrong,
   replace; if needs nuance, amend.
4. Run the sync script after editing.

### Record a new entry (max 3 steps)

1. Pick the obvious resource (tool > framework > language; file by the cause when known).
   If it seems to be missing, check the resource list first — a parallel session may have
   created it. Don't overthink: entries lead with the grep hook, so search finds them even
   in a slightly-wrong file.
2. Classify the entry's KIND (Rule / Gotcha / Issue & Solution — see `### Entry format`,
   answer the three questions IN ORDER), then add the entry at the END of the matching
   section (`## Rules`, `## Gotchyas` or `## Issues & Solutions`), in that kind's format.
   If you spot a duplicate while in the file, merge it. Never run dedupe sweeps. Prune an
   entry only when you notice it is stale. Then run the sync script.
3. If you expect a lesson in some bucket but honest analysis finds none, record NOTHING
   there and say so — never fabricate or pad an entry to fill an expected file. An
   honestly-reported empty result beats a contrived entry.

### Which resource? (tool vs framework vs language)

Ask: **"would this issue exist without the tool / framework?"**

- **Tool / extension** (bundler, server, runtime, CLI) — would NOT exist without it → its
  own tool file. (The TypeScript compiler and its direct plugins like ts-loader are not
  separate tools — they stay in `typescript.md`.)
- **Framework** (has its own behaviour/conventions/quirks, eg the AFTC PHP MVC framework)
  — would NOT exist without it → a file named after the framework (`aftc-framework.md`).
  A framework's own quirk beats the language file.
- **Language** — the issue WOULD exist without any tool/framework → the language file
  (`typescript.md` = type system / compile; `javascript.md` = runtime / syntax / modules).

Pick the BEST-fit file in ONE pass and move on — do not agonise over borderline cases
(eg a JUCE symptom of a general CMake rule). Good-enough routing is correct: the grep
hook finds an entry even in a slightly-wrong file, and a later `-learn` can relocate it.
If a lesson genuinely spans two scopes, file it where a searcher will grep first and
cross-reference the other file in the Fix line; never duplicate the full entry in both.
### Which KIND of lesson? (recorded vs not recorded)

`/aftc-codex-learn` records **technology lessons into `resources/` only** — it NEVER
writes to the fixed top-level docs. FIRST decide whether the lesson is recordable at all:

- **Thought / process guidance**  NOT recorded by `-learn`. `thought-and-action-guidance.md`
  is a FIXED maintainer doc (curated by hand in the package seed; the live copy is
  only replaced by a full reinstall — Start Fresh or `/codex-install`). If a process rule belongs in the codex, tell the user to
  add it to the seed — do not write it via `-learn`.
- **Tech lesson** > the ONLY kind `-learn` records: the right
  `resources/{languages|libraries|frameworks|engines|tools|runtimes}/<topic>.md` (create the
  folder/file if missing). THEN classify it as a Rule, a Gotcha or an Issue & Solution —
  see `### Entry format` below.
- **Design / planning deliberation** > NOT a codex entry. Architectural tradeoffs, "X vs Y"
  decisions, feature specs and discussion conclusions are project/task-specific and
  ephemeral — they belong in the project's plan/spec doc or the relevant module readme,
  not the general codex.

### Entry format (three KINDS: Rules, Gotchyas, Issues & Solutions)

Every resource file is divided into THREE sections with these EXACT headings, in this
order. All three headings are ALWAYS present, even when empty — never delete one:

```
# <Topic>

## Rules

## Gotchyas

## Issues & Solutions
```

Write your entry at the END of the matching section (just before the next `## ` heading,
or at the end of the file for the last section). Each kind has its OWN format — never
mix formats across kinds:

**1. RULE — one single line, a directive.** A convention WE choose to enforce (style,
naming, safety, best practice). No Cause:/Fix: lines, no date:

```
- [ID] Never/Always <do or don't do X> — <one short reason or clarification>.
```

Example: `- [kR9mQ2] Never base64-embed an SVG — inline the SVG in the HTML or use a real .svg file.`

**2. GOTCHA — one single line with TWO required parts: the trap AND the countermeasure.**
A trap built INTO the technology (a silent default, surprising behaviour) — you cannot
change it, only know it and avoid it. One physical line, no Cause:/Fix: lines, no date.
A gotcha WITHOUT the countermeasure is trivia — never write one:

```
- [ID] LEAD — <the trap: what the technology does that bites you>; <what to do / watch for>.
```

Example: `- [01k8yP] Google Fonts & — a bare & silently drops the 2nd+ family; give each family its own &family=.`

**3. ISSUE & SOLUTION — three parts across lines, dated.** A concrete failure that was
OBSERVED (an error message, broken output, wrong behaviour) with a diagnosis. This is
the ONLY kind with Cause:/Fix: lines and a date:

```
- [ID] LEAD_TOKEN — one-line symptom (what you see / the situation)
  Cause: why it happens.
  Fix: what to do. (YYYY-MM)
```

**WHICH KIND? Answer these three questions IN ORDER and use the FIRST that matches:**

1. Did you OBSERVE a concrete failure (error message, broken output, wrong behaviour)
   and find the diagnosis? > **Issue & Solution**. Test: is there a greppable symptom
   or error string? If yes it is ALWAYS an Issue, never a Gotcha.
2. Is it a convention WE decide to follow ("always/never do X", naming, style)? Could
   someone CHOOSE to violate it? > **Rule**.
3. Is it behaviour the TECHNOLOGY forces on you (a trap you can only avoid, not
   change)? > **Gotcha**.

> **EXCEPTION — `thought-and-action-guidance.md` uses NO `[ID]`s.** The `[ID]` format here
> is for files under `resources/` ONLY (`languages|libraries|frameworks|engines|tools|runtimes/<topic>.md`).
> Entries in `thought-and-action-guidance.md` are PLAIN PROSE LEADS — `- one-line symptom`
> then `  Cause:` / `  Fix:` — with **no `[ID]` and no brackets**. For that file: write the
> prose lead, check it is not a duplicate of an existing lead, stop. Never add an `[ID]`
> to `thought-and-action-guidance.md`.

- **`[ID]` (required on ALL new entries in `resources/**/*.md`, every kind).** A short
  (~6-char) alphanumeric token in square brackets, unique within the file (eg `[aB3xY9]`).
  It lets the uniqueness check and any cross-reference target one specific entry. Pick any
  unused token; never reuse one already in the same file. **NOT used in
  `thought-and-action-guidance.md`** (see the EXCEPTION above).
- **Lead token first (every kind).** Right after the `[ID]`, put the most greppable thing:
  the literal unique part of an error message (`TS7016`, `ERR_MODULE_NOT_FOUND`) for an
  Issue; the feature / class / function name for a Rule or Gotcha. Grep must find the entry.
- **`Cause:` / `Fix:` lines (Issues only, both required).** Why it happens, then what to
  do, ending the Fix with the date `(YYYY-MM)`. A fresh session must be able to apply the
  fix without guessing — never sacrifice meaning for brevity.
- **Not only errors.** Anything that took more than 2–3 attempts to work out, framework
  behaviour, and non-obvious methods that save future thought-loops all belong here
  (classified by the three questions above).
- **No project names** — only the date.
- **No project-specific content.** Entries must be GENERAL and reusable across any project.
  Never include: project/page/file names, specific URLs, design names, client names, or
  context that only makes sense in one codebase. Write the symptom/cause/fix so a developer
  on a completely different project can understand and apply it. Bad: "Gallery page crashes".
  Good: "Web page with many iframes crashes the browser tab."
- **Legacy entries** predating this layout (single-line `A — cause — fix` form, no `[ID]`,
  or sitting outside the three sections) are still valid and grep-able; write NEW entries
  under the sections in the formats above, and when you next TOUCH a legacy entry, give it
  an `[ID]`, classify its kind, and move it under the right section. Do NOT mass-reformat
  files just to relocate entries. **`thought-and-action-guidance.md` is prose-only by
  design — never add an `[ID]` there** (not even to its "legacy" entries).

### MANDATORY: contributing back (never wait to be asked)

Contributing to the codex resources is part of completing any work, like updating project
docs. Two triggers:

1. IMMEDIATELY when a qualifying solution is found (took more than 2 or 3 attempts, or a
   future session could realistically hit the same wall: framework behaviour, tooling
   quirks, non-obvious methods) — record it right away while the cause and fix are fresh,
   then continue the task.
2. BEFORE reporting any work as done: do a final sweep of the session — did anything take
   real effort to work out? If yes and it is not yet recorded, record it then. This
   applies to MORE than errors: solutions, gotchas and methods all qualify.

### `/aftc-codex-learn` (self-education)

`/aftc-codex-learn` injects instructions for you to persist durable, GENERAL lessons (not
project-specific) into the codex resources, using your standard tools (read/edit/write +
bash to run the sync script). It: syncs first; checks the resource list to avoid
duplicates; classifies each lesson (Rule / Gotcha / Issue & Solution) and writes it under
the matching section of the right
`languages|libraries|frameworks|engines|tools|runtimes/<topic>.md` ONLY (creating the file
with the three-section skeleton in the correct category folder if missing); proposes entries
and writes only after user
confirmation; then syncs after. `codex-rules.md`, `markdown-guidance.md`, and
`thought-and-action-guidance.md` are FIXED maintainer docs — `-learn` does NOT modify them.
