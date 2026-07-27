# Vite

- `[AeP6X6] ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'` on vite build
  Cause: vite 8 (rolldown) requires the standalone `esbuild` package as a peer for `minify: "esbuild"`.
  Fix: keep esbuild as a devDependency even though no build config require()'s it. (2026-07)
