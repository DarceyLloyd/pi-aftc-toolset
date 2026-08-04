# Data Directory, Packaging & Configuration

Decided 2026-07-18 after clean-room verification. Do NOT re-derive or
"improve" these without new evidence.

---

## Persistent data dir (OUTSIDE the package)

Lives in a per-user OS-standard directory so it survives `pi update`
(which replaces the whole package dir). Resolved by `paths.ts`:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\pi-aftc-toolset\data\` |
| macOS | `~/Library/Application Support/pi-aftc-toolset/data/` |
| Linux | `$XDG_DATA_HOME/pi-aftc-toolset/data/` (fallback `~/.local/share/...`) |
| Override | `AFTC_TOOLSET_DATA_ROOT` env (tests / power users) |

Holds: `turns.db`, `config.json`, `ssh.json`, `report.html`, `aftc-codex/`.

**All runtime files are created lazily** by the extension's .ts code from
in-code defaults. Nothing data-related needs to be shipped.

### Legacy migration

On every startup `index.ts` calls `migrateLegacyData()` (paths.ts): copies any
legacy file (from `<package>/.pi-aftc-toolset/data/`) that has no persistent
counterpart (copy-only, locked source never blocks it), then best-effort deletes
legacy files. Idempotent.

**One-time transition loss (verified, inherent):** the update that INTRODUCES
persistent storage cannot migrate existing package-local data because pi wipes
the old dir BEFORE new code loads. Do NOT try to fix this.

### Ignore rules

`.pi-aftc-toolset/` stays in BOTH `.gitignore` and `.npmignore`. Never add
negation rules (`!...`) for it — a previous negation leaked config/report/artifacts
into the npm tarball.

---

## tests/ is never published

`tests/` stays in BOTH `.gitignore` and `.npmignore` permanently. Tests may
contain sensitive information. Solo-maintained project; Git is not the primary
backup (pcloud is).

---

## Shipped defaults & assets (`extensions/aftc-toolset/data/`)

Package-local folder holding DEFAULTS and static ASSETS that SHIP in the npm
tarball. Distinct from the persistent OS data dir.

```
extensions/aftc-toolset/data/
├── extension-config.json          # PACKAGE-SHIPPED config (codexVersion + future keys; never copied to the OS data dir)
├── aftc-codex/                    # SHIPPED SEED for the knowledge base
│   ├── codex-rules.md
│   ├── thought-and-action-guidance.md
│   ├── markdown-guidance.md
│   └── resources/{languages,libraries,frameworks,engines,tools,runtimes}/*.md
├── aftc-audio-notifications/      # MP3s (read at runtime)
│   └── {question,task-complete,error,aborted,startup}/*.mp3
└── aftc-intro/                    # Startup intro assets
    └── audio/voc_greetings-professor-falcon.mp3
```

### Feature-folder rule (BINDING)

Every feature's shipped files live in their OWN clearly-named subfolder. Never
mix two features' files in one folder. Name folders after the feature, not the
file type. `data/<feature>/` is for assets that are COPIED to the user's live
data dir (the codex seed) or read-only runtime assets the feature serves
(notification MP3s, intro audio). A shipped reference asset that is only ever
READ IN PLACE from the package (never copied to the live dir) may live in the
feature's code folder instead — eg `extensions/aftc-toolset/docx/documentation_guide.md`.

### Paths table

| What | Path |
| --- | --- |
| Shipped defaults root | `extensions/aftc-toolset/data/` |
| Codex seed | `extensions/aftc-toolset/data/aftc-codex/` |
| Notification MP3s | `extensions/aftc-toolset/data/aftc-audio-notifications/<category>/` |
| Intro audio | `extensions/aftc-toolset/data/aftc-intro/audio/` |
| User live codex | `<dataDir>/aftc-codex/` (persistent OS dir) |

### Development process

1. **Seed is SOURCE only.** `data/aftc-codex/` must never contain generated
   files (`codex-resource-list.md`).
2. **Codex seed maps 1:1 to live copy** (copy-only, on first enable). To change
   what ships, copy `<dataDir>/aftc-codex/resources/*` to `data/aftc-codex/resources/*`.
3. **After changing codex resources**, run:
   `node extensions/aftc-toolset/aftc-codex/scripts/sync-codex-resources.mjs`
4. **Audio assets** are read directly from `data/` at runtime (NOT copied to OS
   data dir). Add MP3s to the correct feature subfolder + category.
5. **Packaging:** `data/` ships. Dev tooling (`*.py`, `*.bat`) excluded via
   `.npmignore`. NEVER add a bare `data/` ignore rule. Verify with
   `npm pack --dry-run` before every release.

---

## Configuration defaults (`config.json`)

`config.json` holds cross-session preferences in the persistent OS data dir.
Source of truth: `DEFAULT_PREFERENCES` in `extensions/aftc-toolset/config.ts`.

**Read `docs/working-with-config.md` before touching either config file** — it
is the binding contract (live vs shipped, the NO in-memory cache rule, write
rules, edge cases).

### How defaults work

- **No config.json** -> `ensureConfigFile()` writes one from `DEFAULT_PREFERENCES`.
- **Older config missing fields** -> `loadPreferencesInternal()` merges
  `{...DEFAULT_PREFERENCES, ...parsed}` + write-back migration makes new fields
  explicit. Existing values never discarded.
- **Read fallback** -> `getPreference(key, default)` returns saved value or default.

### How to add/change a default

1. Edit the value in `DEFAULT_PREFERENCES` (`config.ts`).
2. If NEW field: add to `Preferences` interface AND add a `needsXMigration`
   type-check + spread entry in `loadPreferencesInternal()`.
3. Update the table below.

### Every config.json entry

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `footerTimeframe` | string | `"3d"` | rolling `1h`/`2h`/`3h`/`4h`/`5h`/`6h`/`12h`/`24h`/`48h`/`72h` or date-based `1d`/`2d`/`3d`/`5d`/`7d`/`month`/`3m`/`6m`/`1y`; legacy `today`/`28d` migrated on load |
| `footerEnabled` | boolean | `true` | footer widget on/off |
| `footerAveragesEnabled` | boolean | `true` | footer line 4 (recorded averages) on/off |
| `responseDividerEnabled` | boolean | `true` | divider above each reply |
| `thinkProcessingEnabled` | boolean | `false` | inline `<think>` tag parsing |
| `aftc-intro` | boolean | `true` | startup wordmark animation |
| `qwencloudCloudDomain` | string | `"dashscope-intl.aliyuncs.com"` | DashScope domain |
| `qwencloudCloudApiFormat` | string | `"openai-completions"` | cloud API format |
| `qwencloudPlanApiFormat` | string | `"openai-completions"` | plan API format |
| `qwencloudPlanOpenAI` | string | (see code) | plan OpenAI base URL |
| `qwencloudPlanAnthropic` | string | (see code) | plan Anthropic base URL |
| `notifyEnabled` | boolean | `false` | audio notifications on/off; migration enables only when sounds already configured |
| `notifySoundQuestion` | string | `"voc_question_07.mp3"` | filename in `question/`; `""` = none |
| `notifySoundTaskComplete` | string | `"voc_task_complete_07.mp3"` | filename in `task-complete/`; `""` = none |
| `notifyTimeSec` | number | `1` | min task duration before sound; `0` = off |
| `notifySoundError` | string | `"voc_we_got_a_problem_01.mp3"` | filename in `error/`; `""` = none |
| `notifySoundAborted` | string | `""` | filename in `aborted/`; `""` = none |
| `notifySoundStartup` | string | `"xp.mp3"` | filename in `startup/`; `""` = none |
| `replayPrompt` | string | `""` | saved `/replay` prompt; `""` = none; only written by explicit `/save-replay-prompt` (never auto-stored, existing values never overwritten) |
| `warGamesEnabled` | boolean | `false` | WarGames intro animation |
| `aftcCodexEnabled` | boolean | `false` | codex on/off switch |
| `aftcCodexInjectGuidance` | boolean | `true` | inject thinking guidance |
| `aftcCodexAutoLoad` | boolean | `true` | auto-detect + fetch docs |
| `aftcCodexSeeded` | boolean | `false` | first-run seed done |
| `aftcCodexAutoAddEntries` | boolean | `true` | auto-add vs propose-then-confirm |
| `runScriptEnabled` | boolean | `true` | `run_script` tool on/off |

### Removed keys (kept for migration reference)

Keys that older versions of this toolset once wrote to `config.json`.
`config.ts` strips them on every read so the saved file eventually
matches the current schema; do NOT re-add them.

| Key | Was | Replaced by |
| --- | --- | --- |
| `notifySound` | Single key for the task-complete sound (pre-multi-category audio) | `notifySoundTaskComplete` (and the rest of `notifySound*`) |
| `aftcCodexInjectMode` | Dev-only v1.17.0 toggle for codex injection mode | Per-session state controlled by `/codex-inject-rules` |

When you remove a key, add a new row here AND a comment in
`config.ts`'s `loadPreferencesInternal` cleanup block so the next
maintainer has both breadcrumbs.

### Path-bearing entries

- `notifySound*` store a bare FILENAME only; resolved at runtime via
  `path.join(getAudioDir(), <category>, filename)`. Never store absolute paths.
- All other paths computed cross-platform in `paths.ts`. Do not hardcode them.

### Maintenance rule

Keep this table in sync with `DEFAULT_PREFERENCES` and the `Preferences`
interface. Update in the same change whenever a preference is added, removed,
retyped, or its default changed.
