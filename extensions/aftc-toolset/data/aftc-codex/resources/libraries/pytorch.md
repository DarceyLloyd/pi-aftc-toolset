# PyTorch

- [lUOREt] Training step time explodes (eg 1.3s -> 90s/step) and system RAM keeps climbing
  Cause: VRAM exhausted, Windows pages GPU memory to shared/system RAM and every step thrashes over PCIe.
  Fix: free VRAM (close other GPU apps, unload resident models) and re-run; do not tune code; warn when free VRAM drops below ~8 GiB. (2026-07)
- [7lmfB3] torchcodec import/load fails
  Cause: the FFmpeg in use is a static build with no shared DLLs.
  Fix: use a gpl-shared FFmpeg build and register its bin dir via `os.add_dll_directory` + PATH before importing torchcodec; never fix by upgrading torchcodec (its ABI must match the pinned torch). (2026-07)
- [AIgMUj] torch/torchvision/torchaudio CUDA matched set breaks after installing vllm
  Cause: vllm pins its own torch.
  Fix: do not install vllm alongside a pinned wheel set; use the `pt` LM backend instead. (2026-07)
- [pclrdU] No torchaudio wheel for a new torch version
  Cause: torchaudio is in maintenance mode and caps at torch 2.11.
  Fix: pin torch <= 2.11 when torchaudio is required. (2026-07)
- [xzJc3E] Automated audio tests (RMS/duration/sample-rate) pass but the output audio is garbage
  Cause: RMS only proves non-silence, not structure.
  Fix: any audio pipeline change needs a human listen before it counts as verified. (2026-07)
