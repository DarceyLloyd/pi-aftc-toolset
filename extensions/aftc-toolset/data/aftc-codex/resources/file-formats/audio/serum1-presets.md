# Serum 1 Presets (wavetable binary format)

*Scope: the Serum 1 PRESET FILE FORMAT - wavetable references stored as fixed-size binary records inside Serum 1 .fxp presets (plugin id XfsX), in the shared .fxp container (see file-formats/audio/fxp-fxb.md for the container itself). Serum 1 and Serum 2 are VERY DIFFERENT formats - these records are Serum 1 only; do not apply them to Serum 2 presets. Binary format surgery, not sound design.*

## Rules

- [mElVFJ] Serum 1 wavetable references (plugin id XfsX) live in fixed 512-byte NUL-padded records, one per oscillator slot, each shaped [flag byte][path][padding]; an empty record is 512 zero bytes - replicate that exact state when clearing an unresolved reference so the preset loads without erroring.

- [T1fLBO] Serum 1 wavetable refs may omit the .wav extension (name-only references) and may point at .aif files; the noise source is a factory index, not a path - only the wavetable records carry editable paths.

- [crLpSE] Serum 1 .fxp parameter block: in the DECOMPRESSED chunk, 299 consecutive little-endian float32 values start at offset 0x3460 (param N at 0x3460 + 4*N) in VST parameter order; values are normalised (mostly 0..1). Wavetable refs are 512-byte NUL-padded ASCII slots at fixed offsets 0x3C08/0x3E08/0x4008 (OSC1/OSC2/SUB); preset name (32B) at 0x4972; macro labels (4 x 32B) at 0x4A60/0x4A80/0x4AA0/0x4AC0; macro VALUES are params 218-221. Offsets are stable across different chunk sizes.

## Gotchyas

- [LoBhSs] Downloaded Serum 1 presets often embed absolute drive-letter paths from the author's machine (e.g. F:\Dropbox\...) that are broken elsewhere - rewrite them to root-relative '<Collection>/<file>' paths that resolve against the wavetables folder, or clear the record.

- [56hKL2] A wavetable record's padding check must span from the path to the NEXT non-NUL byte (the next record's flag) - checking a fixed 512 run from the string start is off by the flag byte and rejects valid slots; a clear must zero from the flag byte up to (not including) the next non-NUL byte.

- [nqtlwT] Invisible/zero-width Unicode characters (U+200B zero-width space, U+200C/200D, U+FEFF, soft hyphen) sneak into file/folder names via copy-paste; they are invisible but non-ASCII, so they break ASCII-only binary path slots with a mid-batch UnicodeEncodeError - strip them when building target names and resolved paths.

- [o27t63] Unused Serum 1 parameters (empty mod-matrix slots, LFO5-8 which have no UI) are stored as NaN float32, not 0.0 - a decoded value of NaN means 'uninitialised'; serialise NaN as JSON null and skip writing it on re-encode so the stored bytes stay untouched.

- [m2rIVX] Serum 1 .fxp files can hold 2+ concatenated zlib streams: stream 0 is the preset state (the 299 params at 0x3460, name, refs), stream 1+ is the embedded wavetable data (float32 frames). Decompress only stream 0 to read parameters — the file's large size is wavetable data, not parameters.

## Issues & Solutions
