# File Formats Common (Binary & Data Processing)

*Scope: lessons that hold for ANY binary file format work - parsing, decoding, extracting, byte-level surgery, decompression, container/chunked formats, fixed-size records. Format-specific topics live under file-formats/<family>/ (eg file-formats/audio/fxp-fxb.md); the common rides along whenever any file-formats topic is loaded.*

## Rules

- [YU9l00] When rewriting binary preset formats in place (e.g. FXP wavetable paths), verify by re-parsing the rebuilt file AND byte-diffing the decompressed data against the original outside the edited records - string-presence checks alone miss corruption; clear an unresolvable reference by zeroing its fixed-size field (replicating the format's own 'empty' state), never by leaving a broken path.

- [Yw52nE] A shared preset file extension does not mean a shared encoding - a container like .fxp/.fxb wraps each plugin's OWN payload layout (Serum 1, u-he, Sylenth, etc. all differ); identify the owning plugin by its 4CC/magic and use that plugin's format topic, never assume one parser decodes every file with that extension.

- [RJYsss] CBOR (RFC 8949) is small enough to implement decode+encode in stdlib for the common types (map, text, array, int, float, simple) in ~100 lines — do that instead of adding a cbor2 dependency when only a subset of types is used.

## Gotchyas

- [PMALzS] A single-shot zlib decompress reads only the FIRST stream: a container that concatenates multiple zlib streams (a small header stream followed by larger payload streams) silently 'decompresses' to just the first, tiny result with no error. Loop zlib.decompressobj().decompress() over its unused_data until empty to read every stream.

- [36X2Q1] A magic/header check against a hardcoded slice length fails silently when the magic ends in an embedded NUL or extra byte (a 9-byte magic compared against an 8-byte slice). Always slice by len(MAGIC), never a literal length.

- [f5BKL5] json.dumps (default allow_nan=True) emits NaN/Infinity tokens that are not valid strict JSON and break other parsers. When round-tripping binary<->JSON, sanitize non-finite floats to null (allow_nan=False) and skip writing them back on encode so unchanged bytes stay untouched.

- [Y0MmH3] Reverse-engineering a binary parameter layout by correlating paired old/new files fails when a version change rescales or reorders the values: default values (0.0/0.5/1.0) repeat everywhere so value-matching is ambiguous, and if no byte offset reaches a high match rate across many pairs the layout genuinely changed — do not promise a converter without the vendor's spec.

- [Sx4FNL] A different-length string can be swapped into a binary record that stores it in a FIXED-size NUL-padded field - write the new string and re-pad the field so surrounding offsets never shift, then recompress and rebuild the container size fields; don't assume a longer/shorter path needs offset surgery.

## Issues & Solutions
