---
name: javascript-mjs
description: JavaScript ES modules (.mjs) with KISS, modern OOP, and ESM conventions. Use when writing or editing .mjs files, ES module import/export code, or Node.js scripts with ES module syntax.
---

# Javascript Mjs

## Keep It Simple (KISS)
- Do NOT overengineer. Simple functions > complex class hierarchies.
- One file = one responsibility. If a file exceeds 200 lines, split it.
- Avoid unnecessary abstractions (no factories for a single implementation).
- Prefer plain objects and functions over classes when state is simple.

## OOP When Appropriate
- Preferre classes over function based huge single scripts. Instantiate a root controller which will then instantiate and manage all other classes (eg /includes/js/Main.mjs, /includes/js/NavHandler.mjs). Main.mjs should be a singleton.
- Anything that is re-usable that could be classed as a utility place in a utils dir in the /includes/js/utils folder
- Single responsibility per class - a class should do ONE thing well.
- Favor composition over inheritance - pass dependencies in, don't extend.
- Private fields: use `#privateField` syntax, not `_convention`.

## Code Conventions
- Use `const` by default, `let` when reassignment is needed. Never `var`.
- Arrow functions for callbacks, named functions for top-level logic.
- `async/await` over raw promises. Always handle rejections.
- Destructure parameters: `function({name, age})` over `function(obj)`.
- Use template literals (backticks) for string building.

## Module Rules
- One `export default` per module for the main export.
- Named exports for utilities and helpers.
- Import order: node built-ins → npm packages → local modules.
- No side effects at import time - exports should be pure.
