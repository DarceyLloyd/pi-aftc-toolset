"""Key name -> bytes encoder for interactive shells.

Translates symbolic key names (Enter, Tab, Ctrl+C, ArrowUp, F1, etc.) into
the byte sequences expected by terminal emulators. Used by the interactive
shell mode for send_keys.

Names are case-insensitive and accept several common aliases.
"""

from __future__ import annotations


# Special key sequences (incomplete - covers common cases)
# These are the raw bytes sent to the terminal.
_SPECIAL_KEYS: dict[str, bytes] = {
    # Control characters (Ctrl+A through Ctrl+Z)
    "ctrl+a": b"\x01",
    "ctrl+b": b"\x02",
    "ctrl+c": b"\x03",
    "ctrl+d": b"\x04",
    "ctrl+e": b"\x05",
    "ctrl+f": b"\x06",
    "ctrl+g": b"\x07",
    "ctrl+h": b"\x08",  # Also Backspace on some terminals
    "ctrl+i": b"\x09",  # Also Tab
    "ctrl+j": b"\x0a",  # LF (newline)
    "ctrl+k": b"\x0b",
    "ctrl+l": b"\x0c",
    "ctrl+m": b"\x0d",  # CR
    "ctrl+n": b"\x0e",
    "ctrl+o": b"\x0f",
    "ctrl+p": b"\x10",
    "ctrl+q": b"\x11",
    "ctrl+r": b"\x12",
    "ctrl+s": b"\x13",
    "ctrl+t": b"\x14",
    "ctrl+u": b"\x15",
    "ctrl+v": b"\x16",
    "ctrl+w": b"\x17",
    "ctrl+x": b"\x18",
    "ctrl+y": b"\x19",
    "ctrl+z": b"\x1a",
    # Bracketed paste mode (2004)
    "bracketedpaste_on": b"\x1b[?2004h",
    "bracketedpaste_off": b"\x1b[?2004l",
    # Named special keys
    "enter": b"\r",
    "return": b"\r",
    "cr": b"\r",
    "lf": b"\n",
    "newline": b"\r",
    "tab": b"\t",
    "escape": b"\x1b",
    "esc": b"\x1b",
    "backspace": b"\x7f",
    "bs": b"\x7f",
    "delete": b"\x1b[3~",
    "del": b"\x1b[3~",
    "space": b" ",
    # Arrow keys
    "up": b"\x1b[A",
    "down": b"\x1b[B",
    "right": b"\x1b[C",
    "left": b"\x1b[D",
    "home": b"\x1b[H",
    "end": b"\x1b[F",
    "pageup": b"\x1b[5~",
    "pagedown": b"\x1b[6~",
    "insert": b"\x1b[2~",
    # Function keys
    "f1": b"\x1bOP",
    "f2": b"\x1bOQ",
    "f3": b"\x1bOR",
    "f4": b"\x1bOS",
    "f5": b"\x1b[15~",
    "f6": b"\x1b[17~",
    "f7": b"\x1b[18~",
    "f8": b"\x1b[19~",
    "f9": b"\x1b[20~",
    "f10": b"\x1b[21~",
    "f11": b"\x1b[23~",
    "f12": b"\x1b[24~",
}

# Alternate names (normalize to canonical key)
_ALIASES: dict[str, str] = {
    "arrowup": "up",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "uparrow": "up",
    "downarrow": "down",
    "leftarrow": "left",
    "rightarrow": "right",
    "pgup": "pageup",
    "pgdn": "pagedown",
    "page_up": "pageup",
    "page_down": "pagedown",
    "ins": "insert",
    "home_key": "home",
    "end_key": "end",
}


def encode_key(key: str) -> bytes:
    """Encode a single key name to bytes.

    Accepts:
    - Named keys: 'Enter', 'Tab', 'Ctrl+C', 'F1', 'Up', etc.
    - Literal text: any character or string of characters (returned as UTF-8).
    """
    if not key:
        return b""

    normalized = key.lower().strip()

    # Apply aliases
    normalized = _ALIASES.get(normalized, normalized)

    # Check special keys
    if normalized in _SPECIAL_KEYS:
        return _SPECIAL_KEYS[normalized]

    # Literal text
    return key.encode("utf-8")


def encode_sequence(keys: list) -> bytes:
    """Encode a sequence of keys to bytes.

    Each element can be:
    - A string (key name or literal text)
    - A dict {"text": "..."} (literal text run)
    - A dict {"pace": <ms>} (delay marker; consumed as a small sleep)
    """
    parts: list[bytes] = []
    for k in keys:
        if isinstance(k, dict):
            if "text" in k:
                text = k["text"]
                if not isinstance(text, str):
                    raise ValueError(f"text field must be a string, got {type(text).__name__}")
                parts.append(text.encode("utf-8"))
            elif "pace" in k:
                # Pace-only dict: a no-op for byte assembly. The daemon
                # honours `paceMs` between adjacent keys via the `send_keys`
                # pacing parameter so this stays simple here.
                continue
            else:
                raise ValueError(f"Invalid key element: {k!r}")
        elif isinstance(k, str):
            parts.append(encode_key(k))
        else:
            raise ValueError(f"Invalid key element: {k!r}")
    return b"".join(parts)