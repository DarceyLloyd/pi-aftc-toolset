# carrier.ts

Local stdio JSON-RPC client for the packaged Python SSH carrier.

## Responsibilities

- Resolves `uv.exe` on Windows and `uv` on Linux and macOS.
- Starts the packaged carrier with argument arrays, no shell, and isolated standard input, output, and error streams.
- Validates the protocol-versioned ready frame, pairs responses with request ids, handles carrier notifications, and bounds protocol lines and diagnostic buffers.
- Supports request timeouts, abort signals, graceful shutdown, and owned-process cleanup.
- Exposes an observable lifecycle state and rejects new requests after an unexpected carrier exit until the caller explicitly resets.
- `verifySshCarrierReady()` runs the exact packaged spawn path and requires a
  protocol-ready frame; the installer and carrier smoke test use it.
- The carrier accepts only a bounded optional standard-input payload for
  non-interactive commands; credentials are never accepted through that path.

## Lifecycle

The carrier never silently restarts after a crash. After an unexpected process
exit it enters the `terminated` state, rejects every pending request with a
generic message, and emits one `"terminated"` notification through
`onLifecycle()`. While terminated, `request()` and `start()` reject instead of
respawning a carrier that cannot restore in-memory SSH transports.

- `state` returns `"idle"` before start, `"ready"` while the carrier process is
  alive, and `"terminated"` after a crash or an explicit `stop()`.
- `onLifecycle(listener)` fires `"terminated"` once on an unexpected exit. It
  does **not** fire for an explicit `stop()`.
- `reset()` clears a `terminated` state so the next `start()` launches a fresh
  process. It is the explicit reconnect path used before a new connection.
- An optional `spawn` constructor option overrides the packaged carrier command
  and is used only by the deterministic `ssh-carrier-lifecycle-check` tests.

## Security

Carrier diagnostics are retained only as a bounded local buffer. Callers receive safe lifecycle errors rather than raw carrier diagnostics. Stderr is bounded to a fixed tail and is never returned in results, notifications, or lifecycle errors.
