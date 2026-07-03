---
name: angular
description: Angular framework with standalone components, signals, the new control flow syntax, and the ng CLI. Use when working with Angular, ng generate, signals, inject(), or standalone components in .ts files.
---

# Angular

## Setup
- `ng new my-app --standalone` (standalone components, no NgModules)
- `ng generate component my-comp` - create component
- `ng generate service my-service` - create service
- `ng serve` - dev server on port 4200
- `ng build` - production build

## Code Style
- Standalone components: `standalone: true`
- `inject()` for dependency injection (not constructor)
- Signals over RxJS for state: `signal()`, `computed()`, `effect()`
- `@if` / `@for` new control flow (not *ngIf/*ngFor)
- TypeScript strict mode
- One component per file
- SCSS for styles
