# Godot 4.x (GDScript)

- `[CxjhZi] Parse Error: Unexpected identifier "X" in class body`
  Cause: a stray character outside any function at script body level, usually an editing leftover.
  Fix: remove it at the reported line; the error is SILENT in the GUI (scene shows a black screen), visible only in editor log or headless compile output. (2026-07)
- `[hId9D4] The variable type is being inferred from a Variant value`
  Cause: `:=` used with a Variant-returning function (common in RefCounted).
  Fix: use plain `var x = func()` with no colon. (2026-07)
- `[Vz704B] Expected indented block after function declaration`
  Cause: duplicate `func` declaration after patching.
  Fix: find with `grep -c "func name" file.gd` (must be 1) and remove the duplicate. (2026-07)
- `[rFGlHE] Could not preload resource script`
  Cause: the referenced script has a parse error, or a circular class_name dependency.
  Fix: fix the parse error in the referenced script first. (2026-07)
- `[BsGP8Y] Identifier not found: ClassName` in an autoload
  Cause: `class_name` on an autoload referencing another `class_name`'d script (circular dependency).
  Fix: use `const X = preload("res://...")` instead of class_name in autoloads. (2026-07)
- `[VkQffw] Could not resolve script` on an autoload
  Cause: the autoload script does not extend Node.
  Fix: autoloads must `extends Node`. (2026-07)
- `[kqb2uG] Invalid assignment of property or key 'X' ... on a base object of type 'NodeType'` (eg `mouse_filter` on a Line2D)
  Cause: a Control-only property set on Node2D/Node3D.
  Fix: remove the assignment; this is a runtime error that halts the function and leaves blank/partial UI. (2026-07)
- `[i69usF] Invalid access to property 'X' on base object of type 'Nil'`
  Cause: sub-controller `init()` not called before `_process` started ticking.
  Fix: init sub-controllers in `_ready()` AND in every new-game/load path that replaces state. (2026-07)
- `[ZBIEWf] Function "X" not found in base self`
  Cause: wrong name or underscore-prefix mismatch (`_get_x` vs `get_x`).
  Fix: check the exact declared name including leading underscore. (2026-07)
- [oQZCWs] False `identifier not found` errors when compile-checking a single script
  Cause: `--check-only --script` loads the script in isolation without autoloads.
  Fix: always compile-check the full project with `--headless --quit` instead. (2026-07)
- `[N7y4XW] edit` tool fails on .gd files
  Cause: GDScript uses tabs, exact-whitespace matching breaks.
  Fix: patch via bash heredoc (`<< 'EOF'` preserves tabs) or PowerShell `[System.IO.File]::ReadAllText/.Replace()` with literal here-strings; after every patch verify `grep -c "func name" file.gd` is 1 and run the headless compile check. (2026-07)
