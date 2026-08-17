# Spire-presets

## Rules

## Gotchyas

- [G8HZYu] Spire .spf/.sbf float block - legacy float 720 is a constant 0.5 placeholder and float 721 is the REAL mod_wheel, so map legacy[721] to .spf2 'mod_wheel' (index 720) and drop legacy[720]; a naive 1:1 positional map silently writes the wrong mod wheel (and a 'force mod_wheel=0' shortcut only looks right when every test preset happens to have mod wheel 0).

- [EHiu8S] Spire 'anticlick' - the legacy .spf/.sbf files do NOT store anticlick (it is a Spire-2 default, 1 = on, applied at conversion time), so it cannot be recovered from the file; write the default and expose it as a configurable constant rather than trying to read it.

- [XU2L4o] Spire .sbf param count - the bank stores a 32-bit little-endian param count (722 new / 714 old) at file offset 1029; 714-param records omit the last 8 params, which Spire 2 fills with defaults (macro1-4 = 0, pitch_shift/pitch_fine = 0.5, mod_wheel = 0, anticlick = 1), so read the count and backfill those 8.

- [3zwqtb] Spire .sbf slots - a bank holds a FIXED 128 preset slots (each a 277-byte header + N floats, records starting at file offset 1033); unused slots are named 'init' or left blank, so walk at most 128 records and skip init/blank names instead of trusting a name scan.

- [zojWGQ] Spire .sbf truncation - bank files are commonly 2 bytes short at the very end (the final float is cut mid-value), and third-party banks may carry a trailing metadata block after the 128 slots; zero-pad the last float and stop the walk on the first non-printable name.

## Issues & Solutions
