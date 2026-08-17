# 1 - Extension source — Sub-map

Sub-map of the `extensions/aftc-toolset` branch. Duplicates the branch from
the root map (drift check: if they disagree, re-verify against source and fix
both). Leaf annotations live here; the root map annotates branches only.

<!-- structure-map - last-verified: 2026-08-15 - regenerate: run /docx (pi-aftc-toolset documentation generator) -->

## Full Tree

```
1 Extension source (extensions/aftc-toolset)
|- 1.1 Entry & orchestration (index.ts, types.ts)
|- 1.2 Core infrastructure & config (paths, config, db, debug-log, help-registry)
|- 1.3 UI framework (ui/)
|  |- 1.3.1 aftc-console
|  |- 1.3.2 aftc-ui
|  \- 1.3.3 terminal-screen
|- 1.4 Footer, cache & usage
|  |- 1.4.1 Cache diagnostics core (core.ts)
|  |- 1.4.2 Footer widget (+ /aftc-footer menus)
|  |- 1.4.3 Subscription allowance
|  |- 1.4.4 Usage recording
|  \- 1.4.5 Usage report (usage-report app + server)
|- 1.5 Feature modules
|  |- 1.5.1 Keyboard shortcuts (keys.ts)
|  |- 1.5.2 Help & discovery (help.ts)
|  |- 1.5.3 Installer (/aftc-install)
|  |- 1.5.4 Audio notifications (notify.ts)
|  |- 1.5.5 Response divider (response.ts)
|  |- 1.5.6 Emergency stop (stfu.ts)
|  |- 1.5.7 Directory & navigation (/dir /ls /cwd /qd)
|  |- 1.5.8 Replay (/save-replay-prompt /replay /r)
|  |- 1.5.9 Keep it short (/keep-it-short /kis)
|  |- 1.5.10 Theme picker (/theme)
|  |- 1.5.11 Think-tag parser (think-parser.ts)
|  |- 1.5.12 run_script tool (run-script.ts)
|  |- 1.5.13 Startup intros (intros/)
|  |- 1.5.14 Providers (providers/ — DISABLED)
|  |- 1.5.15 aftc-resume (resume.ts)
|  |- 1.5.16 Peer chat (chat.ts)
|  |- 1.5.17 Background terminals (background-terminals/)
|  |- 1.5.18 Copy all (copy-all.ts)
|  \- 1.5.19 File search (file-search/)
|- 1.6 SSH feature (ssh/)
|  |- 1.6.1 Command & tool surface (ssh/index.ts)
|  |- 1.6.2 Sessions & lifecycle (session.ts)
|  |- 1.6.3 Connection store (ssh.json)
|  |- 1.6.4 Redaction & safe errors (redaction.ts)
|  |- 1.6.5 Connection manager screen (/ssh-cm)
|  |- 1.6.6 New connection dialog
|  |- 1.6.7 Connection form & auth overlays
|  |- 1.6.8 Confirm overlay
|  |- 1.6.9 Interactive terminal overlay (/ssh-shell)
|  \- 1.6.10 Python carrier (ssh/carrier/)          sub-project
|     |- 1.6.10.1 Daemon & JSON-RPC
|     |- 1.6.10.2 Sessions & modes
|     |- 1.6.10.3 SFTP & port forwarding
|     \- 1.6.10.4 Safety
|- 1.7 aftc-codex knowledge base (aftc-codex/)
|  |- 1.7.1 Store, seeding & version lifecycle
|  |- 1.7.2 System-prompt injection & detection
|  |- 1.7.3 Commands (/aftc-codex-*)
|  |- 1.7.4 Model tools (codex_load/add/edit/remove)
|  \- 1.7.5 Learn & live-to-seed scripts
\- 1.8 docx documentation generator (docx/)
   |- 1.8.1 /docx command & flow
   |- 1.8.2 Backup
   |- 1.8.3 Shipped guide & type packs
   \- 1.8.4 Helper scripts
```

## Annotations

| ID | Name | Tags | Doc | Status |
| --- | --- | --- | --- | --- |
| 1.1 | Entry & orchestration | | [1.1_orchestration.md](./1.1_orchestration.md) | done |
| 1.2 | Core infrastructure & config | `shared` | [1.2_core_infrastructure_documentation.md](./1.2_core_infrastructure_documentation.md) | done |
| 1.3.1 | aftc-console | `shared` | [1.3_ui/1.3.1_aftc_console.md](./1.3_ui/1.3.1_aftc_console.md) | done |
| 1.3.2 | aftc-ui | `shared` | [1.3_ui/1.3.2_aftc_ui.md](./1.3_ui/1.3.2_aftc_ui.md) | done |
| 1.3.3 | terminal-screen | `shared` | [1.3_ui/1.3.3_terminal_screen.md](./1.3_ui/1.3.3_terminal_screen.md) | done |
| 1.4.1 | Cache diagnostics core | | [1.4_footer_usage/1.4.1_cache_core.md](./1.4_footer_usage/1.4.1_cache_core.md) | done |
| 1.4.2 | Footer widget | surface | [1.4_footer_usage/1.4.2_footer_widget.md](./1.4_footer_usage/1.4.2_footer_widget.md) | done |
| 1.4.3 | Subscription allowance | | [1.4_footer_usage/1.4.3_allowance.md](./1.4_footer_usage/1.4.3_allowance.md) | done |
| 1.4.4 | Usage recording | | [1.4_footer_usage/1.4.4_usage_recording.md](./1.4_footer_usage/1.4.4_usage_recording.md) | done |
| 1.4.5 | Usage report | surface | [1.4_footer_usage/1.4.5_usage_report.md](./1.4_footer_usage/1.4.5_usage_report.md) | done |
| 1.5.1 | Keyboard shortcuts | surface | [1.5_feature_modules/1.5.1_keys.md](./1.5_feature_modules/1.5.1_keys.md) | done |
| 1.5.2 | Help & discovery | surface | [1.5_feature_modules/1.5.2_help.md](./1.5_feature_modules/1.5.2_help.md) | done |
| 1.5.3 | Installer | surface | [1.5_feature_modules/1.5.3_install.md](./1.5_feature_modules/1.5.3_install.md) | done |
| 1.5.4 | Audio notifications | surface | [1.5_feature_modules/1.5.4_notify.md](./1.5_feature_modules/1.5.4_notify.md) | done |
| 1.5.5 | Response divider | | [1.5_feature_modules/1.5.5_response_divider.md](./1.5_feature_modules/1.5.5_response_divider.md) | done |
| 1.5.6 | Emergency stop | | [1.5_feature_modules/1.5.6_stfu.md](./1.5_feature_modules/1.5.6_stfu.md) | done |
| 1.5.7 | Directory & navigation | surface | [1.5_feature_modules/1.5.7_navigation.md](./1.5_feature_modules/1.5.7_navigation.md) | done |
| 1.5.8 | Replay | | [1.5_feature_modules/1.5.8_replay.md](./1.5_feature_modules/1.5.8_replay.md) | done |
| 1.5.9 | Keep it short | | [1.5_feature_modules/1.5.9_keep_it_short.md](./1.5_feature_modules/1.5.9_keep_it_short.md) | done |
| 1.5.10 | Theme picker | surface | [1.5_feature_modules/1.5.10_theme.md](./1.5_feature_modules/1.5.10_theme.md) | done |
| 1.5.11 | Think-tag parser | | [1.5_feature_modules/1.5.11_think_parser.md](./1.5_feature_modules/1.5.11_think_parser.md) | done |
| 1.5.12 | run_script tool | | [1.5_feature_modules/1.5.12_run_script.md](./1.5_feature_modules/1.5.12_run_script.md) | done |
| 1.5.13 | Startup intros | surface | [1.5_feature_modules/1.5.13_intros.md](./1.5_feature_modules/1.5.13_intros.md) | done |
| 1.5.14 | Providers (DISABLED) | | [1.5_feature_modules/1.5.14_providers.md](./1.5_feature_modules/1.5.14_providers.md) | done |
| 1.5.15 | aftc-resume | | [1.5_feature_modules/1.5.15_aftc_resume.md](./1.5_feature_modules/1.5.15_aftc_resume.md) | done |
| 1.5.16 | Peer chat (/chat family) | surface | [1.5_feature_modules/1.5.16_chat.md](./1.5_feature_modules/1.5.16_chat.md) | done |
| 1.5.17 | Background terminals | surface | [1.5_feature_modules/1.5.17_background_terminals.md](./1.5_feature_modules/1.5.17_background_terminals.md) | done |
| 1.5.18 | Copy all (/copy-all) | | [1.5_feature_modules/1.5.18_copy_all.md](./1.5_feature_modules/1.5.18_copy_all.md) | done |
| 1.5.19 | File search (fd + rg) | | [1.5_feature_modules/1.5.19_file_search.md](./1.5_feature_modules/1.5.19_file_search.md) | done |
| 1.6.1 | SSH command & tool surface | | [1.6_ssh/1.6.1_command_tool_surface.md](./1.6_ssh/1.6.1_command_tool_surface.md) | done |
| 1.6.2 | Sessions & lifecycle | | [1.6_ssh/1.6.2_sessions.md](./1.6_ssh/1.6.2_sessions.md) | done |
| 1.6.3 | Connection store | | [1.6_ssh/1.6.3_connection_store.md](./1.6_ssh/1.6.3_connection_store.md) | done |
| 1.6.4 | Redaction & safe errors | | [1.6_ssh/1.6.4_redaction.md](./1.6_ssh/1.6.4_redaction.md) | done |
| 1.6.5 | Connection manager screen | surface | [1.6_ssh/1.6.5_connection_manager.md](./1.6_ssh/1.6.5_connection_manager.md) | done |
| 1.6.6 | New connection dialog | surface | [1.6_ssh/1.6.6_new_connection_dialog.md](./1.6_ssh/1.6.6_new_connection_dialog.md) | done |
| 1.6.7 | Connection form & auth overlays | surface | [1.6_ssh/1.6.7_connection_form.md](./1.6_ssh/1.6.7_connection_form.md) | done |
| 1.6.8 | Confirm overlay | surface | [1.6_ssh/1.6.8_confirm_overlay.md](./1.6_ssh/1.6.8_confirm_overlay.md) | done |
| 1.6.9 | Interactive terminal overlay | surface | [1.6_ssh/1.6.9_terminal_overlay.md](./1.6_ssh/1.6.9_terminal_overlay.md) | done |
| 1.6.10.1 | Carrier daemon & JSON-RPC | | [1.6_ssh/1.6.10_carrier/1.6.10.1_daemon_rpc.md](./1.6_ssh/1.6.10_carrier/1.6.10.1_daemon_rpc.md) | done |
| 1.6.10.2 | Carrier sessions & modes | | [1.6_ssh/1.6.10_carrier/1.6.10.2_sessions_modes.md](./1.6_ssh/1.6.10_carrier/1.6.10.2_sessions_modes.md) | done |
| 1.6.10.3 | Carrier SFTP & forwarding | | [1.6_ssh/1.6.10_carrier/1.6.10.3_sftp_forward.md](./1.6_ssh/1.6.10_carrier/1.6.10.3_sftp_forward.md) | done |
| 1.6.10.4 | Carrier safety | | [1.6_ssh/1.6.10_carrier/1.6.10.4_safety.md](./1.6_ssh/1.6.10_carrier/1.6.10.4_safety.md) | done |
| 1.7.1 | Codex store & lifecycle | | [1.7_aftc_codex/1.7.1_store_lifecycle.md](./1.7_aftc_codex/1.7.1_store_lifecycle.md) | done |
| 1.7.2 | Codex injection & detection | | [1.7_aftc_codex/1.7.2_injection.md](./1.7_aftc_codex/1.7.2_injection.md) | done |
| 1.7.3 | Codex commands | surface | [1.7_aftc_codex/1.7.3_commands.md](./1.7_aftc_codex/1.7.3_commands.md) | done |
| 1.7.4 | Codex model tools | | [1.7_aftc_codex/1.7.4_tools.md](./1.7_aftc_codex/1.7.4_tools.md) | done |
| 1.7.5 | Learn & live-to-seed scripts | | [1.7_aftc_codex/1.7.5_learn_sync_scripts.md](./1.7_aftc_codex/1.7.5_learn_sync_scripts.md) | done |
| 1.8.1 | /docx command & flow | surface | [1.8_docx/1.8.1_docx_command.md](./1.8_docx/1.8.1_docx_command.md) | done |
| 1.8.2 | docx backup | | [1.8_docx/1.8.2_backup.md](./1.8_docx/1.8.2_backup.md) | done |
| 1.8.3 | Shipped guide & type packs | | [1.8_docx/1.8.3_guide_packs.md](./1.8_docx/1.8.3_guide_packs.md) | done |
| 1.8.4 | Helper scripts | | [1.8_docx/1.8.4_scripts.md](./1.8_docx/1.8.4_scripts.md) | done |

Branch nodes 1.3, 1.4, 1.5, 1.6, 1.6.10, 1.7, 1.8 carry their own deep docs
and sub-maps inside their folders.

### Status legend

- `done` — verified against source this pass. `placeholder` — stub.
  `missing` — identified, not written. `reserved` — deleted ID, never reused.

## Related

- Root map: [project_map.md](../project_map.md)
- Sitemap partner: [1_tui_sitemap.md](./1_tui_sitemap.md)
- Design rules for every surface: [design.md](../design.md)
