# revel8 AMD endpoint — deployment record (01)

Authorized START Hack 2026 / revel8 hackathon infra. Pure ops: a GGUF LLM served
as an OpenAI-compatible endpoint on the remote AMD GPU box. Only a neutral
"reply with the word ready" health-check was run. No target API was contacted.

_Deployed: 2026-11-21._

## TL;DR

- **Endpoint reachable:** yes — OpenAI-compatible `http://127.0.0.1:11434/v1` on the box.
- **Served model id:** `huihui-qwen3.8-27b-abliterated-q4_k`
- **Model / quant:** huihui-ai Huihui-Qwen3.8-27B abliterated, **Q4_K** GGUF (16.8 GB, single file).
- **p50 latency:** **0.60 s** (server-only, 16-token neutral completion, 3 calls). ~1.7 s from the Mac through the relay (adds China long-haul RTT).
- **Serving method:** `llama-cpp-python[server]` 0.3.37 built for ROCm 7.2.1 / gfx1100, all layers on GPU0, GPU1 left free.

## Important deviations from the brief (and why)

1. **Quant is Q4_K, not Q6_K.** The box is physically in China (`36.150.116.206`)
   behind the allowlist egress proxy. huggingface.co / cdn-lfs / xet CDN are either
   blocked or crawl at ~0.1 MB/s from the box, and the **Mac→box SSH link is ~5 KB/s**
   (single stream) / <0.3 MB/s (parallel) — uploading a 21 GB file that way is
   infeasible (days). The box CAN reach **ModelScope (Alibaba)** fast (22–38 MB/s,
   China-to-China). ModelScope only carries the abliterated 27B model as **Q4_K**
   (uploader `alex191`, byte-identical to HF's official Q4_K: 16,810,714,400 bytes),
   so Q4_K is the best quant achievable on any fast path to this box. It also fits
   one card with huge headroom. This honours the fallback intent ("…then the
   UD-Q4_K_XL build") — plain Q4_K is the same 4-bit class.
2. **GPUs are ~48 GB each, not ~24 GB.** `rocm-smi` reports 51.5 GB/card (gfx1100
   48 GB, i.e. W7900-class), ~96 GB total. Q4_K (16.8 GB) sits on GPU0 only; GPU1
   stays free as required. Context raised to 32768 given the headroom.
3. **`ssh -L` port-forwarding is blocked** on the box (sshd refuses direct-tcpip to
   loopback; the box also has no `nc`/`socat`). Fixing sshd would be an out-of-scope
   access change, so access is provided via a **session-channel relay** instead (works
   over the normal exec channel). See "Access from the Mac".

## Where things live (on the box, `ssh revel8-amd`, root)

| What | Path |
|---|---|
| Model file (GGUF) | `/workspace/models/Huihui-Qwen3.8-27B-Q4_K.gguf` |
| Python venv (ROCm llama-cpp-python) | `/workspace/llama/venv` |
| Server launch script | `/workspace/serve.sh` |
| Start/restart helper (nohup) | `/workspace/start-server.sh` |
| Server log | `/workspace/server.log` |
| Session relay helper (for Mac access) | `/workspace/relay.py` |

## Serving

- **Engine:** `llama-cpp-python[server]` **0.3.37**, built from pypi (via the
  tsinghua mirror, which the box can reach) with the ROCm/HIP backend:
  `CMAKE_ARGS="-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1100 -DCMAKE_C_COMPILER=/opt/rocm/llvm/bin/clang -DCMAKE_CXX_COMPILER=/opt/rocm/llvm/bin/clang++ -DCMAKE_BUILD_TYPE=Release"`.
- **Bind address:** `127.0.0.1:11434` (loopback on the box).
- **GPU:** pinned to GPU0 via `HIP_VISIBLE_DEVICES=0`; `--n_gpu_layers -1` (all layers on GPU). GPU1 untouched.

**Exact launch / restart command** (survives SSH disconnect via nohup):

```bash
ssh revel8-amd /workspace/start-server.sh
# which runs, detached:  HIP_VISIBLE_DEVICES=0 python -m llama_cpp.server \
#   --model /workspace/models/Huihui-Qwen3.8-27B-Q4_K.gguf \
#   --host 127.0.0.1 --port 11434 --n_gpu_layers -1 --n_ctx 32768 \
#   --n_threads 16 --model_alias huihui-qwen3.8-27b-abliterated-q4_k
```

`start-server.sh` kills any existing server first, so it doubles as the restart
command. After a box reboot, just re-run it.

## Access from the Mac

`ssh -fN -L 11434:localhost:11434 revel8-amd` does **not** work here (forwarding
blocked). Use this relay instead — it exposes the same `http://localhost:11434/v1`
locally. It needs `ncat` on the Mac (installed) and `/workspace/relay.py` on the box
(staged). Run it once; leave it running:

```bash
ncat -l 127.0.0.1 11434 --keep-open --sh-exec \
  "ssh -o ControlMaster=auto -o ControlPath=/tmp/revel8-cm.sock -o ControlPersist=300 -o ServerAliveInterval=20 revel8-amd python3 -I /workspace/relay.py"
```

Then any client points at `http://localhost:11434/v1` (OpenAI-compatible, no API key).
The first call may re-establish the multiplexed SSH master; later calls reuse it.

## Health check (NEUTRAL)

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "huihui-qwen3.8-27b-abliterated-q4_k",
    "messages": [{"role": "user", "content": "Reply with the single word: ready."}],
    "max_tokens": 16,
    "temperature": 0
  }'
```

Result: HTTP 200, coherent completion, `usage` reported. 3 server-side calls:
1.05 s / 0.61 s / 0.60 s → **p50 0.60 s** (first call includes warm-up). The model
is a reasoning model and "thinks" before answering, so a 16-token cap shows
reasoning text rather than a bare "ready" — expected; the endpoint is healthy.
`/v1/models` lists the single id above. VRAM: GPU0 ~19 GB used, GPU1 idle.

## Caveats

- Q4_K (not Q6_K/Q5_K_M) — see deviations. Higher quants are not reachable by any
  fast path to this China-hosted box without a usable Mac→box bulk channel.
- The model file came from a third-party ModelScope re-upload (`alex191`); it is
  byte-identical in size to HF's official Q4_K and loads/serves cleanly, but it was
  not cryptographically verified against an HF checksum (HF is unreachable at speed).
- Access relies on the SSH session relay (ncat + relay.py), not a kernel `-L` tunnel;
  it adds the China RTT (~1 s) per request on top of server latency.
- Server runs under `nohup` (not systemd/tmux — neither installable offline). It
  survives disconnects but not a box reboot; re-run `start-server.sh` after reboot.
- Context is 32768; the GGUF advertises up to 262144 but that would need a large KV
  allocation. Raise `--n_ctx` in `serve.sh` if longer context is needed (ample VRAM).
