# Help registry — slash command documentation contract

**Read this before creating, editing, or deleting ANY slash command in
this extension** (any `pi.registerCommand` call under
`extensions/aftc-toolset/`).

## The rule

`/aftc-help` renders from `extensions/aftc-toolset/help-registry.ts`,
not from a static table. Every slash command the extension registers
MUST have exactly one help-registry entry, recorded in the SAME module,
immediately next to its `pi.registerCommand` call:

```ts
registerHelpEntry({
    command: "aftc-stop",              // primary name, NO leading slash
    args: "[path]",                    // optional usage hint
    description: "Stop the current agent operation",
    category: "Interrupt",             // one of HELP_CATEGORY_ORDER
    aliases: ["stfu"],                 // aliases, NO leading slash
});

pi.registerCommand("aftc-stop", { ... });
pi.registerCommand("stfu", { ... });   // alias — no second entry
```

## Checklist

**Creating a command**
1. `pi.registerCommand("name", …)` as usual.
2. Add ONE `registerHelpEntry` beside it (aliases included in the entry,
   never as separate entries).
3. Pick an existing category from `HELP_CATEGORY_ORDER`. New category =
   add it to the array in `help-registry.ts` (position = section order).
4. Run `node tests/help-registry-check/help-registry-check.mjs`.

**Editing a command**
- Renamed? Update the entry's `command`/`aliases` to match exactly.
- Changed args or behaviour? Update `args`/`description`.
- Descriptions must NOT embed "(alias …)" — the renderer adds it.

**Deleting a command**
- Delete the `pi.registerCommand` AND its `registerHelpEntry` (or remove
  the name from `aliases` when only an alias goes away).

## Edge cases

- **Alias commands** (separate `pi.registerCommand` for the same action):
  one entry, aliases listed in `aliases`. Example: `/stfu` lives in the
  `/aftc-stop` entry.
- **Legacy aliases** (eg `/aftc-footer-report-timeframe`): also just an
  `aliases` entry — help shows current names only.
- **Auto-generated commands** (intro factory's `/<prefix>-on/-off`):
  the generator registers entries in its loop, using the descriptor's
  label.
- **Dormant/disconnected modules** (providers/, intro-factory): keep
  their entries wired — they register only if the module loads, and an
  empty category is simply skipped on the help screen.
- **Not registry material**: pi built-ins, `/skill:*` names, keyboard
  shortcuts. Those stay as static sections in `help.ts`.
- **Duplicate `command` names** replace the old entry and log a
  `[aftc-toolset]` diagnostic — two modules fighting over one name is a
  bug, not a pattern.

## Drift protection

`tests/help-registry-check/` loads every command-registering module
with a mock pi and asserts both directions:

1. every `pi.registerCommand` name is covered by an entry (`command` or
   `aliases`)
2. every entry maps to a real registered command

A missing or stale entry fails the test suite.
