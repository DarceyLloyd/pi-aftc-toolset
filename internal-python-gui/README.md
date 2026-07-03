# AFTC SSH GUI (Python Port)

A Python-based SSH terminal GUI that monitors a `std/` folder for file-based IPC communication, matching the layout of the HTML mockup.

## Architecture

- **PyQt6 GUI** - terminal output, command input, connection form, status bar
- **PowerShell subprocess** - runs `ssh` commands via stdin/stdout pipes (no window)
- **Flask API** - listens on `http://127.0.0.85:8564` for external command injection
- **File IPC** - monitors `std/in.txt`, `std/out.txt`, `std/err.txt`

## Dependencies (locked via uv)

| Package | Version |
|---------|---------|
| PyQt6 | 6.11.0 |
| Flask | 3.1.3 |

## Quick Start

```bash
cd internal-python-gui
uv run python main.py
```

That's it. uv handles the virtual environment automatically.

## Layout

```
┌─────────────────────────────────────────────────┐
│  Terminal output (dark #151515 background)      │
│  ANSI colors rendered as HTML                   │
│  Scrollable, read-only                          │
├─────────────────────────────────────────────────┤
│  > [command input - #111122 background]         │
├─────────────────────────────────────────────────┤
│  Connect to [host] Password [pass] [CONNECT]    │
│  (#242424 background)                           │
├─────────────────────────────────────────────────┤
│  STATUS: DISCONNECTED Server: 127.0.0.85:8564   │
│  (#191919 background)                           │
└─────────────────────────────────────────────────┘
```

## API

Send commands externally:

```bash
curl -X POST http://127.0.0.85:8564/api/v1/send \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la"}'
```

## File IPC

| File | Purpose |
|------|---------|
| `std/in.txt` | Commands sent (append log) |
| `std/out.txt` | stdout stream (real-time append) |
| `std/err.txt` | stderr stream (real-time append) |
