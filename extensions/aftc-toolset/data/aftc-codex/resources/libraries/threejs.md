# Three.js

- `[gHIMJP] TS7016: Could not find a declaration file for module 'three'` (or 'three/webgpu')
  Cause: three 0.185 ships zero .d.ts files (nothing in package exports, build/ or src/).
  Fix: add `// @ts-nocheck` as line 1 of any TS file importing three (template convention), or install @types/three for real checking. (2026-07)
- `[MAqYln] THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend.`
  Cause: info, not an error: three 0.185 WebGPURenderer auto-falls back to its WebGL2 backend when navigator.gpu or an adapter is missing.
  Fix: still wrap construction in try/catch and fall back to THREE.WebGLRenderer for older three versions. (2026-07)
- `[v8Tf5p] THREE.AttributeNode: Vertex attribute "uv" not found on geometry.`
  Cause: three 0.185 WebGPURenderer TSL backend warns on textured planes (CanvasTexture on PlaneGeometry) and generally proves flaky across browsers.
  Fix: if WebGPU is not a hard requirement, standard THREE.WebGLRenderer (WebGL2) avoids the whole class of issues. (2026-07)
- `[T1D2sa] getImageData` / `drawImage` of a WebGLRenderer canvas returns blank
  Cause: the drawing buffer is cleared after compositing when `preserveDrawingBuffer:false` (the default).
  Fix: set `preserveDrawingBuffer:true` (small perf cost) whenever you must sample or screenshot the canvas off-frame. (2026-07)
- [Ex7nm2] WebGL scenes silently stop rendering / `getContext('webgl')` returns null after many contexts
  Cause: browsers cap live WebGL contexts per process (~16); many fixed canvases (or N live iframe previews each spinning up 2-3) exhaust it.
  Fix: reuse one renderer/view, or gate heavy WebGL init behind a flag (e.g. `?preview=1`) when embedded. (2026-07)
- `[17Hjia] Failed to load resource 404 .../examples/jsm/renderers/webgpu/WebGPURenderer.js` when trying WebGPU-first
  Cause: in three 0.185 the WebGPU build is NOT an addon at that path; it ships as `build/three.webgpu.js` exposed via the importmap specifier `three/webgpu`.
  Fix: To go WebGPU-first with a single consistent namespace, dynamically load it: `let THREE; try { if (navigator.gpu) THREE = await import('three/webgpu'); } catch {} if (!THREE) THREE = await import('three');` then `if (THREE.WebGPURenderer) { try { const r = new THREE.WebGPURenderer(opts); await r.init(); return r; } catch {} } return new THREE.WebGLRenderer(opts);`. Add `"three/webgpu":"https://cdn.jsdelivr.net/npm/three@<ver>/build/three.webgpu.js"` to the importmap. (2026-07)
- `[i8uT6C] THREE.Renderer: Objects of type THREE.LineLoop are not supported. Please use THREE.Line or THREE.LineSegments.`
  Cause: three 0.185 dropped LineLoop rendering (logs the warning every frame and draws nothing).
  Fix: Replace `new THREE.LineLoop(geo, mat)` with `new THREE.Line(geo, mat)` and close the loop by repeating the first vertex at the end of the position array; for a secondary ring that should mirror a primary animated ring, share the SAME BufferGeometry (do not `geo.clone()` then never update the clone — it renders as a frozen/invisible shape). (2026-07)
- [3LhrJv] Header/footer three.js renders as a tiny centred cluster in a wide thin band / does not fill the band
  Cause: a PerspectiveCamera with fixed-size content shows a small object ringed by huge empty margins when the canvas aspect is very wide (header/footer strips).
  Fix: Use an OrthographicCamera with a fixed design half-height HH and half-width HW = HH * (clientWidth/clientHeight); set left/right/top/bottom from -HW/HW/HH/-HH and update them on resize; author the scene to lay its content across [-HW,HW] x [-HH,HH] and REFLOW from the live HW each frame so it always fills edge-to-edge and scales with the band. Keep header/footer motion TIME-ONLY (never read scroll); reserve scroll-parallax for the separate background perspective scene. (2026-07)
