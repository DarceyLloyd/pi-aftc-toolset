# MySQL

## Rules

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
