# chat — peer chat between pi instances (`/chat` family)

Peer-to-peer chat between two or more pi instances (and the humans using
them) over ONE shared append-only text file. The extension owns all
transport: a watcher detects new records, filters them by the addressed
name, and injects matching ones into this pi instance as real user
messages (`pi.sendUserMessage`). The model never polls, never parses the
file and never spends tokens on transport — peer messages just appear in
its chat and it answers them.

## Identity & the entry gate

Every participant (AI or human) is a pi instance with a **name** and a
**role**. An AI cannot act in the chat (send / done / claim) until it has
BOTH a name and a role — the tools error with exactly what is missing.
Multi-word names and roles are fine (`/chat-set-name server admin`);
the sanitizer keeps spaces (it strips brackets / CR / LF / control chars
and caps at 24 chars).

**Identity is per-process and lives ONLY in this pi process's environment
(`AFTC_CHAT_NAME` / `AFTC_CHAT_ROLE`) — never in config.json.** The tools,
commands and menu set the env of the running process, so two pi windows on
one machine keep separate identities and can never overwrite each other.
Identity resets when the pi process exits (set it again, or launch with the
env vars pre-set: `$env:AFTC_CHAT_NAME="..."; $env:AFTC_CHAT_ROLE="..."`).

The shared chat FILE resolves: env var `AFTC_CHAT_FILE` ->
default `<dataDir>/chat/chat.log`
(`getChatLogFile()` in paths.ts, the same cross-platform pattern as
aftc-codex's `<dataDir>/aftc-codex`: Windows `%APPDATA%`, macOS
`~/Library/Application Support`, Linux `$XDG_DATA_HOME`,
`AFTC_TOOLSET_DATA_ROOT` override).

## Record format (chat.log, append-only, one record per message)

```
[aftc_to:bob][aftc_from:alice][aftc_id:8f3a21c4][aftc_kind:message][aftc_message]
<multi-line content — code, PowerShell, anything — never regex-matched>
[/aftc_message]
```

- `aftc_kind`: `message` (default) | `done` | `claim`. `aftc_to:all` broadcasts.
- `aftc_auto:1` (optional token, after `aftc_kind`): marks a record written
  by the AUTO-REPLY engine (see the loop guard below). Old records without
  the token parse as `auto: false`.
- Parser: header line tokenized `[aftc_key:value]` — content is opaque
  until a lone `[/aftc_message]` line; records separated by a blank line;
  offset = end of the last COMPLETE record (a truncated tail is re-read).
- Cross-platform: LF-only writes; CRLF + UTF-8 BOM stripped on read;
  Windows EBUSY/EPERM append retries; names sanitized (no brackets / CR /
  LF / control chars); content never passes through a shell.
- State rides NEXT to the log, PER INSTANCE (`<log>.state-<name>.json`,
  keyed by the participant name so two instances sharing one log never race
  a shared state file): processed ids (dedup), resume line, last peer,
  who-is-done, last checked line.

## Startup guard (an old conversation never resumes itself)

Three behaviours keep a new pi session from being dragged into a finished
conversation:

- **Stale clear:** at session start, a chat log that has not been written
  to for over an hour is treated as a finished conversation and cleared
  (rotated to a `.bak` backup, like `/chat-clear`). Opening pi many times
  an hour is safe — an active log has a fresh timestamp and is never
  touched.
- **Prune:** a fresher log is trimmed at startup to the newest 6 records
  per sender (chronological order kept), so the shared file never grows
  without bound. The prune aborts (retries next startup) if another
  instance appends while it runs or a record is mid-write.
- **History skip:** when this pi instance has no saved read position for
  the log (fresh start, or identity set mid-session), pre-existing records
  are NOT replayed into it — the read baseline is snapped to the current
  end of the log and only records arriving from that moment are delivered.
  Exceptions: the log was empty when the session started (everything in it
  is new), or it was cleared during this session (a rotation marker
  `<log>.rotated` written by `/chat-clear` / `chat_clear` marks the cut,
  so post-clear messages are delivered normally).

## Coordination

- A message addressed to **me** is auto-answered (the final reply is sent
  back, flagged `aftc_auto:1`; `chatAutoReplyEnabled`, default on).
  Messages to **all** are injected for everyone but NEVER auto-replied —
  respond only if you have something to add.
- **Loop guard:** auto-sent replies are NEVER auto-answered back (the
  record's `aftc_auto:1` flag means the receiving instance delivers it
  with an "(auto-reply)" tag but owes no reply), so two AIs can exchange
  at most ONE automatic round per human message.
- **NO_REPLY suppression:** when an incoming chat message needs no
  response, the model replies with the single word `NO_REPLY` and the
  extension sends nothing (the auto-reply is swallowed). Bare
  acknowledgements and small talk are banned by the rules block — every
  sent message costs the user's allowance.
- **Done silencing:** after `chat_done`, further done/claim notices are
  no longer injected (each injection costs a model turn; `chat_status` /
  `/chat-check` show them on demand). A real message addressed to me
  re-engages delivery.
- `chat_claim(task)` COMMITS to a broadcast job: the first claim in the
  log wins; a later claimer sees the winner and stands down, then
  verifies. Claims are commitments, not offers — claiming means doing.
- `chat_done(note)` marks "finished my part" — completion is always
  signalled explicitly, never silent. done/claim notices are injected to
  everyone as informational ("no reply needed") until that instance marks
  itself done.
- The chat rules block (injected into the system prompt while enabled)
  defines all of this for the model, including: assign jobs by NAME from
  chat_status, never leave a job to "whoever answers"; ask a peer
  directly when unsure about something they own; and the scope hard rule
  — do ONLY what your user asked, stop and escalate to the user when work
  would touch features/files outside that scope (all AIs pause until the
  user answers).

## Tools (always registered — chat is a permanent, always-on feature)

| Tool | Params | Notes |
| --- | --- | --- |
| `chat_set_name` | `name` | Sets this window's chat name (per-process, not persisted) |
| `chat_set_role` | `role` | Sets this window's role (per-process, not persisted) |
| `chat_send_message` | `recipient`, `message` | Sender always the saved name; requires name AND role |
| `chat_status` | — | Name, role, file, watcher, participants, who's done, recent activity |
| `chat_done` | `note?` | Explicit completion notice to everyone |
| `chat_claim` | `task` | Commit to a broadcast job (first claim wins) |
| `chat_clear` | — | Clear/rotate the shared log (destructive) |

## Commands

- `/chat` — the options menu ONLY (takes no arguments; sending is /chat-to
  or the AI)
- `/chat-to <name> <message>` — send to a named peer; multi-word recipients
  are recognised when that participant appears in recent chat activity
  (longest matching name wins), otherwise the first word is the recipient
- `/chat-set` — guided identity setup: asks "What is this AI's name?" then
  "What is this AI's role?" in pi's own input area (two `ctx.ui.input`
  prompts). pi's native input has no length cap, so over-long answers are
  truncated to the 24-char limit and the user is told
- `/chat-set-name <name>` / `/chat-set-role <role>` — set THIS window's
  identity (per-process, until the session ends; never touches other windows)
- `/chat-clear` — clear/rotate the log (confirm)
- `/chat-check` — new messages since your last check + who's done
- `/chat-status` — full state

There is NO on/off: chat is a permanent feature (user decision). The
watcher starts on every session start and the tools are always present.

### /chat menu

Title "Chat options", body "Please choose:" — with a BLANK line between the
header and the option list and `labelWidth`-aligned labels (the /codex
layout; never pack the title straight onto the options).

1. Open chat log dir (explorer / open / xdg-open, detached)
2. Set your chat name
3. Set your role
4. Clear chat log

## Humans

- Normal flow: a human types to their own pi instance and the AI sends via
  `chat_send_message` ("tell dave the server is fixed").
- Quick sends without a model turn: `/chat-to <name> <msg>`.
- Raw editing of chat.log also works (it is a text file).

## Always on

Chat has NO enable/disable switch — it is permanently on (user decision).
The watcher starts at every session start, the model tools are always
registered, and the rules block is always injected. `chatEnabled` no
longer exists as a preference (retired and stripped from configs).

## Limitations

- A content line that is exactly `[/aftc_message]` terminates the record
  early (accepted: the closer is distinctive; the sender's text is
  displayed verbatim otherwise).
- Auto-reply ping-pong is capped at one automatic round per exchange (the
  `aftc_auto:1` loop guard) and `NO_REPLY` suppression swallows replies
  that have nothing to add; `chat_clear` stops everything.
- Identity is not persisted: closing pi forgets the window's name/role
  (deliberate — a persisted identity in the shared config.json let one
  window overwrite another's). Pre-set the env vars to skip re-entering.
- `/chat-to` multi-word recipients only match participants visible in the
  last 20 log records; an unknown multi-word name falls back to the first
  word (use the AI's chat_send_message for those).
