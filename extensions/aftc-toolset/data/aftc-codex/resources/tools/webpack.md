# Webpack

## Rules

## Gotchyas

## Issues & Solutions


- `[YyG6BA] Critical dependency: the request of a dependency is an expression` from three/examples/jsm/inspector
  Cause: three 0.185 uses dynamic expression imports which webpack cannot statically analyse.
  Fix: suppress with `module.exprContextCritical: false` in the webpack config (vite and bun handle it natively). (2026-07)
- [Gpgsug] webpack-dev-server 6 works with existing `webpack serve --config=... --mode=...` scripts unchanged
  Cause: webpack-dev-server 6 keeps the same CLI/serve behaviour as before.
  Fix: no script changes are needed; the default port is 8080. (2026-07)
