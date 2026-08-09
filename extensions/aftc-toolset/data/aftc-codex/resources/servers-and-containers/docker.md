# Docker

## Rules

- [AFvnl6] slim container images with no curl/wget: implement the healthcheck with the runtime itself (a one-liner fetch in node/bun/python that exits on the response status) instead of installing a tool

## Gotchyas

- [mB4rT8] bind-mount source mv'd - `mv`-ing a host dir that is bind-mounted into a running container does NOT break the mount (it is inode-tracked): the container keeps serving the moved/old dir and never sees a fresh dir created at the original path; recreate the container to re-bind after swapping host paths.

- [E2csnf] docker compose build sits on "transferring context" for many minutes (GBs) before building - the build context is the whole repo and .dockerignore misses heavy fixture/test dirs; watch the transferring-context size in the build output and exclude them (note: a file under an excluded PARENT dir cannot be re-included with a ! negation).

- [JRSeUt] /docker-entrypoint-initdb.d does NOT recurse into subdirectories - the official MySQL/MariaDB entrypoint seeds from a flat glob (docker_process_init_files /docker-entrypoint-initdb.d/*) and any subfolder matches no extension so it is silently ignored (its contents never run); to get per-service subfolder separation add a top-level 00-bootstrap.sh WITHOUT the execute bit (so the entrypoint sources it, keeping docker_process_sql in scope) that loops /docker-entrypoint-initdb.d/*/ and pipes each .sql through that helper.

- [QOs3ap] rename(2) / fs.renameSync fails with EXDEV when src and dst sit on two DIFFERENT bind mounts inside a container, even when `stat` shows the same device - mount boundaries, not devices, are what rename cannot cross. Countermeasure: move files across mounts with copy + unlink; beware that host-side tests can hide the bug when both dirs share one mount.

- [wfceGe] in-container file watchers (bun --watch, nodemon, vite HMR) never fire for edits made on a Windows-host bind mount - Docker Desktop file sharing does not propagate inotify events; keep the watch flag for Linux hosts but after host-side edits restart the container (`docker compose restart <svc>`) instead of waiting for a reload that never comes

- [gxGKcy] First run of a freshly built test container fails with "Cannot find module" for bare imports: `COPY .` + a .dockerignore that excludes node_modules leaves the copied tree without deps; run the package's installer inside the container before running its tests — it is a provisioning step, not a code bug.

- [geE9P3] Upgrading a containerized install by overlaying the new package with cp -r MERGES - files the new version removed survive in the install dir, and a later sync/merge step can copy those stale files back into user data; wipe + replace the install dir (or delete the removed paths) in upgrade-test overlays to emulate real package-manager update semantics.

## Issues & Solutions


- [vB3nC9] Cross-compiling in a container is slow to iterate because the source/build dir is COPY'd into the image (every code change rebuilds from scratch)
  Cause: COPY-ing the source into the image and building in-image makes the build directory ephemeral - each `docker build` restarts the compile, and the large source tree is re-sent as build context.
  Fix: keep the image as a TOOLCHAIN only; at `docker run` bind-mount the source read-only (`-v <src>:/work:ro`), put the CMake build dir on a Docker NAMED VOLUME (`-v myproj-build:/build` - native FS, incremental across runs), and copy only the final artefacts to a host-mounted output dir (`-v <out-dir>:/out`). Add a `.dockerignore` excluding the heavy dirs (e.g. the framework clone, build dirs) so the build context stays tiny - the source arrives via the mount, not the context. (2026-07)

- [xD5pF1] A shell script COPY'd into a Linux image from a Windows checkout dies with `$'\r': command not found`
  Cause: the script was saved with CRLF line endings; bash treats the CR as part of the command.
  Fix: strip CR at image-build time: `COPY docker/build.sh /usr/local/bin/build.sh` then `RUN sed -i 's/\r$//' /usr/local/bin/build.sh && chmod +x ...`. Also normalise any script that will run on Linux directly (the Dockerfile `sed` only fixes the COPY'd one). (2026-07)

- [wL7pQ2] Two docker compose projects in sibling dirs fight over the same containers (one overwrites the other; `--remove-orphans` even removes the sibling's containers)
  Cause: compose defaults the project name to the directory basename, and when two projects live in dirs with the SAME basename (e.g. two `<root>/website/` folders from the same template) they share the project name "website". Combined with identical explicit `container_name` values (phpapache-wl etc. - container names are GLOBAL) and an identical network name, `docker compose up` from project A recreates/overwrites project B's containers, so B ends up with A's ports/config and B's own up/restart silently no-ops or re-points them elsewhere.
  Fix: fully isolate each stack - set a unique top-level `name:` in each docker-compose.yml (compose v2 supports the `name:` property), give each a unique `container_name`/network, and keep service names (the in-network DNS) as you like. Then `docker compose` from each dir only ever touches its own project. Symptom to recognise: `docker port <container>` shows an IP/port from the OTHER project's .env, and `docker compose ls` shows the project's config file in a sibling directory. (2026-07)
- [rQ3mP5] You need to run a one-off script inside an already-running container (seed users, fix a row, regenerate a token) and reach for rebuilding the image or curling a route that doesn't exist
  Cause: rebuilding the image or adding a new HTTP route just to run admin/maintenance code is wasteful; mounting a script with `-v` is fragile if the host path changes; passing the script inline via `docker exec` `bash -c '...'` breaks on quoting / newlines.
  Fix: `docker cp script.php CONTAINER:/tmp/script.php` then `docker exec CONTAINER php /tmp/script.php`. The script can use relative `require __DIR__ . '/vendor/autoload.php'` (or its framework's autoloader) and reads container env (`getenv('DATABASE_HOST')` etc.) for DB connection - same code paths as a normal request. Clean up afterwards with `docker exec CONTAINER rm /tmp/script.php`. For PHP-FPM containers without a CLI, run it via `docker exec CONTAINER php-cli /tmp/script.php` or temporarily drop a script into the docroot and curl it. (2026-07)
- [bX7mK2] The `php:8.5-apache-bookworm` image's default `000-default.conf` DocumentRoot is `/var/www/html` and the default index served is `index.php`, so the SPA at `/var/www/httpdocs/index.html` is never reached even with the right volume mount
  Cause: the image ships a working Apache vhost pointed at `/var/www/html`; `volumes: - ./server/httpdocs:/var/www/httpdocs:ro` mounts your code but doesn't re-point the vhost.
  Fix: in the php-apache Dockerfile, RUN `sed -ri 's!/var/www/html!/var/www/httpdocs!g' /etc/apache2/sites-available/000-default.conf` so the vhost serves the mounted dir. Combine with a `RewriteRule ^$ /index.html [L]` (or the framework's SPA .htaccess) so the SPA at `/` returns `index.html` instead of the framework's `index.php`. Without the sed, the dir listing or `index.php` wins and the build output is invisible. (2026-07)
- [F2gN4b] PHP file edits inside the container don't take effect for hours despite the volume mount working and the page returning 200
  Cause: the image's default opcache config caches pre-compiled PHP for 60 seconds, and opcache won't even CHECK for changes with the default `opcache.validate_timestamps=0` (production mode).
  Fix: in `php.ini` set `opcache.validate_timestamps=1` and `opcache.revalidate_freq=2` (every 2 seconds) - every request checks the file mtime and recompiles if changed. This is the right dev-mode setting; production should use the defaults for performance. Verify with `php -i | grep opcache.validate_timestamps` inside the container. (2026-07)
- [D6pM1K] `docker exec CONTAINER mysql ...` returns `Access denied for user 'app'@'%' to database 'shop_db'` on the second init script, even though the first one worked
  Cause: the `MYSQL_DATABASE` env var only creates the NAMED database AND grants access to it for the NAMED user. Any OTHER database you create in a later init script (`02-shop.sh`) needs a separate `GRANT ALL ON shop_db.* TO 'app'@'%'` - the `MYSQL_USER` is NOT auto-privileged on databases created after container init.
  Fix: at the top of every init script that creates its own database, run `mysql -e "GRANT ALL ON <that_db>.* TO '${MYSQL_USER}'@'%'; FLUSH PRIVILEGES;"` BEFORE the `USE` / `CREATE TABLE` statements, OR set up a second `MYSQL_DATABASE` env var (MySQL 8 supports `MYSQL_MULTI_DATABASE` in some images) and use docker `--mount` of a `mysql-init-file` to grant the access. (2026-07)
- [rD9pT4] App (Apache/PHP-FPM as www-data) cannot delete files/dirs created earlier via `docker exec` - cleanup silently no-ops
  Cause: `docker exec` runs as root, so anything it creates (`mkdir`, `echo > file`) is root-owned with 0755; the web process user cannot unlink/rmdir inside those dirs, and PHP's `@`-suppressed unlink/rmdir hides the failure - the delete endpoint returns success while the dir lingers.
  Fix: when simulating app-created files in a test, `chown -R www-data:www-data` (or the app's user) after creating them via docker exec - or create them through the app itself (an upload/API call) so ownership matches production reality. (2026-07)
- [xE4fN7] `docker exec CONTAINER mysql ... <<'SQL'` - the heredoc SQL silently never runs (no output, no error, zero effect)
  Cause: `docker exec` does not attach stdin by default; without `-i` the container's stdin is closed, so a heredoc/pipe-fed command (mysql, sh, php) reads EOF immediately and exits 0 having executed nothing - the "migration" looks done but no change landed.
  Fix: always add `-i` when piping or heredoc-ing into `docker exec` (`docker exec -i CONTAINER mysql ... <<'SQL'`), and verify the effect afterwards (row counts, SHOW COLUMNS) instead of trusting the silent success. (2026-07)
- [dF6jN3] `/docker-entrypoint-initdb.d` is a READ-ONLY host bind-mount - `docker cp script.sh CONTAINER:/docker-entrypoint-initdb.d/` fails `mounted volume is marked read-only`; copy to `/tmp` instead and run from there (`docker cp` → `docker exec CONTAINER bash /tmp/x.sh` → `docker exec CONTAINER rm /tmp/x.sh`).

- [KRQjM0] browser e2e / curl against a previously-working local dockerized stack suddenly fails with net::ERR_CONNECTION_REFUSED on every URL
  Cause: the containers exited (often a graceful exit after a machine sleep/reboot or Docker Desktop restart) and nothing restarted them; the app code is fine, the URL just has no listener.
  Fix: before suspecting a code regression, run `docker ps -a` (check the Status column for 'Exited') and start the stack (`docker compose up -d`), wait for the healthcheck, then re-run. Recognise the pattern: the same URL worked earlier in the session and the failure is connection-refused on page.goto, not a timeout or a 5xx. (2026-08)

- [l7zf45] A container run with a read-write host bind-mount leaves Linux artifacts (.venv with symlinks, __pycache__) in the Windows working tree - later host-side tools die with EACCES stat on the symlinks
  Cause: The containerised runtime's installers (npm install, uv sync, pip) resolve and write INTO the mounted host tree: a Linux-built node_modules or .venv lands in the Windows working dir, and its symlinks (eg .venv/bin/python) fail Windows stat with EACCES, breaking test walkers and other host tooling.
  Fix: Bind-mount host source read-only (`-v <src>:/dst:ro`) whenever container-side package installs will run; let installs write container-local paths. If a Linux .venv/node_modules already polluted the host tree, delete it from the host (it is useless there) and re-run host tests. (2026-08)

- [wx78lg] docker exec -w /abs/path fails "OCI runtime exec failed: Cwd must be an absolute path" even though the path IS absolute
  Cause: A Docker Desktop (Windows) quirk: `docker exec -w <path>` rejects a valid absolute Linux path with that misleading error.
  Fix: Drop `-w` and pass the working dir through the shell instead: `docker exec <name> sh -c "cd /work && <cmd>"`. (2026-08)

- [iZuFpd] docker compose build fails on Windows: "no valid drivers found: failed to read metadata: open ...meta.json: The process cannot access the file because it is being used by another process"
  Cause: Docker Desktop's buildx metadata file was locked by another docker process (transient Desktop state, not a compose or Dockerfile problem).
  Fix: Restart Docker Desktop and retry; if builds stay wedged, wipe local images/volumes and rebuild fresh. (2026-08)
