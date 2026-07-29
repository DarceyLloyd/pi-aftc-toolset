# Ollama

## Rules

## Gotchyas

## Issues & Solutions

- [oL5mA3] /api/generate returns done:true with an EMPTY response intermittently (same prompt works on retry; worse with longer inputs and with "produce a formatted multi-section document" prompts, which also hit done_reason:"length" mid-structure)
  Cause: model/server flakiness — occasionally zero tokens are emitted for a generation (seen with gemma4:e4b); big structured-output prompts amplify it.
  Fix: prefer several small plain-text single-question calls over one formatted-document prompt (/api/generate is stateless, so each call is a fresh context window anyway); retry once on an empty-string response before treating it as "no content"; and have a forward-progress fallback (eg a one-line placeholder) when every answer comes back empty so one glitchy input can't stall a batch job. Discover installed models with GET /api/tags. (2026-07)

- [oL7nB4] /api/generate returns done_reason:"length" with a COMPLETELY EMPTY response even though eval_count hit the full num_predict budget
  Cause: thinking-capable models (eg gemma4) spend tokens on HIDDEN reasoning first; with a modest num_predict the entire budget is consumed by that hidden thinking and no visible answer is ever emitted.
  Fix: pass "think": false in the /api/generate body for utility completions (summarising, extraction) where the chain-of-thought is unwanted — responses then end with done_reason:"stop" and real text. Alternative: raise num_predict enough to cover hidden thinking + answer. (2026-07)
