# Database Common (All Engines)

*Scope: database lessons that hold for ANY engine (MySQL, Postgres, SQLite, ...) - storage
conventions, migration discipline, NULL semantics. Engine-specific errors and behavior go to
that engine's tool file (mysql.md, ...). Never duplicate an entry in both this file and an
engine file; cross-reference instead.*

## Rules

- [dB1mG4] Never store image data in the database unless project documentation or the user explicitly instructs it - store the files on disk and keep only the paths in the db.
- [dB7kP2] Always make init/migration scripts idempotent so they are safe to re-run - use the engine's guards (CREATE TABLE IF NOT EXISTS, INSERT IGNORE/upsert, existence-checked ALTERs).

## Gotchyas

- [dB3nQ8] `WHERE col = :param` with a NULL bind matches NOTHING - NULL never equals NULL in any SQL engine, so a filter that must match both a value and NULL silently returns only the non-NULL rows; use the engine's null-safe comparison (MySQL: `<=>`, standard SQL: `IS NULL` / `IS NOT DISTINCT FROM`) or handle NULL explicitly.

## Issues & Solutions
