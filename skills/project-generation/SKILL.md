---
name: project-generation
description: Cross-language project generation workflow: file creation, verification strategy, and language-aware validation. Use when scaffolding new projects, creating initial file structures, or generating multi-language starter templates.
---

# Project Generation

### File Creation
- Create files IMMEDIATELY - do not explore the directory structure first
- Use `write_file` for new files, `edit_file` for modifications
- Write ALL files in a single turn when possible (batch writes)

### Verification
- Use `declare_manifest` with simple PowerShell-based checks after file creation
- For file existence use: `if (Test-Path 'path/to/file') { exit 0 } else { exit 1 }`
- Limit verification to 2 retries max - do not get stuck in verification loops
- File existence and syntax/lint checks are the most reliable verification methods

### Language-Specific Validation
- Go: `go vet ./...` or `go build ./...`
- Python: `python -m py_compile file.py`  
- Node.js: `node --check file.js`
- TypeScript: `npx tsc --noEmit`
- Rust: `cargo check`
- PHP: `php -l file.php`
- C#: `dotnet build`
- Java: `javac File.java`

### Error Handling
- If a tool reports an error, fix and retry immediately
- If 3 consecutive tool errors occur, try a different approach
- Always clean up temporary files and background jobs
- Close background jobs with `stop_job` when done
