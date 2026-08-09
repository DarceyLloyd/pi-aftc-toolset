# PHP

## Rules

## Gotchyas

- [nR5vK8] missing `use` import passes `php -l` but dies at call time - an unqualified `Foo::bar()` in namespace `X` silently resolves to `X\Foo` with NO error at lint/parse; the "Class not found" only throws when that line actually executes, so a single untested code path (eg a refresh/status endpoint) can be broken in production while everything else works; after adding a new class reference, verify with a runtime smoke of the exact endpoint, not just `php -l`.
- [tY9wQ3] exit/die inside try - finally blocks STILL run when `exit`/`die` is called inside a try block (PHP runs them before terminating); safe to rely on a dispatch-wrapper finally for cleanup (db close, temp files) even on early-exit paths like binary-stream-then-exit actions.

- [zh5DaS] Reloading a page that was reached by POST resubmits the form (duplicate submissions/dupes); countermeasure: Post/Redirect/Get - after successful processing, redirect to a separate confirmation page and render nothing but the redirect from the handler.

## Issues & Solutions


- `[4A061p] Function curl_close() is deprecated since 8.5` - also `curl_share_close()`, `curl_multi_close()`, `imagedestroy()`, `finfo_close()`
  Cause: no-ops since 8.0 (objects self-free).
  Fix: delete the calls (verified on 8.5.8). (2026-07)
- `[OlE5lK] Constant PDO::MYSQL_ATTR_SSL_CA is deprecated since 8.5`
  Cause: 8.5 deprecated all driver-specific constants/methods on base PDO.
  Fix: use the 8.4 driver-subclass constants: `Pdo\Mysql::ATTR_SSL_CA` / `ATTR_SSL_CERT` / `ATTR_SSL_KEY` / `ATTR_USE_BUFFERED_QUERY` (same values, no behavior change). (2026-07)
- `[JZpA1n] Method mysqli::ping() is deprecated since 8.4`
  Cause: reconnect feature removed in 8.2 making ping redundant.
  Fix: check `$con->connect_errno === 0` or issue `SELECT 1` for liveness. (2026-07)
- `[bBCrb2] Implicitly marking parameter $x as nullable is deprecated` (8.4)
  Cause: `function f(string $s = null)`.
  Fix: make it explicit: `?string $s = null`; usually the biggest 8.4+ deprecation count in a codebase. (2026-07)
- [YMILng] Full 8.0 to 8.5 upgrade reference with master deprecation list and MVC audit checklist
  Cause: upgrading 8.0 to 8.5 raises many deprecations that need one master list plus an MVC audit checklist.
  Fix: audit all dynamic property usage, implicit nullable params, and deprecated ini directives; run with `error_reporting(E_ALL)` and fix every deprecation notice. Key areas: `#[\Override]` attribute enforcement, `E_STRICT` constant removal, `get_class()`/`get_parent_class()` without arg, `mysqli_ping` removal. Verified against PHP 8.5.8, php:8.5-apache-bookworm. (2026-07)
- [41cYKg] Windows: winget `PHP.PHP.8.x` installs to `%LOCALAPPDATA%\Microsoft\WinGet\Packages\...` with NO `php.ini`
  Cause: zero extensions load (curl/openssl/mbstring missing, so Composer fails on https/`openssl`) and its PATH entry shadows any other PHP.
  Fix: copy `php.ini-production` to `php.ini`, set `extension_dir = "ext"` and uncomment the needed `extension=` lines (curl, openssl, mbstring, pdo_mysql, gd, intl, zip...), or use a manually-extracted PHP build instead; verify with `php -m`. (2026-07)
- `[AiBBQm] Class http\Exception\InvalidArgumentException not found` (runtime fatal) after removing a composer package/extension
  Cause: a leftover `use Removed\Class;` does NOT error at parse time; the fatal only fires when that class is actually instantiated.
  Fix: after removing ANY dependency, grep the codebase for dangling `use` statements referencing it (found in PDOQueryLib after dropping ext-http; repoint to a real class eg the global `InvalidArgumentException`). (2026-07)
- [qmHEKR] Adding `declare(strict_types=1)` to a legacy codebase: script the insert (right after `<?php`, before `namespace`) then TEST for coercion fallout
  Cause: the classic break is `PDO::lastInsertId()` (returns `string|false`) assigned to an `int`-typed property/param, which throws `TypeError: Cannot assign string to property ... of type int` under strict_types (it coerced silently before).
  Fix: apply an explicit `(int)` cast; audit other PDO string returns (eg `fetchColumn`) against typed targets. (2026-07)
- [n7Bx2T] Null-byte check placed after `trim()` never fires - input with `%00` passes the guard
  Cause: `trim()` with no charlist strips `\0` (its default charlist is `" \t\n\r\0\x0B"`), so by the time `str_contains($s, "\0")` runs the null byte is already gone; the guard is dead code and the sanitized value sails through.
  Fix: run the null-byte rejection BEFORE any `trim()`/sanitizing that strips `\0`, on the raw user input. (2026-07)
- [fR3wQ9] `foreach (($vo->data ?? []) as &$row)` - writes inside the loop are silently LOST (enriched rows never reach the response)
  Cause: foreach over an EXPRESSION iterates a copy of the array; by-ref writes land on the temporary, not on `$vo->data`. `foreach ($vo->data as &$row)` works, but `($vo->data ?? [])` does not.
  Fix: copy to a variable, iterate that, write back: `$rows = $vo->data ?? []; foreach ($rows as &$row) { ... } unset($row); $vo->data = $rows;`. (2026-07)
