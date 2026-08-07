#!/usr/bin/env bash
# pi usage report — start the local report server.
# Linux/macOS users: chmod +x start.sh once if needed.
cd "$(dirname "$0")"
exec node server.js
