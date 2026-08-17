# Codex Rules

> Unified always-on rules for the aftc-codex knowledge base: the critical
> global rules plus the self-learning / usage process in one file. The
> resource index lives in the auto-generated `codex-resource-list.md`
> (`codex_load('list')`), not here.
>
> IMPORTANT: codex resource WRITES go through the codex entry tools
> (codex_add_entry / codex_edit_entry / codex_remove_entry) - never hand-edit
> resource files and never run a sync script yourself. The tools generate the
> entry [ID]s, validate the per-kind format, place entries under the correct
> section, create missing topic files and category folders, and regenerate
> the resource list internally.
>
> IMPORTANT: rules marked (*D) never apply to visual / creative / design
> tasks (image creation, web design, application design - non-programming
> tasks).

## Critical Global Rules

- Never use em dashes (the long — character); always use a plain dash (-) instead. The em dash appears in this line only so the rule can name it.
- AFTER READING THIS FILE you MUST also read and understand the `## Self-Learning & Usage Guidelines` section below. Do NOT start any project work - no thinking, no file changes, nothing - until you have read these rules AND loaded the relevant codex resources for the project you are about to work on. Skipping that is a hard fail.
- IMPORTANT: Never use the character '§' in any code comment, file or documentation (excluding in this line, do not remove the character '§' from this line).
- Never create NUL files.
- Any script or command you run must be self-terminating: add exit/escape timers (or timeouts) to tests, servers, watchers and one-off scripts so they can never hold the session in an infinite wait. Never run anything that blocks on stdin or runs indefinitely without a guaranteed exit path.
- Got a problem or question ask immediately.
- Never read or use any files in the folders ".bak", ".old", ".git", ".dev" unless specifically asked to or instructed to in another rule or documentation after this.
- Keep answers short and to the point; detail only when asked or when planning. It is fine to just say ok / done / ready - but never leave the user wondering whether you are finished, and never be vague about which feature you mean. If you need to ask a question, ask; don't assume.
- KISS: the simplest solution wins; do not over-engineer; before any edit consider clarity, consistency and maintainability (*D).
- Ensure variables, functions and methods are named exactly what they are for.
- When fixing an issue, first evaluate whether gated logging (a per-file/class enabled flag) is feasible; add logs that read like a story of init, events and timer completions, READ them, fix, then disable or clean up the logging. A hard-won fix is a good codex entry candidate - record it.
- For frontend runtime issues (not rendering, event not firing, timer not running, state not updating): add console logging at every relevant point (function entry, event handler, timer tick, init) and read the console to observe real runtime values BEFORE deep code analysis. Observe first, reason second; gate or remove the logs after the fix.
- Shell discipline (CRITICAL - never get stuck):
  - Pass a timeout to EVERY shell command (powershell, bash, run_script). Default 120s; long builds/docker up to 300. Never run a command without one.
  - NEVER run a non-terminating command in the foreground (dev servers, watchers, `docker compose logs -f`): use the background process tool (win_start_process + win_read_output) or the detached form (`docker compose up -d`).
  - Every script/test you write must self-terminate; nothing may block on stdin or run forever.
  - If a command times out or a port is stuck, kill it (win_stop_process / win_kill_port) and continue - never sit waiting.

## Self-Learning & Usage Guidelines

The codex is a shared knowledge base of hard-won fixes, gotchas and rules:
one markdown file per topic under `resources/`, organised into `languages/`,
`libraries/`, `frameworks/`, `engines/`, `tools/`, `runtimes/`,
`servers-and-containers/`, `file-formats/` (binary formats;
`file-formats/audio/` for preset formats + `file-formats-common.md` for any
binary format work), `ui-ux/` (visual/UX design, nested by platform: web/,
desktop/, mobile/, plugin/ + `ui-ux-common.md`), `database/`, `os/`, plus the
root-level `documentation-and-planning.md` (work methodology). The file name
is the topic. Read the relevant resource when you hit a problem; add an
entry when you solve a non-obvious one.

### The codex resources (how to read them)

- Available resources are listed in `codex-resource-list.md` (`codex_load('list')`). Trust the list; no folder scan needed.
- Load on demand: `codex_load('typescript')`, `codex_load('docker')` ... Fuzzy aliases work (`ts`, `py`, `js`). Special topics: `codex_load('rules')` (this file), `codex_load('guidance')`, `codex_load('list')`.
- `codex_load` searches ALL category folders, so a file's folder does not matter for retrieval.

### Where you WRITE (the live copy, not the package seed)

The package's `extensions/aftc-toolset/data/aftc-codex/` is a READ-ONLY
ship-time seed - never write there. Your writable base is the LIVE per-user
copy in the OS data dir; `codex_load` and the entry tools operate on it. The
seed is also the pristine restore baseline, so writing to it would pollute
what a restore relies on.

### MANDATORY first step before ANY project work

Identify the project's technologies/tools/design requirements, then
`codex_load` the relevant resources (plus `codex_load('guidance')` always)
BEFORE exploring files, planning or implementing. No exceptions. For
planning or documentation work, your FIRST call is
`codex_load('documentation-and-planning')`.

### Project tech-stack block (AFTC-CODEX-STACK)

Every project should declare its stack in the coding agent's auto-inject
file so detection can pin the right resources (this block is the ONLY way
ui-ux domains and target OS are detected):

```
<!-- AFTC-CODEX-STACK
topics: typescript, scss, vite, web-app, windows
-->
```

- Look for the block in the recognised auto-inject files (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, GEMINI.md, .cursorrules, .windsurfrules); create it when missing (prefer AGENTS.md), update it when the stack changes, keep it identical across every file the project has.
- `topics:` is a flat comma list of topic names (resource basenames). Include languages, frameworks, libraries, tools, runtimes, the UI-UX domain and the target OS when specifically targeted.
- Names with no live resource are not errors - detection reports them as "no resource yet". Never invent topics to pad the line.

### Before you edit or create a resource (check stale first)

Consult `codex_load('list')` first: update the RIGHT existing doc; never
duplicate an entry; create a new file only when the topic genuinely does not
exist yet.

### The resource list (auto-generated, never hand-maintained)

`codex-resource-list.md` is machine-generated. Never edit it by hand and
never run a sync script yourself: the entry tools regenerate it when they
create a topic file. Entry CONTENT changes need no list update.

### Look up an issue (max 3 steps)

1. Have an error/message? String-search the obvious resource for the unique part of the message; read the match.
2. No match? Open the ONE obvious resource - a tool file wins (`vite`, `pi-extension`, `ffmpeg`); else a framework file; else the language file.
3. Judge resource names before loading - context is precious; never load a whole folder. If a documented fix fails, solve the issue, then correct or replace that entry.

### Correcting a wrong or outdated entry (immediate)

When told an entry is wrong or outdated: update it IMMEDIATELY with
`codex_edit_entry` (or delete with `codex_remove_entry`) - do not wait for
`/aftc-codex-learn`. The tools keep the `[ID]`, re-validate the format and
refresh an Issue's Fix date. Pass a different `kind` to reclassify.

### Record a new entry (max 3 steps)

1. Pick the obvious resource (tool > framework > language; file by the cause when known). Missing? Check the list first - a parallel session may have created it. Entries lead with the grep hook, so search finds them even in a slightly-wrong file.
2. `codex_load` the target and check the lesson is not already there (the write tools refuse an unloaded topic and exact duplicates). Classify the KIND (three questions IN ORDER below), then `codex_add_entry` - it generates the `[ID]`, writes at the end of the matching section and creates the file/folder when missing. Batch same-topic entries into ONE call; merge duplicates you spot; never run dedupe sweeps; prune only when you notice staleness.
3. If you expect a lesson in some bucket but honest analysis finds none, record NOTHING and say so - never fabricate or pad.

### Which resource? (tool vs framework vs language vs ui-ux)

Ask: **"would this issue exist without the tool / framework?"**

- **Tool / extension** (bundler, server, runtime, CLI) → its own tool file. (The TypeScript compiler and direct plugins like ts-loader stay in `typescript.md`.)
- **Framework** (own behaviour/conventions, eg the AFTC PHP MVC framework) → a file named after the framework; its quirk beats the language file.
- **Language** → the language file (`typescript.md` = types/compile; `javascript.md` = runtime/syntax/modules).
- **UI-UX** - the lesson is how a UI LOOKS or is USED, independent of the tech stack → `ui-ux/<platform>/<domain>.md`: web/web-app (browser apps), web/web-page (content pages), web/web-backend (admin UIs - visual only, never API), desktop/desktop-web-app (web tech in a desktop shell), desktop/desktop-app (native), mobile/mobile-app (touch-first), plugin/vst-plugin (the VISUAL side; preset binaries live in file-formats/audio/). Pick by DOMAIN, never by tech; never mix web and desktop conventions; a lesson holding on EVERY platform goes to `ui-ux/ui-ux-common.md` (never duplicated in both). A lesson that is BOTH design and a technology quirk goes to the technology file, and to the design file only if a design searcher would look there.
- **How we work** (planning / documentation methodology, holds for any project) → root-level `documentation-and-planning.md`.
- **File format / binary data** (parsing, decoding, rewriting: magic bytes, chunks, endianness, NUL-padded records, decompression) → `file-formats/<family>/<format>.md`; a lesson holding for ANY binary format → `file-formats/file-formats-common.md`. Never under `ui-ux/` just because the product is UI-adjacent.
- **Database** - engine-specific → the engine file (`database/mysql.md`); holds for ANY database → `database/database-common.md`.
- **OS** - OS-level behaviour (shells, paths, permissions, services) → `os/<platform>.md`. Every os/ lead MUST name its scope (distro family, mac architecture, Windows version).
- **css/scss vs design (mechanism vs choice):** the TECHNOLOGY bit you (property behaviour, cascade trap, browser quirk) → `css.md`/`scss.md` even when the symptom is visual; a CHOICE true in any technology (contrast, spacing, touch targets) → `ui-ux/<platform>/<domain>.md`.

Pick the best fit in ONE pass and move on - good-enough routing is correct
(the grep hook finds an entry even in a slightly-wrong file). If a lesson
spans two scopes, file it where a searcher greps first and cross-reference
the other file in the Fix line; never duplicate the full entry.

### Which KIND of lesson? (recorded vs not recorded)

`/aftc-codex-learn` records technology lessons into `resources/` ONLY -
never into the fixed top-level docs.

- **Thought / process guidance** - NOT recorded by `-learn`: `thought-and-action-guidance.md` is a FIXED maintainer doc. If a process rule belongs in the codex, tell the user to add it to the seed.
- **Tech lesson** - the ONLY kind `-learn` records, in the right `resources/.../<topic>.md`, classified below.
- **Design / planning deliberation** - NOT a codex entry: architectural tradeoffs, "X vs Y" decisions and feature specs are project-specific; they belong in the project's plan/spec doc or module readme. (Reusable VISUAL/UX lessons ARE recorded - in `ui-ux/`.)

### Entry format (three KINDS: Rules, Gotchyas, Issues & Solutions)

Every resource file has THREE sections with these EXACT headings, in this
order, always present even when empty:

```
# <Topic>

## Rules

## Gotchyas

## Issues & Solutions
```

Write at the END of the matching section. Each kind has its OWN format:

**1. RULE - one line, a directive** (a convention WE choose; someone could
choose to violate it):

```
- [ID] Never/Always <do or don't do X> - <one short reason>.
```

**2. GOTCHA - one line, TWO parts: the trap AND the countermeasure**
(behaviour the technology forces on you; a gotcha without the
countermeasure is trivia - never write one):

```
- [ID] LEAD - <the trap>; <what to do / watch for>.
```

**3. ISSUE & SOLUTION - three parts, dated** (a concrete OBSERVED failure
with a diagnosis; the ONLY kind with Cause:/Fix: lines and a date):

```
- [ID] LEAD_TOKEN - one-line symptom
  Cause: why it happens.
  Fix: what to do. (YYYY-MM)
```

**WHICH KIND? Answer IN ORDER, first match wins:**

1. Observed concrete failure + diagnosis (a greppable symptom)? > Issue.
2. A convention we choose ("always/never", naming, style)? > Rule.
3. Behaviour the technology forces (a trap you can only avoid)? > Gotcha.

> **EXCEPTION - `thought-and-action-guidance.md` uses NO `[ID]s`:** plain
> prose leads with Cause:/Fix: lines. `[ID]s` are for `resources/` only.

- **Short, but never lossy (write for a weak reader):** the fewest plain words that carry the FULL lesson; a weak AI or a junior must apply it without guessing. Cut filler, never meaning.
- **Lead token first:** right after the `[ID]`, the most greppable thing (the unique part of an error message for an Issue; the feature/function name otherwise).
- **Not only errors:** anything that took >2-3 attempts, framework behaviour, non-obvious methods - classify by the three questions.
- **No project names or project-specific content** - only the date. Write so a developer on a different project can apply it.
- **Legacy entries** (single-line, no `[ID]`, outside the sections) stay valid; when you next TOUCH one, give it an `[ID]`, classify it and move it under the right section. Never mass-reformat. `thought-and-action-guidance.md` stays prose-only.

### MANDATORY: contributing back (never wait to be asked)

1. IMMEDIATELY when a qualifying solution is found (took >2-3 attempts, or a future session could hit the same wall) - record it while fresh, then continue.
2. BEFORE reporting work done: sweep the session - anything that took real effort and is not yet recorded, record it (solutions, gotchas and methods qualify, not only errors).

### `/aftc-codex-learn` (self-education)

`/aftc-codex-learn` injects instructions to persist durable, GENERAL lessons
into the resources via the entry tools: dedupe against the list,
`codex_load` each target topic (writes refuse unloaded topics), classify
(Rule / Gotcha / Issue) and write under the matching section of the right
`resources/<category>/<topic>.md` only (creating the file + skeleton when
missing), proposing entries and writing only after user confirmation.
`codex-rules.md`, `markdown-guidance.md` and
`thought-and-action-guidance.md` are FIXED maintainer docs - `-learn` never
modifies them.
