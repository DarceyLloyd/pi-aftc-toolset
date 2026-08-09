# Uv

## Rules

## Gotchyas

- [FSgE0d] uv sync --frozen rejects the lockfile after the project name/version in pyproject.toml changes - run `uv lock` first to regenerate the lock, then sync --frozen is reproducible again.

- [Q9Y2S1] uv add torch from PyPI on Windows resolves the CPU-only wheel (+cpu) - torch.cuda.is_available() is False; a bare [[tool.uv.index]] url entry without explicit=true does NOT bind the package; declare the index with explicit=true plus [tool.uv.sources] torch = { index = "<index-name>" }, then `uv lock --upgrade-package torch && uv sync`, and verify torch.cuda.is_available() and torch.version.cuda before training.

## Issues & Solutions
