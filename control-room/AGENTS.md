# revel8 Control Room

This workspace contains the revel8 product UI and its Better Auth/Convex backend. The project-root `docker-compose.yml` is the canonical runtime; no external x70 checkout is required.

## Architecture

- `apps/app` — Next.js App Router application. The product lives at `/dashboard` (`overview`, `runs`, `control`, and `analytics`). Legacy `/revel8` URLs redirect to the corresponding dashboard URLs.
- `apps/app/components/revel8` and `apps/app/lib/revel8` — run/control/trace UI, model selection, redaction, and launch clients.
- `apps/app/app/api/revel8` — same-origin Node routes for model-aware launch, stop, process status, and model selection. These routes and `/dashboard` require the Better Auth session cookie via `apps/app/proxy.ts`.
- `packages/database` — Convex functions and the `@convex-dev/better-auth` integration. Convex is the primary persistence/realtime store for sanitized runs, trace records, touches, event outcomes, flow definitions/versions, flow run/step checkpoints, and model selections. Compose pushes these functions to a real self-hosted Convex backend before starting Next.js.
- `sidecar` and `agent` — sibling directories outside this workspace. Compose builds the unmodified FastAPI sidecar and shares the unmodified agent with Next.js and the sidecar.

### Auth and Convex URL invariants

- Register `jwt()` **before** `convex({ authConfig })` in `packages/database/convex/auth.ts`. The Convex plugin relies on JWT configuration but must own the final `/convex/token` endpoint; reversing the order overwrites it, and removing JWT breaks sign-in with `jwt_config`.
- Do not disable the Convex token exchange. `/api/auth/convex/token` is required for authenticated server APIs.
- `apps/app/lib/auth.ts` passes `CONVEX_URL` explicitly to server query/mutation/action helpers. The public URL embedded in the browser build is `127.0.0.1:3210`; inside Docker, server calls use `http://convex:3210`. Do not rely on runtime `NEXT_PUBLIC_*` overrides because Next can inline them at build time.

## Compose runtime

From the revel8 project root, copy `.env.compose.example` to `.env`, replace its placeholders, and run `docker compose up`. Docker builds/starts:

1. `convex` — persistent self-hosted Convex on `127.0.0.1:3210/3211`. It generates an admin key inside the `convex_data` volume without printing it.
2. `sidecar` — FastAPI trace REST/WebSocket API on `127.0.0.1:8787`.
3. `web` — Next.js/login on `127.0.0.1:3000`. Its entrypoint waits for Convex, sets deployment env vars (including the separate `REVEL8_INGEST_SECRET` used by service-only ingest actions), pushes functions, idempotently seeds `ADMIN_*`, unsets bootstrap secrets, and starts the production build. The ingest secret remains in the Next.js runtime so detached runs can outlive browser-token expiry.

Open `http://localhost:3000`; unauthenticated users are sent to `/sign-in`. Use the configured admin login. Only Docker and the required values in root `.env` are needed for the Compose path.

Convex data and the local model/flow-state fallback files use named volumes. Model selection is read from Convex first, with the JSON file as an outage fallback. Flow definitions and checkpoints are stored in Convex; `/revel8-settings/flows` holds the CLI's definition/checkpoint files. The host `agent/` directory is bind-mounted read/write into both runtime containers, so traces and the playbook survive restarts and remain visible to the sidecar. `docker compose down` preserves volumes; do not use `down -v` unless Convex/model/flow state should be deleted.

`control-room/docker-compose.yml` is only a host-development Convex helper used by the existing package scripts. It is not the all-in-one runtime.

## Launch and model invariants

- Next.js owns processes launched through `/api/revel8` and tails their JSONL/checkpoints into Convex in bounded batches. Dashboard run/detail/analytics/model/flow reads use authenticated Convex subscriptions; JSONL/sidecar data is a compatibility fallback. Keep process-state merging because Convex and the sidecar cannot inspect Next.js child processes.
- Autonomous launches are locked to `practice`, spawn `python -m agent.run` without a shell, and pass model IDs only through child-process environment overrides.
- The ordered flow editor validates the UI subset of flow v1, saves immutable versions, and launches `python -m agent.flow_run --practice <definition.json> --state <run-state.json> --trace-dir <trace-dir>` (plus the CLI-supported `--run-id`). Dry-run uses the CLI's positional definition plus `--dry-run` and fake transport only. Flow checkpoints and any resulting session traces reconcile into Convex.
- Historical **Import JSONL** reconciliation is authenticated, redacted before transport and again inside Convex, idempotent by session/ordinal, and batched at the mutation's 200-record limit.
- Defaults are fixed: Planner `kimi-k3.1`, Writer `abliterated-large-v2`. Abliterated Flash is selectable as `abliterated-large-flash`, never as a default or guessed alias.
- Compose persists Convex model selections and keeps the file fallback at `/revel8-settings/model-selection.json`; host development uses `.revel8/model-selection.json`.
- Do not mount the root secret `.env` into containers. Compose interpolates required provider/target/auth values into runtime environments, and `.dockerignore` excludes all real env files from the image.
- Both Python runtime images install `ca-certificates`; without the public CA bundle, Target/model HTTPS calls fail before the first trace with `SSLCertVerificationError`.

## Trace display safety

Every raw record/fallback serialization goes through `lib/revel8/redaction.ts`. Submitted `values`, nested secret-bearing keys, and legacy name/value payloads are recursively omitted before display. Field-name lists retain names only. Non-sensitive outcome, timing, arm, and token-usage metadata must remain. Add regression coverage for every newly recognized historical trace shape.

## Verification

```bash
pnpm --filter @x70-monorepo/app test:revel8
CI=true pnpm typecheck
CI=true pnpm build
```

The revel8 tests include recursive redaction, schema/store mutation coverage, idempotent batched imports, realtime mappings, flow validation/state/CLI dry-run, auth/redirect checks, model-default coverage, and a loopback-only launch of a temporary copy of the real agent with local target/model servers. They must not modify `agent/`, contact external targets, or require real credentials. Compose validation uses placeholder values only. A full login/launch/trace Compose smoke requires a running Docker daemon.

For evidence against an actual loopback self-hosted Convex deployment (after pushing functions and exporting its local admin/ingest credentials), run `node scripts/convex-operational-smoke.js`. The script refuses non-loopback URLs, writes and reads runs/touches/outcomes/flows/models through real Convex functions, repeats ingest to verify idempotency, checks value-free persistence, and restores the required model defaults.
