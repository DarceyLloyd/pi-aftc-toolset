# allowance.ts

Subscription **allowance** data module — the source for the footer
widget's **5th line** (5-hour rolling + weekly used % with reset
countdown).

> This readme documents the contract. See `footer-widget.readme.md` for
> how line 5 is rendered, and `types.ts` for the `AllowanceView` /
> `AllowanceProvider` / `AllowanceWindow` interfaces.

---

## What it does

Fetches the subscription allowance windows for the providers that
expose a usable usage endpoint, and exposes a cached snapshot via the
`AllowanceProvider` interface. The orchestrator (`index.ts`) passes the
returned provider into `core.ts`, which re-exposes it on
`FooterDataProvider.getAllowance()` so the footer widget can render line
5 without importing this module.

## Which providers are supported

Verified live against real credentials (2026-07-12):

| Provider id | Endpoint | Notes |
|---|---|---|
| `openai-codex` | `GET https://chatgpt.com/backend-api/wham/usage` | OAuth Bearer token (auto-refreshed) + `ChatGPT-Account-Id`. Body: `rate_limit.primary_window` (5h) + `.secondary_window` (weekly), each `used_percent` + `reset_after_seconds`. |
| `minimax` | `GET https://www.minimax.io/v1/token_plan/remains` | Bearer subscription key. `model_remains[]` → bucket `model_name == "general"`. Reports REMAINING percent (converted to used) and times in MILLISECONDS. |
| `minimax-cn` | `GET https://www.minimaxi.com/v1/token_plan/remains` | China variant (default is non-China per the feature spec). Same body shape. |
| `zai` | `GET https://api.z.ai/api/monitor/usage/quota/limit` | Bearer ZAI_API_KEY (raw token also accepted). `data.limits[]` → `TOKENS_LIMIT unit 3` (5h) + `unit 6` (weekly), each `percentage` (USED) + `nextResetTime` (epoch MS). `data.level` = lite/pro/max. NB: lives under `/api/monitor/`, NOT the `/api/coding/paas/v4/` chat base. |
| `zai-coding-cn` | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` | China variant (open.bigmodel.cn). Same body shape. |
| `anthropic` | _no fetch — reads response headers_ | Claude Pro/Max OAuth subscription. Reads `anthropic-ratelimit-unified-5h-utilization` / `-5h-reset` / `-7d-utilization` / `-7d-reset` from `after_provider_response` (all headers passed through unfiltered). Utilization 0..1 → ×100. **Gated on OAuth credential** — plain API keys never carry these headers → line 5 hidden. |

**Not supported (line 5 hidden):**
- All other providers (google, deepseek, openrouter, bedrock, …).
- Anthropic with a plain **API key** (the unified headers only appear on OAuth
  subscription tokens).

## Public surface

```typescript
export function formatAdaptiveDuration(totalSeconds: number): string;
export function createAllowance(pi: ExtensionAPI): AllowanceProvider;
```

`formatAdaptiveDuration` is pure and unit-tested in
`tests/allowance-check/`. `createAllowance` returns:

```typescript
{ getAllowance(): AllowanceView | null }
```

## Events subscribed

| Event | Why |
|---|---|
| `session_start` | Capture `ctx.model.provider`, do an initial fetch so line 5 appears before the first prompt. |
| `model_select` | Update provider; force-refresh when it changed. |
| `agent_end` | Refresh after each completed prompt (throttled to ≤1 fetch / 30s). |
| `after_provider_response` | Anthropic-only: reads the unified rate-limit headers from each response (no fetch). No-op for every other provider. |

`refresh()` is best-effort: any error (network, auth, parse, non-200)
is swallowed and the last good snapshot is kept (or `null`). Line 5 is
hidden while `null`, so a temporary outage never breaks the footer.

## Auth

Uses pi's `AuthStorage.create()` (→ `~/.pi/agent/auth.json`).
`await auth.getApiKey(provider)` returns a usable Bearer token and
**auto-refreshes OAuth tokens** with file locking, so the Codex access
token is always fresh. The Codex `accountId` is read from
`auth.get("openai-codex")` for the `ChatGPT-Account-Id` header.

## Cancellation & throttling

- Each fetch combines the caller's `ctx.signal` (Escape cancels) with a
  12s hard timeout (`AbortSignal.any`, with a Node <20 fallback).
- Overlapping refreshes collapse into one in-flight fetch.
- Minimum 30s between fetches (the footer's 1Hz ticker repaints, so
  data is always at most ~30s + 1s stale).

## Failure modes

| Failure | Behaviour |
|---|---|
| Unsupported provider | `getAllowance()` → `null` → line 5 hidden. |
| No credential for provider | view cleared to `null` → line 5 hidden. |
| Network / timeout / abort | previous snapshot kept; no throw. |
| Non-200 / unparseable body | previous snapshot kept; logged via `console.log`. |
| Missing window in body | that window is `null`; the other is still shown. |
| Both windows null | `buildAllowanceLine` returns `null` → line 5 hidden. |

## Normalisation rules (the unit-conversion pitfalls)

- **Codex** `used_percent` is USED directly. **MiniMax**
  `current_*_remaining_percent` is REMAINING → `used = 100 − remaining`.
- **Codex** `reset_after_seconds` / `reset_at` (unix-s) are seconds.
  **MiniMax** `remains_time` / `weekly_remains_time` / `*_end_time` are
  MILLISECONDS → divided by 1000.
- Percent values are clamped to 0..100 and rounded.

## Where it fits (rules.md §1.5 — orchestrator pattern)

```
index.ts (orchestrator)
  ├─→ allowance.ts → createAllowance(pi) → AllowanceProvider
  ├─→ core.ts(pi, recorder, allowance)   → FooterDataProvider.getAllowance()
  └─→ footer-widget.ts(pi, dataProvider) → renders line 5
```

This module never imports `core.ts` or `footer-widget.ts`. The only
cross-module import is the pure `formatAdaptiveDuration` helper, which
`footer-widget.ts` imports to build the themed line.
