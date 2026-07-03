---
name: markdown-guide
description: >-
  AI-friendly markdown formatting for documentation .md files. Use when creating
  or editing README, SKILL.md, rules.md, or any *.md files.
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
- One idea per bullet. Short paragraphs.

## Why

- Numbered headings and lists force expensive renumbering when content moves. AI is slow at it, humans are fast.
- Bold, italics, and tables add token overhead with minimal information gain for an LLM reader.
- Plain structure survives restructuring - add, remove, reorder without breakage.
- Numbering is fine where it carries meaning (references, load-bearing order). Drop it where it does not.