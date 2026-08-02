# PyTorch

## Rules

## Gotchyas

- [uDrJKw] MODEL UNLOAD & background load - a background-thread model load finishing AFTER an unload request silently resurrects the model in GPU memory; set a disabled flag on unload and check it at load completion (discard instead of assigning), and free with del + torch.cuda.empty_cache().

## Issues & Solutions


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
- [oMp1xT] OMP_NUM_THREADS=1 in the host environment silently forces single-threaded CPU inference (torch.get_num_threads() == 1, CPU time ~= wall time, ~7x slower)
  Cause: torch respects OMP_NUM_THREADS; some machines have it set globally (user/machine env), and a spawned child process inherits it.
  Fix: in any long-running inference process that owns its CPU workload, set threading explicitly: `torch.set_num_threads(os.cpu_count())` (or the desired count) before CPU jobs; never rely on inherited env defaults. (2026-07)

- [TE7K6x] apply_chat_template(...return_tensors="pt") then model.generate fails with bare 'AttributeError' (transformers 5.x)
  Cause: In transformers 5.x apply_chat_template returns a BatchEncoding (dict of input_ids/attention_mask), not a bare tensor; generate() then fails inside with AttributeError which stringifies empty, hiding the cause.
  Fix: Call apply_chat_template(..., return_tensors="pt", return_dict=True) and pass the whole dict: model.generate(**{k: v.to(device) for k,v in encoded.items()}); decode output[:, encoded["input_ids"].shape[1]:]. Always log type(exc).__name__ with the message so empty-str exceptions stay diagnosable. (2026-08)
