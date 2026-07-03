---
name: request-review
description: Dispatch a fresh reviewer agent with a clean context to critique the code after a self-audit passes. The reviewer has no prior context so it sees the change as a fresh reader would. Use after audit-code passes and before release-branch.
---

# Request Review

Dispatch a fresh reviewer agent with a clean context. The reviewer has no shared state - it can give a genuine second opinion because it hasn't been involved in writing the code.

Solo developer note: this replaces the human reviewer. The reviewer agent IS the reviewer.

## Process

### 1. Prepare the review brief

Write a self-contained brief for the reviewer agent. Include:

- What was built (feature description, not implementation)
- Which files changed (the diff context)
- What the project conventions require
- What the verify command is
- What you're most uncertain about (where you want fresh eyes)
- Security focus - if the change touches user data, auth, or external APIs, call this out and include the OWASP categories the reviewer should focus on

### 2. Dispatch the reviewer agent

Use the Agent tool with a completely fresh context. The agent prompt must be self-contained - no references to "our conversation" or "what we discussed."

```
You are a code reviewer. Review the following code changes.

[brief contents]

Produce a structured report:
- Critical findings (must fix before merge)
- High findings (should fix before merge)
- Medium findings (fix in follow-up)
- Low findings / nits
- What's good (so the author knows what to keep doing)

For each finding: file:line, severity, category, what's wrong, suggested fix.
Be specific. Reference exact line numbers. If you cannot find issues, say so
explicitly - don't invent problems to fill the report.
```

### 3. Apply the review

Use `respond-review` to categorize findings, apply fixes, and re-run tests. Critical and High must be fixed before merge. Medium and Low can be follow-up.

## When to skip

- Trivial one-line fixes (use `quick-fix` instead - the audit + review would be more overhead than the change)
- Changes where the diff is so small that fresh context adds no value
- When you are the only contributor and intend to ship immediately (consider `verify-work` instead)
