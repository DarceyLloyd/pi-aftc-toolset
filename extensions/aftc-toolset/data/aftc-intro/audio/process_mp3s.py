#!/usr/bin/env python3
"""Recursively normalise every .mp3 under this folder (and all
subfolders) and overwrite it in place.

Each file is:
    * decoded to 16-bit PCM,
    * downmixed to mono,
    * resampled to 44.1 kHz,
    * peak-normalised to -1.0 dBFS (same normalisation as
      process_audio.py),
    * re-encoded to 96 kbps MP3,
    * written back over the original file.

Uses the system Python. Missing dependencies (numpy, miniaudio,
lameenc) are installed automatically with pip. miniaudio bundles
minimp3 for decoding and lameenc bundles LAME for encoding, so no
system ffmpeg is required.

Usage:
    python process_mp3s.py            # normalise and overwrite MP3s
    python process_mp3s.py --dry-run  # report only, write nothing
"""

from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

# --- tunables ---------------------------------------------------------
BIT_RATE_KBPS = 96          # MP3 bit rate
TARGET_RATE = 44100         # output sample rate (Hz)
TARGET_CHANNELS = 1         # output channel count (mono)
NORMALIZE_DBFS = -3.0       # peak-normalize audio to this level
# ----------------------------------------------------------------------

HERE = Path(__file__).resolve().parent


def ensure_deps() -> None:
    """Import numpy + miniaudio + lameenc, pip-installing if absent."""
    missing = []
    for mod in ("numpy", "miniaudio", "lameenc"):
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if not missing:
        return
    print(f"[setup] installing: {', '.join(missing)} ...")
    cmd = [sys.executable, "-m", "pip", "install", "--quiet", *missing]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError:
        # fall back to a per-user install (no admin rights)
        cmd = [sys.executable, "-m", "pip", "install", "--quiet", "--user", *missing]
        subprocess.run(cmd, check=True)


def normalize_peak(samples, target_dbfs: float = NORMALIZE_DBFS):
    """Scale int16 samples so the loudest peak reaches target_dbfs."""
    import numpy as np

    full_scale = 32768.0
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 0:
        return samples
    target = full_scale * (10.0 ** (target_dbfs / 20.0))
    gain = target / peak
    out = samples.astype(np.float64) * gain
    return np.clip(out, -32768.0, 32767.0).astype("<i2")


def decode_to_mono_44k(path: Path):
    """Decode an MP3 to mono, 44.1 kHz, int16 numpy samples (n, 1)."""
    import miniaudio
    import numpy as np

    decoded = miniaudio.decode_file(
        str(path), output_format=miniaudio.SampleFormat.SIGNED16
    )
    samples = np.asarray(decoded.samples).astype("<i2")
    # miniaudio returns interleaved frames; shape is (num_frames, nchannels)
    if samples.ndim == 1:
        samples = samples.reshape(-1, decoded.nchannels)

    if decoded.sample_rate == TARGET_RATE and decoded.nchannels == TARGET_CHANNELS:
        return samples

    converted = miniaudio.convert_frames(
        miniaudio.SampleFormat.SIGNED16,
        decoded.nchannels,
        decoded.sample_rate,
        samples.tobytes(),
        miniaudio.SampleFormat.SIGNED16,
        TARGET_CHANNELS,
        TARGET_RATE,
    )
    return np.frombuffer(bytes(converted), dtype="<i2").reshape(-1, TARGET_CHANNELS)


def encode_mp3(samples, rate: int, channels: int) -> bytes:
    import lameenc

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(BIT_RATE_KBPS)
    encoder.set_in_sample_rate(rate)
    encoder.set_channels(channels)
    encoder.set_quality(2)  # 2 = high quality

    pcm = samples.astype("<i2").tobytes()
    data = encoder.encode(pcm)
    data += encoder.flush()
    return data


def run_test(mp3s) -> int:
    """Process a single MP3 and write it next to the script for review."""
    args = sys.argv[1:]
    target = None
    if "--test" in args:
        rest = [a for a in args[args.index("--test") + 1:] if not a.startswith("--")]
        if rest:
            candidate = (HERE / rest[0]).resolve()
            if candidate.exists():
                target = candidate
    if target is None:
        target = mp3s[0]

    print(f"[test] processing single file: {target.relative_to(HERE)}")
    samples = decode_to_mono_44k(target)
    dur_ms = samples.shape[0] * 1000 / TARGET_RATE
    samples = normalize_peak(samples)
    mp3 = encode_mp3(samples, TARGET_RATE, TARGET_CHANNELS)
    out = HERE / f"_test_{target.name}"
    out.write_bytes(mp3)
    print(f"[test] wrote {out.name}: {dur_ms:.0f}ms, {len(mp3) / 1024:.1f} KB mp3")
    print(f"[test] listen to {out.name} to validate, then delete it.")
    return 0


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    test_mode = "--test" in sys.argv[1:]
    # Scan the folder Python was launched from, plus all of its subfolders.
    scan_root = Path.cwd().resolve()
    ensure_deps()

    # Recursively select only real MP3 files. The Python and batch scripts
    # cannot match this filter, so they are never read or overwritten.
    mp3s = sorted(
        p for p in scan_root.rglob("*")
        if p.is_file() and p.suffix.lower() == ".mp3" and not p.name.startswith("_test_")
    )
    if not mp3s:
        print(f"[audio] no .mp3 files in {scan_root} (or subfolders)")
        return 0

    if test_mode:
        return run_test(mp3s)

    mode = "DRY RUN" if dry_run else "processing"
    print(
        f"[audio] {mode} {len(mp3s)} file(s) -> mono {TARGET_RATE} Hz "
        f"@ {BIT_RATE_KBPS} kbps, peak-normalised to {NORMALIZE_DBFS} dBFS"
    )
    ok = 0

    for mp3_path in mp3s:
        rel = mp3_path.relative_to(scan_root)
        try:
            samples = decode_to_mono_44k(mp3_path)
            before_ms = samples.shape[0] * 1000 / TARGET_RATE
            samples = normalize_peak(samples)

            if dry_run:
                print(f"  [dry]  {rel}: {before_ms:.0f}ms (would overwrite)")
                ok += 1
                continue

            mp3 = encode_mp3(samples, TARGET_RATE, TARGET_CHANNELS)
            mp3_path.write_bytes(mp3)
            print(
                f"  [ok]   {rel}: {before_ms:.0f}ms, "
                f"{len(mp3) / 1024:.1f} KB mp3"
            )
            ok += 1
        except Exception as exc:  # keep going on per-file errors
            print(f"  [err]  {rel}: {exc}")

    verb = "would normalise" if dry_run else "normalised"
    print(f"[audio] done: {ok} {verb}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
