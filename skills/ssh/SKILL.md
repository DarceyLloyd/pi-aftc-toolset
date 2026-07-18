---
name: ssh
description: >-
  Drive the pi-aftc-toolset SSH feature inside pi to operate on remote servers
  over SSH. Run non-interactive remote commands, control interactive programs
  (Nano, Vi, htop, tmux) through PTY shells, upload and download files, and
  manage remote files. Use when the user asks to run a command on a remote host
  or server, connect to or operate on a remote machine over SSH, read, edit, or
  move files on a remote server, drive an interactive terminal program remotely,
  or work with an active SSH session.
---

# SSH (pi-aftc-toolset)

Use this skill whenever the user wants to operate on a remote machine over SSH
through pi. It covers the model tools and the local slash commands of the
pi-aftc-toolset SSH feature.

## How SSH works here - read first

The privacy model is load-bearing for everything below.

- You never receive usernames, hosts, ports, passwords, private-key paths,
  passphrases, or fingerprints, and you must never ask for them. The user
  enters credentials locally.
- You only ever see opaque session ids and opaque shell ids. They are your only
  handles to a remote machine.
- You can connect or reconnect a saved server by calling ssh_connect with its
  saved name. That opens a local prompt the user fills in; you never supply or
  see credentials. You cannot create, edit, or delete a connection - only the
  user can, via /ssh-cm or /ssh-connect. New host keys are approved locally
  (the user may have enabled auto-accept with /ssh-auto-accept-session-on);
  changed host keys are always rejected.
- All command output, file content, and errors are bounded and redacted before
  they reach you. Hostnames and key paths are stripped regardless of letter
  casing.
- Destructive operations are gated by local-user confirmation. Call the tool and
  let the user confirm locally; do not try to pre-confirm or work around the
  gate.

## Prerequisites

SSH needs native dependencies that pi install does not always add. If no
session exists or a carrier error appears, ask the user to run /aftc-install
then /reload. The user supplies credentials locally; you connect by saved name.

## Choose the right approach

Route the work to the correct tool family:

- A non-interactive command (ls, ps, grep, a build, a one-shot script) -> ssh_run.
- An interactive program you must drive (Nano, Vi, less, htop, top, tmux, a
  REPL, a debugger) -> the shell tools.
- Inspecting a remote path -> ssh_list_dir, ssh_stat, ssh_read_file.
- Changing a remote path -> ssh_write_file, ssh_mkdir, ssh_rename, ssh_remove.
- Moving bytes between machines -> ssh_upload, ssh_download.
- A port forward -> no model tool and no user command exists; suggest the
  user runs ssh -L / -R / -D from their own terminal if they need a tunnel.

## Get a session id

You need an opaque session id before any tool call.

- If the user already gave you one, use it.
- Otherwise call ssh_status. It lists active sessions and their opaque ids, or
  tells you why nothing is connected (no session yet, carrier running with no
  sessions, or carrier stopped).
- If nothing is connected and the user named a saved server, call
  ssh_connect(<name>) to connect it; the user supplies credentials locally and
  you get back an opaque session id. If the saved name is unknown, ask the user
  to create it with /ssh-connect first.
- When you are done with a session, call ssh_disconnect with its id so the idle
  carrier can wind down.

## Run a non-interactive command

Use ssh_run with a session id and the command string.

Example: call ssh_run with sessionId "<id>" and command "uname -a && df -h".

- Add the optional bounded stdinText only when a command reads from standard
  input. Never use stdinText for credentials.
- The result carries exit code, stdout/stderr presence, and a truncation flag.
  If it says the output was truncated, you did not see all of it; ask the user
  to inspect the local copy rather than guessing.
- Timeouts and cancellations return safe categorized errors: command timeout,
  cancelled, session closed, carrier unavailable. After a session-closed or
  carrier-unavailable error, ask the user to reconnect before retrying.

## Drive an interactive program

Open a shell, drive it, then close it.

1. ssh_open_shell with sessionId "<id>" returns an opaque shell id.
2. Drive it with ssh_send_keys (keys and chords), ssh_paste (larger text),
   ssh_resize (match the terminal size), and ssh_peek (read the current screen).
3. Recover a stuck program with ssh_interrupt, which sends Ctrl+C / Ctrl+D.
4. End it with ssh_close.

Every shell tool after open takes both the session id and the shell id.

Example: open a shell, send "vi notes.txt" then Enter, peek to see the editor,
send ":wq" then Enter to save and quit, then close the shell.

- Poll with ssh_peek, act on what you see, and keep peeks bounded. Do not dump
  entire histories.
- Prefer ssh_run when a program has a non-interactive mode (sed over vi, head
  over less). Reserve shells for genuinely interactive programs.
- The user also has a local /ssh-shell full-screen terminal they control
  directly; you do not drive that one.

## Transfer files

Use ssh_upload and ssh_download between the local machine and the remote
session. Pass absolute local paths and POSIX remote paths.

Example: call ssh_download with sessionId "<id>", remotePath "/var/log/app.log",
localPath "<abs>/app.log".

- Both accept an opt-in preserve flag to keep timestamps and permissions. It is
  off by default.
- Transfers run in chunks and report progress. A cancelled transfer stops
  cleanly and leaves no temp file behind.
- Local and remote overwrites are confirmed by the user locally; just call the
  tool.

## Manage remote files

- Read-only inspection: ssh_list_dir for a directory listing, ssh_stat for
  metadata, ssh_read_file for text contents.
- Mutating: ssh_write_file, ssh_mkdir, ssh_rename, ssh_remove. Each is gated by
  local-user confirmation; call it and let the gate run. Never assume success
  without reading the result.
- Large ssh_read_file or ssh_run output may be truncated; the result tells you
  so.

## Local commands to tell the user about

For anything you cannot do with the tools, guide the user to these local
commands:

- /ssh-connect [name] - connect to a saved connection (new ones are created in /ssh-cm).
- /ssh-cm - manage saved connections (add / edit / delete).
- /ssh-auto-accept-session-on / -off - toggle trusting new host keys without a prompt.
- /ssh-status - show the connection status.
- /ssh-select [id] - set the active session for local commands.
- /ssh-shell - open the full-screen interactive terminal.
- /ssh-close-shell <id>, /ssh-interrupt <id> - manage a local shell.
- /ssh-upload, /ssh-download - transfer, with optional --preserve.
- /ssh-rename - rename a remote path after confirmation.
- /ssh-connections - list saved connection names.
- /ssh-disconnect [id] - close a session.
- /ssh-help - the workflow reference.

## Edge cases

- No active session: call ssh_connect(<name>) for a saved server, or ask the
  user to run /ssh-connect then ssh_status. Do not attempt to connect with
  credentials.
- Session lost or carrier stopped: ssh_status will read Not connected - SSH
  carrier stopped (or another reason). Reconnect with ssh_connect(<name>); it
  spawns a fresh sidecar automatically. Do not retry blindly.
- Truncated output: trust the truncation flag; do not invent the missing bytes.
  The tool tells you when the full version was saved to a local file.
- ssh_connect fails for an unknown name and never creates a connection; ask the
  user to create it locally with /ssh-connect first. In headless mode it fails
  safely - guide the user to /ssh-connect interactively.
- Never request, log, or echo credentials, hosts, ports, or key paths. You
  should not have them; if any appear in output, treat that as a redaction
  failure and do not repeat them.
