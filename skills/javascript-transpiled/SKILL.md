---
name: javascript-transpiled
description: JavaScript transpiled (Babel/TypeScript output), build targets, source maps, and tree-shaking. Use when working with transpiled JS output, webpack/babel/esbuild builds, source maps, or build-tool output.
---

# Javascript Transpiled

## Keep It Simple (KISS)
- The transpiled output is generated code - do NOT edit it directly. Edit the source.
- If you're writing JS that targets transpilation: write clean modern ES6+ and let the build tool handle it.
- Avoid manual polyfills - let the transpiler/bundler inject them.
- Always use the latest version of packages (install via packagename@latest)

## Build Conventions
- Output directory: `dev/` or `dist/` - never commit these to git.
- Source maps enabled for debugging: `--sourcemap` or `devtool: 'source-map'`.
- Minification for production, not development.
- Tree-shaking: use ES module imports so unused code is eliminated.

## Code Style
- Prefer public and private variable definitions above the constructor
- Same rules as JavaScript ES modules - KISS, no overengineering.
- Avoid dynamic imports in transpiled code unless explicitly needed (they break static analysis).
- Prefer `import`/`export` syntax (ESM) over `require`/`module.exports` (CJS).
- `async/await` over raw promises.
