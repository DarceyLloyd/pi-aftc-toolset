# Apache

## Rules

## Gotchyas

## Issues & Solutions


- [yv0n6X] Document root `/` serves the framework index.php instead of the SPA index.html even with `DirectoryIndex index.html index.php` in dir.conf
  Cause: mod_dir picks index.php in practice (vhost/`.htaccess` interaction).
  Fix: add an explicit `RewriteRule ^$ /index.html [L]` at the top of the docroot .htaccess. (2026-07)
- [Jn6LzF] Tests asserting "file not web-accessible" get a false 200
  Cause: the SPA docroot .htaccess falls back ALL missing paths to index.html (status 200).
  Fix: assert on response bytes/content-type, never on the status code, when verifying a file is not exposed. (2026-07)
