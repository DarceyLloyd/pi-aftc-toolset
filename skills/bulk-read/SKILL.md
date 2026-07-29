---
name: bulk-read
description: >-
  Concatenate many files in a directory into a single markdown document when
  the user asks to read, analyze, scan, load, dump, audit, concatenate, or
  merge many files in a project or folder at once. Triggers on phrases like
  "read all files", "analyze the project", "load every file", "concatenate
  files in folder X", "give me everything in src/", "audit the code", or
  wants to understand an entire codebase as a whole. Specifically when 5 or
  more files would otherwise need to be read individually.
---

# Bulk Read

Use this skill when the user asks to read, analyze, scan, load, dump,
audit, or otherwise consume many files in a folder or project at once.

The default approach of reading files one-at-a-time uses one AI turn
per file and burns through context. This skill loads everything into a
single markdown document that can be read in one tool call.

## When to use

- The user says "read all files" or "read every file"
- The user says "analyze the project" or "scan the codebase"
- The user asks to load, dump, concatenate, or merge many files
- Any task that would otherwise require 5 or more separate reads
- The user mentions a folder like "all files in src/" or "all .ts files"

## When NOT to use

- Reading 1 to 3 specific files - just use `read` directly
- Reading a single large file - just use `read` with a path
- Targeted searches across a codebase - use `grep` or `bash` with patterns
- Looking at binary assets, archives, or images - they are skipped anyway

## How it works

This skill ships a bundled Node.js helper at `scripts/bulk-read.mjs`
(relative to this `SKILL.md`). Node.js is used because pi already
requires it, it has built-in cross-platform path handling, and it avoids
shell escaping issues for paths and content.

The script walks the directory tree, filters out noise directories and
binary files, and writes every remaining file into a single markdown
document. The document starts with a manifest (counts, sizes, skipped
reasons), then a numbered file list, then each file's contents prefixed
by `FILE: <absolute-path>` and wrapped in a fenced code block.

The output defaults to the OS temp directory (`os.tmpdir()`), so it
never pollutes the extension's persistent state or the folder being
read. Do NOT write the script or its output into the extension data dir
or the target folder.

## Steps

1. Determine the target directory. Default to the user's current
   working directory if not specified.
2. Resolve the bundled script path against THIS skill's directory. You
   know the absolute path of this `SKILL.md`; the script is
   `<directory-of-this-SKILL.md>/scripts/bulk-read.mjs`. For example, if
   this file is `/X/skills/bulk-read/SKILL.md`, the script is
   `/X/skills/bulk-read/scripts/bulk-read.mjs`.
3. Run the script with bash (quote the path — it may contain spaces):
   ```bash
   node "<skill-dir>/scripts/bulk-read.mjs" [rootDir] [outFile] [maxBytesKB]
   ```
   - `rootDir` defaults to `process.cwd()`
   - `outFile` defaults to `<os.tmpdir()>/bulk-read-<timestamp>.md`
   - `maxBytesKB` defaults to 1024 (1 MB per file)
4. The script prints the output path plus the output's exact line count
   and size. **If it prints a WARNING, the output exceeds a single read
   (pi's read tool truncates at 2000 lines / 50 KB). Do NOT read the
   file in one call — you would silently get a truncated slice and
   analyse only a fraction of the files.** Read it in chunks with the
   read tool's `offset`/`limit` (about 1500 lines per call: offset 1,
   then 1501, 3001, ...) until every line is consumed — or re-run the
   script per subfolder so each output stays under the limit.
5. Proceed with the user's actual task against the loaded content.
6. Once done, optionally delete the temp output file (the bundled script
   is permanent — do not delete it):
   ```bash
   rm "<outFile>"
   ```

## What gets skipped

- Directories: `node_modules`, `.git`, `.venv`, `dist`, `build`,
  `__pycache__`, `.pi-aftc-toolset`, `.bak`, `.old`, `.dev`, `target`,
  `out`, `.next`, `.cache`, `.turbo`, `.vercel`, `.pnpm-store`,
  `.DS_Store`
- Binary files by extension: images, video, audio, archives, fonts,
  compiled binaries, sqlite databases, bytecode files
- Lockfiles by exact filename: `package-lock.json`, `yarn.lock`,
  `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `composer.lock`,
  `Gemfile.lock`, `Pipfile.lock`
- Files larger than `maxBytesKB`
- Files that fail to read - permission denied, encoding errors, etc.
- Symlinks - skipped by default to avoid infinite loops

The output manifest lists how many files were skipped and why.

## Tips

- For a subset of files, pass a more specific `rootDir` (for example
  only `src/` or `extensions/aftc-toolset/`).
- For 100+ files, prefer running the script on subfolders one at a
  time so each output stays under the single-read limit (2000 lines /
  50 KB) and is easier to navigate.
- Tell the user where the temp output file lives so they can inspect it
  themselves or grep it from their shell.
- After analysis, clean up the temp output with `rm` to keep the
  workspace tidy.
- The manifest at the top of the output gives counts and skipped
  reasons - read it first to understand what was filtered out.
- Absolute paths are used everywhere so the agent can locate each
  file precisely even when the walker crosses drive boundaries on
  Windows.

## Examples

Read everything in the current working directory with defaults (output
goes to the OS temp dir):

```bash
node "<skill-dir>/scripts/bulk-read.mjs"
```

Read only `extensions/` with a 2 MB per-file cap, writing to a chosen
file:

```bash
node "<skill-dir>/scripts/bulk-read.mjs" extensions/ extensions.md 2048
```

Read the user's home directory's `notes/` folder:

```bash
node "<skill-dir>/scripts/bulk-read.mjs" ~/notes ~/bulk-notes.md
```
