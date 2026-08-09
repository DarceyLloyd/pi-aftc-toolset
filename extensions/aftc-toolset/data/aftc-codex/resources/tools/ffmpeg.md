# ffmpeg

## Rules

- [qd0aNg] Preserve the source channel count when re-encoding by NOT passing -ac (ffmpeg keeps the input layout by default); convert to a temp file, verify output size and a readable duration, then os.replace - never delete the source before the output is verified.

## Gotchyas

- [oksuKj] ffmpeg "Unable to choose an output format for 'out.mp3.tmp'" - a non-standard temp extension (.tmp) defeats muxer inference; pass -f mp3 (or the real target format) before the temp output path, then os.replace onto the final name.

## Issues & Solutions


- [hkRUmk] Trim is off by a few frames
  Cause: `-ss` before `-i` is a fast seek, not frame-accurate.
  Fix: put `-ss` after `-i` for accuracy (slower, decodes). (2026-07)
- `[wkqIYF] -c copy` fails or produces broken output across inputs
  Cause: stream copy only works when inputs share codec/parameters.
  Fix: re-encode when they do not. (2026-07)
- [IkGcCN] Mux error combining certain codecs and containers
  Cause: `.mp4` does not support opus audio, `.webm` does not support aac.
  Fix: use `.mkv` for mixed-codec muxing. (2026-07)
- [xEy3Lp] MP4 buffers fully before playing on the web
  Cause: moov atom is at the end of the file.
  Fix: add `-movflags +faststart` to MP4 outputs for web playback. (2026-07)
- [Oik5S2] Extracted audio is the wrong track
  Cause: video has multiple audio tracks.
  Fix: pick explicitly with `-map 0:a:0`. (2026-07)
- [BIbZnB] Choppy/low-quality GIF from naive conversion
  Cause: a naive single-pass conversion uses a poor palette, so the GIF looks choppy/low-quality.
  Fix: use the palette method: `-vf "fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"`. (2026-07)
