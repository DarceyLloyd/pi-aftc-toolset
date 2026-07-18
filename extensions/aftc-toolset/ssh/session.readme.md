# session.ts

In-memory SSH session manager.

## Responsibilities

- Passes a session-only connection request to the local carrier.
- Maps carrier session ids to user-visible saved connection names.
- Tracks the selected session only for the active Pi runtime.
- Proxies command, PTY, transfer, and remote file actions to the carrier.
- Returns bounded callers with separate standard-output, standard-error, exit-code, and truncation data for commands; the model boundary formats and redacts it.
- Retains only active connection metadata needed to redact terminal output, then discards it with the session.
- Clears every active session and the current selection when the carrier reports an unexpected termination, so a crash cannot leave stale sessions that silently restart an empty carrier.
- Resets a terminated carrier before a new connection attempt, which is the explicit reconnect path after a crash.
- Reports a single shared status via `getStatus()` (`{ connected, carrierState, sessions }`) consumed by `/ssh-status` and `ssh_status`; `formatSshStatus()` maps it to `Connected` or `Not connected - <reason>`.
- Stops an idle carrier shortly after the last session disconnects or is lost (zero-sessions reaper, 30 s grace); a new `connect` cancels it, and the timer is cleared in `dispose()` and on a terminated carrier.
- Disconnects sessions and stops the carrier during disposal.

## Security

The manager clears a password or private-key passphrase after each completed or failed authentication attempt. It retains credentials only during the immediate local host-key approval retry, then clears them. It exposes session views containing only the saved connection name, opaque id, and connection time. New host keys require local approval for the current Pi session, while a changed in-memory host key is rejected. Remote paths are validated and normalized with POSIX path rules. Carrier errors must be converted to safe messages by the caller.
