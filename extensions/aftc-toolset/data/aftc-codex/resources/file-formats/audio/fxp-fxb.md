# FXP / FXB Plugin Presets (.fxp/.fxb)

*Scope: the .fxp (program) / .fxb (bank) PLUGIN PRESET container format - a plugin-agnostic binary format used by MANY plugins across every plugin API (VST2, VST3, CLAP, AU and others) and every OS (Windows, macOS, Linux). The 4CC at bytes 16-19 identifies the OWNING plugin - the container itself has nothing to do with any specific plugin API or host. Binary parsing and editing: header, chunks, 4CC, endianness. NOT the visual UI-design topic ui-ux/plugin/vst-plugin.md.*

## Rules

- [w51JhF] .fxp/.fxb plugin presets share one header format - 'CcnK' magic, 'FPCh' chunk, and a 4CC plugin id at bytes 16-19 - the 4CC identifies the owning synth even when the extension is shared by many plugins; build the id map by correlating 4CCs from presets inside folders whose names name the synth.

- [swkBIG] Verify the plugin 4CC of every preset file before batch-processing it - preset collections routinely mix in .fxp files for OTHER plugins (they share the extension); process only the target plugin's files and route the rest by their own id.

## Gotchyas

- [sFN6KL] FXP/FXB container size fields are BIG-endian - parsing the chunk boundaries little-endian fails to find the zlib stream and the whole decode breaks.

## Issues & Solutions
