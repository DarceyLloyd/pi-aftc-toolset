# AFTC Framework (PHP MVC)

## Rules

- [sA3gR7] Never rely on UI hiding for authorization - every privileged endpoint re-checks the caller's role (role-filtered lists plus 403 whenever the target record's role exceeds the caller's), because a discovered endpoint with a passed bearer token must still fail.
- [dR9cV2] Never re-declare `docRoot()` in a controller - it lives on `Core/APIController` (protected); call `$this->docRoot()` and assume it exists.

## Gotchyas

- [BRJB2G] hand-written UPDATE rebinds every column - a controller `UPDATE t SET col=:col` that reads each value as `$data['col'] ?? default` rebinds EVERY column from the body, so a partial PUT (eg a sort-only reorder that swaps one field) silently resets the OMITTED columns to their defaults (wipes the text, flips enabled/flags, etc.); use `updateWhitelisted()` (it builds SET only for keys present in the payload) for partial-safe updates, or send the full row with only the changed field different.

## Issues & Solutions


- `[CR0pvf] QueryVo->insertId` is 0 after `PDOQueryLib::execute()` on an INSERT
  Cause: execute() does not populate insertId.
  Fix: use `PDOQueryLib::insert()` for INSERT statements when you need the new row id. (2026-07)
- [nsPDAq] API controller must stream a binary file (download) instead of JSON
  Cause: every `apiResponseLib` helper (send/success/error/created/notFound/unauthorized/forbidden) echoes the JSON envelope and `exit`s, so it cannot be "skipped".
  Fix: bypass it completely: run validations with the helpers, then `$this->db->close()`, send headers manually, `readfile($path)`, `exit`. (2026-07)
- [RuIcbz] Need a storage path outside the document root
  Cause: `index.php` defines `ROOT` as one level below `$_SERVER['DOCUMENT_ROOT']` (eg /var/www when docroot is /var/www/httpdocs).
  Fix: use `ROOT . '/data/...'` for protected files (never web-accessible) and `$_SERVER['DOCUMENT_ROOT'] . '/data/...'` for public uploads. (2026-07)
- [bhtcq5] Guarding an admin API controller
  Cause: validateAccess sends 401 (not logged in) or 403 (wrong role) and exits, so no per-method checks needed.
  Fix: constructor pattern: `$this->securityHandler->setPageUserAccessTypes(['system admin', 'admin']); if (!$this->securityHandler->validateAccess()) { return; }`. (2026-07)
- [9398iY] Need the logged-in user in a public API endpoint
  Cause: the logged-in user is held in framework static state (`Vars`), so a public endpoint must read it from there.
  Fix: `Vars::$loggedIn` + `(int)(Vars::$jwtVo->data['user_id'] ?? 0)` (user_type is `Vars::$jwtVo->data['user_type']`); return `$this->apiResponseLib->unauthorized()` when not set. (2026-07)
- [0SJjX5] Route path params
  Cause: the framework parses declared `{param:regex}` route segments into `routeData()`.
  Fix: declare `{id:\d+}` in Config/Routes.php and read `(int)($this->routeData()['id'] ?? 0)` in the controller; register as `$router->add(METHOD, path, namespace, class, method)`. (2026-07)
- [GH4fgD] Multipart uploads through the framework
  Cause: nothing framework-specific blocks them: `$_FILES` works as normal in any APIController.
  Fix: normalize `$_FILES['files']` (array vs single) before iterating, validate extension + finfo mime, cap size to php.ini `upload_max_filesize`. (2026-07)
- [p06W9R] Create/update from client JSON
  Cause: client JSON keys must be whitelisted and bound, never interpolated, to avoid SQL injection and mass-assignment.
  Fix: follow the AdminShopModel whitelist pattern: an explicit column list, build SET clauses only for keys present, bind every value (never interpolate client data into SQL). (2026-07)
- [0Q18My] PHP 8.5 deprecations live in the framework (found auditing against PHP 8.5.8)
  Cause: `mysqli::ping()` in Core/Libs/MySqlLib.php isConnected() (use connect_errno check), `curl_close()` in GeoIpCheckLib.php + Services/CurrencyConversionService.php (delete the calls), `PDO::MYSQL_ATTR_SSL_*` in PDOLib.php (use `Pdo\Mysql::ATTR_SSL_*`).
  Fix: full fix plan in docs/aftc-framework-proposed-changes.md. (2026-07)
- `[vSfoAY] JWT::encode(): Implicitly marking parameter $keyId as nullable is deprecated` in Logs/error_log.txt
  Cause: vendor issue: firebase/php-jwt v6.10.1 on PHP 8.4+.
  Fix: bump composer to ^6.11 (explicit nullable types added upstream) and re-test auth flows. (2026-07)
- [VR8mtE] Utils::errorHandler logs EVERYTHING including @-suppressed errors (eg intentional @unlink failures land in the log) and has no E_DEPRECATED channel
  Cause: it never checks the `error_reporting()` mask, so `@`-suppressed errors are logged too.
  Fix: check `error_reporting() & $errno` mask first line when touching it. (2026-07)
- [G3cK5m] A new controller in `Controllers/Api/<X>/<Y>.php` returns 500 `Undefined property: <ControllerClass>::$PDOQueryLib` even though it extends `AFTC\Core\APIController` and you only use `$this->PDOQueryLib->fetch(...)`
  Cause: `$PDOQueryLib` is declared on `AFTC\Core\AFTCModel` (the model base class), NOT on `APIController` (the controller base class). The two hierarchies are independent: `APIController extends CustomApiController` and `AFTCModel` is a sibling of `APIController`. So a controller that extends `APIController` directly never gets `$PDOQueryLib` instantiated.
  Fix: either (a) make the controller extend `AFTCModel` instead of `APIController` (only valid if you do NOT need the auth/response helpers from APIController), (b) add `protected PDOQueryLib $PDOQueryLib;` to `Core/APIController.php` and instantiate it in the APIController constructor, OR (c) reach the DB via `$this->db` (DatabaseLib, already on APIController) and call its query helper. Option (b) is the cleanest for any non-trivial controller; option (a) works for read-only model-style controllers. (2026-07)
- [mH7gB4] Seeding test users from a CLI script inside the container: `PasswordLib::hashPassword()` works fine, but you get `Could not open input file: /var/www/aftc-framework/vendor/autoload.php` when the script is at the repo root, not inside the framework dir
  Cause: `require __DIR__ . '/vendor/autoload.php'` in a script at the REPO root (`website/seed-users.php`) resolves to `website/vendor/autoload.php` which doesn't exist - `vendor/` lives at `website/server/aftc-framework/vendor/`.
  Fix: place the seed script INSIDE the framework dir (eg `server/aftc-framework/seed-users.php`) and reference `__DIR__ . '/vendor/autoload.php'` - or compute the path from the script's location to the autoloader (`require dirname(__DIR__) . '/aftc-framework/vendor/autoload.php'`). Equally robust: always run the seed from the framework dir with `docker exec CONTAINER php /var/www/aftc-framework/seed-users.php` so the script's own path is the framework root. (2026-07)
- [nP9kQ2] JWT auth from a TypeScript SPA: bearer token works in `Authorization: Bearer ...` header but `setSecureCookie()` on the server doesn't auto-attach on subsequent cross-origin requests
  Cause: `Utils::setSecureCookie()` only sets a cookie when the request origin matches the cookie's domain/scope - for a SPA calling an API on a different origin (or port) this is fine, but the SPA also needs to send the token in the `Authorization` header for fetch calls because the cookie alone is unreliable (browsers drop Secure cookies over HTTP in dev, and a long-term vs short-term cookie may be on different paths).
  Fix: SPA stores the returned `token` in `localStorage` AND sends `Authorization: Bearer <token>` on every fetch (mirror the cookie for a guaranteed header path). The server accepts either: read the header in the auth middleware, fall back to the cookie if absent. The dev shortcut: don't rely on cookies for API auth - header is simpler and works for both same-origin and cross-origin. (2026-07)
- [kH4yR2] A model query that REUSES a named placeholder (eg `:cid` appears twice in one statement) returns HTTP 500 with the body `"SQL ERROR: Please check application error logs."` and the log shows `SQLSTATE[HY093]: Invalid parameter number`
  Cause: the framework's `PDOQueryLib::checkPlaceholders()` runs BEFORE execute and FAILS THE WHOLE REQUEST when the count of `:` placeholders in the SQL does not equal the count of binds - a placeholder used N times counts N times (so `SELECT ... WHERE x=:cid ... WHERE y=:cid` with one `:cid` bind = 2 placeholders vs 1 bind = mismatch). Underlying PDO rule still stands too: native prepares cannot reuse a named placeholder at all (HY093). The common author mistake is one subquery/column referenced in two places with a single bind.
  Fix: give every OCCURRENCE its own uniquely-named bind (`:cidt`, `:cidv`, `:uida`, `:uidb`, `:uidc` ...) and pass the same value for each. Helper pattern: when building a list of IN() values or repeated conditions, generate `:key` + letter-suffix per index (0->a, 1->b, 26->ba) so bind names stay `[a-zA-Z_][a-zA-Z0-9_]*` (the regex only matches that, digits break it too). Watch for the silent variant: a genuine PDO error caught inside fetch()/fetchAll() returns a QueryVo with success=false and empty data (no throw), so a caller doing `(int)($vo->data['x'] ?? 0)` silently sees 0 - but the REUSED-placeholder case hard-500s first via checkPlaceholders. (2026-07)
- [mQ8nT4] `Utils::generateUniqueNumber()` returns an INT - passing it to a string-typed parameter under `declare(strict_types=1)` throws `must be of type string, int given` (500) at runtime (eg a verification/reset code path)
  Cause: strict_types never coerces int→string for typed parameters, and the code path only dies when actually executed (lint passes).
  Fix: cast `(string)$code` at every call site that feeds a string-typed parameter. (2026-07)
