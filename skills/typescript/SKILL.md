---
name: typescript
description: TypeScript strict mode, ES modules, bundler resolution, and AFTC singleton MVC patterns. Use when writing or editing .ts/.tsx files, configuring tsconfig, or working on TypeScript projects with the AFTC singleton MVC architecture.
---

# Typescript

## Compiler Settings
- Always `"strict": true` with `"strictNullChecks": true`
- Use `"module": "esnext"` with `"moduleResolution": "bundler"` (Vite/Webpack compatible)
- Use `"paths"` for clean imports: `"@src/": ["./src/"]`
- Target `"es2022"` for modern browser APIs
- Include `"dom"` and `"dom.iterable"` in lib

## Project Structure
```
src/
  controllers/   # Singleton MVC controllers
  interfaces/    # IAppComponent, IThreeComponent contracts
  models/        # AppConfig and data models
  utils/         # Pure utility functions
  index.ts       # Entry point with window exposure
  index.html     # HTML template (in src/ for bundler)
```

## Singleton MVC Pattern
- Export `default class` with `private static instance`
- Private constructor - use `getInstance()` factory
- Bind event handlers in constructor: `this.boundFn = this.fn.bind(this)`
- `init()` method returns `Promise<void>` (async for WebGPU)
- `dispose()` method cleans up all resources
- Expose to window: `(window as any).App = appInstance`

## Config Pattern
- Export `const AppConfig = { ... }` as a plain object
- Nest by feature: `scene`, `camera`, `renderer`, `lighting`, `features`
- Separate `component` (static) from `runtime` (tweakable) settings
- Runtime settings can be bound to devtools Inspector

## Component Interface
```typescript
export interface IAppComponent<TRenderContext = unknown> {
  renderLoopUpdate(context: TRenderContext): void;
  dispose(): void;
}
```

## Three.js Specific
- Use WebGPU renderer: `new THREE.WebGPURenderer({ antialias: true })`
- Async init: `await renderer.init()` before use
- Post-processing: `new THREE.PostProcessing(renderer)`
- Set `outputColorSpace = THREE.SRGBColorSpace`
- Use `renderer.setAnimationLoop()` not `requestAnimationFrame`

## Type Safety
- Use `null` initial values for Three.js objects, set during `init()`
- Type guards before use: `if (!this.renderer) return`
- `as any` only for window exposure and debug globals
- Use interface over type for public contracts
