# confirmation-overlay.ts

Reusable overlay-based confirmation dialog for the SSH feature. A thin
wrapper over the AFTC UI toolkit's `showConfirm()` (see
`ui/aftc-ui-readme.md`): a GRUB-style full-screen takeover with the safe
option highlighted by default.

## API

```ts
export interface ConfirmationOptions {
    title: string;
    body: string;
    yesLabel?: string; // default "Confirm"
    noLabel?: string;  // default "Cancel"
}

confirmOverlay(ctx, options): Promise<boolean>
```

- Returns `true` when the user picks the yes action, `false` on the no
  action or cancel.
- Outside the TUI it falls back to `ctx.ui.confirm`, so non-interactive
  callers behave exactly like the built-in confirm.

## Usage

Call from SSH flows that need a destructive-action gate (delete
connection, overwrite file, etc.). Used by the SSH connection-manager
dialogs; see `docs/ssh-documentation.md` for the wider feature.
