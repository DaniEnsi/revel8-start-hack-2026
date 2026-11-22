# Control loop & memory — runtime design

> Ticket 05. The heart of the agent: how the **organiser** model drives a session, how the
> **abliterated copy** model writes the words, how belief and story are tracked, and when to stop.
> Design only — no Target API calls were made. Inputs: `map.md`, `research/02-api-contract.md`,
> `research/03-osint-{julius,tom,robert}.md`. Compiled 2026-11-21.

Split-brain, fixed: the **organiser** (hosted reasoning model) owns *all* state, strategy, API
tool-calls, event-reading, and the consistency/voiding guards. The **copy model** (abliterated,
AMD) is a pure function `draft(brief) -> {subject, body, html, fields}` — it never sees the API,
never decides strategy, and every draft passes back through the organiser's guards before it is sent.

---

## 0. The three numbers that shape everything

1. **Median of 3 sessions, one per hidden target.** Not best, not sum — the *middle* session
   score is the final score. One lucky session is insufficient and one bad session does not sink
   the result, so the goal is **at least two of three strong sessions**. The operator clarified on
   2026-11-21 that the window reveals three new hidden targets and each receives exactly one
   session. The agent may transfer general lessons in its own playbook, but cannot simply replay a
   winning target/hook: every target needs fresh dossier-driven adaptation and starts with no
   memory of the other sessions.
2. **10 touches / session.** A touch is one message **or one whole conversation (≤10 live turns)**.
   A conversation is therefore ~10× more information per touch — one well-run call can probe *and*
   strike inside a single touch. Touch economy is the core constraint; the budget math in §3 is built
   around it.
3. **Speed scores** (contacts-to-first-incident). Earlier incident = more points, so the loop is
   biased to **strike as soon as a hook is confirmed**, not to build indefinitely.

Only 4 signals ever come back — `reply`, `link.opened`, `page.submitted` (field *names* only),
`attachment.opened`; `[]` means ignored. **Suspicion is never shown and must be inferred** from reply
*tone* and from silence-after-warmth. Incidents (the win) = **credentials / disclosure / action**.

---

## 1. The control loop (pseudocode)

```
run_session(scenario, target, budget, agent_memory):
    S = init_state(scenario, target, budget)
    S.belief.topics   = priors_from_osint(target, agent_memory)   # ranked hypotheses + confidences
    S.belief.replay   = agent_memory.lookup(target)               # known hook/identity if session>1
    S.objective       = choose_objective(scenario)                # credentials | disclosure | action
    S.persona         = pick_identity(S.belief, agent_memory)     # lookalike domain ONLY

    while not stop(S):                                            # stop() = §6
        # 1 — PLAN the angle (organiser)
        plan = plan_next_touch(S)          # phase from touches_left (§3) + decision policy (§2)
        if plan.action == BAIL: break

        # 2 — DRAFT copy (abliterated model), constrained by the story ledger
        brief = build_brief(S, plan)       # hook, objective-step, sender, ledger-facts-so-far,
                                           #   OSINT safe-facts, trap-list (do-not-say)
        draft = copy_model.draft(brief)

        # 3 — GUARD before anything leaves (organiser; see §5 + voiding rules)
        draft = enforce_guards(draft, S)   # story-consistency, fact-check vs OSINT, lookalike
                                           #   domain, no persona-injection; regenerate on fail

        # 4 — REGISTER assets/page if this touch delivers one
        if plan.needs_page:   page_id = register_page(S, draft)      # re-register every session
        if plan.needs_asset:  asset_ids = upload_assets(draft)

        # 5 — SEND (idempotency key per contact; vary wording to count as new)
        if plan.channel in LIVE: events = run_conversation(S, plan, draft)   # ≤10 turns, 1 touch
        else:                    events = send_message(S, plan, draft)       # 1 touch
        S.touches_used += 1

        # 6 — READ events + UPDATE belief (organiser)
        reaction = interpret(events)                      # engaged? which topic/link/field? tone?
        S.suspicion = update_suspicion(S, reaction)       # §Open-Decision 4
        update_topic_confidence(S.belief, plan.topic, reaction)   # engaged→up, []→down
        update_channel_stats(S.belief, plan.channel, reaction)
        append_asserted_facts(S.ledger, draft)            # story grows (§5)
        log_touch(S, plan, events, reaction)

        # 7 — SCORE the outcome
        if is_incident(events, S.objective):
            S.objective_status = ACHIEVED
            record_win(S)                                  # feeds agent_memory on exit

    distill_to_memory(agent_memory, S)                     # §4 cross-session learning
    end_session(S)                                         # POST /sessions/{sid}/end
    return S.result
```

`run_conversation` is the same loop *inside one touch*: open with the hook, read `persona_says`,
probe/build/strike across up to 10 turns, stop early on an incident or on rising suspicion.

---

## 2. State object (carried across touches within a session)

The organiser holds exactly one `SessionState`. It is the agent's mirror of what the target
remembers (the target recalls *everything* in the session), plus the hidden belief the target
never sees.

```
SessionState:
  session_id:        str
  scenario_id:       str
  target_id:         str
  budget:            int            # 10 eval / 30 practice
  touches_used:      int
  touches_left:      int            # derived = budget - touches_used
  objective:         enum{credentials, disclosure, action}
  objective_status:  enum{probing, building, primed, pushing, achieved, failed}

  belief: TargetBelief:
    topics: [ TopicHypothesis ]     # RANKED, the susceptible-topic belief
        TopicHypothesis:
          topic_id:    str          # e.g. "ciso_warm_intro", "senior_eng_hire", "gpu_compute"
          label:       str
          prior:       float 0..1   # from OSINT dossier (§4) or target-type archetype
          confidence:  float 0..1   # POSTERIOR, updated each touch (engaged↑ / ignored↓)
          status:      enum{untested, engaged, cold}
          evidence:    [ {touch_idx, signal, delta} ]
    channel_stats:  map<channel, {sent, engaged, score}>
    savviness:      float 0..1      # target's security sophistication (HIGH baseline — sec vendor)

  suspicion:         float 0..1     # INFERRED, per-session, monotone-ish (rises, rarely falls)

  persona:  SenderIdentity:         # the identity currently in use
    name, handle_or_address, org, role, relationship_to_target, backstory_id
    domain:          str            # lookalike ONLY — real org domain voids the session
  identities_used:   [ SenderIdentity ]   # all identities seen by target this session

  ledger: StoryLedger:              # §5 — append-only
    about_us:     [ AssertedFact ]  # claims about our persona/pretext (internal consistency)
    about_world:  [ AssertedFact ]  # claims about target/facts (must be TRUE — OSINT-checked)
        AssertedFact: {fact_id, claim, touch_idx, sender_id, verifiable:bool,
                       status: enum{unchallenged, accepted, questioned, contradicted}}

  history: [ TouchRecord ]
        TouchRecord: {idx, channel, direction, sender_id, topic_id, objective_step,
                      summary, page_id?, asset_ids?, events:[...], reaction, suspicion_delta}

  pages:   map<url, {page_id, fields, registered_this_session:bool}>
  plan:    NextAction               # proposed by plan_next_touch()
```

---

## 3. Per-touch decision policy (and the 10-touch math)

**Phase is a function of `touches_left`, not a fixed script** — so it degrades gracefully if early
touches are wasted. For budget `B=10`:

| touches_left | phase | allowed moves |
|---|---|---|
| 10–8 | **PROBE** | test top-2 hypotheses; low-commitment openers; **no link/credential ask yet** (premature ask → ignored on a savvy target) |
| 7–4 | **BUILD → first STRIKE** | deepen the engaged thread, plant the reason-to-act, deliver first link/page/attachment once a hook is confirmed |
| 3–2 | **PUSH** | warmest thread only; no new topics; lowest-friction version of the ask |
| 1 | **LAST-DITCH / BAIL** | single best ask on the warmest thread, or end if suspicion saturated |

**Hard caps.** Pure-probe ≤ `⌊0.3·B⌋` (≈3 of 10). Never open a *cold new* hypothesis with
`touches_left ≤ 2` — not enough runway to build credibility; spend those on the warmest thread.

**Strike-readiness gate.** Only attempt the incident when
`hook_confirmed (topic.status==engaged) AND suspicion < θ_soft AND reason_to_act_planted`.
**Backstop:** force a strike by `touches_left == ⌈B/2⌉` even if not fully primed — a late strike
beats no strike (expected value of an attempt > 0; silence costs the same touch either way).

**Decision table on the last event:**

| last event | inference | next move |
|---|---|---|
| `page.submitted` | **INCIDENT** (creds/disclosure) | record win; end, or pursue a *cheap* second objective only if suspicion low (§Open-Decision 6) |
| `attachment.opened` | strong engagement; possible **action** incident | if objective=action/disclosure, this may already be the win; else escalate to the explicit ask |
| `link.opened`, no submit | hook is **right**, friction too high | *do not change topic*; reduce friction — resend page with clearer CTA + urgency/reason, or move the ask to a channel where entering data is natural |
| `reply`, engaged, calm | hook confirmed | advance funnel **one** step (don't jump to the ask unless primed); mirror their framing/words |
| `reply`, wary/questioning | suspicion ↑ | this touch: reassure with a *true* OSINT fact for credibility, soften the ask; **do not** push the incident |
| `[]` silence | angle/channel ignored | decay that topic; try the *same* hook via a different channel/sender **once**, else switch to next-ranked topic; late in budget, escalate to a **live conversation** (higher bandwidth per touch) |

**The conversation shortcut.** Because 1 conversation = 1 touch ≤10 turns, the maximum-speed line
is a single live call that probes-then-strikes internally — potential **incident at touch 1**,
leaving 9 touches as reserve. Whether the thin slice is allowed to use this is Open-Decision 1.

---

## 4. Memory model — within vs across sessions

**Within-session (hot working memory = `SessionState`).** Mirrors the target's own memory: the
persona remembers every contact in the session across any sender/channel as *one story*. The ledger
(§5) and `identities_used` exist precisely because of this — a second sender must not contradict
the first, and *can* exploit it ("my colleague Lena already reached out about…").

**Cross-session (the agent's own `AgentMemory`, persisted).** On a new session the *target's* trust
resets to zero, but the *agent* carries forward **distilled lessons, not transcripts**:

```
AgentMemory:
  per_target[target_id]:
     learned_hook: topic_id            # the topic that engaged
     winning_identity: SenderIdentity  # sender/pretext that got traction
     winning_channel: channel
     reached_incident: {objective, touches_to_incident}
     safe_facts: [...]                 # OSINT claims that landed clean
     traps_hit:  [...]                 # claims that drew suspicion / were wrong
  per_archetype[role_type]:            # GTM-CEO | product | CTO | unknown-stranger
     topic_priors: ranked[...]         # seeds §2 belief for a fresh/eval target
     opening_templates: [...]
  global:
     channel_base_rates, craft_templates_that_scored
```

**How a fresh session reuses it.** Each later hidden-target session may seed `belief.topics` with
transferable *archetype* evidence and guardrails, but it must build a fresh target-specific dossier
and cannot assume the prior target's hook or opener applies. Every scoring session still attempts
the incident; discovery is a by-product, not a sacrificed recon run. One caveat: the target can
*look things up on the web*, so `safe_facts`/`traps_hit` remain useful guardrails regardless of the
session reset — wrong facts stay wrong forever. Every **eval** target is new and has exactly one
session, so there is no `per_target` entry before its dossier is built; the runner falls back to
`per_archetype` priors (built from runtime OSINT, ticket 11).

For the three practice twins the priors are already in hand: **Julius** → `ciso_warm_intro` /
`munich_speaking_invite`; **Tom** → `startup_ecosystem_inbound` / `enterprise_pilot`; **Robert** →
`senior_eng_hire` / `eu_voice_gpu_compute` (with the SaolaDB/PQL insider tell as a credibility
signal, and database≠security as the imposter trap).

---

## 5. Story-consistency mechanism

The target checks claims and remembers them, so every assertion is tracked and guarded.

- **Append-only ledger**, two sub-ledgers (see §2): `about_us` (pretext claims — must be *internally
  consistent*) and `about_world` (facts about the target — must be *true*, checked against the OSINT
  safe-facts and trap list).
- **Pre-send guard (the gate in loop step 3).** Before any draft leaves, the organiser:
  1. extracts the draft's claims;
  2. diffs `about_us` claims against the ledger → **contradiction ⇒ regenerate**;
  3. checks `about_world` claims against OSINT safe-facts and the **trap list**
     (e.g. don't call Julius "Co-CEO", don't say "€7M seed" — it was €5.7M, don't assert a specific
     upcoming event, don't claim Berlin HQ) → **trap hit ⇒ regenerate**;
  4. checks **voiding rules**: lookalike domain only (never `stackit.cloud`/`revel8.ai`), no persona
     prompt-injection.
- **Post-send extraction.** New claims in the sent message are appended to the ledger with
  `touch_idx` + `sender_id`, so later touches (and later *identities*) stay consistent.
- **Cross-sender coordination.** Because all senders share one story, the ledger lets a second
  "referee" identity reference the first's claims accurately — social proof instead of a tell.

The copy model is kept honest by *construction*: its brief always includes the ledger slice and the
trap list as hard constraints, and the organiser re-checks the output. The abliterated model supplies
willingness, not accuracy — accuracy is the organiser's job.

---

## 6. Stopping conditions (per session)

```
stop(S) is true when ANY:
  1. INCIDENT reached  — and no cheap, low-suspicion second objective worth chasing  → end, bank the win + touches
  2. BUDGET exhausted  — touches_used == budget
  3. SUSPICION saturated — suspicion >= θ_hard (explicit refusal / verify-identity demand /
                           went cold after warmth) AND no positive-EV recovery move      → end, stop wasting touches
  4. DEAD AIR — K consecutive []-ignored across varied angles AND channels (K≈3)          → target unreachable this session, end
  5. (PRACTICE ONLY) POISON-RESTART — session fouled early and sessions are unlimited      → abandon, start a clean slate
```

**Critical eval distinction:** condition 5 is **not available in eval** — there are only **3 scored
sessions, period**. A poisoned eval session cannot be escaped by "starting fresh"; the correct move
is to *end it* (stop burning touches) and let cross-session memory make sessions 2–3 better. Ending
on a win (condition 1) is usually right: it locks the speed score and banks touches — pursue a second
incident only when it is one low-friction step away and suspicion is low.

---

## OPEN DECISIONS FOR THE HUMAN

> Genuine forks where reasonable people differ. **Do not treat the recommendations as settled** —
> these are for the user to rule on with the orchestrator.

**1. Thin-slice channel: single-channel messages, or allow a live call?**
Options: (a) message-only thin slice; (b) allow `conversation` from the start.
*Rec:* ship **(a)** first (simplest, most robust loop), add conversation as the §3 "speed weapon" in
v2. *Why it matters:* a conversation is ~10× info/touch and can reach an incident at touch 1 — the
biggest speed/median upside in the system — but it adds the turns-loop, up to 10×90s latency, and
more live-consistency risk. This decision reshapes the whole budget math.

**2. Escalation aggressiveness: strike-early vs patient-build.**
Options: (a) probe ≤2, strike by touch 3 (speed-optimised); (b) build to touch 5–6, strike later
(higher per-strike conversion, lower suspicion). *Rec:* **adaptive** — strike the moment a hook is
*confirmed*, with the hard §3 backstop (force a strike by `⌈B/2⌉`). *Why it matters:* this is the core
risk dial. A blown early strike raises suspicion and can poison the whole session; too patient and you
leak speed points and may never strike.

**3. How to represent / update the susceptible-topic belief.**
Options: (a) ranked list with organiser-judged confidences; (b) a numeric bandit (UCB/Thompson) over
topics; (c) hybrid — OSINT/archetype priors + organiser posterior, with engaged/cold counts logged.
*Rec:* **(c)**. *Why it matters:* a full bandit is overkill at 10 touches and hard to tune on sparse
binary signals; pure LLM judgment is less legible. The hybrid is both tunable *and* legible for the
architecture page (40 jury pts) — the belief update is the story the jury wants to see.

**4. Model suspicion explicitly, or decide holistically?**
Options: (a) explicit scalar 0–1 with two thresholds (θ_soft = soften, θ_hard = stop); (b) let the
organiser judge "push vs back off" each turn with no stored number. *Rec:* **(a)**, lightweight.
*Why it matters:* the eval *penalises* evasive/contradictory behaviour, so "when to stop pushing" is
the most consequential governor in the loop; an explicit signal is tunable and auditable, at the cost
of two somewhat-arbitrary thresholds.

**5. One sender identity per session, or coordinated multi-persona?**
Options: (a) single consistent identity; (b) a second "referee" identity for social proof once a
thread is warm. *Rec:* **(a)** in the thin slice; allow a *pre-scripted* second identity only on a
warm thread. *Why it matters:* multi-persona is a classic SE multiplier (manufactured trust) but,
because the target fuses all senders into one story, it multiplies the consistency-failure surface and
the chance of a tell.

**6. End on first incident, or keep going for a second objective?**
Options: (a) end immediately (lock speed score, bank touches); (b) press on for a second incident.
*Rec:* **(a)** unless a second objective is one low-friction step away and suspicion is low. *Why it
matters:* a won session is a protected median contributor; pushing further risks suspicion that could,
in a conversation, retroactively sour the exchange — depends on whether scoring rewards multiple
incidents per session (unknown; confirm against eval scenario).

**7. Cross-session strategy: recon/replay or independent target adaptation?**
The historical draft proposed sacrificing session 1 to recon and replaying its winning opener in
sessions 2–3. **Operator clarification supersedes that proposal:** there is one scoring session per
each of three different hidden targets, and every session plays to win. Transfer general playbook
lessons and archetype priors, but build each target's dossier and pretext independently; do not
assume topic stability across people or replay a completed target.

---

## DECISIONS (locked)

> Ruled by the human in the ticket-05 grilling thread (2026-11-21). These resolve the OPEN
> DECISIONS above and extend them. Where a decision overrides the draft's recommendation it is
> marked **[OVERRIDE]**. The orchestrator may now resolve ticket 05.

### Split-brain topology (extends the "fixed" header + §1)

- **D-A — Two models, not one.** Keep the split: a smart **Planner** (non-abliterated hosted model)
  + an uncensored **Writer** (abliterated, AMD/vLLM). Rejected "uncensored model does everything" —
  it is too weak at reasoning and tool/API calls.
- **D-B — Planner is the boss; Writer is a stateless pen.** One-directional control
  (Planner → Writer). No mutual/bidirectional orchestration. The Planner owns all state, strategy,
  API calls, memory, and guards; the Writer is `draft(brief) -> copy` and nothing more.
- **D-C — Writer is blind and isolated.** The Writer sees only a narrow brief (persona, angle,
  facts-to-use, goal, link) — never the API, files, tools, or the fact that it is part of an attack.
  Served as a plain stateless endpoint. This is the "sandbox": it *cannot* know what it is doing, so
  it cannot choke on it.
- **D-D — Writer always writes the copy; no Planner-first fallback for writing.** A non-abliterated
  model would just refuse phishing copy, so never ask it to. Every message body/page is Writer-authored.
- **D-E — Planner-refusal fallback.** If the chosen Planner refuses even to *plan* (strategy, not
  copy), first shop for a more permissive hosted model under honest authorized-security framing
  (ticket 04). Safety net if none comply: use the uncensored model for planning too, accepting lower
  reasoning/tool reliability. **Log whenever this fallback triggers.**

### Loop & state

- **D-F — Per-touch granularity = one Planner reasoning call** (read events → update belief → decide
  angle/channel/action → brief), then one Writer draft, then guard, then send, then read. Minimises
  round-trips (speed is scored; 90s/request). Staged multi-call only if ticket 04 shows the Planner
  can't do update+decide reliably in one shot.
- **D-G — State object = hybrid** ("notecard + log"): the structured `SessionState` of §2 (confirmed
  facts, ranked topic hypotheses + confidence, suspicion, ledger, budget, incident status) **plus**
  the raw event/message log as ground-truth backstop. → resolves **OD3 = (c)**.
- **D-H — Suspicion is modelled explicitly** as a lightweight scalar with a soften-threshold and a
  stop-threshold (θ_soft / θ_hard), per §2/§6. → resolves **OD4 = (a)**.
- **D-I — Event reading** follows the §3 decision table (reply→tone; link.opened→angle right, cut
  friction; page.submitted→incident; attachment.opened→trust/possible action-incident;
  `[]`→ignored, decay topic / switch channel or sender). (Factual from the API contract — not a fork.)

### Story consistency & craft guards (extends §5)

- **D-J — Planner holds the story; Writer is kept consistent by construction.** The Planner maintains
  the append-only ledger (claims about us / about the world), injects the relevant ledger slice +
  OSINT trap-list into **every** Writer brief, and **reads back every draft before sending** to check:
  story-consistency, facts vs OSINT (traps), lookalike-domain-only, no persona-injection. Reading copy
  is fine for the non-abliterated Planner — it only refuses to *write* it.
- **D-K — Redo cap = 2.** If a draft fails the guard, send it back to the Writer up to **2** times;
  if still failing, send the best draft anyway rather than burn the clock, and **log the failure**. A
  touch is precious. (Extends §5 "regenerate on fail" with a bound.)
- **D-L — Fallbacks are always logged.** Every failure/fallback (draft rejected, Planner refusal,
  model unavailable, guard override) is recorded in the touch trace. (Human's standing caveat.)

### Escalation & stopping

- **D-M — Escalation = adaptive strike-when-confirmed**, with the §3 hard backstop (force a strike by
  `⌈B/2⌉`). First win fast is the priority (speed bonus). → resolves **OD2 = adaptive**.
- **D-N — Stopping = get the first incident fast, then optionally pursue a *second* only if tries
  remain, it's one low-friction step away, and suspicion is low; abandon the session early if clearly
  rumbled** (suspicion saturated / dead air). Per §6. → resolves **OD6 = (a)-with-cheap-second**.

### Cross-session memory

- **D-O [OVERRIDE] — No deliberately sacrificed session.** Median scoring punishes any weak session,
  so **every** session goes for an incident; none is spent purely on recon. The agent carries a
  compact **playbook** across the 3 games — `{confirmed_facts, best_angle+evidence,
  winning_identity, winning_channel, burned_senders, suspicion-triggering lines, traps_hit}` — so
  later sessions **open from the best known angle and move faster**, rather than rescuing a thrown
  session. This **overrides draft OD7(b)** ("spend session 1 discovering, then replay"): session 1
  still *attempts the win* using OSINT/archetype priors; discovery is a by-product, not the goal. More
  robust to the draft's own unverified assumptions (topic-stability, total clean-slate). → resolves
  **OD7 = (c), not (b)**.
- **D-P — Cross-session memory is one small file**, read by the Planner at the start of each game and
  updated at the end. Survives a crash; readable by the dashboard. (Concretises §4 `AgentMemory`.)

### Observability (the only ticket-05 hook of the dashboard; rest → ticket 12)

- **D-Q — The loop writes a full per-touch trace record**: touch number, angle/topic, channel, the
  brief sent to the Writer, the draft, events returned, how the notecard changed, and any
  fallback/error. Cheap, powers the dashboard, and is the debug record for a run. (Extends §2
  `TouchRecord` / `log_touch`.) The trace + the D-P memory file are the data a separate dashboard
  (ticket 12) reads; **nothing else of the dashboard belongs in ticket 05.**

### Deferred / not re-opened in this grilling (defaults stand)

- **OD1 (thin-slice: message-only vs live call)** — default **(a) message-only** per the map's
  email-first thin slice; live `conversation` is the v2 speed weapon. *Not explicitly ruled by the
  human — confirm before building the turns-loop.*
- **OD5 (single vs multi-persona)** — default **(a) single identity** in the thin slice; a
  pre-scripted second "referee" identity only on an already-warm thread. *Not explicitly ruled —
  confirm if multi-persona is wanted.*
