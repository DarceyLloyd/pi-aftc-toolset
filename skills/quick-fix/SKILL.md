---
name: quick-fix
description: Streamlined fast-path for trivial data-only or typo fixes - no TDD, no branching ceremony, no full plan. Use for one-line corrections, comment fixes, doc typos, and other changes that don't warrant a full TDD/plan/build cycle.
---

# Quick Fix

Fast-track for trivial data-only fixes that do not require the full bug-fix chain.

## Entry Criteria (ALL must be true)

1. Purely data change - adding a missing key, fixing a typo, updating a config value, correcting a constant
2. No logic change - no function signature, condition, loop, or control flow is modified
3. No refactor risk - the change does not reorganize or rename existing structures
4. No API surface change - no exported symbol, interface, or contract changes
5. Verifiable with a single assertion - one test, one curl, one grep can prove it works
6. Affects one file
7. Affects five or fewer lines changed

## Guardrails (HARD ABORT - any of these fails)

- Touches more than one file
- Diff exceeds five lines
- Any function signature, condition, or loop is modified
- The verify command is more than one pipeline
- Running the test suite breaks any existing test

## Fast-Path Workflow

1. Make the change.
2. Run a single verification command.
3. If green, commit with `fix:` or `chore:` prefix.
4. If red, abort and switch to the full `fix-bug` workflow.

## Commit message

```
fix(<scope>): <one-line description>

<optional body explaining the why>
```

Example: `fix(docs): correct typo in /cd picker description`

## Out of scope

- Any change that modifies behavior (use `fix-bug` and `develop-tdd`)
- Any change that requires test updates beyond the single change itself
- Any change touching authentication, credentials, or external APIs (use full security review)
