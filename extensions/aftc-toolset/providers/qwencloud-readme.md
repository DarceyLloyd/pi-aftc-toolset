# qwencloud.ts

Alibaba Qwen provider feature: registers **Qwen Cloud (DashScope)** and the
**Qwen Coding Plan** as pi providers so both show up in pi's **native
`/login`** and the `Ctrl+L` model picker.

## What it adds

| Provider id | Display name | Where it logs in | Credential |
| --- | --- | --- | --- |
| `qwencloud-plan` | Qwen Coding Plan | `/login` -> Plans (OAuth-shaped token paste) | `sk-sp-…` / `sk-tok-…` subscription token (Lite / Standard / Pro) |
| `qwencloud` | Qwen Cloud (DashScope) | `/login` -> Use an API key, or `$DASHSCOPE_API_KEY` | `sk-…` pay-per-token DashScope key |

Subscription tiers (Lite / Standard / Pro) need no separate handling: same
endpoints, same token formats — the tier only gates which models the account
can actually call server-side.

## Slash commands

| Command | What it does |
| --- | --- |
| `/qwencloud` | Management menu: Status, Refresh model lists, Cloud region/domain, Cloud API format, Plan API format, Plan endpoints, Re-login help. Outside the TUI it prints the status block with the `[aftc-toolset]` prefix. |

Login itself is always pi's `/login`; re-login is pi's `/logout` + `/login`
(the menu's Re-login help screen shows the exact clicks).

## How it works

- **Registration** is synchronous in `createQwenCloud(pi)` at extension load,
  using the on-disk catalog cache when present, else a small built-in seed
  list. The seed exists because pi hides providers with zero models — without
  it there would be nothing to click in `/login` on first run.
- **Live catalogs**: `GET <baseUrl>/models` (5s hard timeout) on
  `session_start`, on `/qwencloud -> Refresh model lists`, and right after a
  Plan login (deferred re-registration via `setImmediate`). The API returns
  only ids, so reasoning / vision / context window / max output are inferred
  from the id (`inferDef` heuristics; safe 128K default, pi auto-compacts on
  overflow).
- **Fallback chain**: live fetch -> cache
  (`.pi-aftc-toolset/data/qwencloud-{plan,cloud}-models.json`, atomic writes)
  -> seed list. A network failure never removes already-registered models and
  never throws — every failure logs with the `[aftc-toolset]` prefix.
- **Credentials are pi-owned.** The module never touches
  `~/.pi/agent/auth.json`; catalog fetches resolve the active key via
  `ctx.modelRegistry.getApiKeyAndHeaders()` (documented), with
  `$DASHSCOPE_API_KEY` as the cloud env fallback.
- **API shapes**: both providers default to `openai-completions`
  (`/compatible-mode/v1`). `/qwencloud` can switch either to
  `anthropic-messages` (`/apps/anthropic`). DeepSeek-served ids are always
  forced to `openai-completions` (Alibaba's Anthropic path hangs for them).
  Reasoning models get `compat.thinkingFormat: "qwen"` and
  `thinkingLevelMap: { off: null }`. Costs are all zero (no reliable pricing
  source); token usage still records.
- **Preferences** (never secrets) live in `config.json` via `config.ts`:
  `qwencloudCloudDomain` (International / China / custom),
  `qwencloudCloudApiFormat`, `qwencloudPlanApiFormat`,
  `qwencloudPlanOpenAI`, `qwencloudPlanAnthropic`. Region/format changes call
  `setPreference` then re-register in place — applied immediately, no reload.

## Events

| Event | Handler |
| --- | --- |
| `session_start` | Best-effort live catalog refresh for every provider with a resolvable credential, then in-place re-registration. |

## Files it owns

| File | Purpose |
| --- | --- |
| `.pi-aftc-toolset/data/qwencloud-plan-models.json` | Plan catalog cache (offline fallback) |
| `.pi-aftc-toolset/data/qwencloud-cloud-models.json` | Cloud catalog cache (offline fallback) |

Both are recreated lazily and wiped on extension update like all runtime
data (by design). Preferences are the `qwencloud*` keys in `config.json`.

## Tests

`tests/qwencloud-check/qwencloud-check.mjs` — pure-mock (stubbed `fetch`,
mock `ExtensionAPI`, temp cache dirs, injected preferences). Covers
heuristics, payload parsing, model builders, registration shape, live
refresh, offline fallback, env-key resolution, the oauth login flow, and
cache resilience. No network, no pi instance, 30s watchdog.
