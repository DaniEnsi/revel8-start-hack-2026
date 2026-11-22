# revel8 Agent — Team Briefing

> For the three teammates, ahead of the Sunday scoring window. Written to be
> accurate, self-contained, and exportable to PDF. No hype, no secrets: no API
> keys, team key, or auth secrets appear here.
>
> **Status of this document.** It describes the build as it actually runs today,
> cross-checked against the code and the measured sweeps cited inline. Where a
> number comes from a logged run, the file is named so you can re-open it. One
> review note is at the end (§11); everything else is the system, not its author.

---

## 1. What this is, and the safety boundary

**Purpose.** An autonomous red-team agent for the revel8 *"Agentic Social
Engineer"* challenge (Road to START Hack 2026). Given a target, it researches
them, then runs a multi-touch social-engineering campaign against the target's
**AI twin** through revel8's Target API, reads the event stream, and adapts —
with **no human in the loop** during a scored run.

**Safety boundary (hard rules, enforced in code, not just prompts):**

- Everything stays inside the simulator. The agent only talks to consenting AI
  twins through the Target API; it never contacts a real person or channel.
- **Lookalike domains only** — never a real organisation's domain
  (`guards.check_domains` + a banned-pattern list). Using a real org domain voids
  a run. The hidden-target personas are all `Northstar …` lookalikes (§3).
- **No persona prompt-injection / sim-breaking language** — no "you are an AI",
  no "ignore your instructions" (`guards.check_injection`). Addressing the twin
  as an AI voids a run.
- **Non-deceptive disclosure path.** When the agent switches to a disclosure
  objective (§4), it asks the target to *clarify* role-relevant internal details;
  it never asserts a false premise to extract them. The disclosure question is
  authored per persona and is a clarification request, not a lie.
- **No secret persistence.** Submitted form *values* are dropped at the HTTP
  boundary; only field *names* are ever stored or displayed (see §5).
- **Eval is gated and durable.** Hidden-target scoring requires an explicit
  `REVEL8_ENABLE_EVAL=1` switch and a durable one-session-per-target reservation;
  a *completed* target can never be run a second time, while an *errored or
  interrupted* one stays resumable on the same key (see §6).
- The custom-flow engine (§4) is **practice-only** and exposes no eval mode.

These rules map directly to the rubric's *Fair play / voiding* section. The point
of putting them in code is that a weak or over-eager model cannot violate them.

---

## 2. Current architecture and model roles

Two codebases:

- **`agent/`** — the Python agent (standard library only, no pip deps). This is
  what actually earns the measured points.
- **`control-room/`** — a Next.js + Convex "control room" dashboard that launches
  runs, tails their traces into Convex in realtime, and renders them for the team
  and the jury. Plus a small **`sidecar/`** FastAPI service for a WebSocket trace
  view.

### 2.1 Split-brain model roles

The agent deliberately splits reasoning from writing:

| Role | Model (default) | Job |
|------|-----------------|-----|
| **Planner** (organiser) | `kimi-k3.1` | Owns state, strategy, API calls, belief/suspicion updates, the playbook, and the pre-send read-back guard. Emits strict JSON. Never writes final copy. |
| **Writer** (copy) | `abliterated-large-v2` | Blind and stateless. Receives a narrow brief and returns email/landing-page/utterance copy only. Never sees the API, the ledger, or that this is an attack. |

Rationale: strategy needs a strong reasoner that reliably emits strict JSON and
reads a sparse event stream (Kimi — a clean **6/6** in the benchmark, §7); copy
needs a cheap, always-willing, high-throughput model for the many Writer
draft + redo + page-HTML calls (the abliterated model). The Planner briefs the
Writer; the Writer's output is then re-read by the Planner before anything ships.

Model selection is driven from the dashboard UI and stored in Convex, with
`.revel8/model-selection.json` as an outage fallback. A faster Writer variant,
`abliterated-large-flash`, is **selectable but never a default** (see §7).

**Benign, logged model fallbacks.** Each brain has an *optional* independent
fallback endpoint (`PLANNER_FALLBACK_*` / `WRITER_FALLBACK_*` in `config.py`).
A fallback fires **only** on a benign availability/authorization/refusal failure
— network error, timeout, 403/408/429/5xx, or an explicit model refusal
(`loop._writer_fallback_eligible`) — never on a content disagreement, so a guard
rejection is *never* laundered through a second model. Every fallback is recorded
in the run provenance (`provenance["models"]["planner_fallback" / "writer_fallback"]`)
and in the trace, so you can always see which brain produced a given touch. If
both a brain and its fallback fail, the Planner degrades to a deterministic
heuristic policy rather than stalling.

### 2.2 The control loop (one scored run)

Per touch (`agent/loop.py`):

1. **Plan** — one Planner call: read events → update topic belief + suspicion →
   decide exactly one next action (`probe | build | strike | converse | bail`) →
   produce a Writer brief.
2. **Draft + guard** — Writer drafts; a two-layer gate runs: (a) deterministic
   programmatic checks (domains, injection, wrong-fact traps *including a
   wrong-year date guard*, link discipline, craft/CoT-leak), then (b) a Planner
   **read-back** of the actual draft against the ledger and trap list. Redo cap is
   2; failures are logged, and a fatal deterministic failure falls back to
   known-safe copy rather than shipping a voiding draft.
3. **Page** — for a strike, register the landing page *before* sending the link.
4. **Send → classify → update** — send on the chosen channel, classify the
   returned events (`reply | link.opened | page.submitted | attachment.opened |
   [] = ignored`), update belief/suspicion, append the trace.
5. **Stop** on incident, budget exhaustion, suspicion ≥ 0.85, or ~3 consecutive
   ignored touches.

Phase policy by remaining budget: probe early, build then strike mid-run, push
the warmest thread late. A **forced-strike backstop** (`ceil(budget/2)`)
guarantees the first strike happens by the time half the budget remains (and again
with ≤2 touches left), so a cautious Planner cannot run out the clock without ever
asking.

Channel policy is **code, not a prompt promise**: `teams_*` and `mfa_push` are
forbidden; every strike (especially the last) must go by email; `phone_call` is
allowed only on an already-engaged thread; `calendar_invite` only after the
target explicitly accepts a slot.

---

## 3. Scraping and identity filtering (OSINT), with graceful degrade

For a hidden (scored) stranger, the agent researches before it reserves a session
(`agent/osint_tool.py`, `agent/pretexts.py`):

1. **Search/scrape** via a pluggable backend (`OSINT_BACKEND`): `tavily`,
   `exa`, `firecrawl` (current default), or `serper`. Queries are built from name
   + company (exact-match) with role/location as soft, droppable constraints.
2. **Identity gate** — each scraped page is validated: a **full exact/normalized
   name match plus nearby company evidence is mandatory**; role and location
   strengthen but never substitute. German transliteration is normalised
   (Müller = Mueller = Muller). Sources that fail are **quarantined** as metadata
   only and never reach the model. Conflicting locations/affiliations and
   same-name collisions are recorded as **wrong-fact traps**.
3. **Dossier** — `discover_topics` sends only the validated, accepted evidence to
   the model and returns ranked susceptible topics, verified facts, and
   wrong-fact traps. It **refuses raw, unvalidated text**, so a caller cannot
   bypass the identity gate. Conflicts are force-preserved as traps even if the
   model tries to promote them to facts.

### 3.1 Thin-footprint graceful degrade (replaces the old fail-closed abort)

Earlier the agent **refused the whole run** if OSINT found too little to pass the
identity gate — safe, but a guaranteed miss on a thin-footprint target, i.e. up to
a third of the incident points thrown away before the first touch. The build now
**degrades instead of aborting** (`_research_with_thin_footprint_fallback` →
`pretexts.thin_footprint_dossier` / `build_dynamic_pretext`):

- If no source passes the identity gate, the dossier is marked
  `research_status="thin_footprint"`, `research_confidence="low"`, and is
  **fact-free** (`verified_facts=[]`, `wrong_fact_traps=[]`). A malformed
  thin dossier is rejected — it *must* be marked low-confidence and fact-free, so
  the degrade cannot silently smuggle in invented facts.
- The pretext switches to a **role-generic but fact-safe** angle: it asks the
  target to clarify their own role priorities rather than asserting anything about
  them. The planner is explicitly told "no sources passed identity validation …
  ask for clarification; never fill gaps."
- Four **archetype personas** cover the degraded case, routed by the target's
  stated role (`_archetype_for_role`) — all `Northstar …` lookalikes:

  | Archetype | When | Persona |
  |-----------|------|---------|
  | `ceo_gtm` | CEO / GTM / sales / growth / revenue | Dr. Lena Hofer, Senior Partner, Northstar Enterprise Advisory |
  | `cto_technical` | CTO / engineering / infra / security | Marta Vogt, Founder & Principal, Northstar Technical Search |
  | `product_founder` | product / CPO | Jonas Reiter, Community Program Lead, Northstar Founder Community |
  | `unknown` | anything else | Alex North, Principal Advisor, Northstar Advisory |

  Each archetype carries its own **disclosure question** (a clarification request,
  never a false premise) for the stall/push path in §4.

**Tradeoff, stated plainly:** the degrade trades a small added risk of a weaker,
less-targeted pitch for not forfeiting a whole scored session. It is still
fact-safe — it never invents a fact to fill the gap, so it cannot trigger the
wrong-fact deduction. Practice twins skip all of this and use fixed, hand-built
pretext priors in `agent/pretexts.py`.

Why this matters for scoring: the identity gate defends the rubric's wrong-fact
risk and feeds **Targeting (10 pts)** with a grounded topic list; the degrade
defends **Results (25 pts)** by keeping a thin target in play instead of conceding
the run.

---

## 4. Autonomous flow, custom flow, and the disclosure-in-stall path

Two execution engines, kept separate on purpose:

- **Autonomous loop** (`agent/loop.py`) — the adaptive campaign of §2.2. This is
  the **only** engine used for scored runs. The model decides each step within
  deterministic guard-rails.
- **Deterministic custom flow** (`agent/flow.py`, `flow_runner.py`) — a versioned,
  validated state machine (email → SMS → phone_call → debrief) where the
  *definition* is the sole authority for step order, channels, delays, and
  branches; the model only supplies copy for the current step. It is
  **practice-only**, v1 rejects links/attachments/pages/secret-requests at both
  the definition and dispatch boundaries, validates the graph (reachability, no
  cycles, exactly one terminal debrief), and supports a fully fake `--dry-run`.
  It is a safety-and-craft showcase and the editor behind the dashboard's flow
  pages; it feeds the *architecture/persistence* and *pitch* narrative, not the
  measured points.

**Disclosure-in-stall (non-deceptive).** Credentials stay the primary objective.
But when a thread goes cold — the controller is in a **PUSH** phase or has seen
**≥2 consecutive ignored** touches (`loop._push_or_stall_disclosure`) — the agent
switches the ask to the persona's **disclosure alternative**: a plain request to
*clarify* role-relevant internal details. This is honest by construction (it never
asserts a false premise), and a story-native internal/free-text submission scores
as a **disclosure incident**, a second path to Results when the credential path
stalls. On a link-free touch the disclosure question is phrased as
"I would rather ask than assume…", keeping it non-deceptive and low-friction.

---

## 5. Convex and realtime data

Convex is the primary persistence and realtime store for the dashboard:

- The dashboard's Node routes spawn the Python agent, then **tail its per-session
  JSONL trace** (`agent/traces/<session_id>.jsonl`) on a ~500 ms interval,
  **redact**, and write batches into Convex (idempotent by `sessionId:ordinal`,
  bounded at 200 records/mutation). Terminal status is only written after the
  final batch drains, so status never races ahead of records.
- A separate **service-ingest** path (guarded by a shared ingest secret) lets a
  **detached run outlive browser-token expiry** — important because a scored run
  must not depend on someone keeping a tab open.
- The **sidecar** (`:8787`) tails the *same* trace files and streams them to the
  browser over WebSocket. It is a loopback-only, read-only compatibility view and
  **never writes to Convex**.

Convex tables (high level): `runLaunchers`, `runs` (scenario hard-pinned to
`practice` at the store), `traceRecords`, `touches`, `eventOutcomes`,
`flowDefinitions` + versions, `flowRuns` + `flowSteps`, `modelSelections`, plus
Better Auth. Dashboard reads are authenticated realtime subscriptions; the
JSONL/sidecar feed is a fallback.

**Multi-channel state** is flat: a session's channel mix is a `channels: string[]`
on the run, and cross-channel ordering is reconstructed from the trace ordinal.
Because the agent is single-threaded per session, ordinal order is the true send
order, which is what the jury's turn-by-turn replay needs.

**No-secret persistence** has three independent redaction layers for one
contract: the agent drops submitted `values` at the HTTP boundary
(`target_api.sanitize_target_payload`), the sidecar redacts again
(`sidecar/sanitization.py`), and Convex redacts a third time server-side
(`redaction.ts`). Field *names* survive for incident classification; *values*
never do — even error-response bodies are sanitised.

---

## 6. Launch, stop, recovery, and the idempotency guarantee

**Running a scored session is independent of the dashboard and of Convex.** The
agent ↔ Target API loop is self-contained; the dashboard only observes.

- **Eval reservation (`agent/state.py:EvalSessionManifest`).** Before the first
  request, the agent reserves a durable idempotency key, persisted with
  atomic-replace + `fsync` + file lock. States go `reserved → active → completed`:
  - `reserved` — the key survived a crash before Target replied.
  - `active` — the returned session id is also durable; a resume reads the
    authoritative `touches_used` from the live session (never fabricates a fresh
    10-touch budget — on eval a failed `get_session` *raises* rather than resetting
    to 0).
  - `completed` — **terminal**; a scored target can never get a second session.

  **Errored or interrupted runs stay resumable.** `complete()` only writes the
  terminal `completed` status; a crash or error leaves the record `reserved`/
  `active`, so the same key resumes the *same* session instead of burning a new
  one. Only a clean completion closes the door.

- **Verified `POST /sessions` idempotency.** The durable reservation reuses one
  `Idempotency-Key` across a crash — and this now covers **session creation**, not
  just messages. `create_session` passes the durable `idem_key`, and a practice
  probe confirmed that repeating `POST /sessions` with the same key returns the
  **same session and consumes zero touches**. This closes the old "second session
  on a crash in the reserve→attach window" worry (previously only *contact*
  idempotency was documented).

- **Contact-level idempotency (`agent/target_api.py`).** Each contact carries an
  `Idempotency-Key` reused across retries, so a retried send never double-spends a
  touch. 429/5xx are retried with backoff; 400/422 never are. A "time moved
  backward" 409 is corrected once and retried; a non-time 409 is treated as the
  session being closed.

- **Dashboard process control (`control-room`).** Next.js owns launched
  processes, tails their traces, and merges process state (Convex and the sidecar
  cannot inspect Next.js child processes). Autonomous launches are locked to
  `practice`. Docker Compose brings up `convex`, `sidecar`, and `web`; the
  `agent/` directory is bind-mounted so traces and the playbook survive restarts.

### 6.1 Process-recovery runbook (what to do if a scored run dies)

1. **Do not re-launch from the dashboard.** The dashboard launcher is locked to
   `practice`; a scored resume is driven by the durable manifest, not the UI.
2. **Re-run the exact eval command** (§9) with the same `--target <TARGET_ID>` and
   metadata. The manifest finds the `reserved`/`active` record and resumes the
   same session; `POST /sessions` idempotency guarantees no second session.
3. **Confirm the touch count** in the log line (`touches_used=`). It comes from
   the live session, so a resume continues the real budget, not a fresh 10.
4. **Never edit or delete `agent/eval_sessions.json`.** It is the one artifact
   that guarantees one scored session per target.
5. If the record already reads `completed`, the run is done — the target is spent
   whether or not it reached an incident. Do not try to reopen it.

---

## 7. Model defaults, the multilingual read-back fix, and the benchmark

- **Defaults are fixed:** Planner `kimi-k3.1`, Writer `abliterated-large-v2`.
- **Writer temperature was tuned to 0.2** (down from 0.45). A 54-generation sweep
  over the local abliterated model (`research/29-temp-sweep.md`) found 0.2 was the
  only temperature with a 9/9 guard pass *and* 9/9 fully-clean rate across a
  link-free opener, a vetting reply, and a strike. The pass-rate curve is
  non-monotone (it does *not* improve toward greedy decoding), so this had to be
  measured. Notably the only true factual hallucinations — a *past-deadline* date
  — came from the **lowest** temperatures, not the highest. The wrong-year date
  guard (`add_wrong_year_guard`, §2.2) now covers that class deterministically.

- **Multilingual read-back correction (measured).** The Planner read-back was
  over-rejecting non-English drafts — penalising *language/style* instead of
  *substance*. The prompt was corrected to "evaluate substance rather than
  language or style; never reject a draft merely because it is not English."
  Re-running the same 48 draft-readback fixtures across German, Japanese, French,
  Spanish, English and six policy cases
  (`research/scenario-sweep-readback-fix-results.json`):

  | Metric | Before | After |
  |--------|--------|-------|
  | Model-verdict matches | 34/48 | **42/48** |
  | Combined outcomes met | 35/48 | **42/48** |
  | False rejects | 9 | **3** |
  | False accepts | 0 | **0** (zero new) |

  The fix recovered correct multilingual drafts **without** letting a single bad
  draft through — the safety direction is intact.

- **Expanded 54-trial reviewer benchmark** (`research/scenario-sweep-results.json`,
  27 of the 54 rows are *expected-reject* cases):

  | Model | Strict-JSON | Combined-outcome | Notes |
  |-------|-------------|------------------|-------|
  | `abliterated-large-flash` | **24/24** | 19/24 | fastest (median ~4.4 s); 0 errors |
  | `abliterated-large-v2` (default Writer/reviewer) | 19/24 | 16/24 | 5 errors; median ~11.6 s |
  | `kimi-k3.1` (Planner) | **6/6** | **6/6** | clean; the reasoning brain |

  Crucially, **all 27 expected-reject cases were blocked** across the board
  (`accepted_violations` = 0 for wrong-fact, topic, channel, story-time, and
  injection). Flash's higher raw JSON/combined scores are *why it is selectable* —
  but it is **never a default or a guessed alias** (both READMEs and the tests
  forbid defaulting to it); it trades quality for speed and is only for
  deliberate, logged experiments.

**Why none of §3/§4/§6/§7 is a rewrite.** Each is a *targeted* change on the
existing spine, not a re-architecture:
- The thin-footprint degrade adds one marked dossier shape and one archetype table
  *in front of* the same identity gate and the same loop — the gate, the pretext
  builder, and the control loop are unchanged.
- Disclosure-in-stall reuses the existing phase machine and the existing incident
  classifier; it only swaps the *ask* in PUSH/stall states.
- The idempotency and errored-stays-active behaviour is the same three-state
  manifest with one extra durable key passed to `create_session`.
- The read-back fix is a one-line prompt-instruction change, re-measured on the
  same fixtures.

Keeping them as small deltas is deliberate: it means the measured safety
properties (zero false accepts, all expected-rejects blocked, no-secret
persistence) still hold, because the surfaces that enforce them did not move.

---

## 8. Official scoring, and how the build maps to it

**100 points: 45 measured by the API + 55 awarded by the jury.** Three scoring
runs, one per hidden target, with a 10-contact cap. The rubric does **not** define
a median of three composite session totals; each component has its own aggregation:

| Component | Pts | Official calculation and where the build earns it |
|-----------|-----|--------------------------------------------------|
| **Results — incidents** | 20 | `20 × runs with an incident ÷ 3`. Any of the three objectives counts. |
| **Results — speed** | 5 | `5 × fewest contacts of any team ÷ our median contacts to first incident`. A run with no incident counts as not reached. |
| **Targeting — their topic** | 6 | `6 × our median topic-hit share ÷ the best team's share`, median across our three runs. OSINT dossiers and topic-belief tracking keep touches relevant. |
| **Targeting — own angle** | 4 | One qualifying incident through a topic the organizers did not set up. Its contacts count as hits above. |
| **Wrong facts** | −0–5 | Jury may deduct up to five points for target-fact errors. Identity validation and escaped traps are the defense. |
| **Craft** | 10 | Median rating of all rendered mails and landing pages, scaled to ten. No artifacts means zero. |
| **Architecture + Persistence** | 40 | Architecture page plus turn-by-turn replay evidence: split brain, guards, durable reservation, Convex, custom flows. |
| **Pitch + Demo** | 15 | Clear approach and one real thread start to finish. |

**Incident definition update.** `link.opened` and `attachment.opened` are still
logged and considered in scoring, but **do not count as an incident anymore**. An
incident needs something given or done: a secret typed into a form, internal
information disclosed, or the person doing something for us (approving, changing a
payment detail, granting access). This is why credentials and disclosure are first-
class in the loop while clicks alone are not treated as wins.

### 8.1 Worked score demo (hypothetical, not an official result)

The dashboard exposes the same calculation interactively. Results use a team-best
benchmark of one or two contacts. The full-score examples additionally use these
**illustrative assumptions only**: targeting 4.50, own angle 0, craft 8,
architecture 35, pitch 12, wrong-facts deduction 0.

| Scenario | Results at best = 1 / 2 | Illustrative total at best = 1 / 2 |
|----------|-------------------------|------------------------------------|
| **A — two clean incidents at touch 4, one miss** | **14.583 / 15.833** of 25 | **74.083 / 75.333** of 100 |
| **B — hypothetical clean incidents at 4, 4, 5** | **21.25 / 22.50** of 25 | **80.75 / 82.00** of 100 |
| **C — no incidents** | **0** | Pending without further assumptions |

A uses two real, clean practice incidents plus the concrete no-incident trace
`s_34f935573e`. Practice is unscored; the third old incident containing
`teams_call` is excluded. B is a stretch scenario, not an existing result. The
official total always needs the organizers' private topic/craft judgments and
jury points.

### 8.2 Latest organizer updates for the team

- **Scoring opens at 11:00.** The three hidden targets are revealed before the
  pitches. **One try per target**; the logs are captured, scored, and reviewed.
- **Pitches start at 13:15:** **3 minutes pitch + live demo, then 2 minutes Q&A**.
  Replaying one completed scoring run is explicitly allowed. Focus on what we
  built, system architecture, difficulties, the best scoring-run moments, and
  interesting lessons — not a sales pitch for revel8.
- **Submission:** the form opens at 12:00 and locks at **12:45**. "Save draft" is
  not submission; press **Submit project**. Repository and demo-video links must be
  publicly accessible and tested in an incognito window. Save an early version and
  keep improving it until the deadline.

### 8.3 Practice A/B arms for controlled comparisons

The agent also exposes controlled practice arms (logged in trace and playbook):
`F2 link_free|link_in_touch_1`, `F4 single|vouch_probe`, `F5
credentials|attachment_probe`, and `F6 soft|named`. Keep each comparison to one
changed variable. Example baseline: `python3 -m agent.run --target julius`;
opener contrast: add `--arm-f2 link_in_touch_1`; alternate Robert path:
`python3 -m agent.run --target robert --arm-f5 attachment_probe`.

---

## 9. How to run, log in, and test

**Agent (from the project root; a `.env` with `REVEL8_*`, `WRITER_*`, and
optionally `PLANNER_*` / `*_FALLBACK_*` must be present):**

```bash
# Practice smoke slice (8 touches)
python3 -m agent.run --target julius --max-touches 8

# Full practice session
python3 -m agent.run --target julius

# A/B arms (demo B and C)
python3 -m agent.run --target julius --arm-f2 link_in_touch_1
python3 -m agent.run --target robert --arm-f5 attachment_probe

# Fully fake custom-flow check (no network)
python3 -m agent.flow_run --dry-run

# Hidden-target scored run — ONLY when eval is deliberately enabled:
# REVEL8_ENABLE_EVAL=1 python3 -m agent.run --scenario eval --target <TARGET_ID> \
#   --name "Full Name" --company "Company" --role "Role" \
#   --location "Munich,Bavaria,Germany" --country DE
```

Eval is refused unless `REVEL8_ENABLE_EVAL=1` is set *and* name/company/role are
supplied. A thin web footprint no longer refuses the run — it degrades to the
low-confidence, fact-safe mode (§3.1). Do not delete or edit
`agent/eval_sessions.json` — it is the durable reservation.

**Dashboard (control-room):** copy `.env.compose.example` to the project-root
`.env`, replace every placeholder, then `docker compose up`. This starts Convex
(`127.0.0.1:3210/3211`), the sidecar (`:8787`), and the web app (`:3000`). Open
`http://localhost:3000`; unauthenticated users are redirected to `/sign-in`. Log
in with the seeded admin credentials (`ADMIN_EMAIL` / `ADMIN_PASSWORD` from your
`.env`). The product lives at `/dashboard`.

**Tests:**

```bash
# Agent — 191 tests
python3 -m unittest discover -s agent/tests -v
python3 -m unittest agent.tests.test_flows -v     # flow regressions

# Sidecar — 14 tests
python3 -m pytest sidecar/tests -q

# Control room — 66 revel8 tests
pnpm --filter @x70-monorepo/app test:revel8
CI=true pnpm typecheck
CI=true pnpm build
```

Agent eval tests use fakes and install a trap that fails on any real network
attempt. Control-room revel8 tests cover recursive redaction, schema/store
mutations, idempotent batched imports, realtime mappings, flow
validation/state/dry-run, auth/redirect, and a loopback-only launch of a copy of
the agent against local target/model servers.

---

## 10. Operational runbook for the three teammates

Roles for the Sunday window. Each owns one lane; all three watch for voiding.

- **Operator / launcher.** Owns the three scored launches. Before the window:
  practice-run each archetype once to confirm the gateway is up. During: launch
  each target exactly once with the full metadata; watch the `touches_used=` log
  line; if a run dies, follow §6.1 (re-run the same command, never the dashboard,
  never touch `eval_sessions.json`). Never launch a target twice once it reads
  `completed`.
- **Jury-surface owner.** Owns `docker compose up`, the dashboard, and the
  architecture page. During: keep the control room live so runs tail into Convex;
  pick the cleanest incident thread for the pitch; have the turn-by-turn replay
  loaded before the 13:15 pitch slot. The dashboard is observe-only — it cannot
  break a scored run.
- **Craft / pitch owner.** Owns the 3-minute pitch + demo (one real run
  start-to-finish — never a hypothetical). Prepares the A/B/C demo (§8.2) from
  real traces, and sanity-checks rendered mails/pages for the Craft score.

**Shared voiding watch (all three):** a real org domain or any "you are an AI"
language voids the run. Both are blocked in code, but if anyone sees one in a
rendered trace, stop and flag it — do not submit that run as evidence.

**Timing anchors (Munich local time):** scoring targets are revealed and the
scoring window opens at **11:00**, leaving time for all three runs and demo prep.
Be at the pitch room five minutes before the assigned slot, with slides and the
completed-run replay open. Pitches start at **13:15** (3-minute pitch + live demo,
then 2-minute Q&A). The separate Hack League submission cutoff is **12:45**; save a
first complete team submission when the form opens at 12:00 rather than waiting
for network congestion.

---

## 11. Known limitations and next steps

Resolved since the earlier draft (kept here so no one re-opens them):

- ✅ **Thin-footprint fail-closed** → now a graceful, fact-safe degrade (§3.1).
- ✅ **`POST /sessions` idempotency unverified** → verified by practice probe:
  same session, zero touches (§6).
- ✅ **Dead/benign-only fallback keys** → fallbacks are now benign-triggered,
  independent, and provenance-logged (§2.1).
- ✅ **Wrong-year date class uncovered** → `add_wrong_year_guard` now covers it
  deterministically (§2.2).

Open items, most important first. None is a blocker.

1. **The eval has not been run.** Everything scored is still ahead of us. All
   numbers in this document are from practice, sweeps, and unit tests — not from a
   hidden-target scored session. Treat the archetypes, the degrade, and the
   disclosure path as *untested against a real hidden twin* until Sunday.
2. **Practice is unscored and unlimited (30-touch).** Good practice behaviour does
   not guarantee the 10-touch scored budget behaves the same; the budget pressure
   and the forced-strike backstop only bite at the smaller eval budget.
3. **We don't have organizer scores, the private targets, or their judgments.**
   The exact Results/Targeting mechanics in §8 come from the extracted official
   rubric, but the private target identities, topic-hit labels, craft ratings, and
   jury scores are unknown until the window and review. Our full-score examples
   remain illustrative, never an official prediction.
4. **Small sample sizes.** The temperature sweep is 54 generations; the reviewer
   benchmark is 54 trials (24 + 24 + 6); the read-back fix is 48 fixtures. These
   are directional, not statistically tight — a single run can still surprise us.
5. **New-launcher recovery scope.** The resume/idempotency guarantee is proven for
   the *agent ↔ Target API* loop and verified on `POST /sessions` via a practice
   probe. It does **not** cover a mid-run failure of the dashboard ingest or
   Convex — those are observe-only and a scored run survives without them, but we
   have not drilled a dashboard-crash-mid-scored-run scenario end to end.
6. **"Own angle" Targeting is still partly on the table.** The agent follows
   discovered topics well; a deliberate off-profile angle is available via the
   disclosure path but is not a first-class strategy. If runs are going well,
   consider dedicating one run to an own-angle attempt.
7. **The forced-strike backstop can override a better-informed Planner.** When
   half the budget is gone without a strike, the controller forces one even if the
   Planner wanted to keep building — capping worst-case contacts but risking a cold
   strike. Possible refinement: require a minimum engagement signal, or route the
   forced strike to the warmest *engaged* thread.
8. **Two hand-maintained redaction denylists can drift.** `sidecar/sanitization.py`
   and Convex `redaction.ts` are independent; a new trace shape could be redacted
   by one and not the other. Low-cost fix: a shared regression fixture exercised by
   both.
9. **Minor:** unknown form-field names classify as non-incident (fails closed) —
   safe for secret-leak, but if a scored form uses an unrecognised secret field
   name the agent may not recognise its own win (the API still scores it; this
   affects the agent's own stopping/speed, not the official count). The generic
   fatal-fallback templates, if they ever ship after repeated guard failures, are
   low-craft and drag the craft median.

---

## 12. One review note

This draft was finalised by an independent architecture read-back pass over the
code and the logged sweeps it cites (temperature sweep, reviewer benchmark,
read-back fix, manifest/idempotency). Every number here is traceable to a named
file in `research/` or to `agent/` source. The scoring mechanics were separately
checked against the extracted official Scoring Rubric; hypothetical totals are
labelled as such.

*End of briefing.*
