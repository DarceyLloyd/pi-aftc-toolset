# OSX (macOS)

## Rules

## Gotchyas

- [SBGBCv] A zip created on Windows stores no Unix exec bits, so a bundled binary extracts non-executable on macOS/Linux and subprocess exec fails with 'Permission denied' — copy it to a writable runtime dir and `chmod +x` there (you cannot chmod a file inside a read-only app bundle).

- [jnFS9u] macOS apps launched from Finder inherit a minimal PATH (system dirs only), so Homebrew-installed tools are invisible to child scripts and spawned processes — prepend the Homebrew prefix bin dirs (both Apple-Silicon and Intel prefixes) to PATH in the setup script AND in every child-process env you build.

- [GwjgAd] A macOS .app bundle is not reliably writable — launched straight from the mounted DMG, or installed to the shared Applications folder by a non-admin user, its contents are read-only — so writing venvs/caches/lock files/downloaded tools into the bundle fails mid-setup; keep only code and static assets in the bundle and write all runtime state to the per-user data directory.

## Issues & Solutions

- [2RIktq] A bundled executable (e.g. an ffmpeg shipped inside a zip) dies on macOS with 'killed: 9'/EPERM immediately after being chmod +x'd — Gatekeeper kills it on exec.
  Cause: The zip was downloaded in a browser, so macOS attached the com.apple.quarantine extended attribute to every extracted file and that attribute propagated through later copies; chmod +x fixes the exec bit but does NOT clear quarantine, and Gatekeeper blocks quarantined unsigned/ad-hoc binaries.
  Fix: After copying the binary to a writable runtime location, clear the attribute with `xattr -d com.apple.quarantine <binary>` (ignore failure) before executing it. (2026-08)
