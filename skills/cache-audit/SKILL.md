---
name: cache-audit
description: >-
  Audit and optimize prompt-cache performance. Use when the user asks about cache
  optimization, cache hit rates, why a cache miss happened, tool schema costs,
  or cache-first strategy diagnostics.
---

# Cache Audit

Use when the user asks about cache health or why a cache missed.

## Steps

- Run /cache-stats. Note any churn reason in the output - it tells you what changed.
- Run /cache-profile. The top tools by token cost are where prefix bloat lives.
- If neither command explains a sustained low hit rate, look for a recent compaction - it resets the cache, recovery is normal.

## Recommendations

- Disable unused tools when the schema is bloated. Do not reorder them.
- Never edit the system prompt mid-session. Use steering messages instead.
- For CI, keep the system prompt and tool schemas byte-stable across runs.