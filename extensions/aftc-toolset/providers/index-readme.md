# providers/index.ts

Providers folder entry point. Home of every LLM-provider feature in the
toolset; the main orchestrator (`../index.ts`) calls `createProviders(pi)`
— the only function the rest of the extension knows about.

## What it does

Wires each provider module into pi. Today that is exactly one call:

```ts
export function createProviders(pi: ExtensionAPI): void {
    createQwenCloud(pi);
}
```

## Adding a new provider

1. Create `providers/<name>.ts` as a self-contained feature module
   exporting `create<Name>(pi)`.
2. Import and call it from `createProviders` here.
3. Add the sibling `<name>-readme.md` (see `qwencloud-readme.md` for the
   shape) and update `providers/readme.md`.

See `providers/readme.md` for the folder overview and
`qwencloud-readme.md` for the existing provider's full contract.
