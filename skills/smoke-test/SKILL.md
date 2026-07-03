---
name: smoke-test
description: Post-deploy health-check against a live URL or running service. Validates HTTP status, response content, and critical endpoints. Use after a deploy, after a restart, or when verifying that a service is up and healthy.
---

# Smoke Test

>
> **HARD GATE** - A failed smoke test means the deployment is broken. Do NOT mark a deploy as successful until all smoke checks pass.

Validate a deployed application is healthy by running a configurable set of HTTP checks against live URLs. Each check asserts:
- HTTP status code (e.g., 200 for success, 404 for expected-not-found)
- Response body content signal (regex or jq expression)
- Response time threshold (optional)

Can be run standalone for quick health checks or chained as the final step of the `deploy` skill.

## Configuration

Smoke checks are defined in `smoke-checks.yaml` at the project root:

Checks can also be specified inline via environment variables or CLI arguments for ad-hoc use.

### Check Schema

- Field / Required / Default / Description
  - `name` - Yes / - / Human-readable check name (used in report)
  - `path` - Yes / `/` / URL path relative to base_url
  - `method` - No / `GET` / HTTP method
  - `expected_status` - No / `200` / Expected HTTP status code
  - `content_signal` - No / - / Regex or string to find in response body
  - `max_response_time_ms` - No / - / Fail if response slower than this threshold (ms)

## Process

### 1. Load smoke checks

### 2. Run each check

For each check in the configuration, perform an HTTP request:

### 3. Assert results

### 4. Generate report

## Integration with deploy skill

```bash
# In deploy workflow - after successful deploy
DEPLOY_URL="$DEPLOY_URL" bash scripts/run-smoke.sh
```
