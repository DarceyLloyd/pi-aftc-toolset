# Serum 1 Presets (wavetable binary format)

*Scope: the Serum 1 PRESET FILE FORMAT - wavetable references stored as fixed-size binary records inside Serum 1 .fxp presets (plugin id XfsX), in the shared .fxp container (see file-formats/audio/fxp-fxb.md for the container itself). Serum 1 and Serum 2 are VERY DIFFERENT formats - these records are Serum 1 only; do not apply them to Serum 2 presets. Binary format surgery, not sound design.*

## Rules

- [mElVFJ] Serum 1 wavetable references (plugin id XfsX) live in fixed 512-byte NUL-padded records, one per oscillator slot, each shaped [flag byte][path][padding]; an empty record is 512 zero bytes - replicate that exact state when clearing an unresolved reference so the preset loads without erroring.

- [T1fLBO] Serum 1 wavetable refs may omit the .wav extension (name-only references) and may point at .aif files; the noise source is a factory index, not a path - only the wavetable records carry editable paths.

## Gotchyas

- [LoBhSs] Downloaded Serum 1 presets often embed absolute drive-letter paths from the author's machine (e.g. F:\Dropbox\...) that are broken elsewhere - rewrite them to root-relative '<Collection>/<file>' paths that resolve against the wavetables folder, or clear the record.

- [56hKL2] A wavetable record's padding check must span from the path to the NEXT non-NUL byte (the next record's flag) - checking a fixed 512 run from the string start is off by the flag byte and rejects valid slots; a clear must zero from the flag byte up to (not including) the next non-NUL byte.

## Issues & Solutions
