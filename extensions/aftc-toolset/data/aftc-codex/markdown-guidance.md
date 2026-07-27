# Markdown Guidance — Structure Maps

> Documentation guidance for the aftc-codex knowledge base — a top-level guidance
> resource (like `thought-and-action-guidance.md`). Load it on demand with
> `codex_load('markdown-guidance')`.
>
> **FIXED document** — maintained by the maintainer via pi-aftc-toolset releases. The
> `/aftc-codex-learn` self-education loop does NOT modify this file.

A **structure map** is a compact way to document (or understand) any non-trivial
HIERARCHICAL structure — a project layout, a menu flow, a sitemap, an API surface, a
feature tree, a database schema, a component tree. One compact map replaces many
`read` / `grep` / `ls` round-trips, and stable IDs let later text reference a node
without re-describing it.

## The pattern

Draw the tree ONCE with hierarchical IDs, then give per-ID detail below it:

```
1  Root                          ### 1 — Root: what it is
├─ 1.1  Child A                  ### 1.1 — Child A: detail
│   └─ 1.1.1  Grandchild         ### 1.1.1 — Grandchild: detail
└─ 1.2  Child B                  ### 1.2 — Child B: detail
```

Principles:

- **ID = path.** `1.2.1` means root → child 2 → child 1. IDs stay stable even when the
  descriptions change.
- **Tree first, detail second.** The tree is the compact overview; the per-ID blocks are
  the referenceable, loadable detail.
- **Reference by ID.** Elsewhere, write "see 1.6.1" instead of re-describing the node.
- **Use judgment.** Map real hierarchies, not trivial things.

## Template (hand-written map)

Copy this skeleton. The tree goes inside a fenced block; each node then gets a
`### <ID> — <name>` detail heading.

````markdown
<!-- structure-map · last-verified: YYYY-MM-DD · regenerate: <how to rebuild it> -->
# <Structure name>

```
1  <Root>
├─ 1.1  <Child A>
│   └─ 1.1.1  <Grandchild>
└─ 1.2  <Child B>
```

### 1 — <Root>
What it is.

### 1.1 — <Child A>
Detail.

### 1.1.1 — <Grandchild>
Detail.

### 1.2 — <Child B>
Detail.
````

## Staleness rule (critical)

A stale map is WORSE than no map — it misleads. There are two kinds:

- **Auto-generated maps** (directory listings, the codex `codex-resource-list.md`, any
  script-produced tree) are built from reality by a regeneration script, so they are
  always fresh and self-keeping. Never hand-edit them; regenerate them instead.
- **Hand-written maps** (menu flows, sitemaps, feature trees) are SNAPSHOTS, not truth.
  They carry the `<!-- structure-map · last-verified · regenerate -->` header telling any
  reader how fresh they are and how to rebuild them. BEFORE relying on a hand-written
  map, verify it against the actual structure (`ls` / `read` / `grep`); if it has
  diverged, REGENERATE it before proceeding.

## Where the full how-to lives

This resource is a concise summary + template. The detailed how-to (more examples and
edge cases) lives in the markdown skill — load it with `/skill:markdown` (see its
Structure Maps section). The `aftc-codex` skill (`/skill:aftc-codex`) references both.
