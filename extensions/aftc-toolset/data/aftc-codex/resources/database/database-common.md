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

- [Bxqi2r] When mirroring/syncing rows between databases, dedup on each table's natural unique key (e.g. session + sequence number), never the auto-increment id (it differs between copies) - INSERT IGNORE / OR IGNORE makes re-sends idempotent.

- [fzNS31] In a record-then-push sync (rows written locally BEFORE being pushed), pulling your own source's rows back is normally a no-op - they are already local and dedup skips them; the pull tool's real purpose is either mirroring the whole shared store minus your own rows, or restoring your own rows after the local store is lost - set the default exclusion/inclusion to match the actual purpose.

- [iyDVpW] When many clients write to one shared store, tag every row with a per-installation owner id (one UUID per install, created once, sent on every row) - per-run/session ids collide across machines and cannot identify the owner; the pull side filters on the owner id so clients never pull each other's rows back.

- [tUNbrt] For a mirror that pulls a growing shared store, sync incrementally: track the local max timestamp per table and request only rows newer than it - the first (empty-DB) sync is the only full pull; if the shared endpoint already accepts a date range, this needs no server change.

- [r2xqtQ] Never treat an HTTP 200 from a fail-silent ingest endpoint as proof the row was stored - such endpoints log-and-skip bad rows (missing required field, coercion error) and still return 200; verify the row actually landed with a direct DB query (count/select) before declaring success.

- [j2NbT7] Treat a shared mirror/store as production: never TRUNCATE; delete only via an admin connection with a WHERE on exact owner-id values, and record row counts before and after to prove only the intended rows were removed.

- [hw9kG9] When handing out one-time rows from a bank (serial codes, voucher codes, tickets), claim them with SELECT ... FOR UPDATE inside the surrounding transaction and commit after marking them used - a plain SELECT-then-UPDATE lets two concurrent requests claim the SAME row.

- [DX4HXf] When auditing schema documentation or verifying that migrations actually ran, treat the LIVE database catalog (MySQL information_schema, Postgres pg_catalog, SQLite sqlite_master) as the only ground truth - dump the real table/column/index/FK lists from it and compare against the doc, because docs drift silently and numbered migration scripts may never have run against this particular database instance.

## Gotchyas

- [dB3nQ8] `WHERE col = :param` with a NULL bind matches NOTHING - NULL never equals NULL in any SQL engine, so a filter that must match both a value and NULL silently returns only the non-NULL rows; use the engine's null-safe comparison (MySQL: `<=>`, standard SQL: `IS NULL` / `IS NOT DISTINCT FROM`) or handle NULL explicitly.

- [bq0cil] Adding a UNIQUE index to an existing table fails when legacy rows already violate it - for a one-way merge into a DB that cannot take the index, dedup row-by-row with an existence SELECT inside ONE transaction (the existing local row wins).

- [YlFICO] A date-only range 'end' (YYYY-MM-DD) parsed to 00:00:00 silently drops everything after midnight - treat the end as start-of-next-day or 23:59:59.999 so the final day is fully included.

- [oXlrzr] A claim/checkout flow that pre-checks availability BEFORE the transaction and then claims rows with SELECT ... FOR UPDATE LIMIT n inside it can still let a buyer pay and get nothing - two concurrent buyers both pass the pre-check, the loser's FOR UPDATE waits then finds zero rows and assigns none, and the order still commits. Countermeasure: inside the transaction verify the claimed count equals the needed quantity per item and roll back with a clear 'sold out' error on any shortfall.

## Issues & Solutions

- [ACusA1] an e2e/integration assertion that counts rows or items starts failing although nothing changed in the code under test
  Cause: residual rows in the shared dev database from another suite's fixtures (its cleanup was skipped, or ran before a cleanup fix) shift the count or list
  Fix: query the DB for rows matching test-suites' fixture naming patterns (timestamped/suffixed names), delete the residue, then re-run the creating suite to confirm its cleanup now works (2026-08)

- [EBttIA] A sync/merge tool fails with "no such table" or "table X has no column named Y" although the app's schema is current
  Cause: the tool inserts columns added by a newer schema version, but the DB it opens was created/opened by OLDER code so the lazy on-first-open migration never ran on it
  Fix: have the tool self-ensure the columns it writes before inserting (PRAGMA table_info + idempotent ALTER ADD COLUMN with a default) instead of assuming the app already migrated the DB (2026-08)
