---
name: bash
description: Bash shell scripting conventions, shebang, error handling, and quoting. Use when writing or editing .sh files, scripts with #!/bin/bash or #!/usr/bin/env bash, or shell automation tasks.
---

# Bash

- Use `#!/usr/bin/env bash` shebang.
- `set -euo pipefail` at top of scripts.
- Quote all variable expansions: `"$var"`.
- Use `[[` over `[` for tests.
- Prefer `$(command)` over backticks.
- Use functions for reusable logic.
