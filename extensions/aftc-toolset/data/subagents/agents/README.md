Welcome to pi's sub-agent system. A **sub-agent** is a focused helper with
its own fresh context window, its own tools, and its own job. You hand it a
task; it does the work in isolation and hands back a clean result. Your main
conversation stays uncluttered.

This guide shows you how to **create your own sub-agents** and **configure
them correctly**. No prior setup needed.

> **First time? Enable the feature.** Sub-agents ship **disabled** so nothing
> surprises you. Run `/007` and pick option **1 — Enable sub-agents**. It seeds
> your agents folder and switches the feature on. (To turn it off later:
> `/007` → *Disable sub-agents*, or `/007-settings` → Sub-agents → Disabled.)

---

## Your first sub-agent — pick one of three ways

### Way 1: Just ask (easiest)

You don't need to create anything. After enabling the feature, talk to pi
normally:

```
Use reviewer to review this diff.
Use explorer to find every place we read the config file.
Run two reviewers in parallel — one for correctness, one for tests.
```

pi decides which agent to use. The built-ins (`worker`, `planner`,
`researcher`, `reviewer`, `explorer`, `advisor`, `documenter`, `designer` and `tester`) cover most day-to-day work.

### Way 2: Let pi build it for you

Run `/007` → **Create sub-agent...**. You answer a short chain of questions
(what it should do, which tools, which model, any rules) and a sub-agent writes
the whole `.md` for you — frontmatter and prompt body. Confirm, pick Project or
User, done. You never have to type long prompt text in the terminal or know the
field names.

### Way 3: Copy a built-in (most control)

Run `/007-edit explorer` (or `/007-sync` to pull every built-in you don't
have yet) — this copies the built-in `explorer` as an editable `explorer.md`
file in your agents folder. Open it, tweak it, save it. Done.

---

## The 5-minute version: anatomy of a sub-agent

Every sub-agent is one **markdown file** with a small YAML header (the
"frontmatter") and a body (the system prompt). That's it. The filename is the
sub-agent's name.

Here's a complete, working example — save it as `security-auditor.md`:

```markdown
---
description: Security code reviewer
tools: read, grep, find, bash
model: inherit
thinking: high
max_turns: 30
---

You are a security auditor. Review code for vulnerabilities:
- Injection (SQL, command, XSS)
- Auth issues
- Sensitive data exposure

Report findings with file paths, line numbers, severity, and how to fix them.
```

Now ask pi: *"Use security-auditor to review src/auth/."* That's the whole loop.

**Three things to internalise:**

1. **The filename is the name.** `security-auditor.md` → invoked as
   `security-auditor`. Keep it lowercase, use hyphens, no spaces.
2. **The frontmatter sets the rules** (tools, model, limits). The model can
   **never** override these from a tool call — what you write here is locked.
3. **The body is the system prompt** — the sub-agent's personality and
   instructions. Be specific: tell it what to do, what NOT to do, and how to
   format its answer.

---

## Frontmatter — every field explained

All fields are **optional**. Omit one and you get a sensible default.

### Identity

| Field | Default | What it does |
|---|---|---|
| `description` | the filename | One line, shown to pi when it's choosing which agent to use. Make it describe *when* to use it. |
| `display_name` | — | A prettier name for the UI (widget, fleet view). Optional. |

### Brains

| Field | Default | What it does |
|---|---|---|
| `model` | `inherit` (uses your current model) | Which model the sub-agent runs. A full id (`anthropic/claude-sonnet-4-5`), a fuzzy name (`sonnet`, `haiku`), `inherit`, or a **fallback list** `[haiku, sonnet, inherit]` (tries each in order — handy if a provider is down). The model is resolved and validated BEFORE the sub-agent launches, so a run never fails mid-flight on a bad model. |
| `model_tier` | — | Just a hint: `cheap` / `standard` / `premium`. Drives recommendations and the allowance gate. Doesn't pick a provider for you. |
| `thinking` | `inherit` | How hard the model thinks before answering: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Use `low` for fast exploration work, `high` for tricky review. |

### Capabilities (the important safety bit)

| Field | Default | What it does |
|---|---|---|
| `tools` | all built-in tools | A comma list of what the sub-agent can touch: `read, grep, find, ls, bash, write, edit`. Use `none` for nothing, `*` / `all` for everything. **This is your security lever** — a read-only explorer should not have `write` or `edit`. |
| `disallowed_tools` | — | A denylist that wins even if something else grants the tool. E.g. `tools: write, bash` + `disallowed_tools: edit`. |
| `extensions` | `false` | Whether the child loads pi extensions. `false` by default (hermetic). Almost always leave it `false`. |
| `skills` | `false` | `true` to inherit skills from the parent, or a comma list of named skills to preload (`typescript, react`). |

### Limits & safety

| Field | Default | What it does |
|---|---|---|
| `max_turns` | `8` | Max steps before the sub-agent is told to wrap up (it gets a few grace turns, then stops). Raise it for big jobs, lower it to keep costs predictable. |
| `timeout_seconds` | `300` | Hard wall-clock cap. After this, the run is killed. |
| `max_cost_usd` | — | Optional soft cost cap for this sub-agent (enforced between turns). |

### Where & how it runs

| Field | Default | What it does |
|---|---|---|
| `isolation` | — | Set to `worktree` to run in a disposable git worktree (for sub-agents that write code — their changes land on a branch you review, never your working tree). *Ships in a later phase.* |
| `inherit_context` | `false` | `true` to give the sub-agent a **bounded** snapshot of your current conversation. Usually leave `false` — fresh context is the whole point. |
| `run_in_background` | `false` | `true` to run without blocking (you get a receipt, it notifies on completion). *Background mode ships in a later phase.* |
| `prompt_mode` | `replace` | `replace` = the body IS the full system prompt. `append` = the body is added to your main prompt (a "mini-you" that follows the same project rules). |
| `context_files` | `project` | Whether the child sees your `AGENTS.md` / `CLAUDE.md`: `project` (yes) or `none` (no). |
| `codex` | `true` | Whether the sub-agent can consult the **aftc-codex knowledge base** (the toolset's stored conventions and gotchas). When on (and the parent session has codex enabled), the sub-agent gets a read-only `codex_load` tool plus the list of available topics. Set `false` for sub-agents that shouldn't know the codex exists. See "What a sub-agent inherits" below. |
| `codex_write` | `false` | Also let the sub-agent RECORD new lessons into the codex. Off by default — child-written entries tend to be noisy; keep learning in your main session unless you know you want this. |
| `memory` | — | Give the sub-agent a persistent notebook across sessions: `project` (team-shared, committed), `local` (just your machine), `user` (global). Read-only sub-agents automatically get read-only memory. *Ships in a later phase.* |

### Advanced (ignore until you need them)

| Field | What it does |
|---|---|
| `extends` | Inherit another sub-agent's settings + prompt, then override fields. E.g. `extends: explorer` then just add a `skills:` line. Saves duplication. |
| `tags` | Comma labels for grouping in the UI (`read-only, research`). |
| `allowed_subagents` | Lets this sub-agent spawn its own children. **A privilege, not a routing hint** — leave it off unless you really mean it. *Ships in a later phase.* |
| `enabled` | `false` to hide a sub-agent (e.g. disable a built-in you don't want). |

---

## Templates to copy

### Read-only investigator (the most useful starting point)

```markdown
---
description: Find and explain how <X> works in the codebase
tools: read, grep, find, ls, bash
model: inherit
thinking: low
max_turns: 12
---

You are a focused investigator. Find exactly what was asked, cite exact file
paths and line numbers, and return the smallest useful explanation. Do not edit
anything. If you can't find it, say so — don't guess.
```

### Code writer (isolated, safe)

```markdown
---
description: Implement <feature> cleanly with tests
tools: read, grep, edit, write, bash
model: inherit
thinking: medium
max_turns: 40
isolation: worktree
---

You are an implementation sub-agent. Make the requested change in this isolated
worktree, run the tests, and report what you changed and why. If a decision is
risky or unclear, STOP and report it — do not guess.
```

### Specialist with memory

```markdown
---
description: Our team's API design reviewer
tools: read, grep, find
model: inherit
thinking: high
memory: project
tags: review, api
extends: reviewer
---

Review against our API conventions (see your memory folder). Flag breaking
changes, missing versioning, and inconsistent error shapes.
```

---

## How running a sub-agent actually works

You don't "run" sub-agents directly — **pi decides to**. You describe the work
and pi calls the `subagent` tool:

```
Use explorer to map the auth flow, then use planner to plan the refactor.
```

pi will:
- pick the sub-agent(s),
- give each a **fresh context window** (it does NOT see your whole chat — only
  the task and any facts you explicitly pass),
- run them (several at once if the work is independent),
- bring back a bounded result.

**Foreground** (default): pi waits and returns the result inline.
**Background** (`run_in_background: true`): pi starts it, gives you a receipt,
and notifies you when it's done. *Background mode ships in a later phase.*

While work runs, watch the **footer line** and `/007-status`, or open the live
conversation with `/007-fleet`.

The **footer line** is always visible while sub-agents are enabled (toggle in
`/007-settings`), styled like the rest of the footer bar:
`Sub Agents running: 2/4 | Session cost: $0.14 | Agent avg task time: 1m 30s | Agents running: explorer, worker`
— runs active vs max concurrent, this session's total sub-agent cost, the
average time completed tasks took, and the names of the agents running right
now (`—` while none).

---

## What a sub-agent inherits from your toolset

Sub-agents are **hermetic by default**: they get a fresh context window, only
the tools their frontmatter grants, and nothing else from your setup. Your
pi-aftc-toolset features stay with YOUR session — a sub-agent never rings your
audio notifications, never writes to the usage database, never touches the
`/docx` documentation generator, and never gets any menus or overlays.

Two things can be granted deliberately, per sub-agent:

- **aftc-codex knowledge base (`codex: true`, default on).** The sub-agent can
  read your stored conventions and gotchas via a read-only `codex_load` tool —
  it sees the list of topics and can load the ones its task needs. This only
  works while YOUR session has aftc-codex enabled; otherwise there is nothing
  to grant. Set `codex: false` to keep a sub-agent completely unaware of it.
- **Recording lessons (`codex_write: true`, default off).** The sub-agent may
  also write new entries into the codex. Keep this off unless you trust the
  sub-agent's judgement — your main session is the normal place to record
  lessons.

Skills can be granted too (`skills:` field, off by default). Everything else —
SSH, usage report, notifications, themes, shortcuts, `/007` itself — is
never available inside a sub-agent, by design.

---

## Managing sub-agents — the `/007` cheatsheet

| Command | What it does |
|---|---|
| `/007` | Main menu (everything below is reachable from here) |
| `/007-status` | What's running: counts, elapsed time, context-window %, tokens |
| `/007-fleet` | Browse running/recent runs; open a live conversation view |
| `/007-stop [id]` | Stop ONE active run |
| `/007-kill` | Stop one, several, or all active runs (the bulk menu) |
| `/007-new` | Build a sub-agent: answer a few questions, a sub-agent writes the file |
| `/007-edit [name]` | Edit a sub-agent: pick one, flip its On/Off options, or open its file |
| `/007-reset <name>` | Restore a built-in to its shipped default |
| `/007-install` | (Re)seed your agents folder from the shipped built-ins |
| `/007-sync` | Pull improved shipped built-ins into your folder (never overwrites your edits) |
| `/007-open-agent-dir` | Open your agents folder in the file manager |
| `/007-guide` | Read this guide inside pi |
| `/007-preview <name>` | Dry-run: show the resolved model/tools/limits without launching |
| `/007-packs` | Install themed sub-agent packs (web-dev, security, ...) |
| `/007-doctor` | Check everything is set up correctly |
| `/007-settings` | Concurrency, budgets, safety watchdogs, footer line, etc. |

---

## Tips & common mistakes

**Do**
- **Be specific in the body.** "Review for X, Y, Z and report with file:line" beats "review the code".
- **Lock tools down.** An explorer with `write`/`edit` is a footgun. Read-only work → `read, grep, find, ls` (+ `bash` only if it truly needs to run inspection commands).
- **Set `max_turns`.** It's your cost predictability lever. Start at 8-12, raise for big jobs.
- **Use `isolation: worktree` for writers.** Their changes land on a reviewable branch, never your working tree. *(Later phase.)*
- **Name files with hyphens.** `api-reviewer.md`, not `API Reviewer.md`.

**Don't**
- **Don't delegate tiny work.** If pi can do it in one step, a sub-agent is overhead.
- **Don't give a sub-agent your whole conversation** (`inherit_context: true`) unless it genuinely needs the discussion — fresh context is the feature.
- **Don't expect a sub-agent to be a security sandbox.** It runs as you, with your credentials. Tool limits restrict *pi tools*, not OS permissions.
- **Don't name a sub-agent `readme`** — `README.md` in the agents folder is this guide and is skipped. (Files starting with `_` are also skipped, safe for notes/templates.)
- **Don't grant `codex_write` casually.** Every sub-agent that can write to the knowledge base can also clutter it. Read access (`codex: true`) is cheap; write access is a trust decision.

---

## Where things live

| What | Where |
|---|---|
| **Your sub-agents** (the ones you edit) | your live agents folder — run `/007-open-agent-dir` to see it |
| **This guide** | `README.md` in that same folder |
| **Your settings** | `subagents-config.json` in your pi-aftc-toolset data folder (editable; or use `/007-settings`) |
| **Built-ins** (reference) | shipped inside the package — pristine, always available as a fallback |
| **Per-project sub-agents** | `.pi/agents/` in your repo (committed, shared with your team) |

Precedence (highest wins): **project** (`.pi/agents/`) → **your live user
folder** → **built-ins**. A project sub-agent never silently overrides your
personal one — if names collide, use the qualified form (`project/explorer`,
`user/explorer`, `builtin/explorer`).

---

## Beyond the basics

Once you're comfortable:

- **`/007-packs`** — install themed collections (web-dev, data-science, devops, security) so you don't hand-write every specialist.
- **`memory: project`** — give a reviewer a persistent, team-shared notebook so it remembers your conventions across sessions. *(Later phase.)*
- **`extends:`** — build a family of related sub-agents from one base.
- **`/007-settings` → Preset** — Light / Standard / Heavy tunes how many sub-agents run at once for the machine you're on.
- **Background runs + scheduling** — fire a sub-agent on a cron/interval for routine checks. *(Later phase.)*

That's it. Create a file, set the frontmatter, write a clear prompt, and ask pi
to use it. When in doubt, `/007-guide` reopens this page and `/007-doctor`
checks your setup.

---
