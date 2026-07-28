# connection-form-overlay.ts

Reusable overlay-based connection form for the SSH feature. Both helpers
are thin wrappers over the AFTC UI suite (`ui/aftc-ui.ts`):

| Helper | Wraps | Returns |
| --- | --- | --- |
| `connectionFormOverlay(ctx, options)` | `showForm()` | `ConnectionFormResult` on submit, `null` on cancel |
| `authMethodOverlay(ctx, title, initial)` | `showMenu()` | `"password"` / `"key"`, or `null` on cancel |

Outside the TUI both resolve their fallback values (`null` for the form,
`initial` for the auth method) so the caller continues with the
per-field prompts in `connection-form.ts`.

## connectionFormOverlay fields

| Field | Type | Rules |
| --- | --- | --- |
| `name` | text, required | trimmed |
| `username` | text, required | trimmed |
| `host` | text, required | trimmed |
| `port` | int | 1–65535; empty = 22 (create) or keep current (edit) |
| `timeout` | int (seconds) | 1–300; empty = 30 (create) or keep current (edit); returned as `connectTimeoutMs` |
| `key` | text | private-key path; omitted when `allowIdentityFile: false` |
| `auth` | choice | "Password" / "Private key" (password-only when key field hidden) |

- **Validation:** choosing "Private key" with an empty key path bounces
  back to the key field with an error message.
- **Create vs edit:** pass `initial` to pre-fill; port/timeout labels
  then say "leave empty to keep". Without `initial`, empty port/timeout
  resolve to the defaults (22 / 30s).
- `identityFile` is only set on the result when auth is "Private key"
  AND the path is non-empty.

## authMethodOverlay

Single-question select used by the saved-connection flow when only
credentials are still missing. Outside the TUI returns `initial`
(caller falls back to prompts).

See `docs/ssh-documentation.md` for the wider SSH feature.
