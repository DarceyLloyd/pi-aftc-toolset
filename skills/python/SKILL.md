---
name: python
description: Python scripting with uv package manager, stdlib-first, type hints, and error handling. Use when writing or editing .py files, working with uv, pyproject.toml, or venv. Includes Windows pitfalls (multiprocessing spawn safety, cp1252 console), and numeric/audio verification discipline.
---

# Python

## UV Package Manager (REQUIRED)
- Use `uv` for ALL Python project setup: `uv init`, `uv add`, `uv run`
- Never use `pip install` directly - use `uv add <package>`
- Lock dependencies: `uv lock` after adding packages
- Run scripts: `uv run script.py`
- Creating venv: `uv venv` (do NOT commit .venv/ to templates)
- `pyproject.toml` is the single source of truth for dependencies

## UV Quick Reference
- `uv run script.py` - run a script
- `uv run --with requests script.py` - run with an ad-hoc dependency
- `uv add requests` - add a dependency to the project
- `uv init --script foo.py` - create a standalone script with inline metadata
- `uv run python -m ast foo.py >/dev/null` - verify syntax without writing `__pycache__`

## Inline Script Metadata
For standalone scripts, declare deps inline in a `# /// script` block at the top of the file. uv reads it, sets up a venv on demand, and runs the script with the declared deps available.

```python
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests"]
# ///
```

This means a single `.py` file with its declared deps can be `uv run script.py`'d without any surrounding project - useful for throw-away scripts, samples, and CI tooling.

## Build Backend
For pure-Python packages, use `uv_build` in `pyproject.toml`:

```toml
[build-system]
requires = ["uv_build>=0.9.28,<0.10.0"]
build-backend = "uv_build"
```

Faster and more reliable than legacy `setuptools`/`hatchling` for pure-Python projects.

## Stdlib First
- PREFER standard library modules - only add external packages when stdlib can't do the job
- Common stdlib modules: `os`, `sys`, `json`, `csv`, `pathlib`, `argparse`, `hashlib`, `base64`, `sqlite3`, `datetime`, `subprocess`, `shutil`, `tempfile`, `logging`, `urllib`, `http.server`, `xml`, `re`, `collections`, `itertools`, `functools`, `typing`, `dataclasses`
- Only add packages when needed: `requests` (complex HTTP), `Pillow` (images), `pyyaml` (YAML), `qrcode` (QR codes), `rich` (fancy terminal)
- Document WHY each external dependency is needed in README.md

## Script Structure
- Start with `#!/usr/bin/env python3` shebang
- Use `"""docstring"""` at module level describing purpose
- Use `if __name__ == "__main__":` guard - MANDATORY on Windows for any script that (even transitively) starts multiprocessing workers, see below
- Use `argparse` for command-line arguments (not `sys.argv` directly)
- Use type hints on function signatures
- Use `pathlib.Path` instead of `os.path` for file paths
- Return exit codes: `sys.exit(0)` for success, `sys.exit(1)` for failure

## Windows Pitfalls (learned the hard way)
- **Multiprocessing spawn re-runs your script.** On Windows, `multiprocessing` uses spawn: every worker process re-imports the main module. Any script body NOT behind `if __name__ == "__main__":` re-executes in EVERY worker - this includes DataLoader workers, Lightning Fabric, `ProcessPoolExecutor`, and anything built on them. Unguarded consequences seen in production: N python processes at 100% CPU, VRAM ballooning with duplicate model loads, outputs endlessly re-written, the real process deadlocked waiting for workers that are busy re-running the script. Zero real progress for hours. Guard everything; symptom check is `Get-Process python` + GPU/RAM.
- **cp1252 console crashes.** Windows consoles default to cp1252; any emoji/unicode in log output raises UnicodeEncodeError. Reconfigure stdio first thing in entry points: `sys.stdout.reconfigure(encoding="utf-8")` + same for stderr (wrap in try/except for redirected streams).
- **stdout is block-buffered when redirected.** In long-running scripts whose output goes to a log/pipe, prints arrive in rare 4KB chunks. Use `print(..., flush=True)` for progress, or `logging` with an unbuffered handler.
- **DataLoader on Windows:** besides the guard, expect slow worker startup (each re-imports torch etc.); `num_workers=0` is a sane default for IO-cheap datasets to skip the whole problem.

## Numeric / Audio Verification Discipline
- **`soundfile` defaults can silently clip.** `sf.write("x.wav", data, sr)` writes PCM_16 by default - float data beyond +/-1.0 is hard-clipped on write. Scale first, or pass `subtype="FLOAT"`. Always read back and check peak/RMS before claiming a file is correct.
- **RMS != correctness.** Non-silent audio can still be scrambled garbage. Cheap objective diagnostics: spectral flatness (noise ~0.5-1.0 vs tonal music ~0.001-0.3); adjacent-frame cosine similarity of latent/feature sequences (temporal scrambling shows a tell-tale alternating high/near-zero pattern; healthy is uniform).
- **Bisect pipeline defects with saved intermediates.** Dump stage outputs (`np.savez`), then re-run ONE stage under varied configs (CPU fp32 vs GPU bf16 vs fp16). Near-identical outputs exonerate that stage; divergence localizes the bug - far faster than reading all the code.
- **`torch.load`:** default `weights_only=True` for safety; plain dicts of tensors + primitive metadata load fine under it. Use `weights_only=False` only for trusted files with custom objects.
- **Reproduce before fixing.** A deterministic repro (fixed seed + saved inputs) plus a numeric health check beats speculative code reading; confirm the fix by regenerating and re-checking, not by reasoning alone.

## Editing & Bulk Changes
- **Never blind sed/regex-replace Python source.** A comment injected into a parameter list eats the trailing comma and breaks every file at once (12 files broken by one sed in the wild). Make precise targeted edits, then compile-check everything touched: `python -m py_compile file1.py file2.py ...` (fast, no `__pycache__` side effects that matter, catches it immediately).

## Driving Gradio Apps for Tests (gradio_client)
- Discover endpoints + positional params + defaults: `GET http://host:port/gradio_api/info` (`named_endpoints`). Auto-named endpoints look like `/lambda_6`; labels in the dump map to UI controls.
- Call with `Client(url).predict(*args, api_name="/endpoint")`; `handle_file(path)` for file inputs.
- `gr.State` persists per Client session: call the state-setting endpoint first (e.g. a mode switch), then the worker endpoint on the same Client.

## Error Handling
- Use `try/except` for file I/O, network, and external operations
- Never use bare `except:` - always specify exception types
- Use `logging` module instead of `print()` for diagnostics
- Log errors with `logger.error()` to stderr
- Use `FileNotFoundError`, `PermissionError`, `json.JSONDecodeError` specifically

## Safety Rules
- Never use `eval()` or `exec()` on user input
- Validate all file paths before reading/writing
- Use `pathlib.Path.resolve()` to prevent path traversal
- Never store secrets in code - use environment variables
- Hash passwords with `hashlib` + salt, never store plaintext
- Use `subprocess.run()` with `shell=False` (never `shell=True` with user input)

## Testing
- Use `assert` statements for simple validation
- Use `doctest` for embedded tests in docstrings
- Use `unittest` or `pytest` for structured tests
- Smoke test pattern: run script with `--help`, check exit code 0
- Test with sample input files in a `test-data/` directory
- For ML/audio pipelines: RMS/duration checks are necessary but NOT sufficient - add a structural check (see Numeric / Audio Verification) and a human or golden-sample comparison for anything that ships

## Template Integration
- Each template has: `README.md`, `script.py`, `smoke-test.py`, `pyproject.toml` (if deps needed)
- NO `.venv/` in templates - it's in `.gitignore`
- `.python-version` file specifies Python version
- Templates go in `templates/python/<name>/`
