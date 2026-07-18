# index.ts

The default-exported extension entry. The orchestrator.

## Responsibilities

- Imports every feature module's `create*` factory.
- Instantiates them in the right order.
- Wires `core.ts`'s `FooterDataProvider` into `footer-widget.ts` so the
  widget can read cache/timing data without importing core.
- Returns void - pi calls this function once on startup.

## Why it exists

`.dev/dev_guide.md` section 1.5 - feature modules do not import each other. The
orchestrator is the single place that knows about every module and
how they fit together. Adding a new feature = add a new file, then
add one `createXxx(pi)` line here.
