# Docker

## Rules

## Gotchyas

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
  Fix: `docker cp script.php CONTAINER:/tmp/script.php` then `docker exec CONTAINER php /tmp/script.php`. The script can use relative `require __DIR__ . '/vendor/autoload.php'` (or its framework's autoloader) and reads container env (`getenv('DATABASE_HOST')` etc.) for DB connection — same code paths as a normal request. Clean up afterwards with `docker exec CONTAINER rm /tmp/script.php`. For PHP-FPM containers without a CLI, run it via `docker exec CONTAINER php-cli /tmp/script.php` or temporarily drop a script into the docroot and curl it. (2026-07)
- [bX7mK2] The `php:8.5-apache-bookworm` image's default `000-default.conf` DocumentRoot is `/var/www/html` and the default index served is `index.php`, so the SPA at `/var/www/httpdocs/index.html` is never reached even with the right volume mount
  Cause: the image ships a working Apache vhost pointed at `/var/www/html`; `volumes: - ./server/httpdocs:/var/www/httpdocs:ro` mounts your code but doesn't re-point the vhost.
  Fix: in the php-apache Dockerfile, RUN `sed -ri 's!/var/www/html!/var/www/httpdocs!g' /etc/apache2/sites-available/000-default.conf` so the vhost serves the mounted dir. Combine with a `RewriteRule ^$ /index.html [L]` (or the framework's SPA .htaccess) so the SPA at `/` returns `index.html` instead of the framework's `index.php`. Without the sed, the dir listing or `index.php` wins and the build output is invisible. (2026-07)
- [F2gN4b] PHP file edits inside the container don't take effect for hours despite the volume mount working and the page returning 200
  Cause: the image's default opcache config caches pre-compiled PHP for 60 seconds, and opcache won't even CHECK for changes with the default `opcache.validate_timestamps=0` (production mode).
  Fix: in `php.ini` set `opcache.validate_timestamps=1` and `opcache.revalidate_freq=2` (every 2 seconds) — every request checks the file mtime and recompiles if changed. This is the right dev-mode setting; production should use the defaults for performance. Verify with `php -i | grep opcache.validate_timestamps` inside the container. (2026-07)
- [D6pM1K] `docker exec CONTAINER mysql ...` returns `Access denied for user 'app'@'%' to database 'shop_db'` on the second init script, even though the first one worked
  Cause: the `MYSQL_DATABASE` env var only creates the NAMED database AND grants access to it for the NAMED user. Any OTHER database you create in a later init script (`02-shop.sh`) needs a separate `GRANT ALL ON shop_db.* TO 'app'@'%'` — the `MYSQL_USER` is NOT auto-privileged on databases created after container init.
  Fix: at the top of every init script that creates its own database, run `mysql -e "GRANT ALL ON <that_db>.* TO '${MYSQL_USER}'@'%'; FLUSH PRIVILEGES;"` BEFORE the `USE` / `CREATE TABLE` statements, OR set up a second `MYSQL_DATABASE` env var (MySQL 8 supports `MYSQL_MULTI_DATABASE` in some images) and use docker `--mount` of a `mysql-init-file` to grant the access. (2026-07)
