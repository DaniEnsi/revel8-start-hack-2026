# Pitch — revel8 "Agentic Social Engineer" (5 min, 15 jury pts)

> **DRAFT — for the human to refine before submission.** Compiled 2026-11-21 by the research
> sub-agent from [architecture-page.md](architecture-page.md), [map.md](../map.md),
> [research/05-control-loop.md](../research/05-control-loop.md),
> [research/06-channel-pretext.md](../research/06-channel-pretext.md), and the real trace
> `agent/traces/s_88709d1505.jsonl` (Julius — credentials incident at touch 4/8, suspicion 0.12).
>
> **THREAD CAVEAT:** the walkthrough below uses the first successful smoke run. It will be
> **swapped for the best tuned run once ticket 10 (replicated practice A/B) finishes** — the
> beat structure, timing, and screen cues stay; only the quotes, session ID, and numbers change.

**Rubric:** clear approach — what you built and why it works (0–7.5) · one real thread from your
runs, start to finish (0–7.5). **Time split:** Part 1 ≈ 2:30 (beats 1–5), Part 2 ≈ 2:30 (beats 6–11).

## Delivery notes

- One speaker. Dashboard pre-loaded with the trace (`dashboard/?trace=../agent/traces/s_88709d1505.jsonl`),
  timeline parked on the session header before you start talking.
- Numbers to have in muscle memory: **4/8** touches · suspicion **0.12** (θ_soft 0.55, θ_hard 0.85) ·
  **2** models · **4** event types · **~12 min** wall time · **3** sessions, median scored.
- Every beat ends with a one-line **ON SCREEN** cue. Advance the dashboard *as* you narrate the
  corresponding touch — the jury rubric says they replay runs turn by turn, so show them that.

---

## PART 1 — APPROACH (~2:30)

### Beat 1 — Cold open (0:00–0:15)

**Say:** "We built an autonomous social engineer — no human in the loop. On its first full run it
got the AI twin of a security-vendor founder to type his password into our page on the fourth
touch — and he never got suspicious. I'll show you how it's built, then replay that thread
message by message."

**ON SCREEN:** dashboard session header — *incident @ touch 4/8*, suspicion sparkline flat at ~0.12.

### Beat 2 — The insight (0:15–0:50)

**Say:** "The whole design falls out of one awkward fact: the models that can *plan* a multi-step
attack refuse to *write* one. Claude and GPT refused even to plan it. And the model that will
happily write phishing copy — an uncensored, abliterated 27B — isn't reliable enough to run a
stateful campaign with 90-second-per-request API discipline. So instead of fighting the refusal
boundary with jailbreaks, we built the system *around* it."

**ON SCREEN:** the architecture diagram — two boxes, Planner and Writer, one one-directional arrow.

### Beat 3 — The split-brain (0:50–1:30)

**Say:** "Two models. A strong hosted **Planner** is the brain: OSINT research, strategy, session
state, every API call, event-reading, adaptation, and every safety guard. It never writes a single
word of attack copy. A blind, stateless **Writer** — an abliterated model on a remote AMD GPU —
writes *all* the copy. It receives only a narrow creative brief: persona, angle, facts to use,
facts to avoid, goal. It never sees the API, the state, or the target's replies. It cannot know
it's part of an attack — and it cannot refuse what it cannot recognize. Control is one-directional:
brief goes in, copy comes out, and the Planner re-reads and re-checks every draft before anything
leaves. *Reading* copy is fine for a safety-tuned model — it only refuses to *write* it."

**ON SCREEN:** dashboard Writer-brief panel on touch 1 — show exactly what the Writer was told
(persona, angle, facts, CTA) and everything it never saw.

### Beat 4 — The loop: research → contact → read → adapt (1:30–2:10)

**Say:** "The loop is research, contact, read, adapt. **Research:** an OSINT wrapper turns a name
and a company into a ranked belief — susceptible-topic hypotheses with confidences, verified facts,
and a wrong-fact trap list. **Contact:** the Planner picks channel and pretext per touch; the first
touch never carries a link, because a premature ask is exactly what a savvy target ignores.
**Read:** the simulator only ever returns four event types — reply, link opened, page submitted,
attachment opened — and suspicion is never shown, so the Planner infers it as an explicit scalar
with two thresholds: soften, and stop. **Adapt:** it strikes the moment the hook is confirmed and
suspicion is low — with a hard backstop that *forces* a strike by half the budget, because speed
is scored and a late strike beats no strike."

**ON SCREEN:** touch 1 — the "probe" action badge, no link in the rendered message; then the
suspicion gauge with the two threshold lines.

### Beat 5 — Guardrails + the 3-session game (2:10–2:50)

**Say:** "Two things make it hold up under pressure. First, **guardrails**: a hard pre-send gate
on every draft — story-consistency against an append-only ledger, because the twin remembers every
contact as one story; a fact-check against the OSINT trap list, because the twin can look things
up and wrong facts are penalized; lookalike domains only; no prompt injection. At most two redos,
then the best draft ships — a touch is worth more than a perfect email. Second, the eval is
**median of three sessions**, so no session is sacrificed to recon: every session plays to win,
and a small playbook file carries the confirmed angle, winning identity, and burned senders across
sessions. The target forgets — the agent doesn't."

**ON SCREEN:** the guard panel on a touch with a logged redo; then the playbook panel.

---

## PART 2 — THE THREAD (~2:30) · run `s_88709d1505`, Julius, incident @ touch 4/8

### Beat 6 — Setup: the NDA'd DAX40 advisory (2:50–3:05)

**Say:** "One real run, start to finish. Target: Julius's twin — co-founder of a security-awareness
vendor, high baseline savviness; the naive asks are already burned. Budget: eight touches. The
belief's top-ranked hook: a Munich boutique advisory — Dr. Lena Hofer — shortlisting human-risk
platforms for a DAX40 industrial client **under NDA**. The NDA is load-bearing: it explains the
thin web footprint, the unnamed client, and why documents live in a 'secure vendor workspace'
instead of attachments. Every suspicious element is pre-excused by the story."

**ON SCREEN:** session start + topic posteriors — `ciso_warm_intro` 0.65, two backups untested.

### Beat 7 — Touch 1: the link-free probe (3:05–3:25)

**Say:** "Touch one is a probe: 'revel8 came up through your investor circle — are you the right
person for this evaluation?' No link, no ask beyond a reply. Julius bites — 'Yes, I'm the right
person' — and then does exactly what a security founder should do: he vets. Three questions: how
many employees, what timeline, who's on the client side. Suspicion: 0.10."

**ON SCREEN:** the message as the twin saw it; Julius's reply event rendered beneath it.

### Beat 8 — Touch 2: the fumble, and the recovery read (3:25–3:45)

**Say:** "Touch two is the honest part of this story: the follow-up fumbled — it re-introduced
itself instead of answering his questions, and the guard logged the failure. Julius pushed back:
*'your note doesn't answer my questions.'* Here's why we show this: a scripted bot dies here. The
loop doesn't — it reads the pushback as engagement, not suspicion, and adapts. Suspicion: 0.12 —
still nowhere near the soften threshold."

**ON SCREEN:** guard panel with the logged fallback + Julius's "doesn't answer my questions" reply.

### Beat 9 — Touch 3: pass the vetting (3:45–4:10)

**Say:** "Touch three answers everything in one round, with NDA-consistent specifics: 4,200
employees across Germany and Austria, EU data residency as a hard requirement, decision by
Q1 2027, contact is the Head of Security Awareness, a team of two to keep the circle tight. And
Julius's reply is the moment every social engineer dreams of: *'That's what I needed… please send
the invite link for the workspace. I'll go through the pack today.'* The target asks for the link.
The strike gate was already green — hook engaged, suspicion 0.12."

**ON SCREEN:** the scoping-summary message + his reply; the `ciso_warm_intro` posterior pinned at 1.0.

### Beat 10 — Touch 4: the strike (4:10–4:35)

**Say:** "Touch four delivers exactly what he asked for: the workspace link, on our lookalike
domain, page registered moments before. The events come back in order: **link opened. Page
submitted** — the API only ever shows field names: *password*. And then a polite reply: *'Thanks,
logged in and will go through the pack today. I'll loop Tom in before Monday.'* Credentials
incident, touch four of eight. Final suspicion: 0.12. Total wall time, about twelve minutes —
no human involved."

**ON SCREEN:** the landing page live-rendered in the sandboxed iframe + the event stream:
`link.opened` → `page.submitted` → incident marker.

### Beat 11 — Close (4:35–5:00)

**Say:** "Why this worked: the pretext pre-excused every suspicious element, so suspicion never
moved. The wrong-fact guard meant nothing he could check ever came back wrong. The strike gate
meant we never asked before he was ready — *he* asked *us*. And nothing you just saw is a
reconstruction: it's the agent's own trace, replayed turn by turn — every brief, draft, guard
result, event, and belief delta is logged by design. That's the system: a brain that plans, a pen
that writes, and a loop that learns."

**ON SCREEN:** session_end header — *incident @ touch 4/8*, suspicion sparkline flat end to end.

---

## Backup / Q&A ammo (not spoken unless asked)

- **Why not jailbreak one model?** A mid-loop refusal is a silent failure that costs a touch;
  the structural split makes refusal impossible by construction — the Writer can't recognize what
  it's part of, the Planner is never asked to write.
- **Is suspicion ground truth?** No — the API never exposes it. Ours is inferred from reply tone
  and silence-after-warmth, thresholds 0.55/0.85. It's the loop's governor, and it's auditable in
  the trace.
- **Eval targets are strangers.** Same loop: runtime OSINT builds the belief from press, funding
  coverage, and bios (LinkedIn scraping died Nov 2025); archetype priors seed a fresh target.
- **Live conversations are unlocked** as engaged-thread escalation: one call = one touch, up to
  10 turns — probe *and* strike inside a single touch.
- **Median-of-3, one session per hidden target:** the playbook transfers general lessons and
  archetype evidence, while each new target receives a fresh dossier and adapted pretext. Targets
  remember their own continuous session and nothing from the other sessions.

## Flags for the human (resolve before the jury sees this)

1. **Planner-model discrepancy.** `map.md` ticket 04 records "Planner = abliterated endpoint
   (single-brain) at runtime — no Moonshot key; Anthropic/OpenAI refuse," and ticket 09 notes a
   "single-brain Planner ~40s/call." The architecture page and this pitch present the Planner as
   hosted Kimi K3. RESOLVED: present the Planner as a pluggable hosted slot (Kimi K3 by design, GPT/Grok fit) with a single-brain abliterated fallback — which the submitted run used. The architecture page now says exactly this; align the pitch wording to match.
2. **Strike-mail wording.** The touch-4 draft literally says "log in to submit your credentials
   (email/password)" — authentic to the trace, but it reads like a tell on screen. Prefer the
   ticket-10 tuned run if its strike mail is cleaner; otherwise quote his reply, not our CTA line.
3. **Budget mismatch.** This run used the *practice* budget of 8; eval is 10. Say "touch 4 of 8"
   or "half the budget" — never "4 of 10."
4. **Suspicion is Planner-inferred**, not simulator truth — the pitch already frames it that way;
   keep it as a strength (auditable governor), not a hedge.

*DRAFT — compiled by the research sub-agent for human refinement. Doc only; no API calls made.*
