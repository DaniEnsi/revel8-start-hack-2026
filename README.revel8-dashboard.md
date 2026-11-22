# revel8 control-room dashboard

A real-time control room for the **authorized** revel8 "Agentic Social Engineer"
security-awareness CTF (START Hack 2026). It launches, monitors, and replays the
agent's runs. It writes no attack content itself — the existing agent does that;
this is web engineering + orchestration around it.

**Practice scenario only.** Every run control is hard-locked to `practice`; the
eval scenario is refused by both the runner and the sidecar.

---

## What's where

| Piece | Location | What it is |
|-------|----------|-----------|
| **UI** | `x70 monorepo → apps/app/app/revel8/` | A `/revel8` route group inside the existing x70 Next.js app, reusing its shell, Tailwind design system, and shadcn components. Additive only — no existing route/app/package was changed. |
| **Sidecar** | `revel8/sidecar/` | FastAPI service that tails `agent/traces/*.jsonl`, streams new touch records over WebSocket, serves the playbook, and starts/stops `python -m agent.run`. |
| **Agent** | `revel8/agent/` | The already-built agent (pure stdlib). Unchanged. |
| **Sample data** | `apps/app/public/revel8/` | Bundled `sample-trace.jsonl` + `sample-playbook.json` for a zero-backend fallback. |

### The pages (`/revel8`)

- **Overview** — landing/orientation.
- **Runs** (`/revel8/runs`) — every trace in `agent/traces/`, as cards; live runs flagged. Click one to replay.
- **Run replay** (`/revel8/runs/[session]`) — the turn-by-turn view: message as the twin sees it, the registered landing page (sandboxed iframe), events returned (incl. the target's reply), the suspicion gauge with the θ_soft 0.55 / θ_hard 0.85 thresholds, per-topic posterior confidence with touch-over-touch deltas, the guard result + read-back, the Writer brief, fallbacks, the raw record, the session outcome banner, and the cross-session playbook. Scrub with the timeline, ← / → / Home / End, the slider, or ▶ Play. When the run is live it streams in over WebSocket and follows the edge.
- **Control** (`/revel8/control`) — configure target twin + A/B arms + budget and **start a run**; list and **stop** running runs. Practice-locked.
- **Analytics** (`/revel8/analytics`) — aggregates across all traces: incident rate, contacts-to-incident, per-twin breakdown, suspicion curves, A/B arm outcomes, channel usage.

Open `/revel8/runs/sample` any time for the bundled sample replay — it works even
with the sidecar offline.

---

## Run it — local dev (recommended)

Two processes: the sidecar (Python) and the web app (the monorepo's `pnpm dev`).

**1. Sidecar** (from `revel8/`):

```bash
cd sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py                 # serves http://localhost:8787
```

The sidecar reads the project-root `.env` (`REVEL8_*`, `WRITER_*`, `PLANNER_*`,
`FIRECRAWL_*`) via the agent, so a run launched from the Control page reaches the
**remote** abliterated writer model over the configured endpoint. The model is
never hosted or containerized here.

**2. Web app** (from the x70 monorepo root):

```bash
pnpm install           # first time
pnpm dev               # starts apps/app on http://localhost:3000
```

Open <http://localhost:3000/revel8>. The UI talks to the sidecar at
`http://localhost:8787` by default; override per-browser on the Control page, or
globally with `NEXT_PUBLIC_REVEL8_SIDECAR`.

> No auth/Convex is required for `/revel8` — the app's middleware only guards `/`
> and `/dashboard/*`, and the route group never issues a Convex query.

---

## Run it — docker compose (all-in-one)

From `revel8/`:

```bash
export X70_MONOREPO="/absolute/path/to/x70.one/x70 monorepo"   # see .env.compose.example
docker compose up
```

- **sidecar** → `http://localhost:8787` (built from `sidecar/Dockerfile`; mounts
  `./agent`, `./sidecar`, and `./.env`).
- **web** → `http://localhost:3000/revel8` (mounts the monorepo, runs `next dev`).

The `web` service installs node deps into the container on first `up`, so the
first start is slow. For iterative work, the host `pnpm dev` path above is faster;
the sidecar container alone is enough to get live traces into a host-run UI.

The remote AMD/abliterated writer model stays remote — it is reached via the
endpoint in `.env` and is **not** part of compose.

---

## Sidecar API (for reference)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | liveness + resolved paths |
| GET | `/api/runs` | list every trace with derived meta + running flag |
| GET | `/api/runs/{session}` | full records for one session |
| GET | `/api/playbook` | `agent/playbook.json` |
| GET | `/api/running` | currently-running runs |
| POST | `/api/runs` | start a run (validated; practice-locked) |
| POST | `/api/runs/{session}/stop` | stop a running run (SIGTERM to its process group) |
| WS | `/ws/runs/{session}` | snapshot + live-tail of new records |

`POST /api/runs` body: `{ target, arm_f2, arm_f4, arm_f5, arm_f6, max_touches?, no_live?, notes? }`.
`target ∈ {julius, robert, tom}`; arms are validated against their allowed values;
`max_touches ∈ [1,30]`; the scenario is always `practice`.

---

## Safety / scope

- Practice twins only; eval is refused by construction (runner + sidecar).
- The sidecar spawns the agent with a validated **argument vector** (never a shell
  string) and runs open on localhost — authorized local tooling, no public hosting.
- The dashboard renders attack artifacts (lookalike pages, drafts) read-only inside
  a sandboxed iframe; it never navigates to them and never writes attack content.
