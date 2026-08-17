# MySQL

## Rules

- [jfn4iH] On a shared database instance backing several services, give each service its own DB user capped with MAX_USER_CONNECTIONS N, and keep each schema self-contained (no cross-schema joins or foreign keys) - this isolates connection budgets so one service cannot starve another, and makes lifting a schema to its own instance later a clean migration instead of surgery.

- [dhfuya] Secret-free MySQL healthcheck: use `mysqladmin ping -h 127.0.0.1` with NO password - it exits 0 whenever the server answers (even on auth failure), so no root password ever appears in `docker inspect`.

- [urIJOj] Split DB access by direction: a write-only user for ingest and a SELECT-only user for read/report/pull endpoints (grant each the minimum), keep full-access admin credentials out of the web/container layer, and give each endpoint its own API key.

- [N6PJ5h] A shared database that many client installations both PUSH rows to and PULL rows from needs a per-installation owner column (a device UUID) on every row - session/table-scoped ids collide across machines, so a date-range pull cannot be filtered to one owner without it; tag every row at the source, filter pulls by the owner id, and let legacy rows default to ''.

- [VE8R7u] Restrict the DB root account to localhost/socket-only (MYSQL_ROOT_HOST=localhost): root then cannot authenticate over TCP, so even a leaked root password is inert outside the DB container and the least-privilege per-service users stay the only network access path.

- [H4pPna] When a schema change ships alongside app code that uses the new column, apply the migration (ALTER) BEFORE the code goes live - there is an unavoidable window between the two steps, and any client that never retries silently drops a row that lands in it; watch the app error log right after the deploy to spot window errors.

## Gotchyas

- [qW3zL8] `WHERE col = :param` with a NULL bind - matches NOTHING (NULL never equals NULL), so a filter that must match both a value and NULL (eg parent_id roots-or-children) silently returns only the non-NULL rows; use MySQL's null-safe `<=>` operator (`WHERE col <=> :param`) so ONE bind covers NULL and values.

- [aTVGjg] Passwords injected into MySQL init scripts via compose env_file must survive two layers: unquoted bash heredoc expansion and SQL string literals - a $ gets expanded by bash, a single quote breaks the SQL string, a backslash escapes - so generate with `openssl rand -base64 18` (24 chars, charset A-Za-z0-9+/= safe by construction) and validate the char-class mix before writing to .env.

- [DAMlVp] Anything dropped into the /docker-entrypoint-initdb.d mount dir is treated as an init script on the next FRESH init - a one-off migration/ALTER file left there re-runs on every recreated datadir (and a bare .sql crashes mysql:8.4 init); apply one-off migrations manually against the live DB or document them, never place them in the init mount.

- [EhPOTC] MySQL 8+ makes rows a reserved word (the ROWS window-frame keyword) - COUNT(*) AS rows dies with ERROR 1064 near 'rows', and with stderr suppressed (2>/dev/null) the failure looks like 'no output' instead of a syntax error; alias the aggregate to a non-reserved name (row_count/cnt) or backtick-quote the alias.

- [pmzJMd] MySQL's JSON column type normalizes object key ORDER on store — a blob round-trips content-identically but not order-identically, so clients must never depend on key order; store as TEXT/a serialized string instead if order must survive.

- [yH0E9E] MySQL 8.4 deprecates VALUES(col) inside ON DUPLICATE KEY UPDATE — use the row-alias form `INSERT ... VALUES (...) AS new ON DUPLICATE KEY UPDATE col = new.col` (valid 8.0.19+) to upsert without the deprecation.

- [5gWnx9] INSERT IGNORE (dedup) consumes AUTO_INCREMENT ids even for skipped duplicates, so id gaps are normal and the auto-increment counter OVERSTATES table size — use COUNT(*) as the authoritative row total, never the counter.

- [vRTcLX] A FOREIGN KEY with no ON DELETE clause defaults to RESTRICT - a parent row that has child rows can then NEVER be deleted; before writing any wipe/delete feature enumerate the FK references and delete or reassign child rows first (or design the feature as disable-not-delete).

- [I4l5pS] PDO rowCount() after an UPDATE - returns CHANGED rows, not matched rows (unless PDO::MYSQL_ATTR_FOUND_ROWS is set); a 'did it apply' check via rows === 0 only works when the UPDATE always flips a value (eg a WHERE-guard column the SET must change) - if the SET could equal the current values, 0 rows does NOT mean 'no such row', so test existence separately.

## Issues & Solutions


- `[7b9rFb] Specified key was too long; max key length is 3072 bytes`
  Cause: a UNIQUE KEY/INDEX on VARCHAR(N) with utf8mb4 needs N <= 768 (4 bytes per char x 768 = 3072, the InnoDB max).
  Fix: use VARCHAR(255) for indexed columns (eg email), or TEXT without an index. (2026-07)
- [nLM5ew] Init/migration scripts fail when re-run
  Cause: not idempotent.
  Fix: always use `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE` so scripts are safe to re-run. (2026-07)
- [V6HJOd] MySQL container flaps healthy/unhealthy
  Cause: the configured healthcheck is unreliable, so the container oscillates between healthy and unhealthy.
  Fix: use `mysqladmin ping -h 127.0.0.1` as the healthcheck. (2026-07)
- `[eSBJH4] SQLSTATE[HY093]: Invalid parameter number`
  Cause: PDO with native prepares (emulation off) cannot execute a query that reuses the same named placeholder (eg `col LIKE :search OR col2 LIKE :search`).
  Fix: give each occurrence its own bind name (:searcha, :searchb, ...) with the same value. (2026-07)
- [sLQreG] Non-ASCII text (em-dashes, curly quotes) seeds as mojibake (â€") via bash heredoc init scripts
  Cause: the mysql client defaults to the server charset negotiation.
  Fix: pass `--default-character-set=utf8mb4` on every `mysql` invocation in init/migration scripts. (2026-07)

- [wQ8pL3] Paging an n-tier tree server-side - merged list had every root row twice
  Cause: the page was built as (paged roots) + (recursive-CTE subtrees), but the CTE anchor selected the root rows themselves (`WHERE id IN (roots)`), so the merge repeated every root.
  Fix: page the roots (`WHERE parent_id IS NULL ... LIMIT/OFFSET`) and anchor the `WITH RECURSIVE` CTE on the direct children (`WHERE parent_id IN (roots)`, `UNION ALL` the deeper levels); merging roots + CTE rows then yields complete subtrees with no duplicates. (2026-07)
- [mA4kP8] `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` in MySQL - re-running a migration dies `ERROR 1060 (42S21) Duplicate column name` and every statement after it never runs; guard every ALTER with an information_schema.COLUMNS check + PREPARE/EXECUTE (`SET @has := (SELECT COUNT(*) ...); SET @sql := IF(@has = 0, 'ALTER ...', 'SELECT 1'); PREPARE/EXECUTE/DEALLOCATE`) so migrations stay idempotent.

- [bhtr56] ERROR 1048 `Column 'x' cannot be null` from an UPDATE ... SET col = NULL that works in casual testing but fails in production
  Cause: the column is NOT NULL DEFAULT '' and the server runs with STRICT_TRANS_TABLES (MySQL 8.x default): NULL is rejected instead of silently coerced to the default, so a "clear this field" UPDATE hard-fails (and a catching layer turns it into a generic 500).
  Fix: to clear a NOT NULL DEFAULT '' column set it to '' (its default), never NULL - or make the column nullable when NULL is a real state. Verify any '= NULL' UPDATE against the column's nullability, not just dev behaviour. (2026-08)

- [OvSTqV] Incorrect arguments to mysqld_stmt_execute` from an INSERT/SELECT that runs fine until a LIMIT clause gains a `?` bind
  Cause: mysql2's pool.execute()/conn.execute() uses MySQL server-side prepared statements, and MySQL 8.4 rejects a placeholder in LIMIT/OFFSET with 'Incorrect arguments to mysqld_stmt_execute' (the client sends the value as a string the server won't coerce there). Plain conn.query() interpolation hides the problem, so it only bites on the prepared path.
  Fix: never bind LIMIT/OFFSET with ? on the execute() path - inline a validated integer (Math.max/min + Math.floor the page/limit inputs, then template them into the SQL). Safe because the value is a code-validated integer, never user text. (2026-08)

- [CGcUSx] mysql:8.4 (8.4.11) container comes up healthy but the schema tables are MISSING after first init (no error in docker logs beyond one cryptic line)
  Cause: the official MySQL 8.4 entrypoint's .sql init handler calls `docker_process_sql < file` with NO arguments, and the function's `if [ '--dont-use-mysql-root-password' = "$1" ]` check dies with `$1: unbound variable` (the entrypoint runs with nounset). The container then restarts, sees an initialized datadir, and skips ALL init scripts - so the DB starts with no tables. .sh init files (with the exec bit) run as child processes and are unaffected.
  Fix: never ship a bare .sql file in /docker-entrypoint-initdb.d for mysql:8.4 - use a .sh (executable) that pipes the SQL through the mysql client itself: `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < /path/schema.sql`. Keep the canonical .sql in a subdirectory (the entrypoint ignores subdirs with a harmless warning) so it is not double-processed. Verify after first init with SHOW TABLES. (2026-08)
