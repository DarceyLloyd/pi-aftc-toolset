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
- Tables are allowed when they present structured data clearly (command references, comparisons, config matrices). Keep them concise - no excessive columns or merged cells.
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

## Structure Maps

For a non-trivial hierarchical structure (a sitemap, a menu flow, a directory layout, an API surface, a feature tree, a DB schema, a component tree), document it as a compact ID structure map: a tree with hierarchical IDs first, then per-ID detail below.

```text
1  Root
|- 1.1  Child A
|  \- 1.1.1  Grandchild
\- 1.2  Child B
```

Then the per-ID detail:

```text
### 1 - Root: what it is
### 1.1 - Child A: detail
### 1.1.1 - Grandchild: detail
```

- The ID is the path (1.2.1 = root, child 2, child 1). It stays stable even when descriptions change.
- Tree first (compact overview), then per-ID detail (referenceable and loadable).
- Reference a node by ID elsewhere ("see 1.6.1") instead of re-describing it.
- Auto-generated maps (dir listings, a resource list) come from a script, so they stay fresh.
- Hand-written maps go stale. Carry a header like `<!-- structure-map - last-verified: YYYY-MM-DD - regenerate: <how> -->`, verify against reality (ls, read, grep) before trusting one, and regenerate it if it has diverged. A stale map is worse than no map.
- Use judgment - map real hierarchies, not trivial things.

Why it saves tokens: one compact map replaces many read, grep, and ls round trips, and stable IDs let later text reference a node without re-describing it.

## Why

- Numbered headings and lists force expensive renumbering when content moves. AI is slow at it, humans are fast.
- Bold and italics add token overhead with minimal information gain for an LLM reader.
- Plain structure survives restructuring - add, remove, reorder without breakage.
- Numbering is fine where it carries meaning (references, load-bearing order). Drop it where it does not.
- Tables are fine for structured reference data; avoid them for prose that reads better as lists.