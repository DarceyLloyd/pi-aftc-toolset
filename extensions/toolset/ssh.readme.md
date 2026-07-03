# ssh.ts

SSH remote terminal tools. Bridges the model to a local PyQt6 GUI
that holds the actual SSH connection. Five AI-callable tools and
five matching slash commands.

## Architecture

```
pi extension (Node.js, this file)
  └─ launches internal-python-gui via uv (when needed)
      └─ PyQt6 terminal GUI
          ├─ Paramiko SSH client
          ├─ Flask API on http://127.0.0.85:8564
          └─ std/out.txt session log
```

## How credentials stay away from the model

- Username, server, and password are entered in the local Python
  GUI only — never in the pi editor, never in a prompt, never
  sent to the model.
- The model only ever calls tools like `ssh_run` with a **command
  to execute**. It never sees the connection details.
- The GUI holds the SSH connection and runs the command locally,
  returning **only the command output** to the model.
- The Flask API binds to **loopback only** (`127.0.0.85:8564`),
  so no other machine on your network can reach it.

In short: **the AI gets the results of commands, never the keys
to the server.**

## Tools registered (5)

| Tool | Purpose |
|---|---|
| `ssh_status` | Is the GUI reachable? Is it connected? |
| `ssh_connect` | Launch GUI if needed, connect to `user@host[:port]`, optionally run an initial command (default: `ls -la`). Parses `user@host:port`. |
| `ssh_run` | Send a non-interactive shell command to the connected server. Output persists in `std/out.txt`. 1-120s timeout. |
| `ssh_peek` | Read recent output from the API buffer or the full `std/out.txt` log. |
| `ssh_interrupt` | Send repeated Ctrl+C / Ctrl+D to break hung commands. |

## Commands registered (5)

- `/ssh-gui` — launch the local PyQt6 SSH GUI manually.
- `/ssh-connect user@host [password]` — connect to a remote server
  (prompts for password if omitted).
- `/ssh-run <command>` — run a one-shot command on the connected
  server.
- `/ssh-status` — show SSH GUI running state and connection
  status.
- `/ssh-disconnect` — disconnect the active SSH session.

## Safety

- Avoid interactive commands such as `vim`, `nano`, `top` in
  `ssh_run` — they hang because they need keystrokes. Use
  non-interactive alternatives.
- The Python GUI binds to `127.0.0.85:8564` (loopback only).

## Failure handling

- `apiRequest` has a 35s timeout so a dead GUI never hangs the
  model.
- `ensureGui` waits up to 15s for the GUI API to come up after
  launch. On timeout, the tool returns an error.
- `launchBrowser` (for `/usage-report`) uses
  `pi.exec("cmd", ["/c", "start", "", filePath])` on Windows.

## Process management

`guiProcess` is module-scoped. The `exit` and `error` handlers
null it out. Multiple `ensureGui` calls check `isApiReachable()`
before launching — a single GUI instance per session.
