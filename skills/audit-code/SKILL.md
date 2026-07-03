---
name: audit-code
description: Self-review checklist for the coding agent before committing or dispatching a reviewer. Checks security, performance, clarity, scope, test coverage, types, and SOLID. Produces a pass/fail checklist. Use before request-review, before committing, or when the user asks for a code quality check.
---

# Audit Code

**Hard gate:** Audit must check for: bugs (correctness), security, performance, and clarity. Do not skip security review if the code touches user data, auth, or external APIs.

Run this self-review before asking anyone else to look at the code. Goal: catch everything that is clearly wrong or missing so the reviewer can focus on design and architecture, not hygiene.

Distinct from `request-review`: this is the coding agent checking its own work. No second agent is involved. Run this first, then `request-review`.

## Modes

- **Default** - full checklist below.
- **--quick** - run only Supply Chain and Test Coverage. Use for changes under 50 LOC.

## Checklist

### Supply Chain & Security

- No secrets in diff (API keys, tokens, `.env` values, passwords). If found, rewrite history before pushing.
- New dependencies reviewed: not abandoned, not known-malicious, version pinned in lockfile.
- OWASP Top 10 spot-check: injection (SQLi, command, XSS), broken auth, sensitive data exposure, misconfiguration, path traversal.
- Security: diff scanned, no unaddressed HIGH findings.

### Scope

- Changes are limited to what was asked - nothing extra refactored or reorganised.
- No speculative features added.
- No files touched outside the stated scope.
- Changes are surgical: only code strictly required for the task; no refactoring, reorganization, or cleanup outside task scope (Boy Scout Rule applied surgically, not broadly).

### Boy Scout Rule

- Every file touched is cleaner than when it was found.
- No dead code left behind.
- No commented-out code blocks.

### Types and Safety

- No `any` types introduced (TypeScript) or untyped public functions (Python/Go/etc.).
- No `@ts-ignore` or `// eslint-disable` added.
- No `as unknown as X` casts that bypass type safety.

### Test Coverage

- Every new function has at least one test.
- Every bug fix has a regression test.
- Tests verify behavior through public interfaces (not implementation details).
- Tests are F.I.R.S.T compliant (use `enforce-first` if unsure).

### SOLID and Heuristics

- Single Responsibility: no function or module doing two unrelated things.
- Open/Closed: extended through interfaces, not by modifying stable code.
- Dependency Inversion: dependencies injected, not imported globally where avoidable.
- Code is free of smells (deep modules, god objects, feature envy, etc.).

### Code Style

- Functions: 4–20 lines; split if longer.
- Functions: descend exactly one level of abstraction (the Stepdown Rule).
- Files: under 300 lines (ideally 200–300).
- Names: specific and unique.
- No duplication - shared logic extracted.
- Early returns over nested ifs; max 2 levels of indentation.
- Conditionals: expressed as positives.
- Comments explain WHY, not WHAT.

### Agent Readability

- Functions small enough to fit in a standard context window.
- Names unique and specific enough to be greppable.
- Types explicit (no `any`, no inferred return types for public APIs).
- Code avoids deep nesting (max 2 levels) and uses early returns.

### Red Flags

Before reporting, name any rationalisation you caught yourself making for skipping a checklist item. Silence is not acceptable - if you skipped an item, state the reason explicitly.

## Output

Report the checklist with ✓ / ✗ per item. For each ✗, describe what needs to be fixed.

If all items pass: suggest running `request-review` for an independent second opinion.
If any items fail: fix them before proceeding.
