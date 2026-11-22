# revel8 — Agentic Social Engineer

An autonomous, safety-bounded social-engineering agent for the authorized revel8 CTF at START Hack Munich 2026. It researches consenting AI twins, plans multi-channel conversations, writes and guards each contact, records sanitized evidence, and replays runs in a realtime control room.

**Everything runs inside the simulator. No real people, channels, or malware.**

## What is included

- **Planner/Writer architecture:** separate strategy and copy models with actual fallbacks and provenance.
- **Identity-filtered OSINT:** Firecrawl research with exact-person, company, role, and location evidence tiers. Thin footprints degrade safely instead of inventing facts.
- **Adaptive campaign loop:** probe, build, strike, converse, and disclosure paths with two-layer pre-send guards.
- **Deterministic custom flows:** durable email → SMS → phone_call → debrief sequences with checkpoints and idempotent dispatch.
- **Realtime control room:** Next.js, Better Auth, self-hosted Convex, and a FastAPI trace sidecar.
- **Durable execution:** one-touch accounting, story timestamps, idempotent sessions/messages, process recovery, and manifest v2 allocation for **5 attempts per target, 15 total**.
- **Official best-two scoring:** select the best two attempts per target and evaluate incidents, speed, targeting, craft, architecture, and pitch without inventing organizer judgments.
- **Real-brand craft sources:** sanitized Microsoft/Google email and sign-in pairs, plus boutique no-image fallbacks.
- **Presentation assets:** a team briefing and interactive rubric examples.

## Repository layout

```text
agent/                 Python agent, flow engine, guards, traces, tests, and model clients
control-room/
  apps/app/           Next.js dashboard, launcher, replay, analytics, and account UI
  packages/database/  Convex schema, auth, realtime queries, and sanitized mutations
sidecar/              FastAPI trace REST/WebSocket service with recursive redaction
dashboard/            Standalone static replay viewer and bundled sample
research/             Benchmarks, scoring evidence, craft sources, and presentation assets
.scratch/             Architecture research, decision records, and runbooks
```

## Safety boundary

- Only consented AI twins through the Target API.
- Lookalike domains only; never a real organization's own domain.
- No persona prompt injection or simulation-breaking instructions.
- Submitted values are removed at the HTTP boundary and again at trace, sidecar, and Convex boundaries. Field names and value-free incident metadata remain.
- Eval requires explicit `REVEL8_ENABLE_EVAL=1` and valid target metadata. Practice remains unscored with 30-touch sessions.
- Real-brand assets are sanitized templates only. Recipient identities, avatars, telemetry, notification IDs, and real-org URLs are removed.

## Run locally with Docker

Requirements: Docker and the required private values in the project-root `.env` (see [`.env.compose.example`](.env.compose.example)). Do not commit that file.

```bash
cp .env.compose.example .env
# Fill in the required placeholders, then:
docker compose up --build -d
```

Open **http://localhost:3000** and sign in with the configured admin credentials.

Services:

| Service | URL |
|---|---|
| Control room | `http://localhost:3000` |
| Convex | `127.0.0.1:3210` / `127.0.0.1:3211` |
| Trace sidecar | `127.0.0.1:8787` |

Persistent state lives in the `convex_data` and `revel8_model_settings` volumes. Host `agent/traces` is bind-mounted into the web and sidecar containers.

Useful checks:

```bash
docker compose ps
docker compose config -q
docker compose down   # preserves volumes
```

## Agent commands

Run from the repository root with the required `.env` present:

```bash
# Practice smoke run
python3 -m agent.run --target julius --max-touches 8

# Other practice twins
python3 -m agent.run --target robert --arm-f5 attachment_probe
python3 -m agent.run --target tom --no-live

# Fully fake deterministic flow
python3 -m agent.flow_run --dry-run

# Check whether the scoring window is open (free request only)
python3 -B -m agent.tools.eval_window_detector
```

Eval is deliberately gated. When targets and metadata are explicitly approved:

```bash
REVEL8_ENABLE_EVAL=1 python3 -m agent.run --scenario eval --target <TARGET_ID> \
  --name "Full Name" --company "Company" --role "Role" \
  --location "Munich,Bavaria,Germany" --country DE
```

Manifest v2 allows **five attempts per target and 15 total attempts**, with unique idempotency keys and active-error resume. The best two attempts per target are scoring candidates.

## Tests

```bash
# Python agent and flow suite
python3 -m unittest discover -s agent/tests -v

# Sidecar suite
sidecar/.venv/bin/python -m unittest discover -s sidecar/tests -v

# Dashboard, Convex, auth, scoring, and recovery suite
cd control-room
pnpm --filter @x70-monorepo/app test:revel8
CI=true pnpm typecheck
CI=true pnpm build

# Optional real Chromium offline walkthrough
pnpm --filter @x70-monorepo/app test:revel8:browser
```

The offline browser test blocks upstream requests, opens the outcome-first sample replay, selects evidence, verifies redaction, and reloads successfully. It requires local browser dependencies and generated Convex runtime types.

## Current evidence

- Agent tests: **240 passing** including allocation v2 and eval-window detector tests.
- Sidecar tests: **14 passing**.
- Dashboard/Convex tests: **75 passing**, including best-two scoring and left-sidebar checks.
- Real Firecrawl/Kimi dossier validation on all three practice twins with negative controls.
- Expanded scenario benchmark: all 27 expected-reject cases blocked.
- Verified duplicate `POST /sessions` returns the same session with zero touches.
- Actual four-contact practice flow completed: email → SMS → phone call → debrief email.

See [differentiators](research/revel8-differentiators.md) for the underlying evidence and limitations. Revealed-target dossiers stay local.

## Team documents

- [Four-speaker stage script](research/pitch/revel8-four-speaker-script.pdf)
- [Two-page pitch and Q&A brief](research/pitch/revel8-pitch-and-qa.pdf)
- [Team briefing PDF](research/revel8-team-briefing.pdf) — architecture, runbook, scoring, and evidence for all three teammates.
- [Differentiators](research/revel8-differentiators.md) — design decisions, proof points, and remaining unknowns.
- [Team briefing source](research/team-briefing-draft.md) — editable source used for the PDF.
- [Scenario benchmark](research/scenario-sweep-results.json) — model reliability evidence.
- [Read-back improvement](research/scenario-sweep-readback-fix-results.json) — multilingual guard evaluation.

## Security and contribution hygiene

- `.env`, `Key for team 7.pdf`, traces, playbook, eval manifests, local secrets, and runtime state are excluded by `.gitignore`.
- The GitHub repository is public.
- Keep API keys, passwords, recipient identities, and submitted form values out of commits, issues, screenshots, videos, and logs.
- Do not create pull requests or merges without verifying the final worktree and test suite.

## Remaining limits

No official hidden-target score exists yet. Practice results and illustrative rubric demos are not official results. Targeting/craft/jury values require organizer judgments. Final repository links and the pitch deck/slot are finalized separately before submission.
