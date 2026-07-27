# CMake

- [zQ3wE8] Setting `CMAKE_RUNTIME/LIBRARY/ARCHIVE_OUTPUT_DIRECTORY` globally breaks bundle / per-target output layout (binaries land flat, bundle folders end up missing their platform subdir)
  Cause: those variables set the *default* output dir that every target created afterwards inherits, and they desync any build system that computes per-target or bundle-relative paths from them vs the actual target output. Targets that assemble a bundle (e.g. a plugin wrapper that expects its binary under `Contents/<arch>/`) silently produce an incomplete bundle.
  Fix: do not override them globally when targets manage their own per-target output dirs or bundle assembly; let the build system own output layout and read artefacts from each target's own output path. In JUCE this manifests as an empty VST3 bundle (see frameworks/juce.md). (2026-07)

- [sD5fR2] `cmake -A x64` fails with `Generator Ninja does not support platform specification` even though Visual Studio is installed
  Cause: the machine's default CMake generator is often Ninja (not the Visual Studio generator), and Ninja is single-config / has no `-A` platform axis. Omitting `-G` picks the default, so `-A` then errors; `CMAKE_C/CXX_COMPILER` may also be unset because Ninja wasn't pointed at MSVC.
  Fix: pass the IDE generator explicitly, e.g. `cmake -G "Visual Studio 18 2026" -A x64` (detect the installed version with `vswhere -latest -property installationVersion` and map major->generator name). If you genuinely want Ninja, drop `-A` and configure the MSVC toolchain via a preset or `vcvarsall` instead. (2026-07)
