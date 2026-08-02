#!/usr/bin/env python3
"""Recursively trim leading/trailing silence from every .wav under this
folder (and all subfolders) and encode the result to 96 kbps MP3.

Uses the system Python. Missing dependencies (numpy, lameenc) are
installed automatically with pip. lameenc bundles LAME, so no system
ffmpeg is required.

Usage:
    python process_wavs.py            # convert and write MP3s
    python process_wavs.py --dry-run  # report only, write nothing

Output: <name>.mp3 written next to each source .wav (same folder),
overwritten if it already exists. Source .wav files are left untouched.
"""

from __future__ import annotations

import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

# --- tunables ---------------------------------------------------------
BIT_RATE_KBPS = 96          # MP3 bit rate
CHUNK_MS = 10               # analysis window for silence detection
SILENCE_DBFS = -50.0        # below this RMS = silence
PAD_MS = 50                 # silence kept each side of the trim
NORMALIZE_DBFS = -1.0       # peak-normalize trimmed audio to this level
# ----------------------------------------------------------------------

HERE = Path(__file__).resolve().parent


def ensure_deps() -> None:
    """Import numpy + lameenc, pip-installing them if absent."""
    missing = []
    for mod in ("numpy", "lameenc"):
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


def dbfs(rms: float, full_scale: float) -> float:
    if rms <= 0:
        return -math.inf
    return 20.0 * math.log10(rms / full_scale)


def read_wav(path: Path):
    """Return (samples as int16 numpy array shape (n, ch), rate, channels)."""
    import numpy as np

    with wave.open(str(path), "rb") as wf:
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if width != 2:
        raise ValueError(f"{path.name}: only 16-bit WAV supported (got {width * 8}-bit)")

    samples = np.frombuffer(raw, dtype="<i2").reshape(-1, channels)
    return samples, rate, channels


def trim_silence(samples, rate: int, channels: int):
    """Return samples with leading/trailing silence removed (+ padding)."""
    import numpy as np

    full_scale = 32768.0
    chunk = max(1, int(rate * CHUNK_MS / 1000))
    n = samples.shape[0]
    n_chunks = n // chunk
    if n_chunks == 0:
        return samples

    # RMS per chunk across all channels
    blocks = samples[: n_chunks * chunk].reshape(n_chunks, chunk, channels)
    rms = np.sqrt(np.mean(blocks.astype(np.float64) ** 2, axis=(1, 2)))
    loud = rms > full_scale * (10.0 ** (SILENCE_DBFS / 20.0))

    if not loud.any():
        return None  # entirely silent

    first = int(np.argmax(loud))
    last = n_chunks - 1 - int(np.argmax(loud[::-1]))

    pad = int(rate * PAD_MS / 1000)
    start = max(0, first * chunk - pad)
    end = min(n, (last + 1) * chunk + pad)
    return samples[start:end]

def normalize_peak(samples, target_dbfs: float = NORMALIZE_DBFS):
    """Scale samples so the loudest peak reaches target_dbfs (peak norm)."""
    import numpy as np

    full_scale = 32768.0
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 0:
        return samples
    target = full_scale * (10.0 ** (target_dbfs / 20.0))
    gain = target / peak
    out = samples.astype(np.float64) * gain
    return np.clip(out, -32768.0, 32767.0).astype("<i2")


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


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    # Scan the folder Python was launched from, plus all of its subfolders.
    scan_root = Path.cwd().resolve()
    ensure_deps()

    # Select only real WAV files, never either processor or batch launcher.
    wavs = sorted(
        p for p in scan_root.rglob("*")
        if p.is_file() and p.suffix.lower() == ".wav"
    )
    if not wavs:
        print(f"[audio] no .wav files in {scan_root} (or subfolders)")
        return 0

    mode = "DRY RUN" if dry_run else "processing"
    print(f"[audio] {mode} {len(wavs)} file(s) -> {BIT_RATE_KBPS} kbps MP3")
    ok = skipped = 0

    for wav_path in wavs:
        rel = wav_path.relative_to(scan_root)
        try:
            samples, rate, channels = read_wav(wav_path)
            trimmed = trim_silence(samples, rate, channels)
            if trimmed is None:
                print(f"  [skip] {rel}: entirely silent")
                skipped += 1
                continue

            trimmed = normalize_peak(trimmed)
            before_ms = samples.shape[0] * 1000 / rate
            after_ms = trimmed.shape[0] * 1000 / rate
            if dry_run:
                print(
                    f"  [dry]  {rel}: "
                    f"{before_ms:.0f}ms -> {after_ms:.0f}ms (would write "
                    f"{wav_path.with_suffix('.mp3').relative_to(scan_root)})"
                )
                ok += 1
                continue

            mp3 = encode_mp3(trimmed, rate, channels)
            out_path = wav_path.with_suffix(".mp3")
            out_path.write_bytes(mp3)
            print(
                f"  [ok]   {rel}: "
                f"{before_ms:.0f}ms -> {after_ms:.0f}ms, "
                f"{len(mp3) / 1024:.1f} KB mp3"
            )
            ok += 1
        except Exception as exc:  # keep going on per-file errors
            print(f"  [err]  {rel}: {exc}")

    verb = "would convert" if dry_run else "converted"
    print(f"[audio] done: {ok} {verb}, {skipped} skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
