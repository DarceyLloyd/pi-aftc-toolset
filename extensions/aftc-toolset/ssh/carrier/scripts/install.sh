#!/usr/bin/env bash
# install.sh — bootstrap aftc_ssh_carrier via UV
#
# Creates .venv/, installs locked dependencies, and prints the python path
# the host should spawn. Idempotent: safe to run repeatedly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_DIR}"

if ! command -v uv >/dev/null 2>&1; then
    echo "[install.sh] ERROR: uv is not on PATH." >&2
    echo "  Install it from: https://github.com/astral-sh/uv" >&2
    echo "  Or via Homebrew: brew install uv" >&2
    exit 1
fi

echo "[install.sh] Project dir: ${PROJECT_DIR}"
echo "[install.sh] Syncing dependencies via uv..."

uv sync --frozen 2>/dev/null || uv sync

# Print the python executable the host should spawn.
if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* || "$(uname -s)" == "MSYS"* ]]; then
    PY="${PROJECT_DIR}/.venv/Scripts/python.exe"
else
    PY="${PROJECT_DIR}/.venv/bin/python"
fi

echo "[install.sh] Done. Spawn the daemon via:"
echo "  ${PY} -m aftc_ssh_carrier"
