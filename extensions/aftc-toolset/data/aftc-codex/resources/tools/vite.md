# Vite

## Rules

## Gotchyas

- [vM3cX6] `build.minify` also drives `build.cssMinify` when cssMinify is unset - a config that sets `minify: "esbuild"` intending JS-only minification silently minifies the CSS too; set `cssMinify: false` explicitly, or force `minify: false` for non-production builds in the config factory.

## Issues & Solutions


- `[AeP6X6] ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'` on vite build
  Cause: vite 8 (rolldown) requires the standalone `esbuild` package as a peer for `minify: "esbuild"`.
  Fix: keep esbuild as a devDependency even though no build config require()'s it. (2026-07)
