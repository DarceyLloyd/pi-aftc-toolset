# 4 - Project website & feedback (dev.aftc.uk/)

The public web presence for pi-aftc-toolset: the landing page shell and
the PHP feedback app that the startup intro (1.5.13) and the root README
link to.

<!-- last-reviewed: 2026-08-09 22:30 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## Purpose

Owns `dev.aftc.uk/httpdocs/pi-aftc-toolset/` — the deployable web root of
`https://dev.aftc.uk/pi-aftc-toolset/`. Owns the feedback form contract
(fields, validation, storage, email). Does NOT own any extension code (1),
the intro that links here (1.5.13), or deployment infrastructure (no
pipeline exists — files are uploaded to the host manually).

Depended on by: nothing in the package at runtime — the intro (1.5.13) and
README only carry the URL as text.

## Contents

| File | What it is |
| --- | --- |
| `index.html` | AFTC LTD landing page shell: intro overlay letter, a `renderer-info` div for a Three.js WebGPU scene, site footer, Google tag (gtag.js). Its `includes/` assets (css/js/three/gsap, referenced via importmap) are NOT in the repo — the page is only partially mirrored here. |
| `feedback/index.php` | The feedback form + submission handler (below). |
| `feedback/confirm.php` | Thank-you landing page after a successful submit (Post/Redirect/Get target); GitHub-dark styled, self-contained CSS. |
| `feedback/pi-aftc-toolset-feedback.json` | Stale duplicate of the store (an empty array); the LIVE store is resolved one level above the web root (below). |
| `feedback/error.log` | PHP runtime error log artifact from the deployed host. |
| `codex-skill-recorder/` | Stealth ingestion API for codex entry submissions (curation inbox for future releases): `index.php` (the whole endpoint) + `README.md`. Valid JSON POSTs append to `codex-resources.json` in the SAME storage location the feedback app uses (one level above the web root); every other request gets a blank 200. No web page. |
| `pi-aftc-toolset-feedback.json` | Second stale store copy sitting next to `index.html` (also an empty array); not the path the script writes to. |

## Public API & contracts (codex-skill-recorder)

Write-only stealth endpoint, `POST index.php` with `Content-Type:
application/json`: body = `{resource, location, entry, cause?, fix?,
email?}`. `resource` shape `\.\name.md` / `\.\resources\cat\name.md` /
`\.\resources\cat\sub\name.md` (nested topics, eg `ui-ux/web/web-app.md`;
forward or back slashes, up to 4 segments); `location` =
`rules` / `gotchyas` / `issues & solutions` (case-insensitive, normalised);
`entry` ≥ 3 words ≤ 4000 chars; `cause` + `fix` required when location is
Issues, ≤ 2000 chars; `email` optional valid. A valid submission appends
`{date, ip, email, resource, location, entry, cause, fix}` to
`codex-resources.json` (resolved one level above the web root, same as the
feedback store) and answers `{"ok":true}`. EVERY wrong usage — non-POST,
non-JSON content type, malformed JSON, unknown field, bad type/length,
validation failure, rate-limit hit, store problem — gets HTTP 200 with an
EMPTY body: no error text, no redirect, no hints. Hardening: optional
`ACCESS_TOKEN` bearer (empty = disabled), 64 KB body cap, 30 posts/IP/24 h
rate limit (per-IP counter file next to the store), 20 MB store cap, locked
atomic read-modify-write, corrupt store never clobbered, `display_errors`
off + `X-Powered-By` removed. No email is sent on submission. Curation:
read the JSON store, import accepted entries with the codex entry tools
(`codex_add_entry` / `codex_edit_entry`).

## Public API & contracts (feedback/index.php)

Browser-facing form, `POST` to itself. Fields:

| Field | Required | Validation |
| --- | --- | --- |
| `rating` | yes | integer 1–5 (star rating) |
| `email` | no | `FILTER_VALIDATE_EMAIL` when non-empty; used as the email's `Reply-To` header |
| `message` | yes | non-empty, minimum 3 words (`preg_match_all('/\S+/u')`) |

Validation errors re-render the form with the old input repopulated. On
success the browser is redirected to `confirm.php` (PRG — reloading never
re-submits). Every failure (email down, storage unwritable) is written to
PHP's error log ONLY — the visitor always sees the thank-you page.

## Internal architecture & data flow

Plain PHP 8 (`declare(strict_types=1)`), no framework, no dependencies
beyond cURL. One submission does two things:

1. **Email** — POSTs to the SMTP2GO API (`https://api.smtp2go.com/v3/email/send`,
   `X-Smtp2go-Api-Key` header, 30 s timeout) from `feedback@dev.aftc.uk`
   (must be a verified sender in the SMTP2GO account) to the maintainer's
   inbox; subject `PI AFTC Toolset - Feedback received <ymd Hi>`. Success
   requires `data.succeeded === 1 && data.failed === 0`.
2. **Storage** — appends a record
   `{date, ip, rating, email, message}` to
   `pi-aftc-toolset-feedback.json`, resolved as
   `realpath($_SERVER['DOCUMENT_ROOT'] . '/../')` so the store sits OUTSIDE
   the web root no matter which folder the script lives in (created with
   `mkdir 0755` when missing; existing records are read, appended and
   re-written as a JSON array).

## Configuration

All in `feedback/index.php` constants at the top of the file: the recipient
address, the SMTP2GO API key and URL, the sender address. The API key lives
in source — never copy it into docs, logs or the codex.

## Setup, seeding & first run

No build. Upload `httpdocs/pi-aftc-toolset/` to the host's web root, ensure
PHP 8 + cURL, populate the SMTP2GO key. The JSON store self-creates on the
first submission.

## Testing

Tests live in `tests/` (gitignored - not committed); how to run them is in AGENTS.md.

## Operational notes & known limitations

- `index.html`'s `includes/` assets are absent from the repo — the landing
  page cannot be served from this checkout alone.
- `codex-resources.json` (the codex-skill-recorder store) resolves OUTSIDE
  the web root in production — never inside it; a local built-in-server test
  writes it one level above the server's docroot instead.
- `feedback/pi-aftc-toolset-feedback.json` (inside the web root) is a stale
  empty duplicate; the live store is the one resolved above the web root.
- `feedback/error.log` is a deployed-host artifact, not source.
- The visitor never sees an error state — a broken SMTP2GO key silently
  degrades to log-only (check `error.log` when feedback "stops arriving").
  The codex recorder is deliberately stricter by design: it answers blank
  to everything except a fully valid submission (see its README).

## Related

- Linked from: [1.5.13_intros.md](./1_extension_source/1.5_feature_modules/1.5.13_intros.md)
  (startup feedback line) and the root README.
- Master section: [project_documentation.md](./project_documentation.md) ID 4.
