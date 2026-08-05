# Documentation Guide

Lossless-condensed specification for AI models: generate and maintain a
project's full documentation set. Adapted for the pi-aftc-toolset `/docx`
feature: output lives in `./docx/`, the backup is performed by tooling, and
`AGENTS.md` is edited in place via a managed block. The *AI Execution
Prompt* section is copy-paste executable.

**Audience: AI models only.** Every rule below is normative.

---

## 1. Architecture

One project = a root `README.md` + two files in `./docx/` + `AGENTS.md` at
the project root + `./docx/docs/`:

```
README.md                     Classic GitHub readme at the PROJECT ROOT -
                              generated LAST, entry point, links out
docx/
  project_documentation.md    Master - whole application, one section per map ID
  project_map.md              Structure map - the FULL project tree, every level
  docs/
    <id>_<module>_documentation.md   Deep doc for one map ID
    <id>_<module>_map.md             Sub-map for one ID (its branch of the tree)
    <id>_<artefact>.md               Leaf doc (one page / model / component)
    <id>_<artefact>_layout.md        Layout partner for a UI-heavy leaf doc
    <id>_<area>_sitemap.md           Sitemap partner for a UI branch
    <id>_<area>_design.md            Per-area design-rules partner
    <cross-cutting>.md               contributing, deployment, design, ... (no ID)
AGENTS.md                     Auto-loading context at the PROJECT ROOT - pointer
                              + critical rules; edited in place, never moved
```

- `project_map.md` is the single most important artefact: one file, one ID'd
  tree, every node at every level. It is the index, table of contents and
  cross-reference table. The master and README carry only the lite
  (branch-level) tree.
- **Generation scope (hard rule):** write ONLY inside `./docx/` and to the
  project-root `AGENTS.md` (and its identical copies at other AI tool
  locations). Every other folder - including sub-projects - is READ-ONLY:
  read freely, never create/edit/move/delete.
- **Context-loading discipline:** the master is loaded every session (via
  `AGENTS.md`); deep docs are not. Each per-ID master section ends with an
  explicit *Only read...* instruction naming that ID's deep docs. This is a
  context-budget rule, not just a link - honour it when using the docs too.

---

## 2. Structure Map Rules

- IDs: hierarchical dot-paths (`1`, `1.1`, `1.2.3`, `3.4.1.2`).
- Every node that warrants documentation gets an ID; nodes that do not are
  omitted.
- IDs are stable: renames and reordering never renumber; deleted IDs become
  `reserved` and are never reused; insertions take the next free sibling ID.
- Depth matches directory depth.
- Header required: `<!-- structure-map - last-verified: YYYY-MM-DD HH:MM - regenerate: <how> -->`.
  Regenerate from a script where practical; record the command.
- The root map carries the FULL tree. Sub-maps intentionally duplicate their
  branch: (a) drift check - if sub-map and root map disagree, re-verify that
  branch against source and fix both; (b) module-scoped context - a session
  loading one module's docs gets its whole map without the root map.
- Annotate each ID in exactly one place: the root map annotates branches and
  containers; leaf annotations live in the owning sub-map. Annotation links
  use the FULL FILE NAME as the link text
  (`[1.6.2_ssh_sessions_documentation.md](1.6.2_ssh_sessions_documentation.md)`,
  never `[doc](...)`) - the filename is the discovery mechanism, so it must
  be visible without following the link.
- Annotations link to ID-prefixed deep docs. Status legend mandatory
  (`done` / `placeholder` / `missing` / `reserved`).
- Map file layout (canonical, root map and sub-maps alike): H1 + one-line
  intro; the structure-map header comment; `## Full Tree` rendered as an
  indented ASCII tree (`|-`, `\-`), never a bullet list; `## Annotations`
  with ONE line per ID - name, optional tags, deep-doc link, sub-map link,
  status; status legend; node tags list. The root map adds `## Index By
  Kind` (modules / sub-projects / containers / dev-tools lists). Tree and
  annotations stay in lockstep - adding a node means adding it in both.
- Optional node tags: `framework`, `wrapper`, `shared`, `sub-project`,
  `container`, `dev-tool`.

---

## 3. File Naming & Titles

- Every `docx/docs/` file documenting a map node: `<id>_<snake_case_area>_documentation.md`;
  sub-map: `<id>_<area>_map.md`; leaf: `<id>_<artefact>.md` (drops
  `_documentation`); layout partner: `<id>_<artefact>_layout.md`; sitemap
  partner: `<id>_<area>_sitemap.md`; per-area design partner:
  `<id>_<area>_design.md` (global design rules are a cross-cutting
  `design.md`, no ID).
  `_documentation` is the default for every map ID; the leaf form is reserved
  for single-artefact drill-down nodes (one editor, one carousel - typically
  grandchild IDs like `3.3.1`). Partner docs (`_layout`/`_sitemap`/`_design`)
  carry the OWNING node's ID in name and H1 and never get an ID of their
  own. State the chosen convention in the root map
  header and apply it uniformly.
- **The H1 title of every ID-prefixed document starts with the same ID:**
  `# 1.2.1 - MySQL (mysql-aftt)`. File name and title carry the ID at every
  level, no matter how deep.
- Exempt from ID in name and title: the root `README.md`, the docx master
  and map, `AGENTS.md`, and cross-cutting docs (no map ID by definition).
- Cross-cutting names: lowercase kebab-case, singular nouns, no numeric
  prefixes, stable (renames break links).
- Every generated document carries `<!-- last-reviewed: YYYY-MM-DD HH:MM -->`
  (maps: `last-verified` in the structure-map header, same format) -
  INCLUDING the root `README.md`, the master and `AGENTS.md`
  (`project_map.md` carries `last-verified` instead). The root map file
  may be named anything
  matching `*_map.md`; `project_map.md` is the default. Read the
  current date/time from the environment (`date`) - never invent a
  timestamp. A stamp records WHEN the content was last verified against
  source; it is NOT a freshness deadline - a doc stamped 10 minutes ago can
  be stale (code changed since) and one stamped months ago can be current
  (nothing it describes changed). Re-validation is driven by code changes
  and the audit triggers (section 17), never by elapsed time alone.
- Every cross-reference uses the ID, not a path ("see 1.1.2", not "see
  src/billing").

### References Block (mechanical, in every generated doc under docx/docs/)

Immediately after the title, one-line description and last-reviewed header:

```markdown
## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [<id>_<area>_map.md](./<id>_<area>_map.md)
```

- Master + Full project map lines always present, in this order.
- The Map line points at the sub-map the doc belongs to (its parent's map, or
  its own when it owns the map). Docs with no sub-map - including all
  cross-cutting docs - point back to `project_map.md` here.
- A per-document `## Related` section at the bottom still exists for
  peer/sibling/cross-cutting links.

(Exempt: the root `README.md`, the master, the map and `AGENTS.md` - they
are the destinations, not the deep docs.)

---

## 4. README.md (project root — GENERATED LAST)

The root README is the project's public face. It is generated LAST (step 10),
when the project is fully understood, and its content must be rooted in the
facts learned during the run — never guesswork.

### 4.1 The previous README is the structural guide

FIRST read the previous README (`docx/old_docs/README.md` when one exists)
and classify it:

- **Extensive** (many feature sections, tables, images, badges): FOLLOW its
  structure closely. It becomes the skeleton of the new README: same section
  flow, same ordering, same tables — every entry re-verified against source
  and refreshed with what the run learned. Keep its images: every referenced
  image file must be confirmed to exist on disk (drop the reference only when
  the file is gone). Discard only what is provably stale or wrong. Never
  shrink an extensive README to a summary — that is a failure of the run.
- **Thin or absent**: build from the archetype layout below that matches the
  project type.
- Either way: mine, verify, refresh — never copy verbatim without
  re-verification, and never invent content the recon did not establish.

### 4.2 Project-type archetypes

Detect the project type from step-1 recon (manifests, entry points, compose
files) and lay the README out for its AUDIENCE. Two archetypes are catered
for; anything else takes the closest fit and the developer refines from
there.

**A. Tool / extension / plugin / library packages** (pi extension, editor
plugin, npm/pip library, CLI tool). The reader is a USER of the tool: they
need to know what it contains, what each part does, and how to use
everything. Layout: title + badges + one-paragraph description; what's-new
(highlights of the current release); install (shortest path, INCLUDING
installing/enabling requirements and post-install steps); quick-links list
to the feature sections; ONE SECTION PER MAJOR FEATURE with its usage
(commands, options, screenshots where the old README had them); command and
shortcut tables; configuration/defaults; data locations; license. A
tech-stack table is NOT required for this archetype (implementation detail
the user does not need).

**B. Runtime applications / multi-service projects** (docker compose stacks,
web apps, php/apache/mysql, services with scripts). The reader RUNS the
project. Layout: title + one-paragraph description; project requirements;
tech stack with EXACT versions; install (clone -> running); what every
script is for and how to use it (`.bat`, `.sh`, `.ps1` — each one named
with its purpose and example invocation); container/service overview (what
each service is, ports, how to reach it); configuration/env vars; quick
project overview.

### 4.3 Universal rules

- Include the lite (branch-level) project map near the end, matching the top
  level of `project_map.md`.
- End with the link line: *For more details please see
  `docx/project_documentation.md` and `docx/project_map.md`*.
- No per-ID sections, no rules — that is the master's job.
- Badges only when they resolve (keep the old README's badge set when it
  does).
- The README carries the `last-reviewed` header like every generated doc.

## 5. project_documentation.md (Master)

Must work as a complete overview even if nothing else exists. In order:

1. Title + `last-reviewed` header.
2. Description: what it is, who it serves, what problem it solves, what it
   explicitly does NOT do.
3. Tech stack with versions.
4. Lite project map (branch level) + pointer to `project_map.md`. Never
   duplicate the full tree.
5. `## Project Guidance & Rules`: `### Rules` list, then guidance blocks.
   One block is mandatory:
   `### Maintaining This Documentation`:
   - Docs update in the SAME change as the code - never deferred; a stale
     doc is a bug.
   - A wrong doc is corrected immediately + every doc referencing the
     corrected subject is checked and fixed in the same change.
   - Refresh `last-reviewed` / `last-verified` headers of every doc touched.
   - New modules update four things in one commit: map node, master per-ID
     section, Documentation Index entry, new ID-prefixed deep doc.
   - A change that adds a UI surface (page/screen/window/view) or a component
     with its own rules mints a leaf in the same commit: map node (next free
     sibling ID), leaf doc, Documentation Index entry, and the owning UI
     branch's sitemap entry.
6. **One section per ID in the root map - every node at every level.**
   Shape per section: `## <id> - <Name>`; one short paragraph (purpose, what
   it owns, what it does NOT own); ALL functionality mentioned at this
   level, no technical depth; cross-references by ID; ends with:

   > Only read the following files if you need to work on <area> features of
   > this project, or if requested by the user or aftc codex:
   > `./docx/docs/<id>_<area>_documentation.md` and `./docx/docs/<id>_<area>_map.md`.

  When the ID has no sub-map, name only the files that exist (the deep doc
  alone, or the leaf doc plus its layout partner) - never name a `_map.md`
  that does not exist.

   Sub-projects use the extended instruction (see Sub-Projects).
7. Documentation Index (Deep Documents / Sub-Maps / Cross-Cutting / Dev
   Tools, with links). Entries carry the ID:
   `- [docs/1.3.4_x_documentation.md](docs/1.3.4_x_documentation.md) - ID 1.3.4, \`dev-tool\``.
   The index opens with a one-line instruction: *"Discovery index - find the
   doc for the area you are about to work on and load ONLY that doc; do not
   follow these links for areas you are not working on."* Every file in
   `docx/docs/` MUST appear here (the link audit verifies completeness).
8. Final note: new sections may be added by the AI or user as the project
   evolves; the future shape cannot be known in advance.

## 6. Deep Documents

- **One deep doc per ID in every map** (root + sub-maps). No ID is
  documented only inside its parent's doc. A genuinely trivial node gets a
  short stub pointing at the parent - but the file exists, is ID-prefixed,
  and carries the References block. A stub = ID-prefixed file + References
  block + 1-3 sentences (what the node groups, which children carry the
  depth) + Related section. A branch node whose children each have deep
  docs (eg a Containers grouping node) is the canonical stub case.
- Content: public API/contracts, internal architecture and data flow,
  configuration/env/flags, setup and first-run, testing strategy, known
  limitations and operational quirks. Be exhaustive here; the master is
  brief by design. Canonical section order: Purpose (owns / does not own,
  what it depends on and what depends on it, by ID) -> Public API &
  contracts -> Internal architecture & data flow -> Configuration
  (env/flags with defaults) -> Setup, seeding & first run -> Testing ->
  Operational notes & known limitations -> Related. Drop a section only
  when it genuinely does not apply; never reorder the rest.
- **Drill-down: it is better to go too deep than not deep enough.** Triggers
  for leaf docs: a UI surface (page, screen, window, drawer, view, plugin
  editor, CLI/TUI screen) with its own rules or states; a functional region
  of a single screen with its own rules, states or contract; a
  model/controller/service/API group with its own contract; a component or
  animation with non-obvious behaviour; a setup path with ordering
  dependencies (document every step, script, env var). When unsure, create
  the doc. Leaf IDs hang off the parent and are listed in the parent's
  sub-map.
- **Single-surface breakdown:** when ONE screen/window carries several
  complex functional regions (eg a nav, a voice/AI panel and a terminal area
  in one desktop window), the screen node gets child IDs per region, each
  with its own leaf doc; the screen's deep doc keeps only screen-level
  concerns (window lifecycle, layout composition, cross-region state).
  Trigger: a region with its own rules, states or contract. Edge case: when
  the regions are too intertwined to describe independently (every region
  cross-references every other), keep ONE deep doc for the whole screen -
  forced separation produces worse docs, not better ones.
- UI-heavy leaf docs get a `<id>_<artefact>_layout.md` partner (regions,
  breakpoints, states, spacing, asset slots) when the layout itself is
  non-trivial.

## 7. Sub-Maps

- Generated for every ID with its own branch of detail: every sub-project
  and every major branch (containers, database, ...).
- A sub-map is a FILE inside `docx/docs/` named `<id>_<area>_map.md` -
  NEVER a folder. `docx/` contains exactly three entries when generation
  completes: `project_documentation.md`, `project_map.md`, `docs/`
  (plus the tooling-owned `old_docs.zip`). Never invent extra folders or
  files under `docx/`.
- Same shape as the root map: last-verified header, tree, annotations,
  status legend. Sub-IDs hang off the parent ID.
- Every ID in a sub-map gets its own ID-prefixed deep doc.

## 8. Dependency Map (mandatory cross-cutting doc)

`docx/docs/dependency_map.md` - the cross-ID view no deep doc owns.
Table-heavy, every entry keyed by map ID, no prose (deep docs own prose).
Five sections:

1. **Runtime graph** - container/service dependencies, startup order, health
   gates.
2. **Mount map** - host path -> container path -> ro/rw -> which IDs
   read/write it.
3. **Build-output contract** - builder -> output dir -> owns vs must
   preserve ("who may delete what").
4. **Feature trace matrix** - one row per user-facing feature: UI ID(s),
   API ID(s), schema ID(s), storage ID(s). Feeds the context-loading
   discipline.
5. **API consumer matrix** - which frontend area calls which route group.

Do NOT include package/library deps (link to the manifest instead). Carries
a `last-verified` header; updated in the same commit as any structural
change; disagreement with a deep doc means the dependency map is stale.

## 9. Cross-Cutting Docs

Material that cuts across all IDs: workflow, deployment, security, dev
environment, decisions. Lives in `docx/docs/` with no ID prefix. Never
documents a single map ID (that is a deep doc) and never appears in the
structure map. Reachable from the master's Documentation Index and from
Related sections.

Canonical list (pick what the project warrants, typically 4-7 +
dependency_map which is mandatory):

- `contributing.md` - workflow, branching, review, release, structure-map discipline
- `deployment.md` - environments, pipeline, rollback, secrets handling
- `operations.md` - monitoring, alerting, on-call, incident response
- `security.md` - threat model, secrets, vulnerability reporting
- `development.md` - dev environment; lists every dev tool (summary, host access, disable, link)
- `docker.md` - alternative to development.md when the env is entirely compose
- `decisions.md` (or `decisions/` one file per decision, append-only)
- `dependency_map.md` - MANDATORY (see section 8)
- `design.md` - global design rules when the project follows one style:
  palette, typography, spacing, component + interaction conventions
  (CLI/TUI: layout regions, colour/theme and key conventions); per-UI-area
  `<id>_<area>_design.md` partners extend/override it (see section 14)
- `glossary.md` - domain terms (when >10 specialised terms)
- `roadmap.md` - direction without dates
- `faq.md` - only when a question has been asked 3+ times
- `changelog.md` - user-visible changes per release
- `known-gaps.md` - unchecked pre-launch items + fix plan
- `license.md` - only for custom licenses

Skeleton per doc: `# Title`; one-sentence summary (what it answers, when to
load it); `last-reviewed` header; References block (Map line ->
`project_map.md`); `## Overview`; `## Prerequisites`; core sections fitting
the doc type; `## Examples` (copy-pasteable commands over prose);
`## Troubleshooting` (symptom - fix); `## Related` (peer docs + relevant
deep docs by ID).

Anti-patterns: prose-only docs that could be a section elsewhere; duplicates
of the master (link instead); screenshots of command output; pasted log
files; docs without a Related section; dev-tool docs without host-access and
disable instructions.

## 10. AGENTS.md (project root — EDITED IN PLACE, never regenerated from nothing)

Auto-loading context file at the project root (tool variants:
`.github/copilot-instructions.md`, `CLAUDE.md`, `GEMINI.md`,
`.cursor/rules/*.mdc`). A POINTER, not the master. Under 200 lines, no
secrets.

**docx rule:** the existing `AGENTS.md` is SACRED. Never move it, never
rewrite it wholesale. The generation run makes exactly two edits:

1. Insert or replace the managed docx block (the ONLY part docx owns):

```markdown
<!-- AFTC-DOCX
Documentation lives in ./docx/. Do NOT read documentation up front. When
you are about to work on an area, find its doc: read the Documentation
Index in ./docx/project_documentation.md or the annotations in
./docx/project_map.md, then load ONLY that doc from ./docx/docs/. Never
follow documentation links for areas you are not working on. When you
change documented code, update its doc in the same change and refresh its
last-reviewed stamp.
-->
```

2. Update any OTHER stale documentation references in the file to point at
   `./docx/` (eg an old `project_documentation.md` link at the root).

The block's discovery contract (binding): AGENTS.md points at the master
and the map as the ONLY two entry points; the model looks no further until
it is about to work on an area, and then loads only that area's doc. The
master and the map each carry a visible "do not follow these links until
the work touches that area" instruction so a model opening them for
discovery does not cascade-load the whole set.

Every other character of the existing file - critical rules, conventions,
do-not-touch lists - is preserved VERBATIM. If no `AGENTS.md` exists,
create a minimal one: the managed block plus a Start Here section
(README -> master -> map, context-loading discipline). Place an identical
copy at every AI tool location the team uses.

---

## 11. Sub-Projects

A sub-project is a full embedded application (own entry point, own build).
Decision rule: if you can imagine deleting it and shipping the rest
unchanged, it is a sub-project; if it is load-bearing for everything else,
it is a module.

- **Sub-project folders are read-only.** Nothing is ever created, edited or
  moved inside them - no generated README/AGENTS/docs. Pre-existing docs
  inside may be read for reconnaissance and referenced, never written.
  Their own documentation (a framework's docs folder, a sub-project's
  README) is NEVER moved or stripped - the backup tooling only touches the
  project root, `./docs/` and a previous `./docx/` output, so this rule is
  structural, not a judgement call.
- Consequence: the docx docs must be complete enough that the sub-project
  needs no docs of its own: the master per-ID section; the deep doc
  `docx/docs/<id>_<sub_project>_documentation.md`; the sub-map
  `docx/docs/<id>_<sub_project>_map.md`; and one ID-prefixed deep doc for
  every ID in that sub-map, drilling to page/model/component level.
- The master's per-ID section for a sub-project ends with the EXTENDED
  instruction:

  > Only read the following files if you need to work on <sub-project>
  > features of this project, or if requested by the user or aftc codex:
  > `./docx/docs/<id>_<sub_project>_documentation.md` and
  > `./docx/docs/<id>_<sub_project>_map.md`. The <sub-project> is a
  > sub-project: its folder is read-only for documentation - any readme or
  > docs inside it may be read for reference but are never created or
  > modified. When working on the <sub-project> you may need to read the
  > <siblings> documentation - evaluate and act, and read all related
  > documentation.

  The cross-reading clause matters: sub-projects share data, auth and APIs.

## 12. Containers

- Containers form a first-class branch of the map (top-level when they span
  applications; nested under an application when private to it). Match every
  compose service name to its ID.
- The docker setup as a whole gets one deep doc + one sub-map carrying the
  container branch.
- **Every container gets its own deep doc** - mandatory, not size-dependent.
  Nothing is folded into the docker deep doc.
- Container deep doc contents: purpose (owns / does not own, app by ID);
  the compose service name stated explicitly on its own line right after
  the References block (compose names and IDs stay in lockstep);
  build (Dockerfile, base image, args, multi-stage); configuration (EVERY
  env var with default+meaning, EVERY volume with purpose); dependencies (by
  ID, incl. health gates); startup (entrypoint, first boot); init & seeding
  (every script, run order, what it creates, how to re-run against an
  existing volume without wiping); web server specifics when relevant
  (vhosts, default-page handling, rewrites, proxy rules/upstreams, TLS,
  headers/hardening); database specifics when relevant (databases/users
  created, charset, backup/reset); operations (logs, healthcheck, restart
  policy, scaling); local development (minimal `docker build`/`docker run`
  for just this container); Related (app it wraps, peer containers).
- Seed/init containers get IDs even when one-shot (`restart: no`); document
  the ordering (db healthy -> migrations exit 0 -> seed exit 0 -> apps).
- Multiple sites per container: one ID for the container; the deep doc lists
  every vhost/route tree (purpose, docroot, module ID); each site keeps its
  own application deep doc; cross-reference by ID, never duplicate.
- Anti-patterns: container documented only inside its app's doc; folding a
  "small" container into the docker doc; omitting one-shot containers from
  the map; mixing app concerns into container docs or runtime concerns into
  app docs; compose names drifting from IDs.

## 13. Dev Tooling

Dev-only containers (phpMyAdmin, MailHog, MinIO, ...) are documented to the
SAME standard as shipping containers:

- Map ID in the Containers branch, tagged `dev-tool`.
- Own ID-prefixed deep doc (container template) PLUS: how to reach it from
  the host (URL/port/credentials location) and how to disable it for
  production-like runs (the single change that drops the service).
- Per-ID master section like every other ID.
- One-line entry in `docx/docs/development.md` (summary, host access,
  disable, link).
- Promotion to production-required: drop the tag, remove the development.md
  entry, expand operations (backups, access control, monitoring).

## 14. ID Assignment & Framework Dependencies

Rules: every directory with docs-worthy code gets an ID (see Exclusions for
what never gets one); siblings are consecutive (never 1.1.1, 1.1.5, 1.1.9);
depth matches directory depth; reorder/rename keep IDs; deletion reserves;
insertion takes the next sibling; file names derive from IDs.

**UI surface mapping (all platforms):** for anything with a user-facing
interface - SPAs, server-rendered sites, mobile apps, desktop apps (incl.
Electron, .NET, Java), VST/plugin editors, CLI/TUI applications - map the
USER-FACING surface tree: every page, screen, window, drawer, view, manager
and editor a user can reach, as the node's children, even when they are
served by a single flat controllers/ or views/ directory. "Depth matches
directory depth" applies to source-layout branches (build, components,
services); the UI branch mirrors the surfaces a user can reach, because
that is what a session needs IDs for. A UI branch mapped only at
controller-group level is under-mapped.

**Sitemap (mandatory per UI branch):** every UI branch (a website's public
frontend, its admin frontend, an app's window set, a CLI's screen set) gets
a `<id>_<area>_sitemap.md` partner doc next to its deep doc:

- HIGH LEVEL: the full surface tree with IDs (the classic sitemap).
- LOW LEVEL: one entry per surface - purpose, route/window/screen, what is
  on it (sections, components), states, key interactions, data/API sources
  by ID. Detailed enough that the surface can be BUILT correctly from the
  entry alone.

Simple surfaces live entirely in their sitemap entry; surfaces with their
own rules/states/complex layouts get a leaf doc and the sitemap entry
becomes a summary plus pointer. Every reachable surface appears in the
sitemap - no exceptions.

**Design rules:** one global `design.md` cross-cutting doc when the project
follows one style (palette, typography, spacing, component and interaction
conventions; CLI/TUI: layout regions, colour/theme and key conventions).
When UI areas follow DIFFERENT design rules (a public website vs its
admin/CMS, an app vs its installer), each area gets a `<id>_<area>_design.md`
partner doc hanging off its UI branch that extends/overrides the global
rules. `_layout.md` leaf partners defer to these docs instead of
duplicating rules.

**Framework dependency** (the runtime foundation everything sits on): gets
the FIRST sibling ID in its branch by default (per branch when there are
several), tagged `framework`. The ID is reserved even when the code lives in
a vendor dir - the project's RELATIONSHIP with the framework is what gets
documented. Its deep doc covers: purpose/conventions imposed, version and
source + upgrade path, configuration and project overrides, request flow,
conventions every module must follow, extension points, testing, operational
notes. Every dependent module's deep doc must link the framework by ID,
state which conventions it follows/deviates from (deviations need a reason),
and list overridden framework config. A **wrapper** (project's thin layer
over a framework) gets a separate later sibling ID, tagged `wrapper`, and
documents only what the wrapper adds.

## 15. Exclusions

Never traverse, never ID, never read for container detection:

`node_modules/`, `vendor/`, `bower_components/`, `dist/`, `build/`, `out/`,
`target/`, `.next/`, `.nuxt/`, `.svelte-kit/`, `.turbo/`, `.parcel-cache/`,
`.gradle/`, `__pycache__/`, `.pytest_cache/`, `.venv/`, `venv/`, `env/`,
`Pods/`, `DerivedData/`, `.idea/`, `.vscode/`, `.git/`, `.hg/`, `.svn/`,
`coverage/`, `.cache/`, `.tmp/`, `tmp/`, `docx/old_docs/`.

A `.md` inside an excluded directory is never project documentation. When in
doubt, skip. `docx/old_docs.zip` is the zipped previous documentation -
NEVER read it for recon (superseded content is a spoiler, not a source).

**Folders to never touch** (never read, edit or create unless the user or
project docs explicitly lift the rule per-file per-request; if ambiguous,
stop and ask): `.git/` `.hg/` `.svn/`, `.bak/` `*.bak` `*.backup`, `.old/`
`*.old` `old_<name>/` `<name>.old/`, `archive/` `archived/` `deprecated/`,
`_archive/` `_deprecated/` `_legacy/`. Note: `./docx/old_docs/` is NOT covered by
this rule during a generation run - it is the in-flight backup staging
folder and is valid recon input until the final zip step removes it.

## 16. Cross-Reference Rules

- The master's Documentation Index links every deep doc and every
  cross-cutting doc.
- Every generated doc carries the References block and a Related section
  (sibling IDs).
- Cross-references use IDs, not paths.
- File names derive from IDs; an ID change renames the file and fixes all
  links in the same commit.
- Renaming/moving a doc fixes all links in the same commit.
- Adding a module updates map + master section + Documentation Index in one
  commit.

## 17. Maintenance, Regeneration, Backup

Triggers for a doc pass: module added/renamed/moved/deleted; UI surface
(page/screen/window/view) added, removed or redesigned; major
dependency upgrade; new AI tool adopted; contributor correction; a quarter
since last audit; onboarding slowdown.

Drift prevention: `last-reviewed` on every doc; `last-verified` + regenerate
command on maps; link-rot check in CI or pre-commit; code and doc updates in
the same commit.

**Backup (tooling-owned, not the model's job):** when `/docx` runs, the
extension moves every pre-existing documentation file (root-level project
`.md` files, known AI-tool context files, everything under `./docs/`, and
any previous `./docx/` output incl. a previous `old_docs.zip`) into
`./docx/old_docs/`, preserving each file's relative path from the project root.
Partner docs (a `.md` sharing its basename with a non-`.md` sibling) are
left in place. Excluded and never-touch folders are never walked. The move
count is verified against the collected count before generation starts.

The old docs stay readable at `./docx/old_docs/` for the WHOLE generation run
(recon input). As the FINAL step the model runs the shipped zip script,
which packs `./docx/old_docs/` into `./docx/old_docs.zip` and deletes the
folder - future sessions never read superseded docs. To restore old
documentation: unzip `old_docs.zip` and copy files back to their paths.

`./docx/old_docs/` and `./docx/old_docs.zip` are added to `.gitignore` by the
backup tooling.

---

## 18. AI Execution Prompt

Copy verbatim; replace `[PROJECT_PATH]` and `[GUIDE_PATH]`.

```text
You are documenting an existing software project at [PROJECT_PATH]. Generate
the complete documentation set following the Documentation Guide at
[GUIDE_PATH]: a GitHub README.md at the project root (generated LAST),
[PROJECT_PATH]/docx/project_documentation.md +
[PROJECT_PATH]/docx/project_map.md, and a [PROJECT_PATH]/docx/docs/
tree of ID-prefixed deep docs, sub-maps and leaf docs - one deep doc for
every ID in every map, a sub-map for every sub-project and major branch, a
References block and last-reviewed header in every generated document,
ID-prefixed H1 titles, and full per-container docs when Docker is in use.
AGENTS.md at the project root is EDITED IN PLACE per section 10 - insert or
replace the managed AFTC-DOCX block and update stale doc references only;
every other character is preserved verbatim.

GENERATION SCOPE (hard rule): write ONLY inside [PROJECT_PATH]/docx/ and
to the project-root README.md + AGENTS.md (and its identical copies at
other AI tool locations). Inside docx/ create EXACTLY:
project_documentation.md, project_map.md and docs/ (all deep docs,
sub-maps, leaf docs and cross-cutting docs live in docs/ as FILES -
no subfolders, no extra directories). The only other files ever allowed
in docx/ are the transient generation-plan.md (deleted at step 12) and
the tooling-owned old_docs/ + old_docs.zip. Every other folder -
including sub-projects (frontends, backends, frameworks) - is READ-ONLY:
read freely for reconnaissance, never create, edit, move, or delete
anything inside them.

STEP 0 - BACKUP: ALREADY DONE by the /docx tooling. Pre-existing
documentation was moved to [PROJECT_PATH]/docx/old_docs/ (rel-from-root paths
preserved). Do NOT move, delete or zip anything yourself. The old docs under
docx/old_docs/ are your recon input - read them freely. NEVER read
docx/old_docs.zip (a previous run's zipped backup).

STEP 1 - RECONNAISSANCE
- Run the shipped scan script FIRST and work from its output instead of
  walking the tree yourself:
  node "[MAP_SCAN_PATH]" "[PROJECT_PATH]"
- Honour the Folders-To-Never-Touch rule for every operation.
- For each sub-directory with a dependency manifest, record: path, manifest,
  entry points, deployable sub-project or internal module. Record the EXACT
  versions of the framework and key libraries from the manifest/lockfile -
  the tech-stack tables must quote real versions, never "latest" or
  "project-local" when a manifest states one.
- Record every test surface per sub-project. A tests/ folder is never
  assumed to be fixtures-only; look inside it.
- UI surfaces: inventory EVERY reachable page/screen/window/view per UI area
  (route tables, window/screen constructors, menu/nav definitions, CLI/TUI
  screen registries). The UI branch of the map and each area's sitemap are
  built from this list - a missed surface is undocumented UI.
- Containers: record every service name and build context from the scan;
  read the compose/Dockerfiles for env vars, volumes, health gates.
- Read the old documentation under docx/old_docs/ (read-only) - recon input,
  never a write target. Treat existing docs as a hint, never as truth:
  verify routes against the route table, schema against init/migration
  scripts, commands against manifests and compose files, env vars against
  .env and config code. Comments and config are not evidence of a feature:
  when a compose file, config or comment names a file, endpoint or mount,
  confirm the referenced thing actually EXISTS in source before documenting
  it as live behaviour. When docs and code disagree, code wins - note the
  drift in the step 12 report. The previous README (docx/old_docs/README.md)
  is evaluated for the new root README.md at step 11 (section 4).

STEP 2 - SUBDIVISION DECISION
- Per sub-directory: INTERNAL MODULE (deep doc only), SUB-PROJECT (documented
  entirely from docx docs; folder read-only), or FRAMEWORK DEPENDENCY (first
  sibling ID in its branch; wrapper gets the next).
- Rule: deletable-and-ship-the-rest = sub-project; load-bearing = module.
- Output the planned structure (full ID tree + complete file list) BEFORE
  writing anything, so scope can be trimmed up front. Non-interactive:
  proceed. Also WRITE the plan to [PROJECT_PATH]/docx/generation-plan.md so
  the run survives context compaction; delete this file at step 12.

STEP 3 - STRUCTURE MAP FILE
- Generate [PROJECT_PATH]/docx/project_map.md per section 2: full tree every
  level, annotations, status legend, tags, last-verified header. Compose
  service names match IDs. Dev tools are in the map.

STEP 4 - MASTER DOCUMENT
- Generate [PROJECT_PATH]/docx/project_documentation.md per section 5.

STEP 5 - DEEP DOCUMENTS
- Generate docx/docs/<id>_<module>_documentation.md for EVERY ID in the map.
- Generate docx/docs/<id>_<module>_map.md for every ID with its own branch -
  then a deep doc for every ID in that sub-map too.
- Drill down per the guide: leaf docs (<id>_<artefact>.md) for
  pages/screens/models/components/animations with their own rules;
  _layout.md partners for non-trivial UI. When unsure, create the doc. Zero
  leaf docs in a UI-heavy project is a smell.
- Generate docx/docs/<id>_<area>_sitemap.md for EVERY UI branch (public
  frontend, admin frontend, app window set, CLI screen set): high-level
  surface tree + low-level per-surface entries detailed enough to build each
  surface from. Every surface in the step-1 inventory appears in a sitemap.
- Generate the design docs per section 14: a global docx/docs/design.md when
  the project follows one style, and/or <id>_<area>_design.md partners when
  UI areas follow different rules (public site vs admin/CMS).
- Every doc: References block, last-reviewed header, H1 title starting with
  the ID (# <id> - <name>).
- Scope content to the area and be exhaustive: setup, configuration,
  seeding, operations - not a summary.

STEP 6 - SUB-PROJECTS
- For every sub-project: folder READ-ONLY (create nothing inside); generate
  its sub-map and a deep doc for every ID in it, drilling per the guide; the
  master's per-ID section uses the extended Only-read instruction.

STEP 7 - CONTAINERS
- For every container, including dev tools: generate its own deep doc per
  the container contents list in the guide. Generate the docker sub-map
  carrying the container branch IDs. Dev tools add host access + disable
  instructions.

STEP 8 - CROSS-CUTTING DOCS
- Generate docx/docs/contributing.md, docx/docs/deployment.md and
  docx/docs/development.md (every dev tool: summary, host access, disable,
  link).
- Generate docx/docs/dependency_map.md (mandatory) per section 8.
- Add others from the canonical list as the project warrants.
- Testing documentation follows the PROJECT's own test layout when one
  exists (tests/ dir, colocated test files, per-module readmes); only when
  the project has no test convention does the guide default apply.

STEP 9 - AGENTS.md (EDIT IN PLACE)
- Per section 10: insert or replace the managed AFTC-DOCX block; update
  stale documentation references to point at ./docx/; preserve everything
  else verbatim. Create a minimal AGENTS.md only when none exists. Place an
  identical copy at every AI tool location already in use.

STEP 10 - ROOT README (GENERATED LAST on purpose)
- Generate [PROJECT_PATH]/README.md per section 4. It comes after every
  other document on purpose: the root README sells the whole project to a
  newcomer, so it is written only now that the project is fully understood.
- CLASSIFY the previous README first (docx/old_docs/README.md when one
  exists): if it is extensive (many sections, tables, images), FOLLOW its
  structure closely - it is the skeleton of the new README; keep its images
  (verify each file exists), refresh every fact against source, discard only
  the provably stale. Never shrink an extensive README to a summary. If it
  is thin or absent, build from the section 4.2 archetype that matches the
  detected project type (tool/extension/library = feature sections + usage
  for everything; runtime app / multi-container = requirements, install,
  per-script usage, service overview).

STEP 11 - LINK AUDIT (mechanical - run the shipped script)
- node "[LINK_AUDIT_PATH]" "[PROJECT_PATH]"
- The script asserts: every ](...md) link resolves; every ./docx/....md
  prose reference exists; every stamp matches YYYY-MM-DD HH:MM; every
  ID-prefixed file's H1 starts with its ID; every map ID has exactly one
  doc file. Fix every reported failure and re-run until it prints PASS.
- Also eyeball the tech-stack tables for vague versions
  ("latest"/"project-local" where a manifest states one).

STEP 12 - REPORT + FINALISE
- Delete [PROJECT_PATH]/docx/generation-plan.md.
- Summarise: files created/modified, links verified, map ID count,
  sub-projects, containers, deferred items and why.
- Confirm explicitly: nothing was created, modified, or moved outside
  ./docx/, the root README.md and the root AGENTS.md (+ its AI-tool copies).
- Fill in the pre-launch checklist (section 19). Any unchecked item MUST be
  recorded with a fix plan in docx/docs/known-gaps.md (create the file when
  at least one item is unchecked).
- LAST ACTION, after everything else passes: zip the backup away so future
  sessions never read superseded docs:
  node "[ZIP_OLD_PATH]" "[PROJECT_PATH]"
```

### Variations

- **Documentation audit on existing project**: light step 1; steps 3-10
  become diff-based edits preserving structure and filling gaps; reuse
  project_map.md if present (refresh `last-verified`). Backup still runs.
- **Greenfield, no code**: base steps 1 and 3 on intended architecture; mark
  every claim as planned.
- **Open-source**: add `docx/docs/contributing.md` and a License section.
- **Internal-only**: add `docx/docs/security.md` and an access-model section
  in AGENTS.md.
- **Monorepo / docker-heavy**: iterate steps 7/8 per sub-project/container;
  one shared compose file keyed off map IDs.
- **Partial regeneration (one module)**: manually move that module's docs
  into docx/old_docs/ first (the tooling backup is all-or-nothing), then run
  the steps scoped to that module.
- **Re-run on a docx'd project**: the tooling folds the previous ./docx/
  output AND the previous old_docs.zip into the new backup automatically.

---

## 19. Pre-Launch Checklist

Fix any unchecked item, or document the gap in `docx/docs/known-gaps.md`.

- [ ] `README.md` (project root): generated LAST; old README classified (extensive = structural skeleton, images kept + verified) or the section 4.2 archetype followed; feature/usage sections for tool packages or requirements/install/script-usage for runtime apps; lite map + link line.
- [ ] `docx/project_documentation.md`: description, tech stack, lite map, guidance & rules incl. Maintaining This Documentation, one section per ID, Documentation Index.
- [ ] `docx/project_map.md`: full tree every level, `last-verified` + regenerate command, status legend.
- [ ] Lite maps in README and master match the top level of the map; the full tree lives only in the map and sub-maps.
- [ ] Every map ID has a per-ID master section (paragraph + Only-read instruction); sub-projects use the extended instruction.
- [ ] Every map ID has a deep doc at `docx/docs/<id>_<module>_documentation.md`; every tree-node doc is ID-prefixed in name AND H1 title; only the root README, master, map, AGENTS.md and cross-cutting docs lack IDs.
- [ ] Every generated doc has the References block, a Related section with sibling IDs, and a `last-reviewed` header.
- [ ] Every sub-project/major branch has a sub-map; every sub-map ID has its own deep doc. Nothing was created inside sub-project folders.
- [ ] Every UI branch has a `<id>_<area>_sitemap.md` (full surface tree + low-level per-surface entries); every reachable surface appears; surfaces with their own rules/states have leaf docs; complex single screens are broken into region leaves (or kept as one doc when too intertwined).
- [ ] Design rules documented: global `design.md` and/or per-area `<id>_<area>_design.md`; `_layout.md` partners defer to them.
- [ ] Every container (incl. dev tools) has a map ID matching its compose service name and its own deep doc (build, configuration, init/seeding, security, operations).
- [ ] Dev tools: `dev-tool` tag, deep doc with host access + disable instructions, entry in `docx/docs/development.md`.
- [ ] `docx/docs/dependency_map.md` exists: runtime graph, mount map, build-output contract, feature trace matrix, API consumer matrix - ID-keyed, `last-verified` header.
- [ ] Cross-references use IDs, not paths.
- [ ] `AGENTS.md`: under 200 lines, no secrets, managed AFTC-DOCX block present (no upfront doc reads; discovery via master index / map annotations; load-on-demand), prior critical rules preserved verbatim; copies at every AI tool location.
- [ ] Map annotations use full file names as link text; every `docx/docs/` file appears in the master's Documentation Index.
- [ ] link-audit script prints PASS.
- [ ] A new session can onboard from the root README + master + map + AGENTS.md + one deep doc.
- [ ] `docx/old_docs.zip` exists (previous docs zipped, `docx/old_docs/` removed).

---

## 20. Adapting To The Project

Defaults, not laws - document the project's actual shape:

- Container-heavy: most of the tree under Containers; do not invent source
  modules.
- Everything-in-one-container: one container ID; layered behaviour in its
  deep doc.
- Microservice fleets: many sub-projects; budget time.
- Legacy inconsistent IDs: keep them; note in a `## Structure Map Notes`
  master section; fix gradually.
- Documentation-only projects: drop Application Source and Containers
  branches; keep the rest.
- Mixed parent/child containers: private container nests under its app;
  shared containers stay top-level.
- No deep doc needed: a stub pointing at the master section beats a
  placeholder that never gets filled.
- Small projects: the master may be the only deep source; `docx/docs/` holds
  cross-cutting docs only. Do not generate empty docs to fill the shape.

---

## 21. Related

- The aftc-codex knowledge base, when available, holds language/tool
  conventions that `AGENTS.md` should reference where relevant.
