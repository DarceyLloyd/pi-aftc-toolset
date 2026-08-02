# Codex Rules

> Unified always-on rules for the aftc-codex knowledge base: the critical global rules
> plus the self-learning / usage process, combined into one file. The resource index
> lives in the auto-generated `codex-resource-list.md` (`codex_load('list')`), not here.
>
> IMPORTANT: codex resource WRITES go through the codex entry tools
> (codex_add_entry / codex_edit_entry / codex_remove_entry) - never hand-edit resource
> files and never run a sync script yourself. The tools generate the entry [ID]s,
> validate the per-kind format, place entries under the correct section, create missing
> topic files and category folders, and regenerate the resource list internally.
>
> IMPORTANT: Rules in this file marked with (*D) are rules that never apply to any visual, creative, design, image generative etc tasks such as image creation, web design, application design (Non programming tasks).

## Critical Global Rules

- Never use em dashes (the long — character); always use a plain dash (-) instead. The em dash appears in this line only so the rule can name it.
- AFTER READING THIS FILE you MUST also read and understand the `## Self-Learning & Usage Guidelines` section below. Do NOT start any project work - no thinking, no file changes, nothing - until you have read these rules AND loaded the relevant codex resources for the project you are about to work on. Skipping that is a hard fail.
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
- When using (OOP) Object Orientated capable languages and using OOP, define variables above the constructor
- When defining variables that the user/developer may want to adjust often place them at the top of the script
- If you encounter an issue or are requested to fix an issue, before doing anything it is critical that you evaluate if its relevant or feasible to add logging to what you are working on. When you do add logging I typically have in place a log class/function gated via enabled bool flag applicable at the per a file/class level. When I create logs to console or file read like a story of how an application initialises and runs at every step, event, timer completion etc. This often results in any issue being found and resolved very quickly, you should always do this where applicable as it will help you greatly (if you ever have to do this, then what you are trying to fix is probably a good candidate for an entry to the appropriate codex resource in issues & solutions, evaluate and add accordingly). Ensure to clean up or disable logging after the issue has been resolved. Be intelligent and adaptive with how you action this rule.
- For frontend runtime issues (something not rendering, an event not firing, a timer/animation not running, state not updating): add console logging at every relevant point (each function entry, event handler, timer tick, init etc) and read the browser console to observe the real runtime values and execution flow BEFORE doing a deep code analysis. Observe first, reason second - it is faster and more reliable than reading code blind. Gate the logs behind a debug flag or remove them once the issue is resolved.
- Never base64-embed an SVG (via img src or JS injection). Either inline the SVG code in the HTML (best for accessing its dom for animation) or use a real .svg file
- If you need to build anything for testing use the `tests` folder, ensure AGENTS.md has a section titles `Testing` add a short summary of what has been deployed for testing and link to a `testing.md` document for full detailed testing documenation, usage and issues etc. If `testing.md` and `tests` dir don't exist, create them.
- Keep `tests` folder organised, place tests in named sub folders

## Self-Learning & Usage Guidelines

There is a self-improvement process for you to follow on every project - it is all in
this file now (no separate rules file). The codex is a shared knowledge base of hard-won
fixes, gotchyas and rules: one markdown file per technology/topic under `resources/`, organised
into `languages/`, `libraries/`, `frameworks/`, `engines/`, `tools/`, `runtimes/`, `design/`
(visual/UX design: one file per domain + `design-common.md` for lessons that fit EVERY domain),
`database/` (engine-agnostic database lessons), `os/` (platform lessons: `windows`,
`osx`, `linux`), plus the top-level guidance files. The file name is the topic. Read the relevant resource when you hit a
problem; add an entry when you solve a non-obvious one.

### The codex resources (how to read them)

- The available resources are listed in `codex-resource-list.md` (auto-generated; load it
  with `codex_load('list')`). Trust the list - pick the resource to open from it; no
  folder scan needed.
- Load a resource on demand with the `codex_load` tool: `codex_load('typescript')`,
  `codex_load('docker')`, `codex_load('threejs')`. Fuzzy aliases work (`ts`, `py`, `js`).
  Special topics: `codex_load('rules')` (this file), `codex_load('guidance')`
  (`thought-and-action-guidance.md`), `codex_load('list')` (the resource list).
- `codex_load` searches across ALL category folders, so a file's folder does not matter
  for retrieval.

### Where you WRITE (the live copy, not the package seed)

The codex lives in TWO places. The package's `extensions/aftc-toolset/data/aftc-codex/`
is a READ-ONLY ship-time seed - never write there. Your writable knowledge base is the
LIVE per-user copy in the OS data dir (eg `%APPDATA%\pi-aftc-toolset\data\aftc-codex` on
Windows); `codex_load` and the codex entry tools both operate on the live copy (the
tools never touch the seed). The seed is also the
pristine restore baseline (a restore re-copies seed -> live), so writing to it would
pollute the very thing a restore relies on.

### MANDATORY first step before ANY project work

Identify the project's technologies/languages/tools/visual design/ui & ux requirements, 
then load the relevant codex resources for those technologies via `codex_load` 
(plus `thought-and-action-guidance.md` always - `codex_load('guidance')`). This happens
BEFORE exploring project files, BEFORE planning, BEFORE any implementation. No exceptions.

### Project tech-stack block (AFTC-CODEX-STACK)

Every project should declare its stack in the coding agent's auto-inject file so
codex auto-detection can pin the right resources (this block is the ONLY way the
design domains and target OS are detected - no file scan can infer them):

```
<!-- AFTC-CODEX-STACK
topics: typescript, scss, vite, web-app, windows
-->
```

- When starting work in a project: look for the block in the recognised auto-inject
  files (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, GEMINI.md,
  .cursorrules, .windsurfrules). Create it when missing (prefer AGENTS.md when no
  auto-inject file exists), update it when the stack changes, and keep it identical
  across every recognised file the project has.
- `topics:` is a flat comma-separated list of codex topic names (the resource file
  basenames: typescript, cpp, cs, rs, java, vite, docker, ...). Include languages,
  frameworks, libraries, tools, runtimes, the DESIGN domain (web-app, web-page,
  web-backend, desktop-app, desktop-web-app, mobile-app, vst-plugin) and the target
  OS (windows, linux, osx) when the project targets one specifically.
- Names with no live resource are not errors - detection reports them as "no
  resource yet" hints. Never invent topics to pad the line; fewer, accurate names win.

### Before you edit or create a resource (check stale first)

Consult `codex-resource-list.md` (`codex_load('list')`) BEFORE editing or creating a
resource: update the RIGHT existing doc; never duplicate an existing entry; create a new
file in the correct category folder only when the topic genuinely does not exist yet.

### The resource list (auto-generated, never hand-maintained)

`codex-resource-list.md` is machine-generated (byte-stable - it rides the cached system
prompt). Never edit it by hand and never run a sync script yourself: the codex entry
tools regenerate the list internally whenever they create a new topic file. Entry
CONTENT changes do not affect the list (it tracks file paths and first headings only),
so adding, editing or removing entries needs no list update.

### Look up an issue (max 3 steps)

1. Have an error/message? Load the resource list, then string-search the obvious resource
   for the unique part of the message; read the match.
2. No match? Open the ONE obvious resource - a tool/extension file wins (`vite`,
   `pi-extension`, `ffmpeg` …); else a framework file when the behaviour is
   framework-specific (`aftc-framework` …); else the language file (`typescript`,
   `javascript`).
3. Judge resource names before loading - context is precious; never load the whole
   folder. If a documented fix fails, solve the issue, then correct or replace that entry.

### Correcting a wrong or outdated entry (immediate)

When the user tells you a codex entry is wrong, outdated, or has a better fix:
1. Update the entry IMMEDIATELY with `codex_edit_entry` (or delete it with
   `codex_remove_entry`) - do NOT wait for `/aftc-codex-learn`. The tools keep the
   `[ID]`, re-validate the kind's format, and refresh an Issue's Fix date to current
   automatically.
2. If completely wrong, replace the content; if it needs nuance, amend. Pass a different
   `kind` to reclassify - the tool moves the entry to the matching section.

### Record a new entry (max 3 steps)

1. Pick the obvious resource (tool > framework > language; file by the cause when known).
   If it seems to be missing, check the resource list first - a parallel session may have
   created it. Don't overthink: entries lead with the grep hook, so search finds them even
   in a slightly-wrong file.
2. `codex_load` the target resource and check the lesson is not already there (the write
   tools REFUSE to modify a topic you have not loaded this session, and reject exact
   duplicates). Then classify the entry's KIND (Rule / Gotcha / Issue & Solution - see
   `### Entry format`, answer the three questions IN ORDER) and call `codex_add_entry` -
   it generates the `[ID]` and writes the entry at the END of the matching section in
   that kind's format, creating the topic file (and category folder) when missing. Batch
   several entries for the same topic into ONE call. If you spot a duplicate while in
   the file, merge it (`codex_edit_entry` / `codex_remove_entry`). Never run dedupe
   sweeps. Prune an entry only when you notice it is stale.
3. If you expect a lesson in some bucket but honest analysis finds none, record NOTHING
   there and say so - never fabricate or pad an entry to fill an expected file. An
   honestly-reported empty result beats a contrived entry.

### Which resource? (tool vs framework vs language vs design)

Ask: **"would this issue exist without the tool / framework?"**

- **Tool / extension** (bundler, server, runtime, CLI) - would NOT exist without it → its
  own tool file. (The TypeScript compiler and its direct plugins like ts-loader are not
  separate tools - they stay in `typescript.md`.)
- **Framework** (has its own behaviour/conventions/quirks, eg the AFTC PHP MVC framework)
  - would NOT exist without it → a file named after the framework (`aftc-framework.md`).
  A framework's own quirk beats the language file.
- **Language** - the issue WOULD exist without any tool/framework → the language file
  (`typescript.md` = type system / compile; `javascript.md` = runtime / syntax / modules).
- **Design (visual/UX)** - the lesson is about how a UI LOOKS or is USED (layout, contrast,
  spacing, usability, domain conventions) and is independent of the tech stack → the matching
  `design/<domain>.md`: `web-app` (browser apps), `web-page` (content/marketing pages),
  `web-backend` (admin/back-office UIs - visual only, never API), `desktop-web-app` (web tech in
  a desktop shell, eg Electron), `desktop-app` (native desktop), `mobile-app` (touch-first),
  `vst-plugin` (DAW-hosted audio plugins). Pick by the DOMAIN the UI lives in, never by the
  technology, and never mix web and desktop conventions in one file. A lesson that holds on EVERY
  platform (colour, contrast, typography, spacing, sizing, usability universals) goes to
  `design/design-common.md` instead - and never duplicate an entry in both design-common and a
  domain file. A lesson that is BOTH a design lesson and a technology quirk goes to the
  technology file, with the design file getting it only if a design searcher would look for it
  there.
- **Database** - engine-specific (a MySQL error, an engine's syntax/behavior quirk) → that
  engine's tool file (`mysql.md`, ...). Holds for ANY database (storage conventions, migration
  discipline, NULL semantics) → `database/database-common.md`.
- **OS (platform)** - the lesson is OS-level behaviour (shells, paths, permissions,
  installers, windowing, services) that depends on the operating system → `os/<platform>.md`
  (`windows`, `osx`, `linux`). Every os/ entry lead MUST name its scope: the Linux
  distro family (debian/rhel/arch), the mac architecture (intel/arm64), or the Windows
  version - a fix that is true on Ubuntu may be false on CentOS, and Intel-Mac issues
  diverge from M-series.
  **The css/scss vs design test (mechanism vs choice):** if the TECHNOLOGY bit you - a property
  behaves unexpectedly, a specificity/cascade trap, a browser rendering quirk, the fix is a CSS
  technique - it stays in `css.md` / `scss.md`, even when the symptom is visual. If it is a
  CHOICE that would still be true implemented in any other technology (contrast, ink-on-fill
  pairings, spacing, touch-target sizes, layout/usability conventions) it goes to
  `design/<domain>.md`. Mechanism → language file; choice → design file.

Pick the BEST-fit file in ONE pass and move on - do not agonise over borderline cases
(eg a JUCE symptom of a general CMake rule). Good-enough routing is correct: the grep
hook finds an entry even in a slightly-wrong file, and a later `-learn` can relocate it.
If a lesson genuinely spans two scopes, file it where a searcher will grep first and
cross-reference the other file in the Fix line; never duplicate the full entry in both.
### Which KIND of lesson? (recorded vs not recorded)

`/aftc-codex-learn` records **technology lessons into `resources/` only** - it NEVER
writes to the fixed top-level docs. FIRST decide whether the lesson is recordable at all:

- **Thought / process guidance**  NOT recorded by `-learn`. `thought-and-action-guidance.md`
  is a FIXED maintainer doc (curated by hand in the package seed; the live copy is
  only replaced by a full reinstall - Start Fresh or `/codex-install`). If a process rule belongs in the codex, tell the user to
  add it to the seed - do not write it via `-learn`.
- **Tech lesson** > the ONLY kind `-learn` records: the right
  `resources/{languages|libraries|frameworks|engines|tools|runtimes|design|database|os}/<topic>.md` (create the
  folder/file if missing). THEN classify it as a Rule, a Gotcha or an Issue & Solution -
  see `### Entry format` below.
- **Design / planning deliberation** > NOT a codex entry. Architectural tradeoffs, "X vs Y"
  decisions, feature specs and discussion conclusions are project/task-specific and
  ephemeral - they belong in the project's plan/spec doc or the relevant module readme,
  not the general codex. (This is about PLANNING deliberation, not visual design: reusable
  visual/UX lessons ARE recorded - in `resources/design/<domain>.md`.)

### Entry format (three KINDS: Rules, Gotchyas, Issues & Solutions)

Every resource file is divided into THREE sections with these EXACT headings, in this
order. All three headings are ALWAYS present, even when empty - never delete one:

```
# <Topic>

## Rules

## Gotchyas

## Issues & Solutions
```

Write your entry at the END of the matching section (just before the next `## ` heading,
or at the end of the file for the last section). Each kind has its OWN format - never
mix formats across kinds:

**1. RULE - one single line, a directive.** A convention WE choose to enforce (style,
naming, safety, best practice). No Cause:/Fix: lines, no date:

```
- [ID] Never/Always <do or don't do X> - <one short reason or clarification>.
```

Example: `- [kR9mQ2] Never base64-embed an SVG - inline the SVG in the HTML or use a real .svg file.`

**2. GOTCHA - one single line with TWO required parts: the trap AND the countermeasure.**
A trap built INTO the technology (a silent default, surprising behaviour) - you cannot
change it, only know it and avoid it. One physical line, no Cause:/Fix: lines, no date.
A gotcha WITHOUT the countermeasure is trivia - never write one:

```
- [ID] LEAD - <the trap: what the technology does that bites you>; <what to do / watch for>.
```

Example: `- [01k8yP] Google Fonts & - a bare & silently drops the 2nd+ family; give each family its own &family=.`

**3. ISSUE & SOLUTION - three parts across lines, dated.** A concrete failure that was
OBSERVED (an error message, broken output, wrong behaviour) with a diagnosis. This is
the ONLY kind with Cause:/Fix: lines and a date:

```
- [ID] LEAD_TOKEN - one-line symptom (what you see / the situation)
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

> **EXCEPTION - `thought-and-action-guidance.md` uses NO `[ID]`s.** The `[ID]` format here
> is for files under `resources/` ONLY (`languages|libraries|frameworks|engines|tools|runtimes|design|database|os/<topic>.md`).
> Entries in `thought-and-action-guidance.md` are PLAIN PROSE LEADS - `- one-line symptom`
> then `  Cause:` / `  Fix:` - with **no `[ID]` and no brackets**. For that file: write the
> prose lead, check it is not a duplicate of an existing lead, stop. Never add an `[ID]`
> to `thought-and-action-guidance.md`.

- **Short, but never lossy (write for a weak reader).** Use the fewest plain words that still
  carry the FULL lesson - symptom, cause, fix, direction. A weak AI or a junior developer must
  be able to apply the entry without guessing. Cut filler words, never cut meaning or steps.
- **`[ID]` (required on ALL new entries in `resources/**/*.md`, every kind).** A short
  (~6-char) alphanumeric token in square brackets, unique within the file (eg `[aB3xY9]`).
  It lets the uniqueness check and any cross-reference target one specific entry. The
  entry tools generate it (never invent one yourself); it stays stable across edits. **NOT used in
  `thought-and-action-guidance.md`** (see the EXCEPTION above).
- **Lead token first (every kind).** Right after the `[ID]`, put the most greppable thing:
  the literal unique part of an error message (`TS7016`, `ERR_MODULE_NOT_FOUND`) for an
  Issue; the feature / class / function name for a Rule or Gotcha. Grep must find the entry.
- **`Cause:` / `Fix:` lines (Issues only, both required).** Why it happens, then what to
  do, ending the Fix with the date `(YYYY-MM)`. A fresh session must be able to apply the
  fix without guessing - never sacrifice meaning for brevity.
- **Not only errors.** Anything that took more than 2–3 attempts to work out, framework
  behaviour, and non-obvious methods that save future thought-loops all belong here
  (classified by the three questions above).
- **No project names** - only the date.
- **No project-specific content.** Entries must be GENERAL and reusable across any project.
  Never include: project/page/file names, specific URLs, design names, client names, or
  context that only makes sense in one codebase. Write the symptom/cause/fix so a developer
  on a completely different project can understand and apply it. Bad: "Gallery page crashes".
  Good: "Web page with many iframes crashes the browser tab."
- **Legacy entries** predating this layout (single-line `A - cause - fix` form, no `[ID]`,
  or sitting outside the three sections) are still valid and grep-able; write NEW entries
  under the sections in the formats above, and when you next TOUCH a legacy entry, give it
  an `[ID]`, classify its kind, and move it under the right section. Do NOT mass-reformat
  files just to relocate entries. **`thought-and-action-guidance.md` is prose-only by
  design - never add an `[ID]` there** (not even to its "legacy" entries).

### MANDATORY: contributing back (never wait to be asked)

Contributing to the codex resources is part of completing any work, like updating project
docs. Two triggers:

1. IMMEDIATELY when a qualifying solution is found (took more than 2 or 3 attempts, or a
   future session could realistically hit the same wall: framework behaviour, tooling
   quirks, non-obvious methods) - record it right away while the cause and fix are fresh,
   then continue the task.
2. BEFORE reporting any work as done: do a final sweep of the session - did anything take
   real effort to work out? If yes and it is not yet recorded, record it then. This
   applies to MORE than errors: solutions, gotchas and methods all qualify.

### `/aftc-codex-learn` (self-education)

`/aftc-codex-learn` injects instructions for you to persist durable, GENERAL lessons (not
project-specific) into the codex resources, using the codex entry tools
(`codex_add_entry` / `codex_edit_entry` / `codex_remove_entry`). It: checks the resource
list to avoid duplicates; codex_loads each target topic (the write tools refuse a topic
not loaded this session); classifies each lesson (Rule / Gotcha / Issue & Solution) and
writes it under the matching section of the right
`languages|libraries|frameworks|engines|tools|runtimes|design|database|os/<topic>.md` ONLY (the tools
create the file with the three-section skeleton in the correct category folder if missing
and regenerate the resource list for new topics); proposes entries
and writes only after user
confirmation. `codex-rules.md`, `markdown-guidance.md`, and
`thought-and-action-guidance.md` are FIXED maintainer docs - `-learn` does NOT modify them.
