# docx-backup.ts

Deterministic pre-generation backup for `/docx`. Pure Node (fs/path), no
pi imports — unit-tested via jiti from `tests/docx/`.

## Contract

```typescript
export interface DocxBackupResult {
    projectRoot: string;
    oldDir: string;              // <root>/docx/old_docs
    moved: string[];             // dest paths relative to old/
    copied: string[];            // AI context files copied (originals left)
    partnerSkipped: string[];    // partner docs left in place (rel to root)
    docsDirRemoved: boolean;     // ./docs fully emptied -> removed
    docsLeftovers: string[];     // non-doc files keeping ./docs alive
    errors: string[];            // non-empty -> caller MUST abort generation
    warnings: string[];          // non-fatal (eg .gitignore)
    firstRun: boolean;           // no pre-existing documentation found
}

export function runDocxBackup(projectRoot: string): DocxBackupResult
```

Throws ONLY when `docx/old_docs/` cannot be created (the guide's STOP rule:
never regenerate over existing docs).

## Scope — a WHITELIST, never a blacklist

Only these are touched, so framework/sub-project documentation inside code
folders is unreachable by construction:

| Source | Action | Dest under `docx/old_docs/` |
| --- | --- | --- |
| Previous `docx/old_docs.zip` | move | `old_docs.zip` |
| Previous `docx/` output (everything except `old_docs/`, zip) | move | `docx/<name>` |
| Root `*.md` / `*.markdown` (except AI files) | move | `<name>` |
| Root `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` | **copy** | `<name>` |
| `.github/copilot-instructions.md`, `.cursor/rules/*.mdc` | **copy** | same rel path |
| `docs/**/*.md` (minus exclusions/partners) | move | `docs/<rel>` |

AI context files are copied, not moved: `AGENTS.md` is edited in place by
the generation run (managed `AFTC-DOCX` block), so the original must stay
at the root; the copy keeps a restore path.

## Rules enforced

- **Partner docs stay**: a `.md` sharing its basename with a non-`.md`
  sibling in the same directory is left in place and reported in
  `partnerSkipped`.
- **Excluded dir names are never walked** inside `./docs`
  (`node_modules`, `.git`, `old`, `docx`, ... — see `EXCLUDED_DIR_NAMES`).
- **Count verification**: moved == planned, else `errors` gets a mismatch
  entry.
- **`./docs` pruning**: emptied subfolders are removed bottom-up; `./docs`
  itself is removed only when fully empty (`docsDirRemoved`), otherwise
  its remaining top-level names land in `docsLeftovers` and the folder
  stays.
- **`.gitignore`**: `docx/old_docs/` and `docx/old_docs.zip` are appended once
  (idempotent; failure is a warning, never an error).
- **Re-run fold-in**: a previous `old_docs.zip` and previous `docx/`
  output become content of the new `docx/old_docs/`, so the final zip nests
  the history. An `old_docs/` left by an aborted run is kept and merged into.

## What this module does NOT do

- No zipping (that is `scripts/zip-old.mjs`, run by the model AFTER
  generation — the old docs must stay readable for recon).
- No deletion of documentation other than the moves above.
- No walking of code/sub-project folders outside `./docs`.
