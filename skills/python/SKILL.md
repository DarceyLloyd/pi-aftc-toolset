---
name: python
description: Python scripting with uv package manager, stdlib-first, type hints, and error handling. Use when writing or editing .py files, working with uv, pyproject.toml, or venv.
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

This means a single `.py` file with its declared deps can be `uv run script.py`’d without any surrounding project - useful for throw-away scripts, samples, and CI tooling.

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
- Use `if __name__ == "__main__":` guard
- Use `argparse` for command-line arguments (not `sys.argv` directly)
- Use type hints on function signatures
- Use `pathlib.Path` instead of `os.path` for file paths
- Return exit codes: `sys.exit(0)` for success, `sys.exit(1)` for failure

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

## Template Integration
- Each template has: `README.md`, `script.py`, `smoke-test.py`, `pyproject.toml` (if deps needed)
- NO `.venv/` in templates - it's in `.gitignore`
- `.python-version` file specifies Python version
- Templates go in `templates/python/<name>/`
