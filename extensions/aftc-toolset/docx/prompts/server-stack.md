# PROJECT-TYPE PACK: Linux server / Docker stack

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, what counts as a "surface" here, and the per-surface specifics.
Where it sharpens the core, follow it. The core's rules (mirrored tree, one
deep doc per ID, source-over-docs, full pass) still apply.

This pack covers infrastructure / hosting repositories: a Linux server (VM,
VPS, bare metal) provisioned and run by scripts, with a Docker Compose stack
(nginx and/or Apache, PHP, MySQL/MariaDB, monitoring, tools), SSL
automation, systemd units/timers, cron jobs and operator shell scripts. The
repo usually runs in TWO environments (a local dev machine and the live
server) from the same files.

There is typically NO user-facing UI in these repos. Do not invent UI
branches, sitemaps or design docs for them.

## Sources of truth (recon - read these, never the old docs)

- COMPOSE FILES: docker-compose.yml + every override (compose.local.yml,
  compose.prod.yml). Every service, build context, env var, volume, port,
  healthcheck, resource limit and network.
- DOCKERFILES + build contexts: base images, packages, copied config,
  entrypoints. Read any entrypoint script FULLY - it often generates the
  real runtime config (vhosts, certificates) from env vars at container
  start, and that generated behaviour is what you document.
- WEB SERVER CONFIG: nginx.conf, conf.d/, sites-*, Apache confs, .htaccess
  (note when AllowOverride None makes .htaccess dead). Record every vhost:
  domains, docroot or proxy upstream, redirects, TLS, headers.
- ENV FILES: .env, .env.<env>, .env.example pairs. Each var: default,
  meaning, which environment file sets it. Note secrets policy (committed
  vs gitignored) exactly as the project states it - never "improve" it.
- SCRIPTS: every .sh/.bash/.ps1/.bat in the repo (root + scripts/ + cron
  dirs). For each: purpose, exact invocation, what it does step by step,
  env vars, confirmation prompts, destructive actions, which host it runs
  on.
- HOST CONFIG: anything the scripts write outside the repo - systemd units
  and timers, cron entries, firewall rules, swap, fstab, sysctl. Document
  the unit name, schedule and the command it runs.
- SSL: certbot scripts/hooks/timers, cert paths, the SAN domain list,
  renewal flow.
- DATABASE: init/migration scripts, my.cnf/cnf files, .env DB vars,
  existing databases in the data dir.

## What counts as a "surface" on this stack

There are no pages or modals here. The surfaces to inventory and document
are:

- Every CONTAINER (full core container rules apply - one deep doc each,
  including one-shot and dev-tool containers).
- Every VHOST / hosted site: domain, type (static / proxy / redirect),
  docroot or upstream, owning container ID. If the stack HOSTS websites,
  document the HOSTING of each site only - pages, endpoints and site
  content are out of scope unless the user explicitly asks for them.
- Every OPERATOR SCRIPT or script group: tiny related scripts (enable/
  disable pairs, per-host twins) share ONE leaf doc; a long or complex
  script (deploy pipeline, installer) gets its own leaf doc.
- Every SCHEDULED JOB: systemd timer, cron entry - name, schedule, command,
  the script that installs it.
- Every HOST SERVICE the repo manages (a host-level FTP/server package,
  firewall profile).

## Hard rule: the project's own rules outrank this pack

Read the project's AGENTS.md / repo conventions FIRST during recon. If the
project declares an area out of documentation scope (for example "hosted
website content is never documented"), honour it exactly: document the
boundary instead of the content. Never let this pack's inventory rules push
you into documenting something the project has excluded.

## Per-surface contract specifics

- Container deep doc: the core container contents list in full, PLUS the
  entrypoint-generated behaviour (every vhost/config it writes at start,
  in order) when the entrypoint generates config.
- Script leaf doc: purpose -> usage (exact command line, per host) ->
  step-by-step behaviour -> env vars with defaults -> safety (confirmations,
  dry-run flags, what it can delete) -> failure modes found in the code.
- Scheduled job: unit/cron name, schedule in plain words, the exact command
  run, install/remove scripts, how to verify it is armed.
- Vhost table per web server: domain -> type -> target -> doc container ID.

## Environment duality (always document both)

These repos almost always run local + live from one source. For every
container, path and port, record BOTH: the live values AND the local
override values, and name the mechanism that switches them (env file pair,
compose override file, per-host script twins). A doc that only covers the
live server is half a doc.

## Extra rules

- Record exact versions from the compose file / Dockerfiles (image tags,
  base image tags) - "latest" is a real answer when the tag says latest.
- The dependency_map's mount map and runtime graph are the heart of these
  projects - fill them completely (every bind mount, who reads/writes it).
- Document the operator flows end to end (provision a new server, deploy
  an update, renew certs, restore content) as numbered command sequences.
