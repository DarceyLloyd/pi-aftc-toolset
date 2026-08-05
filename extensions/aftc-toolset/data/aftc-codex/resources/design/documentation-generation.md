# Documentation-generation

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

## Gotchyas

- [u3Qbqq] A UI-coverage rule written in one platform's vocabulary ("routes", "pages", "SPAs") makes the documenting model skip every other platform's UI (desktop windows, plugin editors, CLI screens) - it maps only what the words name; write the rule platform-neutrally ("every reachable surface: page, screen, window, view, editor") and require a per-area surface inventory during recon so a missed surface shows up as a visible gap.

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
