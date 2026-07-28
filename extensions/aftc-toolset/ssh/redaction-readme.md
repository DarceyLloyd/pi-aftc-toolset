# redaction.ts

Pure helpers for removing saved SSH connection metadata from text that can be
shown to Pi or returned by a model tool. It intentionally never stores
passwords or private-key passphrases.

## Public API

- `redactSshValues(text, values)` removes arbitrary in-memory sensitive values.
- `redactSshText(text, connection)` removes username, host, port, and private-key path. Host and key-path matching is case-insensitive.
- `sshSafeError()` returns the generic error used at the extension boundary.
- `sshSafeErrorMessage(error)` maps any thrown error to a safe, non-diagnostic
  category message for model-facing tool results. It distinguishes only safe
  outcomes (command timeout, cancellation, missing session, unavailable
  carrier) using numeric carrier codes and fixed strings; it never echoes host,
  user, port, key path, password, passphrase, fingerprint, or carrier
  diagnostics.
