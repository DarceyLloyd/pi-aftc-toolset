# MySQL

## Rules

- [jfn4iH] On a shared database instance backing several services, give each service its own DB user capped with MAX_USER_CONNECTIONS N, and keep each schema self-contained (no cross-schema joins or foreign keys) - this isolates connection budgets so one service cannot starve another, and makes lifting a schema to its own instance later a clean migration instead of surgery.

## Gotchyas

- [qW3zL8] `WHERE col = :param` with a NULL bind - matches NOTHING (NULL never equals NULL), so a filter that must match both a value and NULL (eg parent_id roots-or-children) silently returns only the non-NULL rows; use MySQL's null-safe `<=>` operator (`WHERE col <=> :param`) so ONE bind covers NULL and values.

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
