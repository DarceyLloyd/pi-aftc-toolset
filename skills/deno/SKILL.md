---
name: deno
description: Deno runtime, TypeScript-native development, permissions, and built-in tooling. Use when working with deno, deno.json, deno serve, deno test, deno fmt, or building TypeScript projects with the Deno runtime.
---

# Deno

- Use `deno fmt` for formatting - no prettier config needed.
- Use `deno lint` for linting.
- `deno test` for testing - built-in test runner.
- Permissions are explicit: `--allow-read`, `--allow-write`, `--allow-net`, `--allow-env`.
- Prefer URL imports over npm packages when possible.
- Use `deno.json` or `deno.jsonc` for project configuration.
- Standard library at `https://deno.land/std/` - prefer stdlib over third-party.
- TypeScript is native - no `tsconfig.json` needed unless customizing.
