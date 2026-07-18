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
| `openai-codex` | `GET https://chatgpt.com/backend-api/wham/usage` | OAuth Bearer token (auto-refreshed) + `ChatGPT-Account-Id`. Usually `rate_limit.primary_window` is 5h and `.secondary_window` is weekly. The display uses `primary_window.limit_window_seconds`; if OpenAI supplies a 7-day primary window with no secondary window, it is shown as Weekly rather than incorrectly labelled 5h. |
| `minimax` | `GET https://www.minimax.io/v1/token_plan/remains` | Bearer subscription key. `model_remains[]` → bucket `model_name == "general"`. Reports REMAINING percent (converted to used) and times in MILLISECONDS. |
| `minimax-cn` | `GET https://www.minimaxi.com/v1/token_plan/remains` | China variant (default is non-China per the feature spec). Same body shape. |
| `zai` | `GET https://api.z.ai/api/monitor/usage/quota/limit` | Bearer ZAI_API_KEY (raw token also accepted). `data.limits[]` → `TOKENS_LIMIT unit 3` (5h) + `unit 6` (weekly), each `percentage` (USED) + `nextResetTime` (epoch MS). `data.level` = lite/pro/max. NB: lives under `/api/monitor/`, NOT the `/api/coding/paas/v4/` chat base. |
| `zai-coding-cn` | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` | China variant (open.bigmodel.cn). Same body shape. |
| `kimi-coding` | `GET https://api.kimi.com/coding/v1/usages` | Bearer kimi-coding API key. `usage{}` = weekly window; `limits[]` → the rolling 5h rate window (`window.duration` 300 × `TIME_UNIT_MINUTE`). Counts are STRINGS (`"66"`); `resetTime` is an ISO-8601 UTC string. Labelled simply "Kimi". Verified 1:1 against the kimi.com usage panel (2026-07-18). |
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
| `session_start` | Capture `ctx.model.provider`, do an initial fetch so line 5 appears before the first prompt. Does NOT start the timer (pi is idle). |
| `session_shutdown` | Stop the periodic timer and clear the active flag. |
| `model_select` | Update provider; force-refresh when it changed. The timer needs no restart — ticks refresh whatever provider is current. |
| `before_agent_start` | Re-capture the selected provider after session restoration and fetch before the first request. Marks the prompt active and starts the 3-minute periodic timer. |
| `agent_start` | Low-level run begin (covers auto-retry / compaction runs that skip `before_agent_start`). Marks active + starts the timer; idempotent, never stacks a second timer. |
| `agent_end` | Re-capture the provider and refresh (throttled to ≤1 fetch / 30s). The timer keeps running — pi may still auto-retry, compact, or continue queued follow-ups. |
| `agent_settled` | Pi is truly idle (no retry / compaction / follow-up left; every run ends here, including Escape aborts and errors). Does one final FORCED fetch so line 5 shows the latest numbers, then stops the timer. The tick also checks `ctx.isIdle()` itself, so a missed `agent_settled` can never leave the timer running. |
| `after_provider_response` | Anthropic-only: reads the unified rate-limit headers from each response (no fetch). No-op for every other provider. |

`refresh()` is best-effort: any error (network, auth, parse, non-200)
is swallowed and the snapshot is CLEARED — line 5 hides while the
endpoint is not giving us the data we expect and returns on the next
successful fetch. Stale numbers are never rendered.

## Auth

Uses `ctx.modelRegistry.getApiKeyForProvider(provider)` to resolve a usable
Bearer token and refresh OAuth credentials. The Codex `accountId` is read
through pi's `readStoredCredential()` API, with a compatibility fallback for
older Pi releases, for the `ChatGPT-Account-Id` header.

## Cancellation & throttling

- Each fetch combines the caller's `ctx.signal` (Escape cancels) with a
  12s hard timeout (`AbortSignal.any`, with a Node <20 fallback).
- Overlapping refreshes collapse into one in-flight fetch.
- Minimum 30s between fetches (the footer's 1Hz ticker repaints, so
  data is always at most ~30s + 1s stale).
- A 3-minute periodic timer keeps line 5 fresh while a response is in
  flight (prompts can run for hours). It only runs while a prompt is
  active — started by `before_agent_start` / `agent_start`, stopped by
  `agent_settled` after a final forced fetch — and only for providers
  with a fetch endpoint. On every tick it also asks pi directly whether
  the agent is still active (`ctx.isIdle()`, captured from the last
  event ctx): if pi is idle — e.g. a completion event was missed — the
  tick does one final forced query and shuts the timer down. The timer
  is unref'd, so it never keeps the process alive, and every start is
  guarded so two timers can never run at once.

## Failure modes

| Failure | Behaviour |
|---|---|
| Unsupported provider | `getAllowance()` → `null` → line 5 hidden; no timer started. |
| No credential for provider | view cleared to `null` → line 5 hidden. |
| Network / timeout / abort | view cleared to `null` → hidden until the next success. |
| Non-200 / unparseable body | view cleared to `null` → hidden until the next success. |
| Missing window in body | that window is `null`; the other is still shown. |
| Both windows null | parse throws → treated as a failure → view cleared → hidden. |

## Normalisation rules (the unit-conversion pitfalls)

- **Codex** `used_percent` is USED directly. **MiniMax**
  `current_*_remaining_percent` is REMAINING → `used = 100 − remaining`.
- **Codex** `reset_after_seconds` / `reset_at` (unix-s) are seconds.
  **MiniMax** `remains_time` / `weekly_remains_time` / `*_end_time` are
  MILLISECONDS → divided by 1000.
- **Kimi** counts (`limit` / `used`) are STRINGS → `Number(...)`; used %
  is computed as `used / limit × 100` (it is not reported directly).
  `resetTime` is an ISO-8601 UTC string → `Date.parse` → epoch ms.
- Percent values are clamped to 0..100 and rounded.

## Where it fits (.dev/dev_guide.md section 1.5 — orchestrator pattern)

```
index.ts (orchestrator)
  ├─→ allowance.ts → createAllowance(pi) → AllowanceProvider
  ├─→ core.ts(pi, recorder, allowance)   → FooterDataProvider.getAllowance()
  └─→ footer-widget.ts(pi, dataProvider) → renders line 5
```

This module never imports `core.ts` or `footer-widget.ts`. The only
cross-module import is the pure `formatAdaptiveDuration` helper, which
`footer-widget.ts` imports to build the themed line.
