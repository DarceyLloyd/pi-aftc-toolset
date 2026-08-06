# PROJECT-TYPE PACK: C++ JUCE VST / audio plugin

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers audio plugins built on the JUCE framework (VST3/AU/AAX/
Standalone) and similar C++ audio codebases.

## Sources of truth (recon - read these, never the old docs)

- BUILD: CMakeLists.txt and/or the .jucer project - plugin formats built,
  compile definitions, JUCE modules used, version.
- PROCESSOR: the AudioProcessor (PluginProcessor) - buses/layouts, and
  above all the APVTS/parameter list: EVERY parameter (id, label, range/
  choices, default, unit) is a "control" of the plugin. Parameter tables
  come from the parameter-creation code, never from prose.
- EDITOR: createEditor() and the AudioProcessorEditor subclass(es) - the
  plugin's main screen. Component children, paint()/resized(), LookAndFeel.
- POPUPS: PopupMenu, AlertWindow, CallOutBox, DialogWindow usages (about,
  settings, preset browser, confirmations) - EACH POPUP IS A PAGE with its
  own leaf doc.
- DSP: the DSP graph (processors, filters, oscillators) - documented as
  component/module leaf docs, keyed by source file.
- PRESETS: preset manager + factory presets (how stored, loaded, marked
  dirty).
- HOST/DSP threading: audio-thread vs message-thread rules the code
  follows (locks, atomics, fifo usage) - document them in operational
  notes.

## Surface rules for this stack

- The plugin editor is the main surface: apply the core's sub-page
  breakdown - region leaf docs (eg oscillator section, filter section,
  modulation matrix, preset bar) when 2+ regions have their own rules/
  states/data bindings, one editor doc when inseparable.
- Every popup (about, settings, preset browser) gets its own leaf doc -
  never buried in the editor doc.
- Standalone app build (when present) adds its own surfaces (audio
  settings dialog) - document them too.

## Per-surface leaf contract (what the core's contract means here)

- The component class + file that defines the screen/popup.
- What's on it: every control (slider/combo/button - its component, the
  APVTS parameter id it attaches to, label, range, default).
- Data: parameters bound (APVTS), presets, state save/restore
  (getStateInformation/setStateInformation).
- States: bypass, preset dirty, automation-active, disabled groups.
- Functionality: the interaction flow (turn knob -> parameter -> DSP),
  including gesture/automation behaviour found in code.

## Extra rules

- Formats built (VST3/AU/Standalone/...) and any per-format conditionals
  are documented in the plugin deep doc.
- Host/DAW specifics found in code (latency reporting, tail, sidechain,
  sample-rate handling) are documented in operational notes.
- Exact JUCE version + module list from the build files.
