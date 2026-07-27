# PHP

- `[4A061p] Function curl_close() is deprecated since 8.5` — also `curl_share_close()`, `curl_multi_close()`, `imagedestroy()`, `finfo_close()`
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
