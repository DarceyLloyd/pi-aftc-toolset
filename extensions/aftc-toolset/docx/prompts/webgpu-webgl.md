# PROJECT-TYPE PACK: WebGPU / WebGL app (Three.js, Babylon.js)

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers canvas-rendered browser apps and games built on Three.js,
Babylon.js or raw WebGL/WebGPU - where the "UI" is part DOM (menus, HUDs,
dialogs) and part in-canvas.

## Sources of truth (recon - read these, never the old docs)

- ENTRY/BOOTSTRAP: the engine/renderer setup (WebGLRenderer/Engine/
  WebGPUEngine creation), the render loop, resize handling.
- DOM UI: every HTML overlay - main menu, settings, pause, HUD, dialogs,
  loading screens - from the .html/.css and the JS that shows/hides them.
  <dialog> elements and modal divs are PAGES.
- GUI PANELS: lil-gui/dat.GUI/Tweakpane panels - each panel, its folders
  and every bound control (property, min/max/step).
- SCENES/ENTITIES: scene-graph construction, loaders (GLTF/texture/audio),
  entity/component factories, shader files (.wgsl/.glsl, ShaderMaterial).
- STATE MACHINE: menu/playing/paused/game-over transitions - find the
  state code, not the prose.
- INPUT: key/mouse/pointer/gamepad bindings.
- BUILD: package.json + lockfile (EXACT versions: three/babylon, vite/
  webpack), asset pipeline.

## Surface rules for this stack

- DOM screens (main menu, settings, pause, game over, HUD) are surfaces:
  each gets a sitemap entry and, when non-trivial, a leaf doc. In-canvas UI
  (3D menus, interactive objects acting as UI) is documented as surfaces
  too, with the code that drives it.
- Scenes/levels/entity types are documented as COMPONENTS under the app
  branch (leaf docs), keyed by their factory/scene files.
- The render pipeline (renderer, passes, post-processing) gets its own
  deep doc - it is the heart of the app.

## Per-surface leaf contract (what the core's contract means here)

- The file(s) defining the screen (markup + controller script).
- What's on it: every button/field/control (id, label), every GUI-panel
  control (bound property, range).
- Data: what state/store the screen reads and mutates; persistence
  (localStorage saves/settings).
- States: visible/hidden and the transition that triggers each; loading;
  error (asset load failure).
- Functionality: the interaction flow (start game -> HUD -> pause ->
  resume/quit), input bindings active on this screen.

## Extra rules

- Document asset loading and failure behaviour (what the user sees while
  and if assets fail to load).
- Performance conventions found in source (instancing, pooling, decoupled
  simulation) belong in the app deep doc's operational notes.
