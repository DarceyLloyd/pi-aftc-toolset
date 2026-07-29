# Composer

## Rules

## Gotchyas

## Issues & Solutions


- `[EVN5hd] Your requirements could not be resolved ... affected by security advisories ("PKSA-y2cr-5h3j-g3ys")`
  Cause: Composer 2.10+ audit-blocking refuses to install firebase/php-jwt <7.0 (a DISPUTED "weak encryption" advisory about HMAC key-length enforcement; fixed upstream in 7.0).
  Fix: bump the constraint to `^7.0` (safe for RS256/384/512 usage: the `JWT::encode`/`JWT::decode`/`Key` API is unchanged and the new key-size validation passes for any RSA key >=2048 bits — verified on a 4096-bit key + RS512 with full auth/e2e suites green); only if you must stay on 6.x, ignore it via `composer config audit.abandoned ignore` style policy / `policy.advisories.ignore-id`. (2026-07)
- `[mQVJ5F] composer update`/`install` fails a platform check for an extension you don't have and don't need (eg framework requires `ext-http` but nothing uses pecl_http)
  Cause: composer enforces the `ext-*` platform requirements in composer.json, so a missing (but unused) extension fails the install.
  Fix: pass the SPECIFIC flag `--ignore-platform-req=ext-http` (not `--ignore-platform-reqs`, which ignores ALL platform checks and hides real problems); the proper fix is deleting the bogus requirement from composer.json. (2026-07)
