---
name: nginx
description: Nginx web server configuration, reverse proxy, SSL/TLS setup, and performance tuning. Use when editing nginx.conf, setting up reverse proxies, configuring SSL/TLS with Let's Encrypt, or tuning nginx performance.
---

# Nginx

- Use separate `server` blocks for each site in `sites-available/` with symlinks to `sites-enabled/`.
- Always redirect HTTP to HTTPS in production.
- Use `ssl_certificate` and `ssl_certificate_key` with Let's Encrypt (certbot).
- Enable gzip compression: `gzip on; gzip_types text/plain text/css application/json application/javascript;`.
- Set reasonable timeouts: `client_body_timeout 12; client_header_timeout 12; keepalive_timeout 15;`.
- Use `try_files` instead of `if` for request routing when possible.
- Rate limiting for API endpoints: `limit_req_zone` and `limit_req`.
- Test config before reload: `nginx -t && nginx -s reload`.
