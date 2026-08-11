# File Formats Common (Binary & Data Processing)

*Scope: lessons that hold for ANY binary file format work - parsing, decoding, extracting, byte-level surgery, decompression, container/chunked formats, fixed-size records. Format-specific topics live under file-formats/<family>/ (eg file-formats/audio/fxp-fxb.md); the common rides along whenever any file-formats topic is loaded.*

## Rules

- [YU9l00] When rewriting binary preset formats in place (e.g. FXP wavetable paths), verify by re-parsing the rebuilt file AND byte-diffing the decompressed data against the original outside the edited records - string-presence checks alone miss corruption; clear an unresolvable reference by zeroing its fixed-size field (replicating the format's own 'empty' state), never by leaving a broken path.

- [Yw52nE] A shared preset file extension does not mean a shared encoding - a container like .fxp/.fxb wraps each plugin's OWN payload layout (Serum 1, u-he, Sylenth, etc. all differ); identify the owning plugin by its 4CC/magic and use that plugin's format topic, never assume one parser decodes every file with that extension.

## Gotchyas

## Issues & Solutions
