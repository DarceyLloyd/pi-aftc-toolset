---
name: vue
description: Vue 3 with Composition API, <script setup>, Pinia state management, and Vite/Nuxt. Use when writing Vue components, .vue files, ref/reactive/computed, or working with Vite or Nuxt projects.
---

# Vue

## Setup
- Vite: `npm create vite@latest . -- --template vue` (or vue-ts)
- Nuxt: `npx nuxi init .`
- Use Composition API (`<script setup>`) - no Options API
- `ref()` for primitives, `reactive()` for objects
- `computed()` for derived state, `watch()` for side effects

## Code Style
- Single File Components (.vue): `<template>`, `<script setup>`, `<style scoped>`
- Composables for reusable logic: `useFetch`, `useAuth`
- `v-for` always with `:key`
- `v-if`/`v-show` for conditionals
- Pinia for state management (not Vuex)
- Scoped styles: `<style scoped>`
