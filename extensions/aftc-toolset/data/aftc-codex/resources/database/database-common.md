# Database Common (All Engines)

*Scope: database lessons that hold for ANY engine (MySQL, Postgres, SQLite, ...) - storage
conventions, migration discipline, NULL semantics. Engine-specific errors and behavior go to
that engine's tool file (mysql.md, ...). Never duplicate an entry in both this file and an
engine file; cross-reference instead.*

## Rules

- [dB1mG4] Never store image data in the database unless project documentation or the user explicitly instructs it - store the files on disk and keep only the paths in the db.
- [dB7kP2] Always make init/migration scripts idempotent so they are safe to re-run - use the engine's guards (CREATE TABLE IF NOT EXISTS, INSERT IGNORE/upsert, existence-checked ALTERs).

- [nyp0eW] bulk DB seeders: compute ONE password hash and reuse it for every row (per-row hashing is the bottleneck); keep the regeneration recipe next to the embedded hash

- [WQkDe3] For repeated scans of large file trees, cache each file's size + mtime in a metadata table and only re-hash (e.g. crc) files whose fingerprint changed - re-scans of tens of thousands of files skip unchanged entries instead of re-reading everything.

## Gotchyas

- [dB3nQ8] `WHERE col = :param` with a NULL bind matches NOTHING - NULL never equals NULL in any SQL engine, so a filter that must match both a value and NULL silently returns only the non-NULL rows; use the engine's null-safe comparison (MySQL: `<=>`, standard SQL: `IS NULL` / `IS NOT DISTINCT FROM`) or handle NULL explicitly.

## Issues & Solutions

- [ACusA1] an e2e/integration assertion that counts rows or items starts failing although nothing changed in the code under test
  Cause: residual rows in the shared dev database from another suite's fixtures (its cleanup was skipped, or ran before a cleanup fix) shift the count or list
  Fix: query the DB for rows matching test-suites' fixture naming patterns (timestamped/suffixed names), delete the residue, then re-run the creating suite to confirm its cleanup now works (2026-08)
