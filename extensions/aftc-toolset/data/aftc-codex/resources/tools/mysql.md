# MySQL

## Rules

## Gotchyas

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
