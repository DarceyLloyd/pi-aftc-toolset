# C++

## Rules

## Gotchyas

## Issues & Solutions


- [fG7hJ2] `-Wfloat-equal` fires on an intentional "did this cached float change" check (e.g. caching a normalized parameter and comparing with `!=` each tick)
  Cause: the warning flags any `==`/`!=` on floats as unsafe (rounding); but a cached value you only ever echo back (no arithmetic) is safe to compare exactly - you want a bit-exact change test, and pragmas / `-Wno-` are ugly or global.
  Fix: compare the integer bit pattern instead: `uint32_t x = 0, y = 0; std::memcpy(&x, &a, sizeof x); std::memcpy(&y, &b, sizeof y); return x != y;`. This expresses the exact-change intent and silences the warning with no pragma. Use a real epsilon compare instead when the values ARE computed/accumulated. (2026-07)
