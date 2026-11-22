# revel8 Control Room

Next.js control room for the authorized revel8 security-awareness simulation, with Better Auth, a real self-hosted Convex backend, and the FastAPI trace sidecar.

## One-command local runtime

From the **revel8 project root** (the parent of this directory):

```bash
cp .env.compose.example .env
# Edit .env: replace every required placeholder with local/private values.
docker compose up
```

Then open <http://localhost:3000> and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The first build can take several minutes. Subsequent starts reuse the images and persistent state.

This starts:

- Next.js and the Better Auth login at `127.0.0.1:3000`.
- Persistent self-hosted Convex at `127.0.0.1:3210` (HTTP actions at `:3211`). The web entrypoint deploys the functions and seeds the configured admin automatically.
- FastAPI at `127.0.0.1:8787`, reading and streaming the same traces that Next.js-launched agents write.

No separate monorepo checkout, pnpm installation, Convex account, or cloud deployment is needed. Docker and the required root `.env` values are sufficient. Provider and target endpoints still need to be reachable from the containers; `host.docker.internal` is shown in the example for services running on the host.

### State and secrets

- `convex_data` persists Convex and its locally generated admin key. Convex is primary for sanitized runs, trace records, touches, event outcomes, flow definitions/versions, flow run/step state, and Planner/Writer selections.
- `revel8_model_settings` persists the local model-selection fallback and the flow CLI's definition/checkpoint files under `/revel8-settings/flows`.
- `REVEL8_INGEST_SECRET` is a second random secret, separate from `BETTER_AUTH_SECRET`. Next.js and the Convex service actions use it to keep detached-run ingestion working after browser tokens expire; it is never exposed to browser code.
- The project `agent/` directory is bind-mounted into both web and sidecar, so `agent/traces/*.jsonl` and `agent/playbook.json` persist on the host.
- Root `.env` is used only for Compose interpolation. It is not mounted or copied into either image, and real env files are excluded by `control-room/.dockerignore`.
- `docker compose down` preserves state. `docker compose down -v` deletes Convex and model/flow-state volumes; host traces remain.

## Product routes

The product UI is under `/dashboard`:

- `/dashboard` — overview.
- `/dashboard/runs` — Convex-backed historical/live traces and replay, with JSONL/sidecar fallback and authenticated idempotent **Import JSONL** reconciliation.
- `/dashboard/control` — practice-only autonomous launch/stop, Convex model selection, and the ordered flow editor. The editor validates/saves versions, launches the real `agent.flow_run` CLI in fake dry-run or explicit practice mode, and subscribes to flow/step checkpoints and session-trace links.
- `/dashboard/analytics` — realtime Convex aggregation with sidecar fallback when no stored traces are available.

`/dashboard` and same-origin `/api/revel8/*` launcher routes require the Better Auth session cookie. Old `/revel8/*` pages and sample assets redirect to `/dashboard/*`; the API namespace remains `/api/revel8/*`.

Planner defaults to **`kimi-k3.1`** and Writer to **`abliterated-large-v2`**. Abliterated Flash is available as **`abliterated-large-flash`**. These defaults are covered by tests and must not change incidentally.

Next.js-launched autonomous runs ingest complete JSONL batches into Convex every 500 ms and drain them before terminal status updates. Historical import uses the same session/ordinal idempotency keys and 200-record mutation bound. Flow practice launches use `python -m agent.flow_run --practice <definition.json> --state <run-state.json> --trace-dir <trace-dir>` with the CLI-supported `--run-id`; dry-run uses fake transport only.

Raw trace/detail views and every Convex ingest recursively omit submitted values and secret-bearing fields, including historical traces and legacy field name/value maps. Outcome metadata and submitted field **names** remain visible.

## Host development and checks

The Compose path does not need host tooling. For host-based development, install the `apps/app` and `packages/database` workspace with pnpm 10.8 and use `control-room/.env.example` as the placeholder reference. `control-room/docker-compose.yml` is only the Convex helper for the existing package scripts; the root Compose file is the all-in-one runtime.

Run the required checks from `control-room/`:

```bash
pnpm --filter @x70-monorepo/app test:revel8
CI=true pnpm typecheck
CI=true pnpm build
```

The tests include schema/store mutations, sanitized idempotent ingestion, 200+ record imports, realtime mappings, flow validation and an actual fake-transport CLI dry-run, plus a loopback-only real-agent launch/trace integration check using a temporary agent copy and local model/target servers. They do not alter real traces or contact external targets.

Validate root Compose without printing interpolated secrets:

```bash
docker compose config -q
```

A complete sign-in/launch/WebSocket smoke test requires a running Docker daemon. `CI=true` makes the existing Turbo tasks use checked-in generated Convex types instead of running the host bootstrap that writes local env files.

To verify real Convex reads/writes rather than only schema definitions, push functions to a loopback self-hosted backend, export `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, and the matching `REVEL8_INGEST_SECRET`, then run:

```bash
node scripts/convex-operational-smoke.js
```

The smoke script refuses non-loopback deployments. It writes and reads sanitized run/touch/outcome data, repeats mutations to prove idempotency, exercises service ingest, flow versions/run steps, and model selections, then restores `kimi-k3.1` / `abliterated-large-v2`.
