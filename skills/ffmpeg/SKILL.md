---
name: ffmpeg
description: ffmpeg command-line tool for video, audio, and image processing. Use when converting, transcoding, trimming, extracting audio, resizing, scaling, cropping, concatenating, or muxing media files; when working with .mp4/.mkv/.webm/.mov/.mp3/.wav/.gif; when changing bitrate, codec, framerate, resolution, sample rate, or channels; when streaming or recording; or when the user asks for any media manipulation.
---

# ffmpeg

`ffmpeg` is the canonical CLI for media processing. Most operations follow the same shape:

```text
ffmpeg [global_options] -i input.ext [input_options] ... [output_options] output.ext
```

- `i` flags are inputs. Last positional argument is the output.
- Order of options matters - flags apply to the next input/output, or globally if placed before any input.
- Use `-y` to overwrite without prompting, `-n` to never overwrite, `-hide_banner` to suppress the version banner.

## Convert / Transcode

```bash
# Convert MP4 to WebM (VP9 + Opus)
ffmpeg -i input.mp4 -c:v libvpx-vp9 -c:a libopus output.webm

# Convert MKV to MP4 (H.264 + AAC, faststart for web)
ffmpeg -i input.mkv -c:v libx264 -c:a aac -movflags +faststart output.mp4

# Convert MOV to MP4 (just remux, no re-encode)
ffmpeg -i input.mov -c copy output.mp4

# Convert to MP3 (audio only)
ffmpeg -i input.m4a -c:a libmp3lame -q:a 2 output.mp3

# Convert video to GIF (palette method for best quality)
ffmpeg -i input.mp4 -vf "fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" output.gif
```

## Trim / Cut

```bash
# From 00:00:30 to 00:01:30 (30s start, 60s duration)
ffmpeg -ss 00:00:30 -i input.mp4 -t 60 -c copy output.mp4

# Re-encode (frame-accurate, slower)
ffmpeg -i input.mp4 -ss 00:00:30 -to 00:01:30 -c:v libx264 -c:a aac output.mp4

# Note: -ss BEFORE -i = fast seek (may be off by a few frames). -ss AFTER -i = slow but accurate.
```

## Extract Audio / Strip Video

```bash
# Extract audio from video (no re-encode)
ffmpeg -i input.mp4 -vn -c:a copy output.m4a

# Extract audio (re-encode to MP3)
ffmpeg -i input.mp4 -vn -c:a libmp3lame -q:a 2 output.mp3

# Strip video, keep audio only
ffmpeg -i input.mp4 -an -c:v copy output_silent.mp4
```

## Resize / Scale

```bash
# Resize to 1280x720 (aspect preserved)
ffmpeg -i input.mp4 -vf scale=1280:720 output.mp4

# Resize to 720px wide, auto height
ffmpeg -i input.mp4 -vf scale=720:-1 output.mp4

# Resize to half size
ffmpeg -i input.mp4 -vf scale=iw/2:ih/2 output.mp4

# Force dimensions (may distort aspect)
ffmpeg -i input.mp4 -vf scale=640:480 output.mp4
```

## Change Bitrate / Quality

```bash
# Video: 2 Mbps constant bitrate
ffmpeg -i input.mp4 -c:v libx264 -b:v 2M output.mp4

# Video: CRF 23 (perceptually good quality, ~ H.264 default)
ffmpeg -i input.mp4 -c:v libx264 -crf 23 -preset medium output.mp4

# Audio: 128 kbps
ffmpeg -i input.mp4 -c:a aac -b:a 128k output.mp4

# Audio: VBR MP3 (0 = best, 9 = worst, 2 ≈ 190 kbps)
ffmpeg -i input.wav -c:a libmp3lame -q:a 2 output.mp3
```

CRF vs bitrate: use `-b:v` (bitrate) when file size matters, `-crf` (constant rate factor) when quality matters.

## Change Codec / Container

```bash
# Re-encode to H.265 (HEVC)
ffmpeg -i input.mp4 -c:v libx265 -c:a aac output.mp4

# Copy streams (remux, no re-encode - fast and lossless)
ffmpeg -i input.mkv -c copy output.mp4

# Web-optimized MP4 (faststart moves moov atom to the start)
ffmpeg -i input.mp4 -movflags +faststart -c copy output_web.mp4
```

## Concatenate

```bash
# Concatenate MP4s of the same codec (fast, no re-encode)
# First create a list file:
echo "file 'part1.mp4'" > list.txt
echo "file 'part2.mp4'" >> list.txt
echo "file 'part3.mp4'" >> list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4

# Concatenate with re-encode (works across codecs)
ffmpeg -i "concat:part1.mp4|part2.mp4|part3.mp4" -c:v libx264 -c:a aac output.mp4
```

## Common Filters

Filters are chained with `-vf` (video) or `-af` (audio), each step separated by commas. Reference a labeled output with `[label]`.

```bash
# Crop 100px off all sides
ffmpeg -i input.mp4 -vf "crop=iw-200:ih-200:100:100" output.mp4

# Scale + pad to 1920x1080 (letterbox if needed)
ffmpeg -i input.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black" output.mp4

# Rotate 90° clockwise
ffmpeg -i input.mp4 -vf "transpose=1" output.mp4

# Deinterlace
ffmpeg -i input.mp4 -vf yadif output.mp4

# Stabilize (2-pass, requires vidstab)
ffmpeg -i input.mp4 -vf vidstabdetect=shakiness=5 -f null -
ffmpeg -i input.mp4 -vf vidstabtransform=smoothing=10 output.mp4

# Draw text overlay
ffmpeg -i input.mp4 -vf "drawtext=text='Hello World':fontsize=48:fontcolor=white:x=20:y=20" output.mp4

# Fade in over first 2s, fade out over last 2s
ffmpeg -i input.mp4 -vf "fade=t=in:st=0:d=2,fade=t=out:st=22:d=2" output.mp4

# Volume adjustment
ffmpeg -i input.mp4 -af "volume=0.5" output.mp4    # 50% volume
ffmpeg -i input.mp4 -af "volume=2.0" output.mp4    # 200% volume (may clip)

# Audio normalization
ffmpeg -i input.mp4 -af "loudnorm=I=-16:TP=-1.5:LRA=11" output.mp4
```

## Thumbnail / Frame Extraction

```bash
# Extract a single frame at 5 seconds
ffmpeg -ss 00:00:05 -i input.mp4 -frames:v 1 -q:v 2 thumb.jpg

# Extract one frame per second (for previews)
ffmpeg -i input.mp4 -vf fps=1 frame_%04d.png

# Extract a sprite sheet (10x10 grid of frames)
ffmpeg -i input.mp4 -vf "fps=1,scale=160:90,tile=10x10" sprite.png
```

## Probe Media

```bash
# Show stream info (codec, resolution, bitrate, duration)
ffmpeg -i input.mp4 -hide_banner

# JSON metadata (use ffprobe for richer output)
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4 | jq .
```

## Common Gotchas

- `-ss` before `-i` is fast but loses frame accuracy. Put it after `-i` for accuracy.
- `-c copy` is fast and lossless but only works when inputs share codecs/parameters. Re-encode when they don't.
- `libx264` is GPL - use `libx264rgb` or `-c:v h264_videotoolbox` (macOS), `h264_nvenc` (NVIDIA), `h264_qsv` (Intel) for hardware encoders.
- Container matters: `.mp4` doesn't support `opus` audio, `.webm` doesn't support `aac`. Use `mkv` for mixed-codec muxing.
- `libmp3lame` is the standard MP3 encoder. `-q:a` is VBR (0–9, lower = better), `-b:a` is CBR (e.g. `192k`).
- `aac` encoder is the default in ffmpeg; use `-c:a aac_mf` for higher quality on modern ffmpeg.
- For web playback, add `-movflags +faststart` to MP4 outputs so the moov atom is at the start of the file.
- `-crf 0` is lossless, `-crf 51` is worst, `-crf 18` is visually lossless, `-crf 23` is default. Lower = better quality, larger file.
- For previews/scrubbing, `-ss 0.5 -frames:v 1` is much faster than starting at frame 0.
- When extracting audio from a video with multiple audio tracks, use `-map 0:a:0` to pick the first audio track explicitly.
- `ffmpeg -version` shows the build configuration (which codecs are available, hardware accel support, etc.).
