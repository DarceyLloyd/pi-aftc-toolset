# Python

## Rules

- [rP4mX8] Always build Python applications relative-path-only - launchers, configs and scripts must resolve everything from their own location (script dir, __file__, %~dp0, $PSScriptRoot), never hardcoded absolute paths, so the project folder keeps working when moved between drives/machines; use absolute paths only where project documentation or the user explicitly states otherwise.

- [6HvM68] To find which import emits a FutureWarning/DeprecationWarning at startup, import candidate modules one at a time under warnings.catch_warnings(record=True) instead of guessing from log order.

- [0RRiPx] For very large directory trees, dump every path once with os.scandir (no per-entry stat calls) into a plain text file, then re-read the dump for all analysis and planning - recursive scans of hundreds of thousands of files (du, find, os.walk with stats) are far slower, and repeated scans waste time.

## Gotchyas

- [q2F1UY] argparse options with nargs='*' or action='append' yield lists (often default []), so passing such a value straight to logging.setLevel raises 'Level not an integer or a valid string' - normalize to a scalar level before use.

- [awlqBF] Deeply nested directory trees hit RecursionError - raise sys.setrecursionlimit or walk iteratively with an explicit stack.

- [kv9k6Y] str.rpartition(sep) returns ('', '', s) when sep is absent (unlike partition's (s, '', '')) - splitting extensions with rpartition gives an EMPTY stem for extension-less names, so collision naming yields " (1)" instead of "name (1)"; use os.path.splitext for stem/extension splits.

- [egIWMk] Multiple python procs at 100% CPU, work duplicated, zero training progress
  Cause: Windows multiprocessing spawn re-imports and re-runs the whole script per worker (DataLoader, Lightning Fabric).
  Fix: wrap the body of any script that reaches DataLoader workers in `if __name__ == "__main__":`. (2026-07)
- [CRoWpC] Windows console crashes on unicode output
  Cause: default stdio is cp1252.
  Fix: reconfigure stdout/stderr to UTF-8 at the entry point before any logging/printing. (2026-07)
- `[t0JcFX] uv sync` creates venv from a system Python instead of the project one
  Cause: `UV_PYTHON_INSTALL_DIR` not set.
  Fix: set it into the project folder and verify `.venv/pyvenv.cfg` `home` afterwards. (2026-07)
- [AyGa3V] pydantic v2 errors on `root_validator`
  Cause: V1 API removed.
  Fix: replace with `model_validator`. (2026-07)
- [S0nZlE] Bulk sed/regex replace on Python source silently broke 12 files
  Cause: a parameter-list comma was absorbed into an injected comment.
  Fix: make precise targeted edits, then `py_compile` every file touched. (2026-07)

- [Tg4al5] Prints arrive in rare 4KB chunks when output is redirected to a log/pipe
  Cause: stdout is block-buffered when not a TTY.
  Fix: use `print(..., flush=True)` for progress or a `logging` unbuffered handler. (2026-07)
- `[3d9uWf] sf.write("x.wav", data, sr)` silently clips float audio beyond +/-1.0
  Cause: soundfile writes PCM_16 by default.
  Fix: scale first or pass `subtype="FLOAT"`; always read back and check peak/RMS before claiming a file correct. (2026-07)
- [ByZJ99] Audio scrambled but RMS normal
  Cause: RMS only proves non-silence.
  Fix: check spectral flatness (noise ~0.5-1.0 vs tonal music ~0.001-0.3) and adjacent-frame cosine similarity of latent/feature sequences (healthy is uniform; temporal scrambling shows alternating high/near-zero). (2026-07)
- [pw27rR] Localizing a pipeline defect is slow by code reading
  Cause: a numeric pipeline defect is not visible by reading the code alone.
  Fix: bisect numerically: dump stage outputs (`np.savez`), re-run ONE stage under varied configs (CPU fp32 vs GPU bf16 vs fp16); near-identical outputs exonerate the stage, divergence localizes the bug. (2026-07)
- `[pclerw] torch.load` untrusted file risk
  Cause: default `weights_only=True` blocks arbitrary objects; plain dicts of tensors + primitive metadata load fine.
  Fix: use `weights_only=False` only for trusted files with custom objects. (2026-07)
- [ZsaBFi] DataLoader workers slow to start on Windows
  Cause: each re-imports torch etc.
  Fix: `num_workers=0` is a sane default for IO-cheap datasets to skip the whole problem. (2026-07)
- [TPSMYV] Standalone .py needs deps without a project
  Cause: a standalone script has no project venv to declare its dependencies in.
  Fix: declare them in an inline `# /// script` metadata block (`requires-python`, `dependencies`) at the top of the file, then `uv run script.py` sets up the venv on demand. (2026-07)
- `[yHcdii] did not find executable at '<OLD>\python\cpython-...\python.exe'` after moving a uv project folder
  Cause: a uv venv is NOT relocatable: `.venv/pyvenv.cfg` stores the ABSOLUTE managed-Python path in `home =` and the editable install writes the absolute project path into `_editable_impl_*.pth`, both stale after a move.
  Fix: regenerate the venv at the new location with `UV_PYTHON_INSTALL_DIR=<root>\python uv sync --frozen` (offline from cache); for true portability make launchers self-heal by reading `pyvenv.cfg` `home` and re-syncing when `home\python.exe` is missing. (2026-07)
- `[bEb6Pu] error: failed to remove directory `<root>\.venv\Lib`: Access is denied. (os error 5)` on `uv sync` venv regeneration
  Cause: a running process from that venv (e.g. a dev server launched from `.venv\Scripts\python.exe`) locks the folder.
  Fix: stop every process using the venv first, then re-run. (2026-07)
- `[963aBj] ImportError: cannot import name 'amp' from partially initialized module 'torch'` (circular import) when running the portable `python\cpython-*\python.exe` directly with `PYTHONPATH=.venv\Lib\site-packages`
  Cause: torch needs a properly activated venv/site environment, not a raw PYTHONPATH bolt-on.
  Fix: don't bypass the venv for torch; fix the venv itself (regenerate pyvenv.cfg) instead of the PYTHONPATH hack. (2026-07)
- [gyecHQ] FastAPI/Starlette `h11 LocalProtocolError: Too much data for declared Content-Length` only when a REAL browser loads the page (httpx/requests tests pass clean)
  Cause: two distinct causes, same misleading error: (1) `@app.middleware("http")` (BaseHTTPMiddleware) re-buffers/re-streams the response body via `call_next`, corrupting `FileResponse`/`StaticFiles` streams; (2) `JSONResponse({}, status_code=204)` renders a 2-byte `{}` body for a 204 No Content (e.g. a `/favicon.ico` endpoint browsers auto-request).
  Fix: (1) replace with a PURE ASGI middleware that only edits headers on the `http.response.start` message (`MutableHeaders(scope=message)["Cache-Control"]=...`) and passes the body stream through untouched; (2) a 204 must carry NO body, use `Response(status_code=204)`. (2026-07)

- [a0rIfg] ImportError at startup: numba needs NumPy X or less, got newer NumPy
  Cause: numba pins numpy below the installed numpy series, and the plugin importing numba fails entirely.
  Fix: upgrade numba to a release supporting the current numpy series; pip may auto-downgrade numpy to satisfy the pin - afterwards verify torch/C-extension consumers still work with the downgraded numpy. (2026-08)
