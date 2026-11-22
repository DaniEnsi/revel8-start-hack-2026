# revel8 Agent — autonomous red-team agent (ticket 09)

Autonomous social-engineering agent for the **authorized** revel8 "Agentic Social
Engineer" CTF (START Hack 2026). It runs against consenting AI personas in the
closed simulator. Practice is available by default; hidden-target eval requires
the explicit `REVEL8_ENABLE_EVAL=1` environment gate and a durable per-target
session reservation.

## Architecture (split brain, research/05 D-A..D-Q)

```
            ┌────────────────────────────────────────────────┐
            │  Planner (organiser, PLANNER_* env)            │
            │  owns: state, strategy, API calls, guards,     │
            │  belief updates, suspicion scalar, playbook    │
            └───────┬───────────────────────────────▲────────┘
              brief │                               │ read-back (D-J guard, redo ≤2)
                    ▼                               │
            ┌────────────────────────────────────────────────┐
            │  Writer (abliterated, WRITER_* env)            │
            │  blind+stateless: draft(brief) -> copy only    │
            └────────────────────────────────────────────────┘
```

- `config.py` — loads project-root `.env`; Planner defaults to the Writer
  endpoint (single-brain), swap PLANNER_* to a separate model when needed.
  `REVEL8_ENABLE_EVAL=1` is the only eval enable switch; practice does not need it.
- `target_api.py` — Target API client: all endpoints, `Idempotency-Key` per
  contact (reused across retries), 429/5xx backoff, 120s timeouts.
  `create_session(..., idem_key=...)` accepts a durable caller key for the flow
  adapter and scored-session manifest.
- `llm.py` — OpenAI-compatible chat clients + robust JSON extraction.
- `state.py` — `SessionState` notecard+log (D-G), the practice playbook, and
  `EvalSessionManifest`. The manifest atomically persists `reserved` → `active`
  → `completed`, including the session idempotency key before the first request.
  A crash retries the same key/session; a completed target can never get another.
- `pretexts.py` — per-twin persona/angle/facts/trap-list/topic priors/link
  config (research/06, F1–F6), plus `build_dynamic_pretext` for hidden targets.
  Dynamic pretexts carry `verified_facts`, `wrong_fact_traps`, and `top_pick`
  from the dossier into Planner/Writer briefs. Research cannot supply regex,
  channels, endpoints, or domains; all runtime domains are generated lookalikes.
- `guards.py` — programmatic gate: lookalike-domain-only, no persona-injection,
  wrong-fact trap regexes, link discipline. Planner read-back is the second
  layer (D-J).
- `prompts.py` — Planner/Writer/read-back/conversation prompts (incl. persona
  defense intel: no code-asks, portal aversion, vetting-queue pivot).
- `loop.py` — the control loop: one Planner call/touch (D-F) → Writer draft →
  guard (redo cap 2, D-K, fallbacks logged D-L) → register page before striking
  (07) → send → read events → update belief/suspicion (D-H/D-I) → adaptive
  strike with ⌈B/2⌉ backstop (D-M) → stop on incident/budget/suspicion/dead
  air (D-N). Live conversation mode (F3) = engaged-thread escalation only.
  For every call/chat turn, Planner supplies only a brief, Writer supplies the
  channel-appropriate utterance, deterministic domain/trap/injection/story checks
  run, and Planner must explicitly pass read-back. Writer/read-back/shape failures
  fail closed without dispatch. One started call spends one touch and permits at
  most ten sent turns; turn retries reuse the approved text and idempotency key.
- `trace.py` — per-touch JSONL trace at `agent/traces/<session_id>.jsonl` (D-Q).
- `osint_tool.py` — identity-filtered public research plus dossier/topic discovery.
  Eval calls `research(name, company, role, location=..., country=...)` and then
  `discover_topics`; practice twins use the fixed priors in `pretexts.py`.
- `flow.py` / `flow_runner.py` / `channels.py` / `flow_run.py` — deterministic custom-flow
  vertical slice. It owns channel order, delays, reply/timeout branches, stops, idempotency, and
  durable checkpoints for email → SMS → phone_call → debrief email. `--dry-run` is fully fake;
  `--practice` explicitly wires the live practice Target adapter and requires durable state and
  a trace directory. The flow adapter remains practice-only and exposes no eval mode.

## Scoring contract (operator-confirmed 2026-11-21)

The scoring window reveals three new hidden targets (Sunday morning, exact time TBD). Use one
10-touch session per target; the median of the three session scores is final. A message on any
channel or one whole call (≤10 utterances) is one contact/touch, including ignored messages.
Landing-page registration, file uploads, event reads, and failed-request retries are free. A
target remembers everything within its own continuous session and nothing across sessions.
Practice remains unlimited and unscored, with 30-touch sessions on the three practice targets.
The scored adapter is implemented but disabled by default. With eval explicitly enabled, the
runner requires the hidden target ID plus name/company/role metadata (location/country are
optional research hints), performs identity-filtered research before reservation, and caps the
session at ten touches even if the server advertises more or `--max-touches` is larger. A lower
`--max-touches` is honored. Manifest-driven resume reuses an active session; manual `--resume`
and `--resume-session` are rejected for eval, and a completed target cannot be run again.

## Run

```bash
# from the project root; .env must be present (REVEL8_*, WRITER_*, PLANNER_*)
python3 -m agent.run --target julius --max-touches 8          # smoke slice
python3 -m agent.run --target julius                          # full 30-touch practice session
python3 -m agent.run --target robert --arm-f5 attachment_probe
python3 -m agent.run --target julius --arm-f2 link_in_touch_1 --arm-f6 named
python3 -m agent.run --target tom --no-live                   # message-only, no live escalation

# Fully fake custom-flow check: email -> SMS -> phone_call -> debrief email
python3 -m agent.flow_run --dry-run

# Hidden-target scored run (only after the operator deliberately enables eval):
# REVEL8_ENABLE_EVAL=1 python3 -m agent.run --scenario eval --target TARGET_ID \
#   --name "Target Name" --company "Company" --role "Role" \
#   --location "Munich,Bavaria,Germany" --country DE
```

Eval reads/writes `agent/eval_sessions.json` (override with
`Config.eval_manifest_path` in embedding/tests). Do not delete or edit that manifest to
manufacture another scored attempt. All eval tests use fakes and block real HTTP.

A/B arms (all logged in trace + playbook for ticket 10):
- `--arm-f2 link_free|link_in_touch_1` — opener aggressiveness (default link_free)
- `--arm-f5 credentials|attachment_probe` — Robert CV `attachment.opened` probe
- `--arm-f6 soft|named` — Julius referrer framing ("investor circle" vs Sergej Epp)

Outputs: `agent/traces/<session_id>.jsonl` (per-touch record), the eval manifest
for scored runs, and `agent/playbook.json` for practice only (cross-session learned
hooks, winning identity/channel, traps hit, incidents). Eval does not write hidden-target
research into the practice playbook.

Each practice and eval invocation writes a `run-<run_id>.manifest.json` audit
file to the trace directory. The manifest, `session_start` and `session_end`
trace records, and CLI result share the run ID and `provenance` data. Provenance
contains the configured Planner and Writer model IDs, a null Planner fallback
model, and SHA-256 hashes of `prompts.py`, `pretexts.py`, and `loop.py` (which
contains inline templates). Every resume receives its own run ID and audit
manifest. The eval reservation and idempotency key live in `eval_sessions.json`.

## Hard rules enforced in code (voiding rules, research/02)

Lookalike domains only (never `revel8.ai` / `stackit.cloud` / real customer
domains) · no persona prompt-injection or sim-breaking language · wrong-fact
trap lists per twin (guard regenerates on hit) · everything stays in the
simulator · eval requires the explicit environment gate and exactly one durable
session per target · scored sessions never exceed ten touches · live turns fail
closed before sending when either guard layer cannot approve them.

## Tests

```bash
python3 -m unittest discover -s agent/tests -v
python3 -m unittest agent.tests.test_flows -v  # the 32 flow regressions
```

The agent-core tests cover eval gate ordering, research metadata forwarding,
dossier-to-Writer propagation, crash/terminal manifest behavior, the ten-touch cap,
durable session idempotency, Writer-only call copy, every guard failure class, and
the ten-turn/one-touch conversation invariant. Target, research, and model HTTP is
mocked; the new eval tests additionally install a `urlopen` trap that fails on any
real network attempt.
