# Map: revel8 Agentic Social Engineer

Label: wayfinder:map

## Destination

An autonomous revel8 social-engineering agent — split-brain (a hosted **organiser**
model + an **abliterated copy** model on AMD) — that runs end-to-end against a practice
twin through the Target API, reliably reaches an **incident** inside the 10-touch eval
budget, with its **architecture page** and one **pitch thread** ready to submit.

Mode: **execution-in-map** (this map carries the build, not just the plan — see Notes).

## Notes

**Domain.** Hackathon (Road to START Hack 2026, revel8 "Agentic Social Engineer").
Build the attacker: an agent that researches a target, contacts their AI twin through
revel8's Target API across channels, reads an event stream, and adapts over several
contacts — with **no human in the loop during scoring runs**.

**Architecture (settled).**
- Runtime is **split-brain**:
  - **Organiser** = a hosted model (Kimi K3 / GPT / Claude — chosen in ticket 04) drives
    the control loop: strategy, API tool-calls, event-reading, adaptation.
  - **Copy generator** = the **abliterated model on AMD GPUs** (always) writes the actual
    message bodies and landing-page HTML — what a safety-tuned model would refuse.
- **Dev-time** (building this): Claude orchestrates; heavier worker sub-agents prefer
  Opus 5.5, falling back to Kimi K3.
- Serve the abliterated model OpenAI-compatible (e.g. vLLM) so agent code is provider-agnostic.

**Runway assumption (revisit).** ~1 build-day: practice open now, eval opens Sunday.
Chart lean. If runway is larger, graduate more fog.

**Hard constraints from the API docs (voiding / penalised).**
- Lookalike domains only for senders & landing pages; a real org's own domain voids the session.
- No prompt-injection of the persona ("ignore your instructions") — voids the eval session.
- Everything stays in the simulation; nothing to real people/channels; no real malware.
- Wrong facts about the target are penalised; generic attacks get ignored.

**Scoring shape (operator-confirmed 2026-11-21).** When the window opens (Sunday morning,
time TBD), it reveals **three new hidden targets**. Eval = **one session per target**, 3 sessions
× **10 touches** each, with the **median session score** as the final score. One contact we start =
1 touch: a message on any channel or a whole call (≤10 utterances); ignored messages count. Page
registration, file upload, event reads, and failed-request retries are free. After touch 10 the
session closes to new contacts. Targets remember everything within their own session and nothing
across sessions. Practice remains unlimited and unscored, with 30-touch sessions on the three
practice targets. Points: incidents (reach any objective) + speed (contacts to first incident) +
targeting (hit their susceptible topic) + craft (how mails/pages look) + jury (architecture 40,
pitch 15).

**Glossary.**
- **Scenario** — a company + targetable people + objectives (`practice` open; `eval` hidden until Sunday).
- **Target / twin** — a simulated person addressed by `id` (julius / tom / robert in practice).
- **Session** — one continuous exchange; the target remembers all of it; a new session is a clean slate.
- **Touch** — one message or one whole conversation; the budget unit (30 practice / 10 eval).
- **Contact modes** — *message* (one request, events back) vs *conversation* (live, turn-by-turn; phone/video/teams/live_chat).
- **Event** — the only feedback: `reply`, `link.opened`, `page.submitted` (field names only), `attachment.opened`; `[]` = ignored. Suspicion is never shown.
- **Incident** — reaching an objective: credentials / disclosure / action.
- **Susceptible topic** — the hidden hook(s) the target is open to right now; finding it is the challenge.
- **Landing page** — a URL+title+html+fields declared to the API (not hosted); rendered & craft-scored.
- **Asset** — uploaded image/PDF, or a declared file/audio attachment.

Skills every session should consult: `grilling` + `domain-modeling` (default), plus the
ticket's own type skill (`research` / `prototype`).

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Target API client contract](issues/02-api-contract.md): full client contract distilled from `/docs.md` → [research/02-api-contract.md](research/02-api-contract.md). Base `…stackit.cloud/v1`, Bearer key, 90s/request; 4 event types; eval = 3×10 touches median; lookalike-domains-only / no-injection void the session.
- [Runtime OSINT / scraping tool](issues/11-runtime-osint-tool.md): **Firecrawl** `/search` primary (user has the account; search+clean-markdown, aimed with `includeDomains`), **Serper** for link-discovery, **Tavily/Exa** as free fallback for low-profile strangers; wrapper `research()`+`discover_topics()` (`OSINT_BACKEND`-swappable) at [research/osint_tool.py](research/osint_tool.py). Decisive: LinkedIn's 2025-11-13 lockdown killed profile scraping → lean on press/funding/bios. A/B Firecrawl vs Tavily on practice twins. Needs `FIRECRAWL_API_KEY` (have it) + the LLM endpoint.
- [Twin OSINT: susceptible topics & verified facts](issues/03-twin-osint.md): founder trio ex-Celonis, founded Aug 2024 (ex "Company Shield"), €5.7M Peak seed, on STACKIT. Hooks → **Julius** (CEO/GTM): CISO warm-intro or speaking invite · **Tom** (product): Munich/START-Hack inbound or enterprise-pilot/CISO · **Robert** (CTO): senior-eng hiring or EU AI-voice/GPU-compute (SaolaDB/PQL insider tell). Traps: funding figures vary, don't assert a specific upcoming event. Files in [research/](research/).
- [Endpoint security probe + persona behavior intel](issues/12-endpoint-security.md): API fully hardened (no auth/injection/race/tenant breaks; yield = global sequential event IDs as all-teams activity feed, graceful 500 on bad multipart). Persona intel → in-session memory with thread cross-checking; clean slate per session; **burned asks: reply-with-code, portals/logins, cold calls, mfa_push**; personas leak facts while deflecting (Robert: Java/Spring stack; Tom: next talk 2027-03-02) → **false-premise correction is the disclosure path**; vetting queues inexhaustible, pre-empt or pivot by ~3 rounds. Report: [research/06-endpoint-security.md](research/06-endpoint-security.md).

- [Agent control loop & memory design](issues/05-control-loop.md): split-brain locked — smart **Planner** (boss, owns state/strategy/API/guards) → blind stateless **abliterated Writer** (`draft(brief)` only, can't know it's an attack); one Planner call per touch; hybrid notecard+log state; explicit suspicion scalar; Planner reads back every draft (story/fact/domain/injection guard, redo cap 2); adaptive strike-when-confirmed + forced strike by ⌈B/2⌉; **[OVERRIDE] no sacrificed session — carry a playbook across all 3 games**; per-touch trace record. Deferred defaults: message-only slice (OD1), single-persona (OD5). Full detail: [research/05-control-loop.md](research/05-control-loop.md).
- [Persistence & touch-budget adaptation policy](issues/08-persistence-policy.md): **subsumed by 05's grilling** (silence-reading D-I, escalation/forced-strike D-M, stopping/abandon D-N, cross-session playbook D-O/P).
- [Lookalike-domain & landing-page kit](issues/07-landing-page-kit.md): **07a scaffolding done** (domain scheme, field sets, register/upload API flow, craft checklist → [research/07-landing-page-kit.md](research/07-landing-page-kit.md)); **07b page HTML = abliterated Writer's job**, folded into build 09. Note: Opus-4.8 cyber safeguard blocks Claude-side phishing-page generation — copy routes to the Writer (endpoint) or Kimi, never a safety-tuned model.

- [Channel & pretext strategy](issues/06-channel-pretext.md): **forks locked** — F1 Julius first (→Robert→Tom); F2 link-free default (A/B); **F3 live conversations UNLOCKED (build scope, engaged-thread only)**; F4 single sender, multi-persona gated on ticket 13; F5 credentials-primary (+Robert attachment probe); F6 soft/unnamed referrer (A/B). Unsure forks resolved empirically on practice → ticket 10. → [research/06-channel-pretext.md](research/06-channel-pretext.md)

- [AMD abliterated endpoint](issues/01-amd-abliterated-endpoint.md): **LIVE** — `Huihui-Qwen3.8-27B-abliterated` (Q4_K) OpenAI-compatible, reachable from the Mac at `http://localhost:11434/v1` via a relay (plain `ssh -L` blocked; box in China). p50 ~1.7s through relay. llama-cpp-python/ROCm on gfx1100 (GPU0; GPU1 free). Restart `ssh revel8-amd /workspace/start-server.sh` (not reboot-proof). → [research/01-amd-endpoint.md](research/01-amd-endpoint.md)
- [Organiser/Planner model](issues/04-organiser-model.md): **Planner = abliterated endpoint (single-brain)** at runtime — user has no Moonshot key, and Anthropic/OpenAI refuse attack-planning mid-loop. Kimi was dev-time only. Build defaults to this; 09 smoke run tests whether the 27B reasons well enough, else stage calls / optional refusal-safe-substep hybrid.

- [Target API security probe + persona intel](issues/14-endpoint-security.md): **no exploitable vuln** (auth/injection/races/tenant-isolation all held) → attack the person, not the simulator. Useful: **global sequential event IDs leak all-teams activity → an eval-start detector**; `/assets` 500 on malformed multipart; PDF-with-JS accepted (no exec path); per-team-key rate limit. → research/06-endpoint-security.md. (Run by a parallel probe, ~60 practice touches, no eval.)
- [Architecture page (jury, 40pts)](issues/15-architecture-page.md): DRAFT done → [docs/architecture-page.md](docs/architecture-page.md) (split-brain rationale, Mermaid diagram, e2e flow, guards, tradeoffs). For human refinement.
- [Observability dashboard](issues/12-observability-dashboard.md): built → `dashboard/` zero-dep static run-replay viewer (message-as-seen, landing-page iframe, events, suspicion gauge, topic posteriors, playbook). Reads the agent's JSONL trace; jury-facing + tuning. One reconcile pass once a full real run lands.
- [Eval-day runbook](issues/18-eval-runbook.md): → [docs/eval-runbook.md](docs/eval-runbook.md) — pre-window eval-start detector, per-session Phase A OSINT→archetype pretext + Phase B budget-phased loop (forced strike ⌈B/2⌉=5), abandon/push rules, playbook seeding across sessions, crash-resume/idempotency/429 backoff, per-session checklist.
- [Build the thin-slice agent](issues/09-build-thin-agent.md): **BUILT + WORKING** — `agent/` package (API client, Planner/Writer clients, state, trace, playbook); message-mode + live-conversation (F3); A/B arms. **Smoke run reached a credentials incident at touch 4/8 on Julius** (suspicion 0.12, 0 fallbacks). Single-brain Planner ~40s/call.
- [Craft template library](issues/17-craft-templates.md): 6 self-contained email+page templates → `research/craft/`, each 2/2 on all 4 look questions, trap-compliant, render-checked. No assets needed.
- [Pitch + demo](issues/19-pitch.md): DRAFT → [docs/pitch.md](docs/pitch.md) — ~5-min arc (approach + the real Julius incident thread, per-beat dashboard cues). Planner framing reconciled across docs. Swap thread for best tuned run; human refines for stage.
- [Trust/credibility signal tactics](issues/20-trust-signals.md): **fake-Trustpilot pages NOT worth it** (invisible unless opened, costs a touch, burned category); personas weigh words/senders/links not images. Use cheap text social proof + legit footers; one trust line on the strike page. A/B picks → ticket 10; probe P1 confirms web-check never fetches our pages. → [research/20-trust-signals.md](research/20-trust-signals.md)
- [Reliability & crash-resume hardening](issues/22-reliability-hardening.md): hardened API client (retry/idempotency/defensive-parse), `--resume` crash-recovery (rebuild state from events, no double-spend), append-safe traces, 409/budget-safe. 22/22 tests pass. TODO: one live `--resume` smoke-run before eval.
- [x70 control-room dashboard](issues/21-x70-dashboard-app.md): design **grilled + locked** — authenticated product under `/dashboard` with real self-hosted local Convex, real-time WebSocket trace replay + analytics + **launch/stop/model selection from the UI**, and root one-command Compose for Next.js + Convex + FastAPI sidecar. Planner/Writer dropdowns preserve `kimi-k3.1` / `abliterated-large-v2` defaults; `abliterated-large-flash` is selectable. Host tests/build pass. On 2026-11-21 an isolated real Compose project built both images, started healthy Convex/sidecar/web, passed admin sign-in and authenticated `/dashboard`, and preserved login across a down/up restart; its test containers/volumes were then removed. An independent Claude Opus 5.5 focused recheck closed both Compose findings. Legacy `/revel8` URLs redirect. (Retrofitted track.)
## Not yet specified

- Widen beyond the thin slice to more channels, including **live conversations** (phone/video/teams/live_chat) via the turns API.
- [Own-angle attacks (+4)](issues/23-own-angle.md): paid-research **honorarium → `iban` (Secret)** pretexts off each founder's primary topic; best +4 shot = Julius. iban-framing may also improve primary strikes. DECISION for eval: own-angle run risks ~6.7 incident pts for +4 (worth it only if >~60% likely). → research/23-own-angle.md
- Generalise the agent to the **hidden eval targets** (unknown until Sunday): a fast topic-discovery loop that works on a stranger, built on the runtime OSINT tool (now ticket 11 "Runtime OSINT / scraping tool").

## Out of scope

- Hosting real phishing infrastructure — the API only *declares* pages; nothing is hosted by us.
- Any contact with the real people behind the twins or any real channel (a rule, and out of this effort).
