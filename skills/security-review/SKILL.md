---
name: security-review
description: Security review checklist - threat-model, OWASP Top 10, secrets in diff, dependency hygiene, auth/authz, input validation, sensitive data exposure, misconfiguration. Use when reviewing code that touches user data, auth, or external APIs, or when the user asks for a security audit.
---

# Security Review

**Hard gate:** Security review is non-optional for code that touches user data, auth, credentials, or external APIs. Do not skip.

## 5-phase scan

1. **Scope** - identify the diff being reviewed. Limit to the actual changes; ignore untouched files.
2. **Context** - understand the existing security patterns in the codebase (auth model, sanitization helpers, secret storage, middleware).
3. **Vulnerability assessment** - trace user input to sinks; check auth boundaries, crypto, deserialization, path ops, SSRF, command injection.
4. **False-positive filter** - cross-check each finding against the codebase's specific defenses. Reject low-confidence findings.
5. **Report** - output structured findings (file:line, severity, category, exploit scenario, fix).

## Coverage checklist (OWASP Top 10 + common)

- SQLi / NoSQLi - parameterized queries, ORM, no string concat
- XSS - output encoding, CSP, sanitization on render
- SSRF - URL allowlist, no user-controlled fetches to internal resources
- Command injection - never pass user input to a shell; use execve or library APIs
- Auth bypass / IDOR - verify every request checks ownership / authorization
- Unsafe deserialization - avoid native deserialization of untrusted data
- Path traversal - resolve and verify paths are under expected roots
- Crypto flaws - use vetted libraries, never roll your own; correct algorithm + IV + key length
- Secrets in code / logs / client-side - env vars or secret manager, never in source or logs
- Sensitive data exposure - least-privilege logging, scrub PII
- Template / expression injection - sandboxed templating
- Misconfiguration - debug off in prod, defaults safe, error messages don't leak internals
- Dependency hygiene - known-good versions, lockfile committed, supply-chain integrity

## Findings format

For each finding:

- File:Line - Severity (Critical / High / Medium / Low) - Category
- Description: how the vulnerability manifests
- Exploit scenario: a concrete attack path
- Recommendation: fix with a code snippet or config change

## Severity rubric

- **Critical** - exploitable today by an unauthenticated remote attacker, or loses user data
- **High** - exploitable with limited conditions (authenticated user, specific input)
- **Medium** - bad practice that becomes a vulnerability under specific conditions
- **Low** - defense-in-depth gap; fix opportunistically

## When to invoke

- Touches user data, auth, credentials, sessions, or external APIs
- New dependency with a notable surface area
- Pre-release, on a feature branch, before merge to main
- After a security-relevant library upgrade
- After a CVE announcement against a dependency you use

## Out of scope

- Performance, style, or correctness (use `audit-code` for those)
- A full penetration test (this is code review, not exploitation)
