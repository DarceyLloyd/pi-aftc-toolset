# 1 - Extension source — TUI sitemap

<!-- last-reviewed: 2026-08-11 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [1_extension_map.md](./1_extension_map.md)

Every reachable user-facing surface of the toolset, from source
(`pi.registerCommand`, `pi.registerShortcut`, `ctx.ui.custom({overlay})`,
`showMenu/showConfirm/showForm/showViewer`, `pi.setWidget`,
`pi.appendEntry` renderers). Design rules for all of them: [design.md](../design.md).

## HIGH LEVEL

```
Persistent widgets (setWidget, belowEditor)
|- Footer dashboard (6 lines, line 6 = sub-agents) → 1.4.2 footer widget doc
\- AFTC text intro (typewriter wordmark)         → 1.5.13 intros doc

Full-screen overlays (AFTC UI takeovers, ctx.ui.custom overlay:true)
|- SSH connection manager (/ssh-cm)              → 1.6.5
|  |- New connection dialog (form)               → 1.6.6
|  |- Edit connection form                       → 1.6.7
|  \- Confirm dialogs (delete/replace/password)  → 1.6.8
|- Interactive SSH terminal (/ssh-shell)         → 1.6.9
|- Auth method menu + password/passphrase inputs → 1.6.7
|- Host-key approval confirm                     → 1.6.8 (via ssh/index.ts)
|- Footer dashboard menu (/aftc-footer)          → 1.4.2
|  \- Timeframe picker                           → 1.4.2
|- Theme picker (/theme)                         → 1.5.10
|- Quick dir access menu (/qd)                   → 1.5.7
|- Notification sounds hub (/aftc-audio-notifications) → 1.5.4
|  \- Per-category sound picker (×8)             → 1.5.4
|- /aftc-help viewer                             → 1.5.2
|- Cache profile / cache stats viewers           → 1.4.1
|- Codex menus (/codex)                          → 1.7.3
|  |- Resources & updates menu                   → 1.7.3
|  |- Seed choice (Pre-trained / Fresh)          → 1.7.3
|  \- Install/wipe confirms                      → 1.7.3
|- /docx + /docx-update modals                   → 1.8.1
|  |- Context-window refusal info modal
|  |- Context advisory confirm
|  |- Backup confirmation modal
|  \- Project-type picker
|- Sub-agent menus (/007 family)                 → 1.9.7
|  |- /007 main menu (disabled + enabled states)
|  |- Enable confirm (first seed)
|  |- Browse agents + agent detail actions
|  |- /007-edit agent picker + options menu
|  |- /007-settings (presets/capacity/safety/output)
|  |- /007-status live table
|  |- /007-kill multi-select
|  |- /007-guide + /007-doctor viewers
|  \- Disable finish-or-kill confirm
|- /aftc-install confirm + result viewer         → 1.5.3
|- Usage-clear confirm (/usage-clear)            → 1.4.5

Inline transcript entries (pi.appendEntry — never in LLM context)
|- emphasis/warn/error/info lines (aftc-console) → 1.3.1
|- /dir + /ls directory listing card             → 1.5.7
|- /cwd card                                     → 1.5.7
|- replay saved/empty notices                    → 1.5.8
|- response divider rule                         → 1.5.5
\- codex banners / prep notices                  → 1.7.2
\- intro feedback line (disabled 2026-08) → 1.5.13

Browser surface (opened in the browser by the /usage-report local server)
\- usage-report web app — Overview/Models/Thinking/Timings/Projections tabs → 1.4.5
```

## LOW LEVEL

### Footer dashboard widget — see [1.4.2_footer_widget.md](./1.4_footer_usage/1.4.2_footer_widget.md)
Persistent 4–5 line themed bar below the editor (model/cache, prompts/cost,
timing/tools, timeframe averages, subscription allowance). States: hidden
(preference), render error line, allowance line hidden for unsupported
providers. `/aftc-footer` opens its settings menu (Enable footer / Show
recorded averages / Set averages timeframe) and the 19-option timeframe
picker (10 rolling + 9 calendar windows).

### AFTC text intro — see [1.5.13_intros.md](./1.5_feature_modules/1.5.13_intros.md)
One-line typewriter widget on session start ("AFTC" → "All For The Code —
pi-toolset vX.Y.Z — …"). Self-clearing; `/aftc-intro-on|off`. WarGames
full-screen intro exists but is dormant (factory disconnected).

### SSH connection manager (/ssh-cm, /ssh-connection-manager) — see [1.6.5](./1.6_ssh/1.6.5_connection_manager.md)
Full-screen list of saved connections (`name` + `user@host[:port]` only).
Tab focus between list and options row `[ Add new connection ] [ Edit ]
[ Delete ]`; ↑/↓ wrap, PgUp/PgDn page, Home/End edges; Enter activates the
focused option; Esc/Ctrl+C closes. Empty state focuses the options row.
Re-opens fresh after every add/edit/delete.

### New connection dialog — see [1.6.6](./1.6_ssh/1.6.6_new_connection_dialog.md)
AftcForm: name/username/host (required), port int 1–65535 (default 22),
timeout int 1–300 s (default 30), key path (optional), password (optional,
masked). Empty password → "Are you sure?" confirm; name collision → replace
confirm; saves to ssh.json (1.6.3).

### Edit connection / auth overlays — see [1.6.7](./1.6_ssh/1.6.7_connection_form.md)
Edit form (same fields minus password; saved password preserved) and the
connect-time auth flow: auth-method menu (Password / Private key) then
`ctx.ui.input` password or passphrase prompt. Headless falls back to
sequential per-field prompts.

### Confirm overlay — see [1.6.8](./1.6_ssh/1.6.8_confirm_overlay.md)
Two-button showConfirm wrapper; safe option highlighted by default; used for
host-key approval, delete/replace confirms, upload/download overwrites,
usage-clear, /docx confirms.

### Interactive SSH terminal (/ssh-shell) — see [1.6.9](./1.6_ssh/1.6.9_terminal_overlay.md)
VT100 virtual screen (1.3.3) inside an AFTC panel; forwards typing,
navigation, function keys and Ctrl chords; Esc goes to the remote program;
Ctrl+] exits locally; PTY resized to the viewport; 150 ms poll.

### Footer menus — part of [1.4.2](./1.4_footer_usage/1.4.2_footer_widget.md)
Settings-hub loop menu (selection preserved across toggles) + timeframe
picker with rolling-window hints and `(current)` marker.

### Theme picker (/theme) — see [1.5.10](./1.5_feature_modules/1.5.10_theme.md)
showMenu over `ctx.ui.getAllThemes()`; live preview on highlight; Enter
commits, Esc reverts; `(current)` marker; headless lists names on stdout.

### Quick dir access (/qd) — see [1.5.7](./1.5_feature_modules/1.5.7_navigation.md)
Menu: "Open users data dir" / "Open .pi data dir" → OS file manager
(explorer/open/xdg-open, detached).

### Notification sounds hub — see [1.5.4](./1.5_feature_modules/1.5.4_notify.md)
Settings hub: Enabled toggle + 8 category rows (startup, question, task,
error, aborted, context 25/50/75) each showing current sound, + "Open
notification sounds dir". Each row opens a sound picker (MP3 list + NONE).

### /aftc-help — see [1.5.2](./1.5_feature_modules/1.5.2_help.md)
Scrollable viewer: registry-driven command sections (13 categories), static
Skills list, static Shortcuts table.

### Cache viewers — part of [1.4.1](./1.4_footer_usage/1.4.1_cache_core.md)
`/cache-profile` (per-tool schema costs, prefix shape, churn) and
`/cache-stats` (session cache + ROI + burn rate) rendered in showViewer.

### Codex menus — see [1.7.3](./1.7_aftc_codex/1.7.3_commands.md)
`/codex` main menu (Codex Enabled / Inject Thought Guidance / Auto-Detect &
Load Docs / Auto Sync on Startup / Resources &
Updates), resources sub-menu
(sync/install/status), first-run seed choice (Pre-trained / Fresh Start),
install wipe confirms, status viewer.

### /docx + /docx-update modals — see [1.8.1](./1.8_docx/1.8.1_docx_command.md)
Refusal info modal at ≥25% context; existing-docx update-vs-rebuild modal
(/docx with a docx/ folder, TUI only); advisory confirm at ≥20%; backup
confirmation (wording differs per command); project-type picker (10 packs,
auto-detect pre-selected). Both commands share the same modal flow.

### Sub-agent screens (/007 family) — see [1.9.7](./1.9_subagents/1.9.7_commands_ui.md)
`/007` main menu (disabled state: enable-first; enabled state: Active work,
Browse agents with source dots + detail actions, Open agents folder,
seed-mismatch row, Settings, guide, Disable), first-enable seeding confirm,
`/007-edit` agent picker → per-agent On/Off options menu (frontmatter flags
+ raw-file edit + reset), `/007-settings` menus, `/007-status` live table,
`/007-kill` toggle-mark multi-select, `/007-guide`/`/007-doctor` viewers,
disable finish-or-kill confirm. All aftc-ui menus/confirms/viewers; headless
prints bounded blocks.

### Installer surfaces — see [1.5.3](./1.5_feature_modules/1.5.3_install.md)
`/aftc-install`: missing-deps confirm modal → npm install + uv sync →
result viewer; session-start warning line when deps are missing.

### Usage report — see [1.4.5](./1.4_footer_usage/1.4.5_usage_report.md)
Report web app in `<dataDir>/usage-report/`, served by a bundled local
server and opened in the browser; 7 tabs (Overview, Models, Thinking levels, Timings, Projections, Context & allowance, Errors); `/usage-clear` confirm overlay.

### Inline transcript entries
`/dir` `/ls` listing card and `/cwd` card (customMessageBg Box); replay
save/empty notices; response divider rule; aftc-console severity lines;
codex banners; the intro feedback line (`aftc-intro-feedback` renderer -
feedback prompt + clickable link, display-only; disabled 2026-08 via the
`feedbackEnabled` flag in intro-text.ts). All rendered via
`pi.appendEntry` / custom message renderers — persisted in the session,
filtered from LLM context.

## Related

- [1_extension_map.md](./1_extension_map.md) · [design.md](../design.md)
- Surface framework: [1.3_ui/1.3.2_aftc_ui.md](./1.3_ui/1.3.2_aftc_ui.md)
