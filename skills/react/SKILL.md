---
name: react
description: React with functional components, hooks, Vite, and Next.js. Use when writing React components, JSX/TSX, useState/useEffect, or working with Vite or Next.js projects.
---

# React

## Setup
- Vite: `npm create vite@latest . -- --template react` (or react-ts)
- Next.js: `npx create-next-app@latest .`
- Use functional components with hooks - no class components
- `useState` for local state, `useEffect` for side effects
- Custom hooks for reusable logic: `useFetch`, `useLocalStorage`

## Code Style
- One component per file, named export or default
- Props destructured: `function Card({ title, children })`
- Hooks at top of component, never inside conditionals
- `key` prop on all mapped elements
- CSS modules or Tailwind - no inline styles
- TypeScript preferred over PropTypes

## Build & Test
- `npm run dev` - Vite dev server
- `npm run build` - production build
- `npm run preview` - preview production build
- `npm test` if using vitest/jest
