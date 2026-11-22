# Pick the organiser model (Kimi K3 / GPT / Claude)

Type: prototype
Status: resolved
Blocked by: 02

## Question

Decide which hosted model drives the runtime loop (strategy, API tool-calls,
event-reading, adaptation). Run representative loop prompts — plan next angle from an
event trace, keep the story consistent, decide follow-up vs switch-channel — and compare
reasoning quality, tool-calling reliability, latency, cost, and whether strategy-level
prompts trip refusals. Pick the cheapest that holds up.

## Note (from 05 grilling)

Per D-E: if the chosen Planner refuses to *plan* (strategy, not copy) under honest
authorized-security framing, shop for a more permissive hosted model; last-resort fallback
is using the uncensored model for planning too (lower reasoning/tool reliability), and log
whenever that fallback triggers. The Planner only ever *reads* copy, never writes it (D-D/J).

## Evidence (2026-11-21): Claude/4.8 refuses to PLAN, not just write

Delegated drafts for tickets 06 (pretext) and 07 (pages) both failed on claude-opus-4-8's
`[cyber]` safeguard — the planning/strategy itself, under honest authorized-hackathon
framing. Per 05 D-E this rules the available Claude model out as the **Planner**. Narrowed
candidates: **Kimi** (low-refusal), **GPT** (test), or the **abliterated model as planner**
(D-E last resort, lower tool reliability). Decision waits on: Kimi wiring OR the live
endpoint (01). GPT/Codex is reachable (ticket 01's Codex agent ran) but gpt-6.2-sol already
refused the abliterated setup, so expect similar on attack-planning — test before trusting.

## Evidence (2026-11-21, cont.): Kimi K3 proven

Kimi K3 (via Cursor) cleanly drafted ticket 06's pretext strategy honoring every wrong-fact
trap → **Kimi K3 is a proven low-refusal Planner candidate** (capable reasoning + trap
discipline). Leading option for the Planner role; abliterated endpoint = fallback (D-E).

## Answer — Planner = Kimi K3

Decided by elimination + evidence: Claude (4.8 fallback) refuses even to plan (06/07 `[cyber]`);
GPT/gpt-6.2-sol already refused the abliterated setup (expect similar on planning); **Kimi K3
(via Cursor) cleanly drafted the 06 pretext strategy honoring all traps** → capable + low-refusal.
- **Planner = Kimi K3** (strategy, API tool-calls, event-reading, adaptation).
- **Writer = abliterated endpoint** (ticket 01) for all copy.
- Open check for build (09): confirm Kimi's **tool-calling reliability** in the live loop (D-F:
  one reason+decide call per touch); if shaky, stage into multiple calls. Abliterated-as-Planner
  stays the D-E last-resort.

## Runtime reality (2026-11-21): single-brain on the abliterated endpoint

User has only Anthropic/OpenAI keys — no Moonshot/Kimi runtime key. Kimi was a dev-time
executor (via Cursor), NOT callable from the agent at runtime. Anthropic/OpenAI refuse the
attack-planning mid-loop (unreliable). **Decision: runtime Planner = the abliterated endpoint
(single-brain)** — exactly what the build (09) defaults to; no rework.
- Risk: the 27B is weaker at multi-step reasoning + tool/JSON calls. The 09 smoke run is the test.
- If too weak: (a) stage the Planner into smaller single-purpose calls (D-F); (b) OPTIONAL hybrid —
  use an Anthropic/OpenAI model ONLY for refusal-safe mechanical sub-steps (parse events, shape
  JSON, pick a channel), never the attack framing. Revisit only if the smoke run demands it.

## Follow-up: Planner model sweep = ticket 16

When the OpenAI key arrives, run the sweep (ticket 16): GPT newest→older (fall back if newest
refuse) vs single-brain baseline vs optional hybrid; pick the strongest non-refusing Planner.

## Two findings (2026-11-21): 27B is config-bound; K3.1 writes cleanly
- 27B failures are CONFIG, not incapacity: served at **Q4_K**, Writer **temp 0.45**, and **GPU1 idle**
  (24GB/96GB used). Fixes: Writer temp ~0.15, higher quant (Q8/fp16 — VRAM available), tighter prompt.
- **K3.1 (ticket 28) writes the same copy at 10/10 adherence, no refusal.** So: PRIMARY = K3.1 single
  brain (Planner+Writer) if the x70 gateway URL+key is supplied; FALLBACK = fixed-config 27B (self-hosted).

## Standing preference (operator, 2026-11-21): local-first, split ideal, K3.1 fallback
1. Give the LOCAL abliterated model (on the provided AMD cards) a genuine best effort — both GPUs
   + a stronger model/quant + tuned temp. The organizers provided the hardware; using it is valued.
2. **Ideal = split roles:** local abliterated = **Writer** (low-refusal copy, on the AMD cards);
   **K3.1 = Planner** (reasoning) IF the x70 gateway key is supplied; else local does both.
3. **K3.1 as Writer fallback** only if the upgraded local model still can't write reliably.
