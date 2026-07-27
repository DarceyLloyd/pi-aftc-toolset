# GSAP

- [fzvHLl] GSAP does NOT auto-detect or respect `prefers-reduced-motion`
  Cause: it animates whatever you tween, on every machine, regardless of the OS setting. So "my animation got suppressed under reduced-motion" is always YOUR code (a `prefersReducedMotion()` guard around the tween), never gsap itself.
  Fix: There is no gsap config flag for it; to make motion play regardless of the OS setting, relax your own guard. Per global rules, do not add such a guard unless the user/docs explicitly ask. (2026-07)
