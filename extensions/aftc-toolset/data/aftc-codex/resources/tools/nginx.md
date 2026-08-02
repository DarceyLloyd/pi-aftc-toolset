# Nginx

## Rules

## Gotchyas

- [nG4xQ7] open_file_cache_errors on - nginx caches 404s and only revalidates them every open_file_cache_valid interval (eg 120s), so files restored to disk keep 404ing while sibling files restored at the same time work; reload nginx (kill -s HUP / nginx -s reload) to clear instantly, or wait out the interval - check this before suspecting permissions/mounts.

## Issues & Solutions
