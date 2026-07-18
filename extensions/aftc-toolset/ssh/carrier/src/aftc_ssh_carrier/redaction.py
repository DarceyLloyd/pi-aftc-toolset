"""Password / secret redaction utilities.

Used to ensure that passwords never appear in any text returned to the host
or written to logs. Applied to all outputs that may include remote shell
prompts (e.g. SSH password prompts echoed by the remote pty).
"""

from __future__ import annotations

import re


# Patterns that indicate a password / secret prompt line. Matched case-insensitive.
# Anchored at end-of-line so we don't redact legitimate content that happens
# to contain these words.
_PASSWORD_LINE_PATTERNS = [
    re.compile(r"password\s*(?:for\s+\S+)?\s*[:>] ?$", re.IGNORECASE),
    re.compile(r"passphrase\s*[:>] ?$", re.IGNORECASE),
    re.compile(r"verification\s+code\s*[:>] ?$", re.IGNORECASE),
    re.compile(r"otp\s*[:>] ?$", re.IGNORECASE),
    re.compile(r"\bsudo\s+password", re.IGNORECASE),
]

_REDACTION = "[REDACTED]"


def redact_password_lines(text: str) -> str:
    """Redact lines that look like password prompts.

    For each line in `text`, if it ends with a password-prompt pattern, replace
    the line with the redaction marker. Other lines are passed through unchanged.
    """
    if not text:
        return text

    out_lines: list[str] = []
    for line in text.splitlines(keepends=False):
        if any(p.search(line) for p in _PASSWORD_LINE_PATTERNS):
            out_lines.append(_REDACTION)
        else:
            out_lines.append(line)
    return "\n".join(out_lines)


def redact_echoed_secret(text: str, secret: str | None) -> str:
    """Redact an echoed secret from a text string.

    Used when we know a password was typed and want to scrub any accidental
    echo from the scrollback. Returns `text` with all occurrences of `secret`
    replaced by the redaction marker. `secret` may be None (no-op).
    """
    if not text or not secret:
        return text
    return text.replace(secret, _REDACTION)