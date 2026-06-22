---
name: cache-audit
description: >-
  Audit and optimize prompt-cache performance. Use when the user asks about cache
  optimization, cache hit rates, why a cache miss happened, tool schema costs,
  or cache-first strategy diagnostics.
---

# Cache-First Strategy Audit

Use this skill when the user asks about cache optimization, cache performance,
prompt-cache diagnostics, or when they ask "why did the cache miss?",
"how's my cache hit rate?", or similar questions.

## Overview

This project uses an aggressive cache-first strategy to minimize token costs.
The system-prompt prefix (base prompt + tool schemas + memory files) must stay
byte-stable across turns so the provider's automatic prompt-cache stays warm.

## Steps

### 1. Check Current Cache State

Run the `/cache-stats` command to get the current session's cache diagnostics:

```
/cache-stats
```

This shows:
- Aggregate cache hit rate (the steadier, cost-oriented number)
- Per-turn hit rate (the latest volatile rate)
- Last turn's absolute cache split (N cached / M new)
- Total session cost

### 2. Check Tool Schema Costs

Run `/cache-profile` to see per-tool token costs:

```
/cache-profile
```

This shows which tools are eating the most prefix budget. Large tools (many
parameters, long descriptions) bloat the tool schema and reduce the
cacheable prefix size.

### 3. Diagnose Cache Miss Causes

Cache misses happen for three reasons:

| Reason | Cause | Fix |
|--------|-------|-----|
| **system prompt change** | Something mutated the system prompt mid-session (e.g., adding/removing skills, changing model) | Avoid mid-session system prompt changes. Use turn-tail injection instead. |
| **tools change** | Active tools were added or removed between turns | Keep tool list stable. Toggle plan mode at execution time, not by changing the tool schema. |
| **compaction** | The session was compacted, rewriting the message prefix | Inevitable; compaction is a controlled cache-reset point. The aggregate rate absorbs this. |

### 4. Recommend Improvements

Based on the diagnostics, recommend:
- If tool schema is large (>2000 tokens): suggest disabling unused tools
- If hit rate is low (<30%): check for mid-session tool changes
- If compaction happened recently: note that cache reset is normal and will recover
- If system hash changes mid-session without user action: investigate extensions mutating the prompt

### 5. Validate Cache Guard (CI/CD)

For projects using CI cache guards:
- Check that no PR inadvertently breaks the cacheable prefix
- Verify that system prompt and tool schemas are stable across test runs

## Reference

The cache-first strategy is documented in this package's README.md.
Key principle: never mutate the cache-stable prefix mid-session. Ride the turn
tail instead (steering messages, follow-up messages, memory queue).
