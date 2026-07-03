---
name: bun
description: Bun runtime, package management, HTTP server, and testing conventions. Use when working with bun, bun test, bun build, Bun.serve, or building JavaScript/TypeScript projects with the Bun runtime.
---

# Bun

## Setup
- `bun init` - create project
- `bun install` - faster than npm/yarn
- `bun run dev` - run dev server
- `bun test` - Jest/Vitest compatible
- `bun build` - production bundling

## API Development
- Native `Bun.serve()` for HTTP server
- `Bun.file()` for file operations
- `.ts` and `.js` natively - no transpiler
- JSON: `await req.json()`, `Response.json(data)`
- SQLite built-in: `import { Database } from "bun:sqlite"`
- Password hashing: `Bun.password.hash()`
- Lockfile: `bun.lock`
