# Comfyui

## Rules

- [7Qh5Lu] Share one model library across multiple installs: keep all model folders in a central directory and map it via extra_model_paths.yaml (base_path + is_default: true so it lists first and receives downloads); merge legacy folder aliases into one key with multi-line values (clip into text_encoders, unet into diffusion_models).

- [lbVFQg] SageAttention needs the --use-sage-attention launch flag, a triton-windows install, and the wheel matching torch's CUDA major and torch series; masked attention falls back to SDPA automatically when the wheel exposes no explicit attn_mask parameter.

- [a7OlEL] Migrate browser extensions off deprecated frontend shim paths by reading each shim's source: shims just re-export members from a global API object on window, so replace the import with direct access to that object to kill both client warnings and server deprecation logs.

## Gotchyas

- [1cCPJI] Some custom nodes hardcode subfolders of the models dir, bypassing the path registry: grep node code for hardcoded models_dir joins before relocating model folders, and leave junctions for those folders so their future downloads still land in the shared library.

- [tgr9DR] Updating custom node packs overwrites hand-patched files (e.g. deprecated-import or bug fixes): re-check and reapply local patches after every pack update, since warnings that were fixed will silently return.

## Issues & Solutions

- [3jUOCa] custom node fails to import with 'TypeError: Level not an integer or a valid string: []'
  Cause: the node passes the CLI --verbose value to logger.setLevel, but --verbose is a nargs='*' list (default []).
  Fix: normalize the level in the node's logger setup: take the last list element if non-empty, validate against known level names, default to INFO. (2026-08)
