# JUCE (C++ audio plugin framework)

- [jH7kLm] JuceHeader.h not generated / `Cannot open include file: 'JuceHeader.h'` on a `juce_add_plugin` target
  Cause: JUCE only auto-generates `JuceHeader.h` for PIP targets; a normal `juce_add_plugin` target must opt in.
  Fix: call `juce_generate_juce_header(<target>)` immediately after `juce_add_plugin(<target> ...)`. It emits `<build>/<target>_artefacts/JuceLibraryCode/JuceHeader.h` via juceaide. (2026-07)

- [qR3nP9] `'LookAndFeel_v4' is not a member of 'juce'` / base class undefined (and a cascade of `override did not override any base class methods`)
  Cause: the look-and-feel class name uses a capital V; there is no lower-case `v4`. The mass `override` errors are just the compiler reporting that the (undefined) base has no such virtuals.
  Fix: subclass `juce::LookAndFeel_V4` (capital V) and override e.g. `drawRotarySlider`. When many `override` errors appear at once, fix the base-class name first. (2026-07)

- [vT8xW2] CLAP format not available / `FORMATS CLAP` does nothing in JUCE 9
  Cause: JUCE 9 has no `juce_clap` module and no native CLAP support in its CMake.
  Fix: add the third-party `clap-juce-extensions` (with its `clap` + `clap-helpers` git submodules) via `add_subdirectory`, then `clap_juce_extensions_plugin(TARGET <t> CLAP_ID "..." CLAP_FEATURES note-effect)`. The CLAP artefact lands in `<build>/<t>_artefacts/<Config>/CLAP/`. Gate it behind a CMake option so VST3-only builds don't require it. (2026-07)

- [bN5cY6] `juce_add_binary_data` assets unresolved / `BinaryData::` link errors
  Cause: declaring the binary-data target is not enough; it must be linked, and the generated header included where used. Symbol names replace every non-alnum char in the filename with `_` (so `Rajdhani-Bold.ttf` -> `BinaryData::RajdhaniBold_ttf` / `BinaryData::RajdhaniBold_ttfSize`).
  Fix: `juce_add_binary_data(<DataTarget> SOURCES file1 file2 ...)`, add `<DataTarget>` to the plugin's `target_link_libraries`, and `#include <BinaryData.h>` in the .cpp that reads it. Load a font once with `Typeface::createSystemTypefaceFor(BinaryData::X_ttf, BinaryData::X_ttfSize)`. (2026-07)

- [dF1gZ4] VST3 bundle missing its binary (`Contents/x86_64-win/*.vst3` absent; only `moduleinfo.json` present)
  Cause: setting `CMAKE_RUNTIME/LIBRARY/ARCHIVE_OUTPUT_DIRECTORY` globally redirects the VST3 binary out of JUCE's per-target bundle output directory, leaving the bundle with only the manifest (not installable). This is the JUCE symptom of a general CMake trap - see tools/cmake.md for the rule that applies to any per-target/bundle build.
  Fix: do NOT set those vars globally with JUCE; let JUCE manage per-target output dirs. Read built plugins from `<build>/<Target>_artefacts/<Config>/<FORMAT>/` (VST3 = the `.vst3` bundle folder, CLAP = `CLAP/*.clap`, Standalone = `Standalone/*.exe`). (2026-07)

- [hJ9kM7] Hand-written `key=value` settings file is ignored by `PropertiesFile`
  Cause: `PropertiesFile::reload()` only accepts `loadAsBinary()` or `loadAsXml()`; plain text is never parsed, so `getValue` returns the default. The default `storageFormat` is opaque binary.
  Fix: always write via `setValue` + `saveIfNeeded` (never by hand). For a human-readable, editable file set `options.storageFormat = juce::PropertiesFile::storeAsXML`. On Windows the default file is `%APPDATA%/<folderName>/<applicationName>.<suffix>` (a leading-dot suffix is handled via `withFileExtension`, so `.settings` yields `name.settings`, not a double dot). (2026-07)

- [pL2qS8] Setting a parameter value does not move an attached `juce::Slider`
  Cause: `RangedAudioParameter::setValue()` updates `getValue()` but does not fire the listeners that repaint the slider's visual position.
  Fix: use `setValueNotifyingHost(v)` when a programmatic set must show on the dial. Real DAW automation and user drags already go through the notifying path, so this only matters for code that sets the value directly (e.g. a test/QA harness). (2026-07)

- [wX4yA3] `MidiMessageMetadata` has no `getSamplePosition()` / `getMessage()` returns by value
  Cause: in JUCE 9 the metadata view exposes public members, not getters.
  Fix: read `meta.samplePosition`, `meta.data`, `meta.numBytes` directly; `meta.getMessage()` returns a `MidiMessage` by value (binding to `const MidiMessage&` is fine via lifetime extension). (2026-07)

- [cE6fG5] `apvts.getRawParameter(id)` does not compile in JUCE 9
  Cause: the raw-parameter accessor was removed.
  Fix: use `apvts.getParameter(StringRef id)` which returns a `RangedAudioParameter*`; call `->getValue()` for the normalized 0-1 value. Build parameters with `juce::ParameterID{id, ver}` and `AudioParameterFloatAttributes().withLabel(...).withStringFromValueFunction(...)`. (2026-07)

- [rU0tV1] Pure MIDI effect (no audio) bus layout rejected by hosts
  Cause: a MIDI-only plugin must declare zero audio buses and report the layout accordingly.
  Fix: construct with `AudioProcessor(BusesProperties())` (empty = no buses); in `isBusesLayoutSupported` return true only when both `layouts.getMainInputChannelSet().isDisabled()` and `getMainOutputChannelSet().isDisabled()`; set `isMidiEffect()`/`acceptsMidi()`/`producesMidi()` true; in `processBlock` just `buffer.clear()` defensively (0 channels) and process the `MidiBuffer`. (2026-07)

- [mK7nB9] Unit-test console app exe not where expected (`juce_add_console_app`)
  Cause: like plugins, console-app output goes under JUCE's artefacts tree, not a flat folder.
  Fix: the binary is at `<build>/<Target>_artefacts/<Config>/<Target>.exe`; locate it with `where /r <build> <Target>.exe` (a cmd `for /r ... in (literal)` does NOT check existence and yields bogus paths - see tools/batch.md). (2026-07)

- [nQ8rT3] `addAndMakeVisible(child)` shows a panel that should start hidden (constructor called `setVisible(false)`)
  Cause: `addAndMakeVisible` internally calls `child.setVisible(true)`, which overrides the constructor's `setVisible(false)`. The make-visible wins.
  Fix: for overlays/panels that start hidden, use `addChildComponent(child)` (adds without changing visibility), then `child.setVisible(true)` + `child.toFront(true)` when toggled on. (2026-07)

- [kL4mN8] Linux build of a JUCE GUI plugin fails with `X11/extensions/XInput2.h: No such file or directory` (and: which apt deps does a JUCE plugin need on Linux?)
  Cause: juce_gui_basics includes XInput2 (libxi-dev) on top of the usual X11 set; libxi-dev is easy to omit. WebKit/curl are only needed if you enable the browser/curl modules.
  Fix: minimal verified dep set on Debian/Ubuntu: `build-essential cmake ninja-build pkg-config git` + `libx11-dev libxcomposite-dev libxcursor-dev libxext-dev libxinerama-dev libxrandr-dev libxrender-dev libxi-dev libfreetype-dev libfontconfig1-dev libasound2-dev`. Skip webkit/curl when `JUCE_WEB_BROWSER=0`/`JUCE_USE_CURL=0`. LV2 needs NO apt package (JUCE vendors the LV2 SDK). LV2 is the Linux-native open format, but VST3 and CLAP also build and run on Linux (the bundle's `.so` sits under `Contents/x86_64-linux`), so build all three for max DAW compatibility. (2026-07)

- [tY6uK1] MIDI effect leaves stuck notes in the downstream instrument after transport stop / "notes held after release" that never clear
  Cause: a MIDI effect tracks which OUTPUT notes it told the downstream instrument to play, but `reset()`/`prepareToPlay()`/`releaseResources()` (which hosts call on transport stop, start, and buffer-size change) wipe that tracking state WITHOUT emitting note-offs. The instrument then drones on the forgotten notes forever, and because the effect forgot them, later key-releases never send the missing note-offs - so it looks like "release does not work."
  Fix: never clear sounding state silently. On reset/prepareToPlay, if anything is sounding set a `panicPending` flag (`std::atomic<bool>`, since releaseResources may run on a non-audio thread); at the top of the next `processBlock` (the only place you can write the output MidiBuffer) `exchange` it false and emit a full MIDI panic - `MidiMessage::allSoundOff(ch)` + `allNotesOff(ch)` for ch 1..16 (32 CCs, the standard panic). Test gotcha: `isNoteOff()` takes a `bool` arg so its member-pointer type differs from the no-arg `isAllSoundOff()`/`isAllNotesOff()`; count messages with a lambda predicate, not one member-pointer type. (2026-07)

- [gH2nP8] MIDI effect stuck notes that get WORSE when turning a knob while playing / a chord built up note-by-note leaves the original (un-inverted) notes held forever
  Cause: a re-voicing MIDI effect that re-computes its output once PER incoming event inside a single `processBlock` emits causal note pairs at the SAME pitch within one block - e.g. as a chord grows note-by-note, inversion lifts a note so the engine emits `noteOn(60)` then `noteOff(60)` (60 moved to 72). A well-meaning `stable_sort` that forces ALL note-offs before ALL note-ons at the same timestamp reorders that pair to `noteOff(60) ... noteOn(60)`, so the note-off fires BEFORE the note-on it was meant to cancel and the downstream synth latches 60 permanently. The engine's own `activeBits` looks correct, so unit tests that only inspect internal state pass - the bug is only visible by replaying the OUTPUT stream into a fake instrument.
  Fix: sort output events by TIME ONLY and preserve causal generation order (`std::stable_sort` with `return a.time < b.time;` - NO off-before-on tiebreak). Within a single re-voice the diff already emits all note-offs before all note-ons, so a genuine pitch change still goes off-then-on naturally; only the harmful cross-event reorder is removed. To catch this class of bug, test by feeding the engine's OUTPUT MidiBuffer into a fake instrument (noteOn adds / noteOff removes / CC120+123 clears) and assert it is silent after releasing all held notes - including a randomized stress test that turns parameters while pressing/releasing. (2026-07)

- [dR4gT7] `DragAndDropContainer::performExternalDragDropOfFiles` (or `performExternalDragDropOfText`) does NOTHING when triggered from a button's `onClick`
  Cause: a native external drag-drop can only be initiated from inside an active mouse-drag gesture; a click handler has no drag context, so the call silently no-ops (no error).
  Fix: start the drag from a `mouseDrag` override (set an `armed` flag on `mouseDown`, then on `mouseDrag` build the file/text and call the static `performExternalDragDropOfFiles ({ path }, canMove, sourceComponent)`). In JUCE 9 it is a STATIC method taking `(const StringArray& files, bool canMoveFiles, Component* source = nullptr, std::function<void()> callback = nullptr)` - not an instance method needing a parent DragAndDropContainer. (2026-07)

- [oP8mK2] `juce::Optional<T>` has no `.value()` member (compile error C2039) - it is NOT `std::optional`
  Cause: JUCE's Optional wraps `std::optional` but exposes a different accessor surface; `.value()` is not forwarded.
  Fix: use `opt.orFallback (default)` (value-or), `*opt` / `opt.operator*()`, or `opt.hasValue()` + dereference. `AudioPlayHead::PositionInfo::getBpm()`/`getPpqPosition()` return `juce::Optional<double>`, so e.g. `bpm = pos->getBpm().orFallback (120.0);`. (2026-07)

- [bT5nQ9] `juce::TextButton::textColourId` does not exist (C2039 / undeclared) when setting or finding the button's text colour
  Cause: in JUCE 9 TextButton splits the text colour by toggle state; there is no single `textColourId`.
  Fix: use `juce::TextButton::textColourOffId` and `juce::TextButton::textColourOnId`. In a custom `drawButtonText` override pick the colour by `button.getToggleState()` (on -> textColourOnId, off -> textColourOffId) via `button.findColour (...)`. (2026-07)

- [sQ3xW6] A plugin's own Play button does nothing audible because the internal sequencer is gated on the DAW transport's `getIsPlaying()`
  Cause: if the sequencer only runs when `PositionInfo::getIsPlaying()` is true, pressing the plugin's Play button with the DAW transport stopped produces no output (isPlaying is false), so the user hears nothing.
  Fix: run the sequencer on its OWN beat clock when armed: each block advance `beatPos += (numSamples / sampleRate) * (bpm / 60)` using the playhead's BPM (fallback 120), loop with `fmod (beatPos, totalBeats)`, and trigger step note-ons/offs on step changes. Read the BPM regardless of play state. Optionally disarm when the transport stops (track a wasPlaying flag and clear `armed` on the true->false transition) so the DAW stop button also stops it. (2026-07)
