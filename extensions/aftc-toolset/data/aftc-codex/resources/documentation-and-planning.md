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

## Gotchyas

- [u3Qbqq] A UI-coverage rule written in one platform's vocabulary ("routes", "pages", "SPAs") makes the documenting model skip every other platform's UI (desktop windows, plugin editors, CLI screens) - it maps only what the words name; write the rule platform-neutrally ("every reachable surface: page, screen, window, view, editor") and require a per-area surface inventory during recon so a missed surface shows up as a visible gap.

- [6e9Zig] A "load X first" directive aimed at a weaker model gets rationalised away when a prerequisite seems missing (no detectable project stack -> "I'll load it after you point me at the repo") - state in the directive that the resource applies even before the prerequisite is known, and re-test against the weak model, not just the dev model.

- [l40a53] Force-killing a process found by fuzzy command-line substring match can kill your own interactive host session - the pattern matches every process built on the same entry script; enumerate the matches and verify identity (parentage, start time, who spawned it) before killing, or kill only PIDs captured at spawn time.

- [E1FfVB] Exact-count assertions on tracked side-effects (read/log/record counts) go stale when a feature adds an implicit extra side-effect (an auto-cascade load) - update the expected count to include the implicit record rather than assuming the tracking broke.

- [165sMY] Hand-written GitHub heading anchors go dead - the auto-generated slug strips punctuation: '## **My Tool (v2 - stable release)**' anchors to #my-tool-v2---stable-release (parens removed, spaces to hyphens, ' - ' to '---'); derive the anchor from the ACTUAL heading text and verify it, or the link goes nowhere.

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
