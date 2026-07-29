# Gradio

## Rules

## Gotchyas

## Issues & Solutions


- [XBeBhU] theme/css/head ignored or error with `Blocks()` in Gradio 6
  Cause: API moved.
  Fix: pass theme/css/head to `launch()`, not `Blocks()`. (2026-07)
- [ccQoQu] gradio_client calls fail validation or use default component values (eg max steps capped)
  Cause: `gr.State` persists per Client session, a fresh session has defaults.
  Fix: service init and generation calls MUST share one `gradio_client.Client`. (2026-07)
- [8aESro] Newly installed item missing from a dropdown when driving via API
  Cause: component choices are built at page load.
  Fix: call the refresh endpoint/button before selecting it. (2026-07)
- [27bL71] Need endpoints, positional params and defaults for gradio_client
  Cause: gradio_client needs the app's endpoint metadata, which only the info endpoint provides.
  Fix: use `GET /gradio_api/info` (named_endpoints); hidden `gr.State` fields (eg task_type) must be set via their change-handler endpoint before the main call. (2026-07)
- [wBzRRf] Force dark theme regardless of user OS setting
  Cause: Gradio follows the user's OS light/dark setting by default and has no direct force-dark option.
  Fix: add a redirect script with `?__theme=dark` via the `head` param. (2026-07)
