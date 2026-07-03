---
name: nodejs
description: Node.js scripting with ES modules and CommonJS, stdlib-first, npm conventions, and async/await patterns. Use when writing Node.js scripts, .js or .mjs files, working with npm, or building CLI tools.
---

# Node.js

## Module System
- Prefer ES modules (.mjs) for new scripts: `import`/`export` syntax, top-level `await`
- Use CommonJS (.js) when compatibility with older Node.js or existing codebases is needed
- Always specify `"type": "module"` in `package.json` for ES module directories
- Use `.mjs` extension to explicitly opt into ES modules regardless of package.json

## Stdlib First
- Node.js has a RICH standard library - use it before reaching for npm packages
- Built-in modules: `fs`, `path`, `os`, `http`, `https`, `crypto`, `stream`, `events`, `util`, `url`, `querystring`, `child_process`, `readline`, `zlib`, `buffer`, `timers`, `assert`, `dns`, `net`, `tls`
- Only add external packages when stdlib truly can't do the job
- Document WHY each dependency is needed in README.md

## Script Structure
- Start with `#!/usr/bin/env node` shebang
- Use `"use strict"` (CommonJS) or rely on ES module strict mode
- Use `try/catch` around async operations
- Use `process.exit(0)` for success, `process.exit(1)` for failure
- Use `console.error()` for errors, `console.log()` for output
- Parse CLI args with `util.parseArgs()` (Node 18+) or `process.argv`

## Package.json Requirements
- Minimal `package.json` - only what's needed
- Always include: `"name"`, `"version": "1.0.0"`, `"private": true`
- ES modules: `"type": "module"`
- Only add `"dependencies"` when external packages are REQUIRED
- NEVER commit `node_modules/` or `package-lock.json` to templates
- Dependencies are installed by `npm install` at deployment time

## File Operations
- Use `fs/promises` for async file operations
- Use `path.join()` - never string concatenation for paths
- Use `fs.existsSync()` for existence checks
- Stream large files: `fs.createReadStream()` / `fs.createWriteStream()`
- Use `path.resolve()` for absolute paths

## Error Handling
- Always `try/catch` around `await` expressions
- Handle specific error codes: `err.code === 'ENOENT'`, `err.code === 'EACCES'`
- Never use bare `catch {}` - always log or handle the error
- Use `process.on('uncaughtException')` for top-level error handling in long-running scripts

## Safety Rules
- Never `eval()` user input
- Validate file paths before read/write
- Use `path.normalize()` to prevent path traversal
- Never hardcode secrets - use `process.env`
- Hash passwords with `crypto.scrypt()` or `crypto.pbkdf2()`
- Use `child_process.spawn()` with `shell: false`

## Testing
- Run with `--help` and verify exit code 0
- Test with sample data in a `test-data/` directory
- Use `node:assert` for simple assertions
- Smoke test: run script, check exit code, verify output

## Template Integration
- Each template has: `README.md`, `package.json`, `script.mjs` or `script.js`, `smoke-test.mjs`
- NO `node_modules/` - it's in `.gitignore`
- NO `package-lock.json` - generated at install time
- Templates go in `templates/nodejs/<name>/`
