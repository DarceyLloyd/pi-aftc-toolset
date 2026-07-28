# help-registry.ts

Help registry — the single source of truth for `/aftc-help`. A utility
module (same class as `db.ts` / `paths.ts`): feature modules may import
it; it has no pi dependency.

## Why it exists

`help.ts` used to keep a static command table that drifted from the
actual `pi.registerCommand` calls (example: `/aftc-footer-report-timeframe`
was registered in `core.ts` but missing from help). Now every module
records its commands in the registry right next to the pi registration,
and `help.ts` renders purely from the registry.

## API

```ts
registerHelpEntry({
    command: "aftc-stop",          // primary name, NO leading slash
    args: "[path]",                // optional usage hint
    description: "Stop the current agent operation",
    category: "Interrupt",         // one of HELP_CATEGORY_ORDER
    aliases: ["stfu"],             // optional, NO leading slash
});

getHelpEntries(): HelpEntry[]      // copy, registration order
resetHelpRegistry(): void          // tests only
```

`HELP_CATEGORY_ORDER` defines both the valid categories and the section
order on the help screen.

## Rules

- **One entry per primary command.** Aliases live in `aliases`, never as
  separate entries.
- **Call it next to the pi registration** (just before or after), inside
  the same factory, so the two can never be edited apart.
- **Descriptions must not embed "(alias …)"** — the renderer appends
  aliases itself.
- Duplicate `command` names replace the old entry and log a diagnostic.
- Not everything belongs here: pi built-ins, `/skill:*` entries, and
  keyboard shortcuts stay as static sections in `help.ts`.

## Drift protection

`tests/help-registry-check/` loads every command-registering module with
a mock pi and asserts both directions: every `pi.registerCommand` name
is covered by an entry (as `command` or `alias`), and every entry maps
to a real registered command. Adding a command without a registry entry
fails the suite.

## Wiring

Imported by every feature module that registers slash commands and by
`help.ts` (the only reader). See `docs/help-registry.md` for the
create/edit/delete checklist.
