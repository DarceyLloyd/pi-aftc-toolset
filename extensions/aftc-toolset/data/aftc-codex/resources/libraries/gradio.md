# Gradio

## Rules

## Gotchyas

- [3lyaui] Inserting a new component into an api_name endpoint's inputs list shifts the positional parameter order for gradio_client/curl callers - existing clients silently pass wrong values; update the API docs table, examples and E2E tests in the same commit as the UI change.

- [Jn4E6y] gradio_client rejects a plain list-of-rows for a Dataframe input (pydantic DataframeData validation error) - pass the {"headers": [...], "data": [[...]]} dict (exactly what a Dataframe OUTPUT returns, so feeding one endpoint's table into another works as-is).

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

- [srDuKr] Native Save-As file dialog hangs/crashes when invoked from a Gradio (web server) worker thread
  Cause: tkinter must run on the main thread; calling it from a Gradio worker thread deadlocks or crashes, and heavy top-level imports make the child process slow to start.
  Fix: spawn the dialog as a child process (python helper.py --dialog ...) that prints the chosen path to stdout; keep numpy/soundfile-style imports lazy inside functions so the dialog child starts fast; support an env-var override that skips the dialog so automated E2E tests can drive the endpoint headlessly. (2026-08)
