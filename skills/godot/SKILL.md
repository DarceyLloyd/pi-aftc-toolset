---
name: godot
description: Godot 4.x engine with GDScript, MVC architecture, headless testing, JSON configs, and performance patterns (MultiMesh, flow-field, decoupled simulation). Use when working on .gd files, Godot projects, game development with Godot 4, or any task involving the Godot engine CLI, project structure, GDScript coding conventions, Godot 4.x version-specific syntax, or game architecture patterns.
---

# Godot 4.x

> **Engine**: Godot 4.x (verify version in `project.godot`). GDScript 2.0 syntax only.

## When to Use
Working on `.gd` files, `.tscn` scenes, Godot project structure, JSON-driven game data, autoload singletons, MVC patterns in Godot, MultiMesh rendering, flow-field pathfinding, headless CLI testing, or troubleshooting GDScript parse/compile errors.

---

## Godot CLI

### Compile Check (REQUIRED — run before AND after every change)
```bash
# Full compile check with autoloads loaded
./Godot_v4.x-stable_win64_console.exe --path "path/to/project" --headless --quit
```
Zero errors on stdout = clean. Non-zero exit code or "ERROR" / "Parse Error" on stdout = broken.

**Do NOT use `--check-only --script`** — it loads the script in isolation without autoloads and will fail on identifier-not-found errors that are fine in the full project context.

### Editor
```bash
./Godot_v4.x-stable_win64.exe --path "path/to/project" --editor
```

### Store executables at project root for version pinning (recommended)
```
project/
├── Godot_v4.x-stable_win64.exe          # GUI editor
├── Godot_v4.x-stable_win64_console.exe  # headless
└── project.godot
```

---

## Architecture — MVC + KISS

### Models (`scripts/models/` — pure data, no scene-tree dependency)
- Use `class_name` + `extends Resource` or `extends RefCounted`
- Pure data containers: properties, enums, helper methods
- NO scene-tree references, NO `get_node()`, NO `@onready`
- Example: `game_state.gd`, `building_data.gd`, `unit_data.gd`, `map_data.gd`

### Controllers (`scripts/controllers/` — autoload singletons)
- `extends Node` (autoloads must extend Node)
- Central simulation orchestration at fixed timestep
- Delegate to subsystem modules (`extends RefCounted`) to stay under size limits
- Example: `game_controller.gd` (autoload), `ai_controller.gd` (RefCounted, managed by game_controller)

### Views (`scripts/views/` or main scene scripts)
- `extends Node` (scene-attached) for components attached to nodes
- `extends RefCounted` for pure rendering logic
- Read from model data, never mutate state directly
- Example: `line_select.gd`, `game.gd` (main scene), `unit_renderer.gd`

---

## File Size Limits (CRITICAL)

| File Type | Max Lines | Pattern |
|-----------|-----------|---------|
| Main scene script (game.gd) | 800 | Thin orchestrator — coordinate, don't implement |
| Simulation autoload (game_controller.gd) | 500 | Thin dispatcher — delegate to subsystems |
| Any other .gd file | 1500 | Extract into coherent subsystems when approaching |

**When a file nears its limit, extract a coherent subsystem:**
- Use `extends RefCounted` for pure logic managers (no scene-tree dependency)
- Use `extends Node` only for scene-attached view components
- Place extracted files in the same directory or a `subsystems/` subfolder
- New features MUST go into appropriate subsystem files, never dumped into root files

---

## GDScript Critical Rules

### Prohibited
- `class_name` on autoload scripts that reference other `class_name`'d scripts (circular dependency)
- `:=` type inference with Variant-returning functions — use `var x = func()` (no colon, no type)
- `:=` in RefCounted classes — use explicit types or plain `=`
- Bare `if` without body or `pass`
- `match` arms without `_:` catch-all (even if empty, add `_: pass`)
- Referencing sibling `@onready` vars in `_ready()` (tree-order dependency)

### Required  
- `@onready var` for all `$NodePath` or `%UniqueName` references
- `pass` in empty blocks (if, match, func stubs)
- Explicit types for function parameters when returning from typed functions
- `const PreloadedClass = preload("res://path/to/script.gd")` for cross-script references
- `var state = get_node("/root/GameController").state` for accessing autoload singletons

### Type Inference Fixes
```gdscript
# WRONG — fails in RefCounted / with Variant returns
var eu := state.get_unit_by_id(target_id)   # Parse Error: Variant inference

# RIGHT — plain assignment, no type inference
var eu = state.get_unit_by_id(target_id)

# RIGHT — explicit type where possible
var target_pos: Vector3 = Vector3.ZERO
var threat_ratio: float = _ai_assess_threat_at(pos, radius)
```

### Enum Gotchas
```gdscript
# Enums are global within a script — names must be unique
enum DefenseMode { OFF, FIRE_AT_WILL }      # OK
enum RepairTurretPriority { PRIORITISE_REPAIR, PRIORITISE_DISASSEMBLE }  # OK
# DON'T reuse enum value names across different enums in same file
```

### Match Statement Rules
```gdscript
match order.get("type", ""):
    "move":
        issue_move_order(unit, order["target"])
    "attack":
        issue_attack_order(unit, order["target_id"])
    _:
        pass  # REQUIRED catch-all
```

---

## Editing GDScript Files

### The edit tool frequently fails on .gd files
GDScript uses tabs for indentation. The `edit` tool requires exact whitespace match (tabs vs spaces). **Prefer bash heredoc patching** for multi-line changes:

```bash
# 1. Always backup first
cp scripts/target.gd scripts/target.gd.bak

# 2. Create patch content (tabs are preserved in heredocs with << 'EOF')
cat > /tmp/patch.txt << 'ENDOFPATCH'
func new_function() -> void:
	# tab-indented code here
	pass
ENDOFPATCH

# 3. Apply: head up to insertion point + patch + tail from resume point
{
  head -n INSERT_AFTER_LINE scripts/target.gd
  cat /tmp/patch.txt
  tail -n +RESUME_LINE scripts/target.gd
} > /tmp/new.gd

mv /tmp/new.gd scripts/target.gd

# 4. CRITICAL: Verify no duplicate function declarations
grep -c "func funcName" scripts/target.gd  # Must return 1
```

### Heredoc Patch Rules
- **NEVER include the NEXT function's declaration** in the patch — it will duplicate
- When replacing a function, use `tail -n +START_OF_NEXT_FUNC` not `tail -n +END_OF_FUNC`
- After every patch: `grep -c "func functionName" file.gd` should return 1
- Use `<< 'ENDOFPATCH'` (quoted delimiter) to prevent shell variable expansion

### When editing with sed (single-line changes only)
```bash
sed -i 'LINENUMs/old_text/new_text/' file.gd
# Example: fix a variable name
sed -i '332d' file.gd  # Delete line 332 (e.g., duplicate function decl)
```

### PowerShell Bulk Replace (for large multi-line changes on Windows)
When bash heredoc patching isn't available, use PowerShell's `[System.IO.File]::ReadAllText` + `.Replace()`:

```powershell
$file = "full\absolute\path\to\file.gd"
$content = [System.IO.File]::ReadAllText($file)
$search = @'
exact old text with tabs
	indented code here
'@
$replace = @'
exact new text
	new indented code
'@
if ($content.Contains($search)) {
    $content = $content.Replace($search, $replace)
    [System.IO.File]::WriteAllText($file, $content)
}
```

**Critical rules**:
- Always use full absolute paths — `cd` in one PowerShell invocation line doesn't carry to the next
- `.Replace()` replaces ALL occurrences — ensure search string is unique with enough context
- Use `@'...'@` (literal here-string) to avoid escaping `$` and backticks
- After replace, run `grep -c "func funcName" file.gd` to verify no duplicates

---

## Project Structure Pattern

```
project/
├── project.godot                  # Config, autoloads, input map
├── data/
│   ├── units/*.json               # Unit stat configs (one JSON per type)
│   └── buildings/*.json           # Building stat configs (one JSON per type)
├── scenes/
│   ├── main_menu.tscn
│   ├── game.tscn
│   └── galaxy_map.tscn
├── scripts/
│   ├── models/                    # Pure data Resources
│   │   ├── game_state.gd
│   │   ├── building_data.gd
│   │   ├── unit_data.gd
│   │   └── map_data.gd
│   ├── controllers/               # Autoload singletons + manager modules
│   │   ├── game_controller.gd     # Central simulation (autoload)
│   │   ├── ai_controller.gd       # AI module (extends RefCounted)
│   │   ├── save_manager.gd        # Save/load (autoload)
│   │   ├── camera_controller.gd   # Camera (autoload)
│   │   └── flow_field_manager.gd  # Pathfinding cache (autoload)
│   ├── views/                     # View components
│   │   ├── line_select.gd
│   │   └── unit_renderer.gd
│   └── autoload/                  # Other autoloads (config, audio, settings)
│       ├── config_loader.gd
│       ├── audio_manager.gd
│       └── game_settings.gd
└── assets/                        # Fonts, textures, models, audio
```

---

## Config-Driven Data (JSON)

### ConfigLoader Pattern
ConfigLoader is typically an autoload that auto-discovers JSON files:
```gdscript
# config_loader.gd
func _load_units() -> void:
    var dir := DirAccess.open("res://data/units/")
    dir.list_dir_begin()
    var filename: String = dir.get_next()
    while filename != "":
        if filename.ends_with(".json"):
            var unit_type := filename.replace(".json", "")
            units[unit_type] = _load_json("res://data/units/" + filename)
            unit_types.append(unit_type)
        filename = dir.get_next()
    dir.list_dir_end()
```
- No registration needed — new JSON files are auto-discovered
- `get_unit_config(type)` / `get_building_config(type)` return parsed Dictionary
- Returns empty `{}` if config not found — unit/building models fall back to hardcoded defaults

### Unit Config JSON Format
```json
{
  "name": "Unit Display Name",
  "tier": 2,
  "domain": "orbital",
  "max_health": 500.0,
  "move_speed": 5.0,
  "attack_range": 10.0,
  "attack_damage": 15.0,
  "attack_cooldown": 1.0,
  "armor": 2.0,
  "shield_hp": 100.0,
  "shield_regen": 5.0,
  "hp_regen": 0.0,
  "build_power": 12.0,
  "repair_speed": 15.0,
  "projectile_speed": 200.0,
  "damage_type": "kinetic",
  "aoe_radius": 0.0,
  "aoe_damage": 0.0,
  "is_orbital": true,
  "can_target_ground": true,
  "is_naval": false,
  "is_titan": false,
  "can_cloak": false,
  "has_permanent_vision": false,
  "metal_cost": 400.0,
  "energy_cost": 250.0,
  "build_time": 15.0
}
```

### Building Config JSON Format
```json
{
  "name": "Building Display Name",
  "tier": 2,
  "max_health": 1500.0,
  "metal_production": 0.0,
  "energy_production": 0.0,
  "metal_consumption": 0.0,
  "energy_consumption": 20.0,
  "metal_storage": 0.0,
  "energy_storage": 0.0,
  "attack_range": 0.0,
  "attack_damage": 0.0,
  "attack_cooldown": 1.0,
  "sight_range": 15.0,
  "build_time": 25.0,
  "metal_cost": 400.0,
  "energy_cost": 200.0,
  "is_factory": true,
  "can_overdrive": false
}
```

### When adding new types, register in ALL of these places
1. JSON config in `data/units/` or `data/buildings/`
2. `FACTORY_UNIT_LISTS` dict (game.gd) — if produced by a factory
3. `BUILDER_STRUCTURES` dict (game.gd) — if a builder can construct it
4. `BUILDING_TIERS` dict (game.gd) — for building type tier lookup
5. `UNIT_SIZES` dict (unit_renderer.gd) — mesh dimensions
6. `UNIT_COLORS` dict (unit_renderer.gd) — base color
7. `_get_unit_badge_color()` match (game.gd) — UI badge color
8. `_get_unit_type_name()` match (game_controller.gd) — display name fallback

---

## Performance Patterns for 10K+ Units

### Decoupled Simulation
- Fixed timestep at 10 ticks/sec, independent of framerate
- Units in fog still simulate but don't render

### MultiMeshInstance3D
- Batch unit rendering: one MultiMesh per unit type
- Per-instance colors for team identification (friendly vs enemy tint)
- Frustum culling is automatic with MultiMesh

### Flow-Field Pathfinding
- Dijkstra-based direction fields for group movement
- LRU cache (size 16) — shared fields for units heading to same destination
- Individual A* fallback for small groups

### Rendering Patterns
- 3D models fade to 2D icons at strategic zoom levels (high altitude)
- Fog of war: units in fog simulate, not rendered
- Sight ranges per unit type, radar for long-range blips
- Permanent vision around owned buildings (grace period after destruction)

---

## Autoload vs RefCounted vs Node

| Type | extends | Scene-tree | Use case |
|------|---------|------------|----------|
| Autoload | `Node` | Yes (root) | Central systems: simulation controller, save manager, camera, config loader |
| RefCounted | `RefCounted` | No | Pure logic modules: AI controller, pathfinding solver, economy calculator |
| Scene Node | `Node` / `Node3D` | Yes (scene) | View components attached to scene nodes: HUD, building panels, renderers |

```gdscript
# Autoload accessing another autoload's state:
var state = get_node("/root/GameController").state

# RefCounted managed by autoload:
# In game_controller.gd:
const AIControllerRef = preload("res://scripts/controllers/ai_controller.gd")
var ai_controller: RefCounted
func _ready():
    ai_controller = AIControllerRef.new()
    ai_controller.init(state, self)
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Parse Error: Unexpected identifier "X" in class body` / Stray character in class body | A stray character (letter, symbol, number) outside any function at script body level. Often a leftover from editing (e.g., `t` before a `var`). Prevents the ENTIRE script from loading. | Remove the stray character at the reported line. Scene change produces only a black screen — the error is silent in the GUI, visible only in editor log or headless compile output. |
| `Function "X" not found in base self` | Called function doesn't exist or wrong name, OR underscores mismatched | Check function exists with EXACT correct name. `_get_ground_height` ≠ `get_ground_height`. Underscore prefixes matter. |
| `Expected indented block after function declaration` | Duplicate function declaration (two `func name` lines) | Remove duplicate — use `grep -c "func name" file.gd` to find |
| `Expected indented block after "if" block` | `if` with no body (often from bad patch that split a function) | Check the `if` has a complete body |
| `Could not preload resource script` | Script has parse error, or circular class_name dependency | Fix parse error in the referenced script first |
| `The variable type is being inferred from a Variant value` | `:=` used with Variant-returning function in strict mode | Change `:=` to `=` (plain assignment) |
| `Could not resolve script` | Autoload script has parse error or wrong extends | Autoloads must extend Node |
| `Identifier not found: ClassName` | `class_name` used in autoload referencing another `class_name` | Use `preload()` instead of `class_name` in autoloads |
| `Invalid assignment of property or key 'X' with value of type 'int' on a base object of type 'NodeType'` | Setting a Control-only property (e.g., `mouse_filter`) on a Node2D/Node3D (e.g., `Line2D`). Runtime error, not a parse error — halts function execution, resulting in blank/partial UI. | Remove the property assignment. Non-Control nodes don't process mouse input by default. Use `grep -n "mouse_filter" *.gd` to audit — verify each target node is a Control subclass (Panel, ColorRect, Label, Button, etc.). |
| `Invalid access to property 'X' on base object of type 'Nil'` | Sub-controller state ref is null because `init()` not called before `_process` starts ticking | Always call `sub_controller.init(state, self)` in `_ready()` AND in every `new_game()` variant that creates a new state. Do NOT only init in `spawn_starter_units()` — the process loop may tick before units spawn. |
| Stale function bodies after extraction | Function dispatched via new delegation call but old implementation body still exists and is called from other internal code | Keep old function body as delegation stub (one-liner) until ALL callers are updated. Use `grep -n "funcName" file.gd` to find all callers. Only delete the body after zero remaining callers. |

## Sub-Controller Extraction Pattern

When splitting a large controller into subsystem modules, use this proven pattern:

```gdscript
# Sub-controller file (extends RefCounted)
# scripts/controllers/economy_controller.gd
extends RefCounted

var state  # GameState reference, set by init()
var parent  # GameController reference, for emitting signals & calling parent methods

func init(s, p) -> void:
	state = s
	parent = p

func tick(dt: float) -> void:
	# ... access state.buildings, state.metal, etc.
	parent.economy_updated.emit(state.metal, state.energy, ...)
```

```gdscript
# Parent controller (autoload singleton)
# scripts/controllers/game_controller.gd
extends Node

const EconomyControllerRef = preload("res://scripts/controllers/economy_controller.gd")
var economy_controller = EconomyControllerRef.new()

func _ready() -> void:
	state.generate_flat_map(20, 20)
	economy_controller.init(state, self)  # MUST init BEFORE _process starts

func new_game(...) -> void:
	state = GameStateRef.new()
	# ...
	economy_controller.init(state, self)  # Re-init when state is replaced

func _process(delta: float) -> void:
	# ...
	_tick(TICK_RATE)

func _tick(dt: float) -> void:
	economy_controller.tick(dt)  # Delegation
	# ... other sub-controller ticks

# Public API stub — keeps backward compat for external callers
func toggle_overdrive(building_id: int, bonus: float = 1.0) -> void:
	economy_controller.toggle_overdrive(building_id, bonus)
```

### Init Timing (CRITICAL)
- Sub-controllers MUST be initialized in `_ready()` before `_process()` starts ticking
- When state is replaced (new game, load game), re-init ALL sub-controllers with the new state
- Create `_init_sub_controllers()` helper to avoid duplication across init paths
- Pattern: `_ready()` calls init, `new_game()` calls init after creating new state, `new_game_procedural()` calls init

### Internal vs External Calls
- Sub-controllers call back to parent via `parent.method_name()` or `parent.signal_name.emit()`
- Functions called from within the same sub-controller use `self._private_method()` or just `_private_method()`
- When extracting, check ALL internal callers still reference correct function names (underscore prefix must match)

### PowerShell Bulk Text Replacement (Alternative to heredoc)
When the `edit` tool fails on large multi-line GDScript replacements:

```powershell
$file = "path\to\file.gd"
$content = [System.IO.File]::ReadAllText($file)
$search = "exact old text with `n for newlines"
$replace = "exact new text with `n for newlines"
if ($content.Contains($search)) {
    $content = $content.Replace($search, $replace)
    [System.IO.File]::WriteAllText($file, $content)
}
```

**WARNING**: PowerShell's `cd` may not change the working directory for subsequent commands in the same invocation block. Always use full absolute paths with `[System.IO.File]`.

**WARNING**: `.Replace()` replaces ALL occurrences. Ensure your search string is unique in the file. For function bodies that appear in multiple locations (e.g., `new_game()` vs `new_game_procedural()`), add enough surrounding context to make it unique.

### After Every Bulk Replace
1. `grep -c "func functionName" file.gd` — verify count = 1 (no duplicates)
2. Check for orphaned `if` blocks or mismatched indentation
3. Run compile check immediately

---

## MVP: Minimum Verification After Changes
1. `wc -l scripts/game.gd scripts/controllers/game_controller.gd` — check sizes
2. `grep -c "func newFuncName" scripts/file.gd` — verify no duplicates
3. `./Godot_v4.x-stable_win64_console.exe --path "." --headless --quit` — compile check
4. If compile fails: fix errors top-down (first error may cascade), re-run until clean
