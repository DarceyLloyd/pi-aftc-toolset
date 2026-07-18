# help.ts

`/aftc-help` - a static, scrollable list of every slash command and
keyboard shortcut this extension registers.

## What it does

Renders a `ctx.ui.select` dialog grouped by category:

- **General** - `/aftc-help`, `/aftc-install`, `/cls`, `/theme`
- **Response** - `/aftc-response-divider`, `/aftc-intro-stop`, `/aftc-intro-on`
- **Interrupt** - `/aftc-stop`, `/stfu`
- **Navigation** - `/cd`, `/cd-set-max-depth`, `/dir`, `/ls`, `/cwd`
- **Footer / cache / timing** - `/aftc-footer`,
  `/aftc-set-costs-timeframe` (alias `/aftc-footer-report-timeframe`),
  `/cache-profile`, `/cache-stats`, `/cache-reset`
- **Usage report** - `/usage-report`, `/usage-clear`
- **SSH** - `/ssh-connect`, `/ssh-status`, `/ssh-run`, `/ssh-shell`,
  `/ssh-close-shell`, `/ssh-interrupt`, `/ssh-upload`, `/ssh-download`,
  `/ssh-list`, `/ssh-stat`, `/ssh-read`, `/ssh-write`, `/ssh-mkdir`,
  `/ssh-rename`, `/ssh-remove`, `/ssh-disconnect`, `/ssh-help`
- **Skills** - `/skill:cache-audit`, `/skill:bulk-read`
- **Shortcuts** - `alt+c`, `Ctrl+T` (built-in pi)

Sections are dash-underlined, columns aligned, no box characters.
Clean, scannable, works in any terminal.

## Static snapshot, not introspected

The list is a static `Array<[name, description]>` table per
category, not built from `pi.getCommands()`. The reason: the
descriptions are human-written and would not be derivable from the
command registration. The trade-off: when a new command is added,
this file must be updated to match. See the comment block at the
top of `GENERAL_COMMANDS` et al. for the file → command map.

## Headless fallback

In RPC / `-p` mode where `ctx.hasUI` is false, the help lines are
printed to stdout with a `[aftc-toolset]` prefix instead of
opening a TUI dialog. (.dev/dev_guide.md section 6.3)

## Public factory

```typescript
export function createHelpModule(pi: ExtensionAPI): HelpModule
```

Returns the module instance (currently unused - the module is
self-contained, but the orchestrator pattern keeps the reference
around for symmetry with other modules).

## Commands registered (1)

- `/aftc-help` - show this command and shortcut list in a
  scrollable dialog (60s timeout, then auto-dismiss).
