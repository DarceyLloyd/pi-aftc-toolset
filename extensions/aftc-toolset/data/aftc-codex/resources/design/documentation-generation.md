# Documentation-generation

## Rules

- [Y6KBkg] Verify every feature named in config files or comments exists in source (file, endpoint, mount) before documenting it as live - a comment referencing a missing file means the feature is reserved or removed

- [XCzbwf] During documentation recon, record exact dependency versions from manifests/lockfiles and inspect the contents of every tests/ directory - never assume a tests folder is fixtures-only

- [UhAJ0p] When evaluating generated output against saved reference outputs, never read the references before or during generation - they bias the result; read them only when the evaluation step begins

- [bpZyt0] When a generator enforces mechanical format rules, apply them to every emitted artifact - including maps, indexes and other meta-files, not just content files - and include those files in the mechanical audit

- [q1nq7C] When generating dozens of documentation files, batch writes into a few script executions using quoted heredocs (<<'EOF') - no shell expansion, far fewer tool calls than one write per file

## Gotchyas

## Issues & Solutions

- [t3IE5p] Mechanical markdown audit reports false H1/stamp failures and silently misses entries
  Cause: head -1 grabs a leading HTML header comment instead of the first heading; extraction regexes covered only one markup variant (e.g. bold bullets), not all variants in use
  Fix: match the first heading with grep -m1 '^# '; make extraction patterns cover every markup variant in use; reconcile extracted counts against expected counts to expose extraction gaps (2026-08)
