# Nginx

## Rules

## Gotchyas

- [nG4xQ7] open_file_cache_errors on - nginx caches 404s and only revalidates them every open_file_cache_valid interval (eg 120s), so files restored to disk keep 404ing while sibling files restored at the same time work; reload nginx (kill -s HUP / nginx -s reload) to clear instantly, or wait out the interval - check this before suspecting permissions/mounts.

- [9C4I5B] Auditing an endpoint's client-IP logs, an unknown IP may be the server ITSELF - a curl from the host to its own public hostname (smoke test / verify POST) arrives with the server's public egress IP and looks exactly like a foreign user; identify the server's public IP (curl ifconfig.me / api.ipify.org) BEFORE treating any unknown IP as an outsider.

## Issues & Solutions
