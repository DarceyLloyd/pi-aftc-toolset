# Bash

## Rules

## Gotchyas

- [gL4sD7] `for f in $(grep -rl ...)` - unquoted command substitution in a for-loop word-splits on EVERY whitespace, so a path containing a space (eg `Admin Frontend/src/x.ts`) arrives as two broken paths (`Admin`, `Frontend/src/x.ts`) and every sed/mv fails `No such file or directory`; pipe into a while loop instead: `grep -rl PATTERN dirs... | while IFS= read -r f; do ... "$f"; done`.
- [mS4dF6] sed -i 's/a/b/' for multi-line or complex code edits - sed matches are global and context-blind (it rewrites inside strings, comments and every occurrence, and a pattern that partially matches can splice broken code with NO error); keep sed for simple single-purpose replacements and verify the result by reading the file - never trust a complex sed edit blind.

- [cFmLiD] Recursive grep/find across a huge tree (site-packages, node_modules, a whole monorepo) can run for minutes and look like a hang - scope searches to the smallest directory that can contain the target, add --include/--exclude filters, and cap commands with timeout; when in doubt, list candidate dirs first and grep each one separately.

- [i4iUAP] git-bash/MSYS on Windows silently rewrites leading-slash arguments AND `-e VAR=/abs/path` values into install-relative Windows paths (`/opt/x` becomes `<git-root>/opt/x`), breaking docker exec targets and container env vars; set `MSYS_NO_PATHCONV=1` for the command (or use a `//` prefix, or wrap the remote command in `sh -c`).

- [sRhSOw] In git-bash (MSYS) on Windows, a `>nul` redirect creates a real file named 'nul' - the null device name is only special to cmd/PowerShell; the stray file breaks `git add -A` ('unable to index file nul') and trips the no-NUL-files rule. Use `>/dev/null` in bash and reserve `>nul` for cmd/batch scripts.

- [ycyrIv] N=$(grep -c pattern file || echo 0)` yields '0\n0' when there are no matches — grep -c PRINTS 0 AND exits non-zero, so the `|| echo 0` fallback appends a second 0 and any `[ "$N" -gt 0 ]` or arithmetic on N dies with 'integer expression expected'; grep -c already prints 0, so use plain `N=$(grep -c ...)` and handle the exit status separately (`|| true`), never a value-substituting fallback.

- [Dw7zNj] Shell scripts saved with Windows (CRLF) line endings fail under bash on macOS/Linux — bash keeps the trailing \r inside each token (`set -euo pipefail\r` becomes `pipefail\r: invalid option`), dying with a misleading 'command not found'; write scripts with LF endings, and verify with a byte count of 0x0D (a grep for \r can misread it) rather than trusting the editor.

## Issues & Solutions


- [hQ7nW3] A large inline bash command (a few KB+, eg a multi-heredoc blob) stops part-way with `warning: here-document ... delimited by end-of-file (wanted 'EOF')` - blocks BEFORE the cut ran, everything AFTER silently did not (files half-written, the trailing sync/verify never ran), with NO error on the parts that ran
  Cause: the agent's bash tool feeds the command to bash via stdin and TRUNCATES inline input beyond a few KB, so bash reads and executes incrementally up to the cut and never receives the closing heredoc delimiter (hence the warning) nor anything after it. The heredoc is not actually missing its `EOF` - the command was cut off before it. Body content, `set -e`, `tee`, and quoting are NOT the cause (small blobs using all of those run fine); size is. In pi this is the core `bash` tool (`dist/core/tools/bash.js`): in its stdin-transport mode it writes the whole command with a single `child.stdin.end(command)` and swallows the write error - which is why the truncation is silent.
  Fix: never send one giant inline bash blob. The cleanest workaround is to write the script to a temp file and run `bash <file>` - the only inline command is then the tiny `bash /tmp/x.sh`, so nothing truncates (this is what a dedicated run-script-style tool does). Otherwise write files with the file tools (no shell parsing or transmission limit) or split the work into several small commands kept well under a couple of KB each, and ALWAYS re-verify the final state (counts / greps) instead of trusting that a multi-block script ran to completion. If you see "here-document delimited by end-of-file", assume the command was truncated and check what actually landed before continuing. (2026-07)
- [pT2vX9] `curl http://127.0.0.81/...` (or any 127.0.0.x where x!=1) from git-bash returns `http 000` / `Failed to connect` / connection refused, while the EXACT same URL works from PowerShell `curl.exe` and `Invoke-RestMethod`
  Cause: the git-bash / MSYS `curl` cannot reach Docker Desktop ports bound to a non-.1 Windows loopback IP (127.0.0.33/55/80/81...) - it reports a connection failure that looks identical to a server being down, so you waste time blaming the container/API. PowerShell's own `curl.exe` and `Invoke-RestMethod` reach those same ports fine (Docker Desktop publishes the port on the host loopback).
  Fix: on Windows, drive HTTP smoke tests against Docker-bound ports from PowerShell (`Invoke-RestMethod`/`curl.exe`), not the bash `curl`. If you MUST use bash, point it at a port on 127.0.0.1 (the one loopback address bash reaches) or add a host alias. The symptom "bash curl 000 but PS works" = the service is up; switch tools, don't keep debugging the server. (2026-07)
- [kM8dR2] `unbound variable` - a heredoc-fed mysql seed/init script dies part-way (the remaining init scripts never run, so the DB is silently HALF-seeded: schema + early seeds present, later seeds/tables missing)
  Cause: `set -euo pipefail` at the top + an UNQUOTED heredoc (`<<SQL`, kept unquoted on purpose so `${VAR}` expands) + a literal `$name`-shaped string inside the SQL body (eg an argon2id hash `$argon2id$v=19$m=65536...`): bash expands it as a variable and `nounset` aborts the script. Without `set -u` the same bug silently expands to an empty string and corrupts the data instead.
  Fix: escape the dollars in the literal (`\$argon2id\$v=19\$...`), or give blocks that need no expansion a quoted heredoc (`<<'SQL'`). After ANY DB reseed, sanity-check row counts before assuming the seed succeeded - a dead-halfway init still starts the server and looks healthy. (2026-07)
- [pR7wM5] git-bash MSYS path translation rewrites unix paths inside tool arguments - `docker cp x CONTAINER:/tmp/x.sh` is rewritten to a Windows temp path (`C:/Users/.../Temp/x.sh`) and the follow-up `docker exec bash /tmp/x.sh` then dies "No such file or directory"; export `MSYS_NO_PATHCONV=1` (or double the leading slash `//tmp//x.sh`) before docker cp/exec commands that carry container paths on git-bash.

- [MVahdj] grep: -P supports only unibyte and UTF-8 locales` - any grep -P (PCRE) call fails in git-bash on Windows even for a valid pattern
  Cause: git-bash's grep build only enables PCRE (-P) under unibyte or UTF-8 locales, and the default MSYS2 locale does not qualify, so every -P invocation dies before matching anything.
  Fix: use grep -oE (ERE) instead and rewrite PCRE-isms as POSIX: \d -> [0-9], \s -> [[:space:]], non-greedy .*? -> a greedy [^"]*/[^ ]* pattern that stops at the delimiter; -E works in every git-bash locale. Alternatively export LC_ALL=C.UTF-8 before the grep -P call to satisfy the locale requirement (verified working). (2026-08)

- [CT1aam] Rows seeded with a timestamp from `date +%s%3N` never appear in date-range queries (FROM_UNIXTIME shows NULL)
  Cause: some date builds (eg busybox) ignore the %N width modifier and print the FULL 9-digit nanoseconds, so date +%s%3N yields a 19-digit value (epoch-ms x 1,000,000) that is out of range for date arithmetic and range filters (FROM_UNIXTIME shows NULL, WHERE timestamp BETWEEN ... matches nothing).
  Fix: before storing an epoch-ms value from date +%s%3N, verify it is 13 digits, or compute it arithmetically: $(( $(date +%s) * 1000 )). Rows already seeded with the huge value never match date-range pulls - re-seed them with corrected timestamps. (2026-08)
