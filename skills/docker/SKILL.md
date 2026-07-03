---
name: docker
description: Docker, Docker Compose, Dockerfile best practices, and multi-service orchestration. Use when writing Dockerfiles, docker-compose.yml, container healthchecks, or working with Docker images, volumes, and networks.
---

# Docker

## Project Setup
- Use `docker-compose.yml` for multi-service orchestration
- Use `Dockerfile` for custom images; place in `dockerfiles/<service>/Dockerfile`
- Use `.env` for configurable ports and credentials (never hardcode)
- Use `.dockerignore` to exclude node_modules, .git, .env, logs

## Docker Compose Best Practices
- Every service needs a `container_name`
- Use `healthcheck` with appropriate intervals for all services
- Use `depends_on` with `condition: service_healthy` for startup ordering
- Use named volumes for persistent data (MySQL, MongoDB, Redis)
- Use bind mounts only for development code (`./src:/app/src`)
- Always specify `restart: unless-stopped` or `on-failure:N`
- Use `networks` to isolate services on a shared bridge network

## Dockerfile Best Practices
- Use specific base image tags (e.g., `php:8.5-apache`, not `php:latest`)
- Combine RUN commands with `&&` to reduce layers
- Clean up package caches in the same RUN layer (`rm -rf /var/lib/apt/lists/*`)
- Use `COPY` not `ADD` unless you need tar extraction
- Set `WORKDIR` before COPY/RUN commands
- Use multi-stage builds for compiled languages and Composer
- Order COPY by change frequency (package.json first, then source)
- Never run as root in production - use `USER www-data` or equivalent
- Include HEALTHCHECK instruction

## PHP-Apache Specific
- Enable mod_rewrite for clean URLs: `a2enmod rewrite`
- Enable mod_headers for security headers: `a2enmod headers`
- Set `AllowOverride All` for `.htaccess` support
- Document root: `/var/www/httpdocs` (mapped from `./server/httpdocs`)
- PHP extensions via `install-php-extensions`: gd, pdo_mysql, mysqli, zip, redis, xdebug
- PHP config in `/usr/local/etc/php/conf.d/php-optimized.ini`
- Composer install: `curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer`
- `APACHE_DOCUMENT_ROOT` env var must match volume mount

## MySQL Specific
- Use `mysql:9.7` base image
- Healthcheck: `mysqladmin ping -h localhost -uroot --silent`
- Init SQL in `/docker-entrypoint-initdb.d/` (runs alphabetically on first boot)
- Data persisted via named volume to `/var/lib/mysql`
- For development, `MYSQL_ALLOW_EMPTY_PASSWORD: "true"`; for production, use `MYSQL_ROOT_PASSWORD`

## Port Conventions
- PHP-Apache: 8080 (configurable via APP_PORT)
- MySQL: 3306 (configurable via MYSQL_PORT)
- phpMyAdmin: 8081 (configurable via PMA_PORT)
- Node.js: 3000
- Deno: 8000
- Bun: 3000
- Redis: 6379
- MongoDB: 27017
- Nginx: 80/443
- Use 127.0.0.x for multi-service local access

## Template Deployment
- When a template is deployed, READ ALL files before making changes
- Read the template README.md for guidance on file layout and conventions
- Update .env.example with new variables needed
- Update docker-compose.yml for any new services or port changes
- Update the Dockerfile for version changes or new extensions
- Update smoke tests to verify new functionality
- After all changes, verify: `docker compose config` (YAML validation)
- Run `docker compose up -d --build` and check `docker compose ps`

## Smoke Test Pattern
- Verify `docker --version` and `docker compose version`
- Verify all containers running: `docker compose ps --status running`
- Verify healthchecks pass for each service
- Verify HTTP endpoints respond: `curl -sf http://localhost:<port>/`
- Verify database connectivity
- Verify file integrity (docker-compose.yml, README.md, key source files)

## Common Pitfalls
- `docker-compose` vs `docker compose` - use `docker compose` (v2)
- Port conflicts - check nothing else uses the port before starting
- Volume permission issues on Linux - match UID/GID in Dockerfile
- Init SQL only runs on FIRST boot - use `docker compose down -v` to reset
- .env file must be in same directory as docker-compose.yml
- Container name conflicts - `docker compose down` before rebuilding
