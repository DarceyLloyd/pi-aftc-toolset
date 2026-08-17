# Sqlite

## Rules

## Gotchyas

## Issues & Solutions

- [fg6tAl] VACUUM INTO fails with `no such column: <path>` when the target filename is written as a double-quoted string literal
  Cause: double quotes denote an identifier in SQLite, so the path is parsed as a column name
  Fix: bind the destination as a parameter (prepare('VACUUM INTO ?').run(path)) or wrap it in single quotes - a bound parameter also keeps the path clean. (2026-08)
