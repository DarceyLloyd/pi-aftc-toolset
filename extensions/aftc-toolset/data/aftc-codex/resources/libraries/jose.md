# Jose

## Rules

## Gotchyas

- [kZJtcb] jose v6 removed the KeyLike type export - code typed against it fails to compile; type imported keys as Awaited<ReturnType<typeof importPKCS8>> (or CryptoKey) instead

## Issues & Solutions

- [fI3qb9] signed JWT has nbf one second AFTER iat even though both were meant to be identical (strict parity checks / other stacks reject or flag the token)
  Cause: chaining setIssuedAt() with setNotBefore(0) evaluates each helper at its own call moment, so the two Math.floor(Date.now()/1000) reads can cross a second boundary.
  Fix: compute ONE epoch-seconds constant and pass it to both: setIssuedAt(ts).setNotBefore(ts).setExpirationTime(ts + ttl). (2026-08)

- [8jljpc] importPKCS8 fails on a passphrase-protected PEM key generated with `ssh-keygen -m PEM` (encrypted PKCS#1) - jose cannot decrypt it directly
  Cause: jose's importers expect unencrypted PKCS8/SPKI PEM; ssh-keygen -m PEM produces passphrase-encrypted PKCS#1.
  Fix: decrypt and convert with node:crypto first: createPrivateKey({key: pem, format: 'pem', passphrase}), then export({type:'pkcs8'}) / createPublicKey(...).export({type:'spki'}) and import THOSE strings with importPKCS8/importSPKI. (2026-08)
