# Production dashboard in the x70 monorepo

Type: task
Status: resolved
Blocked by:

## Question
Build the run-replay dashboard as a proper app in the x70 monorepo (Turborepo+pnpm, Next.js,
Radix/shadcn + Tailwind, Biome) — a production-grade version of the standalone `dashboard/`
viewer, matching x70 conventions. Model strategy: start on Opus/GPT (user's credits, not Kimi's
paid); fall back to Kimi only for parts a safety model refuses (rendering the phishing trace
content). Purely additive new app; don't touch existing apps/packages.

## OPEN DESIGN DECISIONS (grilling — not yet ruled)
This ticket (and the whole dashboard track) was NOT in the original Wayfinder destination —
it was retrofitted. Build PAUSED pending the human's rulings:
- G1 Primary purpose: our debug/tuning tool / jury-replay artifact / both.
- G2 Integration: standalone app in apps/ / a route inside an existing x70 app / fully separate repo.
- G3 Live-ness: static trace-file load / reads the live trace dir / real-time stream of an in-progress run.
- G4 Scope: run-replay only / + cross-run analytics (incident rate, A/B, per-twin) / + a control panel to launch runs.
- G5 Deploy + polish: local-only for the pitch / deployed to a URL; internal vs demo-grade polish.

## DECISIONS (locked, grilling 2026-11-21)
- G1 BOTH (debug + jury-replay), demo-grade polish.
- G2 Integrate into **apps/app** — reuse its shell/components via a `/revel8` route group (branch, additive). Optional simple landing page.
- G3 **Real-time via WebSocket** (Python sidecar tails trace JSONL → pushes; browser subscribes); static-file load as fallback.
- G4 **ALL**: run-replay + cross-run analytics + a **control panel to start/stop/configure runs** from the UI.
- G5 No URL; **one-command all-in-one docker-compose** (web + sidecar, shared trace volume; env → remote AMD endpoint + Target API + Firecrawl).
- Orchestrator sub-decisions (user-delegated): **skip Convex/auth** for this internal tool; 2-service compose; AMD model stays remote (relay/env), not containerized.

## Answer — BUILT (all 7 priorities, branch `revel8-dashboard`, additive-only)
Control-room in `apps/app/app/revel8/` (Overview, Runs, real-time Run-replay, Control panel,
Analytics; x70 design system) + FastAPI sidecar `revel8/sidecar/app.py` (tails traces → WebSocket,
serves runs/playbook, starts/stops `python -m agent.run` practice-locked w/ validated argv).
Verified in-browser on a real trace; `tsc` clean, Biome 0 errors. docker-compose validates (not
built — Docker daemon down). Run: sidecar `cd revel8/sidecar && .venv/bin/python app.py`; web
`pnpm dev` → `/revel8`. Pre-existing `/api/auth` 500 is unrelated (no Convex; /revel8 needs no auth).
Stray `apps/revel8-dashboard/` (my cancelled-attempt leftover) deleted. TODO: one `docker compose up` when the daemon's up.
