# subagents/subagent-catalog.ts — readme

Discovery + parsing + resolution of agent profiles (markdown files
with YAML frontmatter).

## Tiers (highest precedence wins, no silent shadowing)

| Tier | Location | Note |
| --- | --- | --- |
| project | `<cwd>/.pi/agents/*.md` | gated until the Phase-3 content-hash approval lands (`includeProject` option) |
| user | `<dataDir>/subagents/agents/*.md` + `<piAgentDir>/agents/*.md` | `PI_CODING_AGENT_DIR` honoured |
| builtin | `<package>/extensions/aftc-toolset/data/subagents/agents/*.md` | pristine seed, never edited |

Discovery skips `README.md` (the user guide) and `_*.md` scratch
files. `enabled: false` hides an agent (unless discovery runs with
`includeDisabled` — the `/007-edit` picker uses it so disabled agents
can be re-enabled from inside pi). `disableDefaultAgents`
hides the whole built-in roster.

## Frontmatter

`parseSubAgentProfileFile()` fills every design-6.1 field with its
default: identity (`name`/`description`/`display_name`), brains
(`model` id/fuzzy/`inherit`/fallback array, `model_tier`, `thinking`),
capabilities (`tools`, `disallowed_tools`, `skills`, `codex`,
`codex_write`), limits (`max_turns`, `timeout_seconds`,
`stall_timeout_seconds`, `stall_detection`, `loop_detection`),
behaviour (`context_files`, `prompt_mode`, `inherit_context`,
`persist_session`, `output_transcript`, `enabled`, `tags`, `extends`).
Later-phase fields (`isolation`, `memory`, `run_in_background`,
`allowed_subagents`, `max_cost_usd`) parse-and-ignore until their
phase ships. Frontmatter is AUTHORITATIVE — tool arguments can never
override it (invariant 8).

## Resolution

`resolveSubAgentProfile(name, profiles)` accepts qualified ids
(`user/explorer`, `builtin/explorer`, `project/explorer`) which reach a
specific tier. Discovery keeps ALL copies (a live `explorer` does not
delete `builtin/explorer` — no silent shadowing); unqualified names
resolve by tier precedence — the discovery list is precedence-ordered,
so the first match is the authoritative one (the seeded live copy over
the pristine package copy). A leading `@` is stripped (some models add
it).
