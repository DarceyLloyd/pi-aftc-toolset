# Documentation & Planning

## Rules

- [Y6KBkg] Verify every feature named in config files or comments exists in source (file, endpoint, mount) before documenting it as live - a comment referencing a missing file means the feature is reserved or removed

- [XCzbwf] During documentation recon, record exact dependency versions from manifests/lockfiles and inspect the contents of every tests/ directory - never assume a tests folder is fixtures-only

- [UhAJ0p] When evaluating generated output against saved reference outputs, never read the references before or during generation - they bias the result; read them only when the evaluation step begins

- [bpZyt0] When a generator enforces mechanical format rules, apply them to every emitted artifact - including maps, indexes and other meta-files, not just content files - and include those files in the mechanical audit

- [q1nq7C] When generating dozens of documentation files, batch writes into a few script executions using quoted heredocs (<<'EOF') - no shell expansion, far fewer tool calls than one write per file

- [dLI7uV] After changing a documentation-generation spec, validate by running it against several real projects of different archetypes (single-page app, multi-area web stack, single-window desktop app, plugin editor) and mechanically auditing each output - mock fixtures cannot catch under-specified mapping rules.

- [6JodTT] Give every UI area of a documented project a sitemap page: the full tree of reachable screens plus one entry per screen detailed enough to rebuild that screen from; simple screens live entirely in their sitemap entry, screens with their own rules or states get a separate detailed doc the entry points to - every screen documented, doc count scales with complexity not screen count.

- [G3UcLe] Capture design rules in one global design doc when a project follows a single style, plus per-area design docs that override it where areas genuinely diverge (public website vs admin back-office); per-screen layout docs reference these instead of repeating the rules.

- [coAT0F] Split a single complex screen/window into per-region child docs only when each region has its own rules, states or contract; when the regions are too intertwined to describe independently, keep ONE document - forced separation reads worse, not better.

- [DML7gd] migrating a doc tree onto renamed infrastructure: copy the tree, run ONE case-preserving token sweep (a separate sed pattern per case variant), then grep for BOTH the old token and old-platform terms afterwards - prose mentioning old platform concepts is what the token sweep misses

- [lxCcOL] Before executing an inherited planning/design document (especially one from a degraded or looping prior session), verify its load-bearing claims against live reality one by one: CLI flags via --help, protocol/API claims against the official docs, and which-competitor-does-what attributions against the actual package sources - and scan the files for corruption (out-of-range characters, blank-run spam) first, because a terminal meltdown may or may not have reached the artifacts.

- [jFqMgz] Renumber hierarchical IDs (1.11 -> 1.12) in one pass with exact-token matching over the original tokens (regex on quoted strings plus a dict lookup) - sequential substring replacement cascades ('1.11'->'1.12' then '1.12'->'1.13' double-shifts) and longest-first ordering is still fragile.

- [65y9iQ] Build upgrade/migration test fixtures from the ACTUAL shipped artifact - npm pack the published version and extract its data - never from a dev snapshot, whose content drifts from what users really have and makes the test assert the upgrade against the wrong old state.

- [GyAQJ0] When restructuring a file tree with a move map, plan for the long tail: user-created files at old locations must be evaluated (entries merged into the matching new file, or the file relocated to the right new folder) - never silently deleted or left orphaned in a folder the new layout no longer has.

- [OOB1lb] README quick-scan structure: Description/What's New sections carry short 'what it is + the slash command' bullets, each ending with a 'Click here for more information' anchor to its main section; all real detail lives ONLY in the main sections, and never keep a separate quick-links block that duplicates the bullets (it drifts and its anchors rot).

- [jNtrS8] After generating a file-move/rename plan, audit the destinations mechanically before trusting it: every destination must keep its source extension, no two sources may share one destination, and per-folder counts must reconcile - silently collapsed destinations (a slice bug dropping filenames) survive a human read of the plan and only show up in a mechanical check.

- [gAmSsN] For file-organising tools, run a final low-confidence pass over leftovers: re-match them by name keywords (plurals and pack shorthands included) into the target vocabulary instead of leaving them in the misc drawer forever; keep the vocabulary editable and dry-run first.

- [DcXvue] When a dedup pass keeps one copy of duplicate content that other files reference by path, refs must be rewritten to the kept copy and the kept copy must land where the ref points - resolve dedup and refs together, then verify no ref points at a dropped copy.

- [TpnZ37] When multiple agents share one system, whoever did NOT make a change independently verifies the deployed result against the LIVE system before the thread closes - reviewing the diff is not reviewing what is actually running.

- [od8ece] When accused of (or unsure about) an unexpected file change, answer with git evidence: git log --name-status on the affected paths shows which commit and author introduced it — and stage explicit paths when committing (never bulk add-all) so your own commits can never sweep in unrelated changes.

- [SreVIx] A load-on-demand documentation contract must live in the auto-loaded entry file (AGENTS.md / CLAUDE.md etc), not only inside the docs it governs - a rule written inside a file the reader is told not to read is invisible; state there which root docs are read every session and that deep docs load only for the area being worked on.

- [wQfP3k] When a documentation/generation prompt demands exhaustive coverage but the target project's own rules declare an area out of scope, the project rules win - document the declared boundary (inventory + why excluded), never the excluded content.

- [hhGPR6] Run required verbose scripts (backups, archivers, installers) with their transcript output capped (quiet flag or tail the log) - full verbosity belongs in the log file; thousands of lines of file listings in the session transcript burn context and allowance for zero information.

- [F2lWxs] When documenting or reviewing an UNFAMILIAR project that keeps one readme per source module next to the code (a <module>-readme.md convention): read those readmes FIRST as your map of the module set - they are updated in the same commit as the code, so they are usually current - but they are still docs, so grep-verify the load-bearing claims (command names, config keys, file paths) against the source before repeating them in your own documentation.

- [APA87g] Document a test suite's check/assertion count from the runner's own summary output, never from a grep of the assertion call sites - calls sitting on conditional paths overstate the real count and the assertion helper's own definition line pollutes a naive grep, so the static number and the run number diverge.

- [GuvvNI] When a documentation file, script or folder is removed, renamed or moved, grep the ENTIRE repo (not just the docs folder - sub-project readmes, structure maps, deployment guides and other docs' Related sections all hide pointers) for the old path or name and fix every hit in the same change; the sweep is only done when the grep returns zero.

- [eMSSIF] Test suites (unit, integration, e2e) must never hardcode values that come from seed data - a fixture slug, a foreign-key id, a pager 'page X of Y' count, a search term - because regenerating or replacing the seed silently breaks every such assertion and the failures masquerade as code bugs. Repoint fixtures to entities the test creates itself, and add an early-abort guard so a failed fixture setup returns one clear error instead of a cascade of undefined-id requests.

- [S6g2CA] Wire auxiliary report generation (rename suggestions, lint summaries) into the build/dry-run path so the reports stay fresh automatically, and wrap each pass in try/except so an auxiliary failure can never break the main flow.

- [pL5vB8] "let's discuss" / "this is all planning" means DO NOT build, create, integrate or deploy - capture decisions in a living plan doc, reflect them back, and confirm explicitly before any implementation; when unsure whether you are still planning, ask.

- [sD3nH6] Maintain a SINGLE living spec/plan doc and update it CONTINUOUSLY as each decision is made (never batch to the end) - record the decision, its rationale and any earlier choice it supersedes, so a fresh context can resume without re-deriving anything.

- [mP7wK3] Document a non-trivial HIERARCHICAL structure as a compact ID structure map: a tree with hierarchical IDs (1, 1.1, 1.2.1) drawn once, per-ID detail below it, nodes referenced by ID instead of re-described; verify a hand-written map against the real structure (ls/read/grep) before trusting it - only script-generated maps self-keep.

- [tF4jR9] Build anything for testing in the project's tests folder (organised in named subfolders), with a Testing section in AGENTS.md linking a testing.md for the details - create both when missing.

## Gotchyas

- [u3Qbqq] A UI-coverage rule written in one platform's vocabulary ("routes", "pages", "SPAs") makes the documenting model skip every other platform's UI (desktop windows, plugin editors, CLI screens) - it maps only what the words name; write the rule platform-neutrally ("every reachable surface: page, screen, window, view, editor") and require a per-area surface inventory during recon so a missed surface shows up as a visible gap.

- [6e9Zig] A "load X first" directive aimed at a weaker model gets rationalised away when a prerequisite seems missing (no detectable project stack -> "I'll load it after you point me at the repo") - state in the directive that the resource applies even before the prerequisite is known, and re-test against the weak model, not just the dev model.

- [l40a53] Force-killing a process found by fuzzy command-line substring match can kill your own interactive host session - the pattern matches every process built on the same entry script; enumerate the matches and verify identity (parentage, start time, who spawned it) before killing, or kill only PIDs captured at spawn time.

- [E1FfVB] Exact-count assertions on tracked side-effects (read/log/record counts) go stale when a feature adds an implicit extra side-effect (an auto-cascade load) - update the expected count to include the implicit record rather than assuming the tracking broke.

- [165sMY] Hand-written GitHub heading anchors go dead - the auto-generated slug strips punctuation: '## **My Tool (v2 - stable release)**' anchors to #my-tool-v2---stable-release (parens removed, spaces to hyphens, ' - ' to '---'); derive the anchor from the ACTUAL heading text and verify it, or the link goes nowhere.

- [InqH1r] A tree renderer that appends only child rows never prints the top-level nodes - their children render detached one level up and leaf top-level nodes vanish entirely; every node must print its own row before recursing.

## Issues & Solutions

- [t3IE5p] Mechanical markdown audit reports false H1/stamp failures and silently misses entries
  Cause: head -1 grabs a leading HTML header comment instead of the first heading; extraction regexes covered only one markup variant (e.g. bold bullets), not all variants in use
  Fix: Match the first heading with grep -m1 '^# '; make extraction patterns cover every markup variant in use - ASCII-tree prefixes are the most-missed one (strip leading spaces/pipes/backslashes/dashes before reading the token, or tree-formatted sections silently evade extraction); reconcile extracted counts against expected counts to expose extraction gaps. (2026-08)

- [oaNMKo] A markdown link/format checker reports broken links in a doc that merely describes the link syntax
  Cause: The checker's syntax regex matches literal prose that DESCRIBES the syntax - including the checker's own documentation and any doc explaining the format being checked.
  Fix: When documenting a checkable syntax, write it in a non-matching form (split the tokens, use a different example shape) or scope the checker to skip code spans; if a checker fails on a file that only TALKS about the format, that is this trap, not a real violation. (2026-08)

- [KxhFE4] A test that copies its own repo and asserts on the copy's contents fails after the tool is run on that repo (self-hosting doc/codegen/lint tools)
  Cause: The copy inherits whatever the tool's own output or side-effects left behind (generated dirs, moved/deleted files), so assertions written for the pre-run tree fail even though the tool works.
  Fix: Assert durable invariants (contract files, fold-in behaviour, untouched zones), not incidental files the tool may move or generate; when the tool restructures its own repo, update fixture expectations to the new reality - the run is the environment change, not a regression. (2026-08)
