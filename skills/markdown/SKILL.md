---
name: markdown
description: >-
  AI-friendly markdown formatting for documentation .md files and tasks.md.
  Use when creating or editing README, SKILL.md, development guides, or tasks.
---

# Markdown for AI

Apply these rules whenever you write or edit a .md file.

## Structure

- Use #, ##, ### for headings. Never prefix with numbers - no `## 1.` unless it is part of a meaningful step sequence e.g. a tutorial or install guide process, such as `## Step 2:`, or `## Stage 2:`.
- Use `-` for unordered list items by default.
- Use `1. 2. 3.` numbered lists ONLY when items are referred to by number (e.g. "see rule 1") or order is genuinely load-bearing. If you can reword to drop the reference without bloat, prefer `-`.
- Use --- to divide major sections.
- Stop at ### for heading depth.

## Content

- No `**bold**` or `***italic***`. Plain prose only.
- No markdown tables. Use prose or lists.
- Never use emphasis.
- No em dashes. Use a regular hyphen instead, surrounded by spaces when used as a parenthetical or aside, or no spaces when used as a compound modifier. Em dashes add visual noise and require special handling in many text tools.
- One idea per bullet. Short paragraphs.

## tasks.md

Use task lists only when asked to create or update `tasks.md`.

- Place tasks in clear sections.
- Use `[ ]` for work that is not started or incomplete.
- Use `[/]` for work in progress or partly implemented.
- Use `[X]` only after verification in every required environment.
- Mark a task `[/]` when work starts.
- Mark the task `[X]` or `[-]` after verification.
- Process any affected tasks before stopping.
- Before stopping, count task markers and report exactly:

```text
Progress: <complete>/<total> complete, <remaining> remaining
```

## Why

- Numbered headings and lists force expensive renumbering when content moves. AI is slow at it, humans are fast.
- Bold, italics, and tables add token overhead with minimal information gain for an LLM reader.
- Plain structure survives restructuring - add, remove, reorder without breakage.
- Numbering is fine where it carries meaning (references, load-bearing order). Drop it where it does not.