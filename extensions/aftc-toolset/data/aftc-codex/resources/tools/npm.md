# Npm

## Rules

## Gotchyas

- [UkAJRl] Scripted npm publish must not leak the token into the global or project .npmrc - write the token into a TEMP .npmrc, point NPM_CONFIG_USERCONFIG at it for the single publish call, then delete it; keep the token file itself gitignored AND npmignored.

- [sGi6Y2] Non-interactive publish to a 2FA-protected package keeps asking for OTP / failing - the granular access token must be created with "bypass 2FA" AND the package's publishing-access setting must allow bypass-2FA tokens (the strict "disallow bypass 2FA tokens" option forces an OTP on every publish).

- [ZU9Qcp] Stray files (IDE cache dirs like .vs/, CI config like .github/) land in the published tarball - npm packs everything except .npmignore (falling back to .gitignore only when no .npmignore exists), so run npm pack --dry-run before every publish and ignore the offenders.

- [pZttsf] npm view <pkg> version` can still return the OLD version for a minute or so right after a successful publish (registry/CDN cache lag) - wait and retry against the official registry explicitly before concluding the publish failed.

- [2DacVD] npm publish failing with E404 'Not found - PUT ...' during LOCAL token-based publish is an auth problem, not a missing package - an expired granular access token or one without read+write access to that package produces 404; regenerate the token (with package-scoped write access) and retry instead of changing the package name.

- [RNcs9T] npm only allows unpublishing a version within 72 hours of publish - after that a published version can never be removed from the registry; treat every publish as permanent and unpublish mistakes inside the window.

## Issues & Solutions

- [P72ROm] npm publish via trusted publishing (OIDC) fails E404 'Not Found - PUT' or ENEEDAUTH despite a correct trusted-publisher entry and id-token: write
  Cause: actions/setup-node with registry-url writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into .npmrc; with no NODE_AUTH_TOKEN secret it expands to EMPTY and npm treats auth as already configured, short-circuiting the OIDC exchange. A bundled npm older than 11.5.1 (node 22, some node 24) likewise falls back to token auth silently.
  Fix: Upgrade npm in the workflow to latest (>= 11.5.1) and strip the empty token line before publishing: sed -i '/_authToken/d' "${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}". Treat a 404 on the publish PUT as a misleading auth failure, not a missing package. If OIDC still refuses, a local publish script with a granular token is the reliable fallback. (2026-08)
