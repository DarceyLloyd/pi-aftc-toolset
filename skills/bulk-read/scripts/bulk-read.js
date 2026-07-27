#!/usr/bin/env node
// bulk-read.js - Concatenate files in a directory into a single
// markdown document for efficient LLM context loading. Walks the tree
// recursively, skips noise directories and binary files, and emits
// FILE: <absolute-path> headers with fenced code blocks.
//
// Bundled with the bulk-read skill (skills/bulk-read/scripts/). Run it
// from there; do NOT copy it into the extension data dir or the target
// folder. Output defaults to the OS temp dir so it never pollutes the
// extension's persistent state or the folder being read.
//
// Usage:
//   node bulk-read.js [rootDir] [outFile] [maxBytesKB]
//
// Defaults:
//   rootDir     = process.cwd()
//   outFile     = <os.tmpdir()>/bulk-read-<timestamp>.md
//   maxBytesKB  = 1024 (1 MB per file)

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(process.argv[2] || process.cwd());
const outFile = process.argv[3] || path.join(
    os.tmpdir(),
    'bulk-read-' + new Date().toISOString().replace(/[:.]/g, '-') + '.md'
);
const maxBytes = parseInt(process.argv[4] || '1024', 10) * 1024;

const SKIP_DIRS = new Set([
    'node_modules', '.git', '.venv', 'dist', 'build', '__pycache__',
    '.pi-aftc-toolset', '.bak', '.old', '.dev', 'target', 'out', '.next',
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
    'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'Pipfile.lock',
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
