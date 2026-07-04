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

The agent writes a small Node.js script (provided below) to a temp
location, runs it, reads the produced markdown file with `read`, then
optionally cleans up. Node.js is used because pi already requires it,
it has built-in cross-platform path handling, and it avoids shell
escaping issues for paths and content.

The script walks the directory tree, filters out noise directories and
binary files, and writes every remaining file into a single markdown
document. The document starts with a manifest (counts, sizes, skipped
reasons), then a numbered file list, then each file's contents
prefixed by `FILE: <absolute-path>` and wrapped in a fenced code block.

## Steps

1. Determine the target directory. Default to the user's current
   working directory if not specified.
2. Write the bundled script (in the "Script" section below) to a temp
   file - for example `.pi-aftc-toolset/data/_bulk-read.js`.
3. Run the script with bash:
   ```bash
   node .pi-aftc-toolset/data/_bulk-read.js [rootDir] [outFile] [maxBytesKB]
   ```
   - `rootDir` defaults to `process.cwd()`
   - `outFile` defaults to `<rootDir>/.pi-aftc-toolset/data/bulk-read-<timestamp>.md`
   - `maxBytesKB` defaults to 1024 (1 MB per file)
4. The script prints the output path. Read that path with `read`.
5. Proceed with the user's actual task against the loaded content.
6. Once done, optionally delete the temp files:
   ```bash
   rm .pi-aftc-toolset/data/_bulk-read.js <outFile>
   ```

## What gets skipped

- Directories: `node_modules`, `.git`, `.venv`, `dist`, `build`,
  `__pycache__`, `.pi-aftc-toolset`, `.bak`, `.old`, `target`, `out`,
  `.next`, `.cache`, `.turbo`, `.vercel`, `.pnpm-store`, `.DS_Store`
- Binary files by extension: images, video, audio, archives, fonts,
  compiled binaries, sqlite databases, bytecode files
- Lockfiles by exact filename: `package-lock.json`, `yarn.lock`,
  `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `composer.lock`,
  `Gemfile.lock`
- Files larger than `maxBytesKB`
- Files that fail to read - permission denied, encoding errors, etc.
- Symlinks - skipped by default to avoid infinite loops

The output manifest lists how many files were skipped and why.

## Tips

- For a subset of files, pass a more specific `rootDir` (for example
  only `src/` or `extensions/toolset/`).
- For 100+ files, prefer running the script on subfolders one at a
  time so the resulting markdown is easier to navigate.
- Tell the user where the temp file lives so they can inspect it
  themselves or grep it from their shell.
- After analysis, clean up with `rm` to keep the workspace tidy.
- The manifest at the top of the output gives counts and skipped
  reasons - read it first to understand what was filtered out.
- Absolute paths are used everywhere so the agent can locate each
  file precisely even when the walker crosses drive boundaries on
  Windows.

## Examples

Read everything in the current working directory with defaults:

```bash
node .pi-aftc-toolset/data/_bulk-read.js
```

Read only `extensions/` with a 2 MB per-file cap:

```bash
node .pi-aftc-toolset/data/_bulk-read.js extensions/ extensions.md 2048
```

Read the user's home directory's `notes/` folder:

```bash
node .pi-aftc-toolset/data/_bulk-read.js ~/notes ~/bulk-notes.md
```

## Script

Save this verbatim to a temp `.js` file (typically
`.pi-aftc-toolset/data/_bulk-read.js`) and run with `node`. The agent
must not modify it - any tweaks belong in the args, not the script.

```javascript
#!/usr/bin/env node
// bulk-read.js - Concatenate files in a directory into a single
// markdown document for efficient LLM context loading. Walks the tree
// recursively, skips noise directories and binary files, and emits
// FILE: <absolute-path> headers with fenced code blocks.
//
// Usage:
//   node bulk-read.js [rootDir] [outFile] [maxBytesKB]
//
// Defaults:
//   rootDir     = process.cwd()
//   outFile     = <rootDir>/.pi-aftc-toolset/data/bulk-read-<timestamp>.md
//   maxBytesKB  = 1024 (1 MB per file)

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(process.argv[2] || process.cwd());
const outFile = process.argv[3] || path.join(
    rootDir, '.pi-aftc-toolset', 'data',
    'bulk-read-' + new Date().toISOString().replace(/[:.]/g, '-') + '.md'
);
const maxBytes = parseInt(process.argv[4] || '1024', 10) * 1024;

const SKIP_DIRS = new Set([
    'node_modules', '.git', '.venv', 'dist', 'build', '__pycache__',
    '.pi-aftc-toolset', '.bak', '.old', 'target', 'out', '.next',
    '.cache', '.turbo', '.vercel', '.pnpm-store', '.DS_Store',
    '.parcel-cache', '.svelte-kit', '.nuxt',
]);

const BINARY_EXT = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
    '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz',
    '.exe', '.dll', '.so', '.dylib', '.bin', '.pyc', '.class', '.o',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flac', '.ogg',
    '.db', '.sqlite', '.sqlite3',
]);

const SKIP_FILES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
    'Cargo.lock', 'composer.lock', 'Gemfile.lock', ' Pipfile.lock',
]);

function isProbablyBinary(buf) {
    // First 8KB: any NUL byte strongly suggests binary content.
    const n = Math.min(buf.length, 8192);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
}

function detectLang(p) {
    const base = path.basename(p).toLowerCase();
    if (base === 'dockerfile') return 'dockerfile';
    if (base === 'makefile') return 'makefile';
    if (base === '.gitignore' || base === '.dockerignore') return '';
    const ext = path.extname(p).toLowerCase().slice(1);
    const map = {
        ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
        py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
        java: 'java', c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
        h: 'c', hpp: 'cpp', cs: 'csharp', php: 'php',
        sh: 'bash', bash: 'bash', ps1: 'powershell', bat: 'batch', cmd: 'batch',
        md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
        toml: 'toml', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
        sql: 'sql', lua: 'lua', r: 'r', swift: 'swift', kt: 'kotlin',
        vue: 'vue', svelte: 'svelte',
    };
    return map[ext] || '';
}

function fmtKb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

function walk(dir, found, skipped) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
        skipped.unreadable++;
        return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;            // avoid loops
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(p, found, skipped);
        } else if (entry.isFile()) {
            if (SKIP_FILES.has(entry.name)) { skipped.lockfile++; continue; }
            const ext = path.extname(entry.name).toLowerCase();
            if (BINARY_EXT.has(ext)) { skipped.binary++; continue; }
            let stat;
            try { stat = fs.statSync(p); } catch (_) { skipped.unreadable++; continue; }
            if (stat.size > maxBytes) { skipped.large++; continue; }
            try {
                const fd = fs.openSync(p, 'r');
                const buf = Buffer.alloc(Math.min(stat.size, 8192));
                fs.readSync(fd, buf, 0, buf.length, 0);
                fs.closeSync(fd);
                if (isProbablyBinary(buf)) { skipped.binary++; continue; }
            } catch (_) { skipped.unreadable++; continue; }
            found.push({ path: p, size: stat.size });
        }
    }
}

const found = [];
const skipped = { binary: 0, large: 0, unreadable: 0, lockfile: 0 };
walk(rootDir, found, skipped);

const now = new Date().toISOString();
const totalSize = found.reduce((s, f) => s + f.size, 0);
const out = [];
out.push('# Bulk Read: ' + rootDir);
out.push('');
out.push('- Generated: ' + now);
out.push('- Root: ' + rootDir);
out.push('- Files included: ' + found.length);
out.push('- Skipped (binary): ' + skipped.binary);
out.push('- Skipped (lockfile): ' + skipped.lockfile);
out.push('- Skipped (too large): ' + skipped.large);
out.push('- Skipped (unreadable): ' + skipped.unreadable);
out.push('- Total content size: ' + fmtKb(totalSize));
out.push('');
out.push('## File list');
out.push('');
found.forEach((f, i) => out.push((i + 1) + '. ' + f.path + ' (' + fmtKb(f.size) + ')'));
out.push('');
out.push('---');
out.push('');

for (const f of found) {
    let content;
    try {
        content = fs.readFileSync(f.path, 'utf8');
    } catch (err) {
        content = '<<unable to read: ' + err.message + '>>';
    }
    const lang = detectLang(f.path);
    out.push('FILE: ' + f.path);
    out.push('```' + lang);
    out.push(content);
    out.push('```');
    out.push('');
}

const outDir = path.dirname(outFile);
try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, out.join('\n'), 'utf8');
} catch (err) {
    console.error('Failed to write ' + outFile + ': ' + err.message);
    process.exit(1);
}

console.log('Wrote ' + found.length + ' files (' + fmtKb(totalSize) + ') to:');
console.log('  ' + outFile);
console.log('Skipped: ' + skipped.binary + ' binary, ' + skipped.lockfile + ' lockfile, ' + skipped.large + ' too large, ' + skipped.unreadable + ' unreadable');
```