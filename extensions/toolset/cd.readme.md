# cd.ts

Directory-navigation slash command. Switches the current Pi session to
a different directory - interactively (preserve-or-fresh picker +
tree-style overlay) or by path argument.

## Slash commands (2)

- **`/cd`** - switch to a different directory.
- **`/cd-set-max-depth [2-10]`** - set the descendant-depth cap for the
  picker listing. Default 3. Pass a number directly or run with no args
  for a 2–10 picker (current value marked).

## Behaviour matrix

| Invocation | Headless / RPC / `-p` | Interactive TUI |
|---|---|---|
| `/cd` (no args) | `ui.notify` error suggesting a path argument | Two-step: (1) PreserveOverlay Yes/No, (2) CdOverlay tree picker |
| `/cd existing-dir` | switches directly (fresh session) | switches directly (fresh session) |
| `/cd missing-dir` (parent exists) | prompts `ctx.ui.confirm`, then creates + switches (fresh) | prompts, then creates + switches (fresh) |
| `/cd missing-dir` (parent missing) | `ui.notify` error, aborts | `ui.notify` error, aborts |
| `Esc` from preserve Yes/No | n/a | cancels the entire flow (no session touched) |
| `Esc` from picker | n/a | cancels the entire flow |
| `/cd-set-max-depth N` | sets depth to N (or error if out of range) | sets depth to N (or error if out of range) |
| `/cd-set-max-depth` (no args) | notify current value | opens 2–10 picker |

## Two-step interactive flow (no arguments)

### Step 1 - preserve vs fresh (PreserveOverlay)

A custom modal matching the dir-browser visual style. Arrow keys to
navigate (↑↓), Enter to confirm, Esc to cancel. **No timeout /
countdown** - only Esc cancels.

```text
╭─ 📂 Preserve current session? ──────────────╮
│                                            │
│   ❯ Yes                                    │
│     No                                     │
│                                            │
│   ↑↓ = navigate | Enter = Select | Esc …   │
╰────────────────────────────────────────────╯
```

- **Yes** → `SessionManager.continueRecent(targetDir)`. If a recent
  session file already exists for the target directory, pi resumes
  from it (no overwrite). If none exists, a fresh session is created.
- **No** → `SessionManager.create(targetDir)`. A brand-new empty
  session is always written.

The choice is held in closure until a target directory is picked -
cancelling the picker cancels the whole flow.

### Step 2 - directory picker (CdOverlay)

A wider, scrollable tree-style overlay (width 72–160, defaults to 110).
Cyan header line shows `Current Path: <path>` (or just `Drives` in
drive-listing mode). **No `..` row** - left-arrow is the only way up.

```text
╭─ 📂 Move to directory ─────────────────────────────────────────────────────╮
│                                                                            │
│   Path: ▮                                                                  │
│                                                                            │
│   Current Path: W:\Dev\pi-aftc-toolset                                     │
│                                                                            │
│   ❯ .bak/                                                                 │
│     docs/                                                                 │
│     extensions/                                                           │
│       extensions/toolset/             ← depth-2 with full path            │
│     internal-python-gui/                                                   │
│     node_modules/                                                          │
│       node_modules/@aws-sdk/          ← depth-2 with full path            │
│     skills/                                                               │
│     tests/                                                                │
│     themes/                                                               │
│                                                                            │
│   ↑↓ = navigate | ← = Up level | → = Enter | Enter = Select …               │
╰────────────────────────────────────────────────────────────────────────────╯
```

#### Listing rules

- **No `..` row.** Up-navigation is exclusively via the **←** key.
- Direct children shown first, depth-N grandchildren shown next (N
  = current max-depth setting, default 3). Depth-2+ entries use full
  relative paths so collisions (`src/core/` vs `tests/core/`) are
  visually distinct. Traversal is **breadth-first** so depth-1
  children of the current directory always appear at the top of
  the listing, before their grandchildren - otherwise wide
  subtrees like `node_modules/` or `.git/` would dominate the top
  and bury the user's actual target folder.
- **No cap on the number of entries.** The walker produces every
  descendant up to the depth limit; the viewport slides via
  `scrollOffset` so the selection is always visible - use
  `PgUp` / `PgDn` (or `Ctrl+PgUp` / `Ctrl+PgDn`) to scroll through
  a long listing. The cache (`subdirCache` + `direntCache`, 500ms
  TTL) means the walker only reads disk once per dir per 500ms,
  so the cost of an unbounded listing is paid at most twice per
  second.
- "↓ rows N–M of TOTAL (keep typing to narrow)" hint when the
  listing is larger than the viewport.

#### Drive listing (reached by ← from a drive root)

```text
╭─ 📂 Move to directory ─────────────────────────────────────────╮
│   Drives                                          (cyan)        │
│   ❯ C:\    D:\    M:\    W:\    X:\                          │
│   ↑↓ = navigate | → = Enter | Enter = Select | Esc = cancel   │
╰────────────────────────────────────────────────────────────────╯
```

Enter selects the drive as the target. Right-arrow drills into it.
No `..` row - you're at the top.

#### Empty-folder behaviour (drill into a dir with no subdirs)

`drillIntoSelected` checks the entry's children via the readdir cache
and is a **no-op** when the folder is empty. The user cannot enter
a leaf folder via → (per the spec). They must use ← to leave, type
a path + Enter, or pick a different folder.

#### Initial open at an empty folder

If `currentDir` happens to be empty when the picker opens, the
listing shows "No subdirectories". Pressing Enter with no input
and no highlighted entry selects the current folder (most useful
interpretation: "I want to be right here"). Pressing ← navigates up.

#### Typed-input fallback

If the user types a path in the input field that doesn't match any
listing result, Enter falls through to the same resolve/create flow
that `/cd <path>` uses. Tab autocompletes the highlighted entry into
the input.

## Keyboard reference (CdOverlay)

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection. The viewport follows so the selected row is always visible. |
| `←` | Navigate up one level. At drive root → switch to drives-listing. |
| `→` | Drill into the highlighted entry (refresh listing). **No-op on empty folders.** |
| `Enter` | Confirm: select the highlighted entry, or pick currentDir on empty listing. |
| `Tab` | Autocomplete the highlighted entry into the input. |
| `Esc` | Cancel - no session change. |
| `PgUp` / `PgDn` | Jump up / down by the **visible viewport size** (tracked automatically - each page step equals the number of rows the overlay actually paints, so terminal size / overlay height changes the step automatically). Clamped at row 0 / last; no wrap-around. |
| `Ctrl+PgUp` / `Ctrl+PgDn` | Jump to first / last entry. |
| `Backspace` / `Delete` / `Ctrl+U` / `Ctrl+K` / `Ctrl+W` | Edit the input. |
| `Home` / `End` (or `Ctrl+A` / `Ctrl+E`) | Move input cursor. |
| Plain characters | Insert into input (refreshes listing by fuzzy match). |

## Keyboard reference (PreserveOverlay)

| Key | Action |
|---|---|
| `↑` / `↓` | Move between Yes and No. |
| `Enter` | Confirm the highlighted option. |
| `Esc` | Cancel the whole `/cd` flow. |

## Cross-platform path handling

- Drive listing: `fs.readdirSync` probes A→Z on Windows (`process.platform === "win32"`); POSIX systems return `["/"]`.
- Drive-root detection: `path.parse(p).root === p` - works uniformly across `C:\`, `D:\`, `/`, `/Volumes/...`, etc.
- Path joining: `path.join`, `path.dirname`, `path.basename` from Node's `path` module - separators handled per-OS.
- Initial cwd is `path.resolve`'d on overlay construct so the header never renders `.` or `..`.
- Tested on Windows 11. POSIX behaviour is enforced by Node's `path` module.

## Events subscribed

- `session_shutdown` - delete the just-left session file if it
  contains no real user/assistant messages. Skipped on
  `reason === "reload"` (the user is coming back, not leaving).
  Preserved 1:1 from upstream pi-move.

## Public factory

```typescript
export function createCd(pi: ExtensionAPI): void
```

Self-contained, no cross-module state. The orchestrator
(`index.ts`) calls this once at startup.

## Closure state

- **`maxDepth`** - closure-scoped `let`, default 3. Mutated by
  `/cd-set-max-depth`. Per-session (resets on session_start).
- **`maxDepth` is passed into `CdOverlay` at construction time** so
  the picker uses the current value.
- **Module-scoped, intentionally persistent**: the two-level directory
  cache (`direntCache` + `subdirCache`, 500ms TTL) - speeds up
  keystrokes without re-stating the disk. See `rules.md` §4.3.
- **Per-overlay instance**: input, cursor, scrollOffset, currentDir,
  entries, selectedIndex, isShowingDrives - local to `CdOverlay`,
  garbage collected when the modal closes.

## Failure modes

- `/cd` invoked headless with no args → `ui.notify` error.
- `PreserveOverlay` cancelled → entire flow aborts silently.
- `CdOverlay` cancelled → entire flow aborts silently.
- Target directory missing **and** parent dir missing → `ui.notify` error.
- `ctx.ui.confirm` declined → operation aborts silently.
- `mkdirSync` throws (permissions, etc.) → `ui.notify` error.
- `SessionManager.create` / `continueRecent` returns no session file → `ui.notify` error.
- `SessionManager.continueRecent` finds an existing session file → preserved 1:1, NOT overwritten.
- `ctx.switchSession` rejects → caught and surfaced via `ui.notify`.
- `/cd-set-max-depth <n>` with out-of-range n → `ui.notify` error; current value unchanged.
- `/cd-set-max-depth` (no args) cancelled → no change.
- `fs.unlinkSync` in `session_shutdown` race (file already gone) → caught and swallowed; idempotent.