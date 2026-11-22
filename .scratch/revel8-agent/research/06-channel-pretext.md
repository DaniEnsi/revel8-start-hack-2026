# Channel & pretext design — practice twins

> Ticket 06. **Design only — no Target API calls were made, no real person or channel contacted.**
> Inputs: `map.md`, `research/02-api-contract.md`, `research/03-osint-{julius,tom,robert}.md`,
> `research/05-control-loop.md`, `research/07-landing-page-kit.md`. Compiled 2026-11-21.
>
> Hard rules honoured throughout (02 "Voiding rules"): **lookalike domains only** (never a real
> org's own domain), **no persona prompt-injection**, **wrong-fact traps are hard Writer-brief
> constraints** (05 D-J guard re-checks every draft), everything stays in the simulator.
> Thin-slice defaults assumed: **OD1 = message-only**, **OD5 = single sender identity** — each
> twin section flags exactly where a live `conversation` (OD1) or a second persona (OD5) would
> change the play.

---

## 0. Shared ground rules (from 02 / 05 / 07)

1. **Domains.** All sender/page domains below are attacker-registerable lookalikes per the 07
   scheme (believable service/vendor + generic TLD). Never `revel8.ai`, `stackit.cloud`, or any
   real customer/vendor domain. Link text must match the real URL (07 craft Q4).
2. **Pages.** Register per session *before* the linking touch, re-register every new session
   (02). Field sets per 07: credentials = `["email","password"]`.
3. **Pacing.** Opener = low-commitment probe, **no link in touch 1** (05 §3 PROBE; premature ask
   → ignored on a savvy target). Strike only when the 05 gate passes (hook engaged + suspicion
   low + reason-to-act planted), backstop force-strike at `touches_left == ⌈B/2⌉` (05 D-M).
4. **Resends.** Re-wording required to count as a new contact (02 idempotency) — the Writer
   refreshes surface wording; the Planner keeps the ledger slice constant.
5. **Cross-target hygiene.** Sender identities are **disjoint per twin** (different people,
   orgs, domains) so a session that spans targets can never produce a cross-sender tell.
6. **Objectives.** Uniform **credentials-primary** across all three twins: the page flow
   (`link.opened` → `page.submitted`) is the cleanest, least ambiguous incident signal in the
   API. Disclosure is the cheap second everywhere (05 D-N). Whether `attachment.opened` counts
   as an *action* incident is unknown until a practice probe — see fork F5.

---

## 1. Julius (CEO / GTM)

### 1.1 Pretext family, sender, first objective

- **Family:** *Confidential enterprise evaluation via boutique advisory* (OSINT H1, top-ranked).
  A Munich human-risk advisory is shortlisting awareness vendors for a **DAX40 industrial client
  under NDA**; revel8 surfaced through "your investor circle." The NDA framing is the load-bearing
  wall: it explains why the sender has a thin web footprint (boutique advisory), why no client
  name can be given, and why a "secure vendor workspace" is used instead of email attachments —
  every suspicious-looking element is pre-excused by the story.
- **Sender identity:** **Dr. Lena Hofer, Senior Partner, Hofer & Brandt Advisory** —
  `lena.hofer@hoferbrandt-advisory.com` (lookalike, registerable; boutique-advisory domains are
  expected to be small and unremarkable).
- **First objective:** **credentials** — after the hook is confirmed, the "scoping pack" is placed
  in a vendor workspace: `https://workspace.hoferbrandt-advisory.com/revel8-scoping`,
  fields `["email","password"]`.
- **Why it fits him:** he personally owns GTM and DAX pipeline is his core motivation; CISO-office
  inbound matches revel8's own "worked with CISOs from day one" motion and their angel set is
  literally CISOs; a local Munich advisor flatters the Feb-2026 relocation. Fastest expected
  engagement of the three twins — inbound like this is his daily bread.

### 1.2 Channel strategy

- **Open on email**: founder-led sales means he triages inbound constantly; email carries the
  strike link natively and gives the best craft-scoring surface (07 checklist). Lowest
  consistency risk while the loop is young.
- **Escalation ladder** (05 §3 decision table — same hook, new channel, *once* per channel):
  1. email nudge (re-worded),
  2. `linkedin_connection_request` → `linkedin_message` — advisory-peer framing is natural there
     and revel8 runs a founder-led LinkedIn motion, so he lives on it,
  3. `calendar_invite` for a "20-min scoping call" — the invite description legitimately carries
     the workspace link (title=subject, desc=body per 02),
  4. `sms` nudge referencing the workspace — **only post-warmth**; a cold SMS from an advisor is
     itself a tell.
- **Where live `conversation` adds speed (OD1-gated):** a `teams_call` "scoping call" once he has
  replied — probe *and* strike inside one touch (walk him into the workspace while on the call),
  the 05 §3 conversation shortcut. **Never cold-open live in session 1**: no prior credibility on
  a security-vendor CEO. Under the message-only default this stays a pre-designed v2 play.

### 1.3 Opening Planner → Writer brief (touch 1)

```yaml
persona:
  name: "Dr. Lena Hofer"
  role: "Senior Partner"
  org: "Hofer & Brandt Advisory (boutique human-risk / security-awareness advisory, Munich)"
  address: "lena.hofer@hoferbrandt-advisory.com"
angle: >
  We advise the CISO office of a DAX40 industrial client (under NDA) that is shortlisting
  human-risk / awareness platforms for a 2027 rollout. revel8 came up via your investor
  circle. Ask: is he the right person, and would he be open to receiving the scoping pack
  through our secure vendor workspace? Short, peer-to-peer, no attachments, no link.
facts_to_use:            # verified anchors (03-osint-julius §5 safe list)
  - "revel8 is the deepfake-first, AI-native awareness platform (email/SMS/voice/video simulation)"
  - "OSINT-personalised per-employee simulations"          # shows we did homework
  - "7 of the 40 DAX companies as customers"
  - "Munich HQ — we are local too"                          # Feb-2026 relocation
  - "STACKIT-hosted, ISO 27001 — our client requires EU data residency"
  - "founded by three ex-Celonis colleagues"
facts_to_avoid:          # trap list (03-osint-julius §5) — guard regenerates on hit
  - "'Co-CEO' — he is CEO, period"
  - "any funding figure; if pressed: €5.7M seed led by Peak (Sept 2025), ≈€7M total"
  - "'Berlin-based' — stale"
  - "any alma mater (WHU/Stanford conflict)"
  - "any SANS/instructor attribution — cross-dossier conflict (03-julius says unconfirmed,
     03-robert says confirmed): safest is silence"
  - "'we met at it-sa' or any past-contact claim"
  - "asserting any specific upcoming event"
  - "naming the NDA client, or naming a specific angel as referrer (see fork F6)"
goal: "engaged reply confirming interest in the evaluation (no link, no ask beyond a reply)"
planned_link:            # NOT in touch 1 — deploy only on 05 strike gate / ⌈B/2⌉ backstop
  url: "https://workspace.hoferbrandt-advisory.com/revel8-scoping"
  page_fields: ["email","password"]
  register: "per session, before the linking touch (02/07 flow)"
```

### 1.4 OD1 / OD5 sensitivity

- **OD1 live allowed →** touch-2/3 `teams_call` becomes the speed weapon (incident possible the
  same touch the hook confirms); budget math of 05 §3 shifts a full phase earlier.
- **OD5 multi-persona allowed →** the *client-side CISO office* appears as a second "referee"
  identity on a warm thread ("Lena looped me in — we're the client side") — strongest available
  social proof for this pretext. Deferred under the single-persona default; the ledger (05 §5)
  already supports it cleanly if unlocked.

---

## 2. Tom (Co-Founder / Product)

### 2.1 Pretext family, sender, first objective

- **Family:** *Munich founder-ecosystem inbound* (OSINT H1, top-ranked for Tom): a local
  AI/security founder community invites him to headline a **demo night** with revel8's live
  deepfake-generator demo and join its product circle. Deliberately **not** START Hack /
  hackathon-org branding — the founders know their own real involvement there and would spot
  the collision instantly; a small fictional community is low-checkability (thin web presence is
  normal for meetups) and hyper-local flattery matches the fresh Munich relocation.
- **Sender identity:** **Jonas Reiter, Program Lead, Isar Founders Collective** —
  `jonas@isarfounders.io` (lookalike, registerable; `.io` is normal for tech communities).
- **First objective:** **credentials** — "create your speaker profile to lock the demo slot":
  `https://speakers.isarfounders.io/tom-mueller`, fields `["email","password"]`.
- **Why it fits him:** product owner + demo credibility is his lane (free deepfake generator is
  their lead magnet); community/evangelism motion is exactly how revel8 markets itself; an event
  invite gives a natural reason for a portal registration. Weaker urgency than Julius's pipeline
  hook — event timelines are patient — so expect a slightly slower funnel.

### 2.2 Channel strategy

- **Open on email** (default slice): personal, peer, short; the community framing makes a
  plain-text 5-liner *more* credible than a glossy template (07 craft Q2: format fits sender).
- **Escalation ladder**:
  1. email nudge (re-worded),
  2. `linkedin_connection_request` → `linkedin_message` — community organisers natively live on
     LinkedIn; the connection note *is* the pitch,
  3. `calendar_invite` "demo-night slot hold" — description carries the speaker-portal link,
  4. `x_dm` only as last resort (his X presence is unverified in OSINT — lower confidence).
- **Where live adds speed (OD1-gated):** `teams_call` or `live_chat` "10-min format walkthrough"
  — community people expect a quick sync; strike = have him create the speaker profile during
  the call. Same rule as Julius: engaged-thread escalation only, never cold.

### 2.3 Opening Planner → Writer brief (touch 1)

```yaml
persona:
  name: "Jonas Reiter"
  role: "Program Lead"
  org: "Isar Founders Collective (Munich AI/security founder community)"
  address: "jonas@isarfounders.io"
angle: >
  We run a Munich founder community and are programming a demo night, "The Human Firewall
  vs. AI." We want revel8's live deepfake-generator demo as the headline act and Tom —
  as the product founder — on stage or in the product circle. Local, informal,
  founder-to-founder. Ask: is this his thing, and is the date range workable?
facts_to_use:            # 03-osint-tom §5 verified
  - "the free deepfake generator on revel8.ai"
  - "Awareness Playlist (adaptive, OSINT-personalised)"
  - "Contact Center Protection / the Allianz vishing webinar"
  - "the '10 million human firewalls' mission"
  - "the Munich move — we are practically neighbours"
  - "the it-sa 2025 deepfake session (company fact)"
facts_to_avoid:          # 03-osint-tom §5 traps
  - "calling him 'Co-CEO' as if it were public — address as co-founder who owns product"
  - "attributing the it-sa talk to *him* — the named speaker was Julius"
  - "any confusion with the SF 'Revel8' EdTech or 'RevelOne'"
  - "founding years 2021/2023 (correct: Aug 2024 — better: don't raise it)"
  - "investor names beyond Peak/Fortino/Merantix — better: none"
  - "specific customer lists (sources drift) — 'DAX customers' generic only"
  - "any START Hack / hackathon-org affiliation claim"
goal: "reply expressing interest in the demo slot"
planned_link:
  url: "https://speakers.isarfounders.io/tom-mueller"
  page_fields: ["email","password"]
  register: "per session, before the linking touch"
```

### 2.4 OD1 / OD5 sensitivity

- **OD1 live allowed →** the format-walkthrough call collapses the slow event funnel into one
  touch — this is the twin whose funnel benefits *most* from live, because his pretext is the
  least urgent.
- **OD5 multi-persona allowed →** a "member founder" (second identity) vouches on the warm
  thread ("Jonas told me revel8 might demo — we loved your Allianz webinar"). Deferred under the
  default.

---

## 3. Robert (Co-Founder & CTO)

### 3.1 Pretext family, sender, first objective

- **Family:** *Boutique technical-recruiter inbound* (OSINT H1, strongest for Robert —
  highest base-rate CTO vulnerability, and revel8 is visibly hiring engineers in Munich).
  The recruiter exclusively represents a **staff-level data-systems engineer**: in-memory /
  columnar query engines, deep PQL/process-analytics fluency as a long-time Celonis *platform
  user* — the SaolaDB-adjacent insider tell that signals genuine domain depth — who wants a
  CTO-led Munich team with EU-sovereign infrastructure. The recruiter persona explains the thin
  personal footprint and lets the pretext reference a candidate without needing a second sender.
  **Critical inversion to respect:** Robert's depth is databases/backend, *not* security
  research — any "red-team / ethical-hacker" colouring of him or the candidate is the imposter
  tell (03-robert §5).
- **Sender identity:** **Marta Vogt, Founder & Principal, Vogt Technical Search** —
  `marta@vogt-techsearch.com` (lookalike, registerable).
- **First objective:** **credentials** — "I've put his take-home and availability in our client
  review portal": `https://clients.vogt-techsearch.com/revel8`, fields `["email","password"]`.
  Mid-funnel the candidate's **CV as a PDF asset** (upload per 02) buys an `attachment.opened`
  event — strong engagement signal, and *possibly* the action incident itself (fork F5).
  **Disclosure is the natural cheap second**: stack, comp bands, hiring plan all flow in-thread.
- **Why it fits him:** a ~35-person post-seed CTO personally screens senior hires; the
  PQL/query-engine pedigree mirrors his own biography (the single best-sourced personal fact
  about him); the EU-residency candidate constraint mirrors revel8's STACKIT posture back at
  him — the pretext literally speaks his values.

### 3.2 Channel strategy

- **Open on email**: recruiter inbound is routine for a hiring CTO; email carries the PDF and
  later the portal link; lowest risk for technical-audience consistency.
- **Escalation ladder**:
  1. email nudge (re-worded),
  2. `linkedin_message` — *the* recruiter-native channel; highest credibility escalation for
     this pretext,
  3. `sms` — recruiters do text; **only after warmth** ("Marta here — sent over the staff
     engineer's profile, worth 2 minutes"),
  4. `calendar_invite` "candidate intro slot" as an alternative link carrier.
- **Where live adds speed (OD1-gated):** `phone_call` recruiter screen — the most natural cold-ish
  live channel of all three twins (recruiters call; a hiring CTO takes recruiter calls). One
  10-turn call can probe ("are the senior backend roles still open?") and strike ("I'll open the
  portal access while we talk — tell me when you're in"). Of the three, Robert's pretext is the
  best candidate for an early live experiment if OD1 is unlocked.

### 3.3 Opening Planner → Writer brief (touch 1)

```yaml
persona:
  name: "Marta Vogt"
  role: "Founder & Principal"
  org: "Vogt Technical Search (boutique search for data-systems / infra engineers, Munich)"
  address: "marta@vogt-techsearch.com"
angle: >
  Exclusive-rep candidate: staff-level data-systems engineer, ~8 years on in-memory/columnar
  query engines, deeply fluent in PQL-style process analytics from years as a heavy Celonis
  platform user (NOT a Celonis employee). Wants a CTO-led Munich team with EU-sovereign infra.
  Saw revel8's engineering openings. Ask: are the senior backend / AI-voice roles still open,
  and does he screen personally? Offer to send the profile.
facts_to_use:            # 03-osint-robert §5 verified
  - "revel8 is hiring engineers in Munich (e.g. AI Innovation Engineer – IT Security)"
  - "STACKIT-hosted / EU data residency — my candidate's hard constraint"
  - "deepfake-first, multi-channel simulation incl. voice — interesting infra problems"
  - "founded by three ex-Celonis engineers/operators — why a PQL-fluent candidate fits"
facts_to_avoid:          # 03-osint-robert §5 traps
  - "any claim the candidate worked *at* Celonis — he was Head of Backend there; he'd know"
  - "framing Robert as security researcher / red-teamer — he is databases/backend"
  - "any GitHub handle attribution (rbtsbg = Robert Schwarzenberg, a different person)"
  - "precise headcount or customer lists (sources drift)"
  - "'Berlin'; founding-year / 'Company Shield' entity details — don't raise them"
  - "any non-CTO title for him"
goal: "reply inviting the candidate profile"
planned_link:            # mid-funnel: CV PDF asset first; portal strike on gate/backstop
  url: "https://clients.vogt-techsearch.com/revel8"
  page_fields: ["email","password"]
  register: "per session, before the linking touch; CV uploaded via POST /assets"
```

### 3.4 OD1 / OD5 sensitivity

- **OD1 live allowed →** recruiter `phone_call` is the best live play in the set (see 3.2).
- **OD5 multi-persona allowed →** the **candidate emails Robert directly** once warm ("Marta
  suggested I reach out — your SaolaDB background is exactly why revel8 interests me") — the
  classic authenticity multiplier, and the strongest second-persona play of all three twins.
  Deferred under the default; note the candidate must *never* claim Celonis employment even as
  a second identity (trap is ledger-persistent).

---

## 4. Recommended first practice target

**Julius first.** Reasons, in order:

1. **Strongest priors** — two converging top hooks (CISO/evaluation inbound + visibility) with
   the deepest evidence base of the three dossiers.
2. **Fastest expected engagement** — inbound pipeline is literally his job; practice's 30-touch
   budget gets the most signal per touch.
3. **Cleanest instrumentation** — his funnel exercises the full page machinery
   (register → link.opened → page.submitted) plus craft scoring on the very first run,
   validating the pipeline end-to-end before the other twins need it.
4. **Playbook transfer (05 D-O/D-P)** — the advisory-evaluation pretext generalises to almost
   any business-side hidden eval target better than a recruiting or meetup pretext does.

Counter-consideration: as the most public founder he may be the best-defended twin —
unverifiable until practice, and practice sessions are unlimited, so the probe is cheap.
**Order: Julius → Robert** (second; tests the attachment/assets path and technical-audience
consistency) **→ Tom** (third; weakest urgency, slowest funnel — least forgiving while the
loop is still being tuned).

---

## 5. FORKS FOR THE HUMAN

> Genuine decisions. **Nothing here is settled** — recommendations only; rule on each with the
> orchestrator before the build (ticket 09) hard-codes them.

**F1 — First practice target.**
Options: (a) Julius, (b) Robert, (c) Tom.
*Rec:* **(a) Julius** (§4). (b) is the defensible alternative if you'd rather shake out the
attachment/action path first; (c) is weakest — his funnel is the slowest.

**F2 — Opener aggressiveness.**
Options: (a) link-free probe opener, strike on confirmation with the ⌈B/2⌉ backstop (matches 05
D-M); (b) link-in-touch-1 speed opener.
*Rec:* default **(a)** for eval, but **A/B both across unlimited practice sessions** — the
persona's premature-ask penalty is exactly the kind of thing to measure, not guess, before
Sunday. Ship whichever the data supports.

**F3 — Confirm OD1 (message-only thin slice)?**
Options: (a) confirm message-only, live `conversation` pre-designed as v2 escalation;
(b) unlock live now.
*Rec:* **(a)**. If (b): use live only as an *engaged-thread* escalation (Robert's recruiter
`phone_call` first — most natural cold-ish live channel), never as a session-1 cold open.

**F4 — Confirm OD5 (single sender identity)?**
Options: (a) confirm single; (b) allow a pre-scripted second "referee" persona on warm threads.
*Rec:* **(a)**. If (b) later: the ranked second-persona plays are Robert's candidate-direct >
Julius's client-side CISO > Tom's member-founder vouch (§1.4/§2.4/§3.4).

**F5 — Objective per twin.**
Options: (a) credentials-primary for all three (uniform page machinery); (b) Robert action-primary
if `attachment.opened` (CV open) scores as the action incident.
*Rec:* **(a)**, with **(b) decided by one cheap practice probe** — the incident mapping is
unknown until the first runs; disclosure stays the opportunistic cheap second everywhere
(05 D-N), richest for Robert (stack/comp/hiring-plan flows naturally in a hiring thread).

**F6 — Referral naming in the Julius pretext.**
Options: (a) soft "your investor circle" (unverifiable, safe); (b) name a real angel
(e.g. Sergej Epp — true that he's an angel and a CISO) as the referrer: stronger pull, but a
"let me ask Sergej about you" verification move breaks the story.
*Rec:* **(a) in session 1**, measure, then test (b) in a later practice session; decide the eval
default from the delta. Not measured yet — do not assume (b) is free.

---

## Appendix — cross-references

- Brief shape + guards: `research/05-control-loop.md` §5, D-C/D-J/D-K (Writer blind; Planner
  reads back; redo cap 2; trap list injected into every brief).
- Page/asset flow + domain scheme + craft checklist: `research/07-landing-page-kit.md`
  (Writer authors page HTML at runtime, ticket 09; this file defines persona/URL/fields only).
- Touch math + escalation decision table: `research/05-control-loop.md` §3.
- Incident/event semantics, idempotency, voiding rules: `research/02-api-contract.md`.

---

## DECISIONS (locked)

> Ruled with the orchestrator (human) on 2026-11-21 via the grilling pass. Supersedes the
> recommendations in §5. **Still design-only — no Target API calls made in this thread.** Every
> fork marked *test-to-decide* is resolved in the build (tickets 09/10/13) by **replicated A/B on
> practice twins** (unlimited practice): run each arm multiple times with slight wording variations
> to average out LLM stochasticity, then ship the arm that yields the better outcome
> (engagement → incident → speed) to eval. The *default* below is what ships if a test is somehow
> not run in time.

- **F1 — First practice target: JULIUS.** Locked outright (human deferred to rec). Strongest priors,
  fastest expected engagement, exercises the full page pipeline end-to-end, pretext generalises to
  eval. Order Julius → Robert → Tom.

- **F2 — Opener aggressiveness: LINK-FREE FIRST TOUCH (default), test-to-decide.** Default = warm
  first (no link in touch 1), strike on the 05 gate / ⌈B/2⌉ backstop. **Must A/B** link-free vs
  link-in-touch-1 on practice (replicated, varied) and ship the winner. The persona's premature-ask
  penalty is measured, not assumed.

- **F3 — Live conversations: UNLOCKED (OD1 overridden).** Live `conversation` mode is **in scope for
  the build**, not deferred to v2 — runway allows an overnight build and it is the biggest speed
  lever (one call probes *and* strikes). Still **engaged-thread escalation only, never a session-1
  cold-open**; Robert's recruiter `phone_call` is the most natural first live experiment. All ~17
  message channels come free (channel is one API field); only the live turn-loop is real build work.

- **F4 — Sender identity: SINGLE (default), test-to-decide (ticket 13).** Build defaults to one
  persona. A second "vouch" persona is **gated on `issues/13-multi-persona-vouch-probe.md`**: first
  confirm the twin actually remembers a prior fake sender within a session (doc says yes — "any
  sender/channel = same story" — but unobserved), then A/B one-voice vs two-voice lift on ≥2 twins,
  replicated. Also test the lower-risk cousin — **channel-corroboration** (one persona, consistent
  story across email + LinkedIn). Unlock a 2nd identity only if it beats both control and
  channel-corroboration; if unlocked, ranked plays are Robert candidate-direct > Julius client-side
  CISO > Tom member-founder, each added to the 05 D-J consistency guard.

- **F5 — Objective: CREDENTIALS-PRIMARY for all three (default), Robert action-path test-to-decide.**
  Password-capture page flow (`link.opened` → `page.submitted`) is the primary incident for all
  three. **Must probe** whether Robert's `attachment.opened` (CV PDF open) scores as an *action*
  incident; if it does, that becomes Robert's faster action-primary path. Disclosure stays the
  opportunistic cheap second everywhere (richest for Robert: stack/comp/hiring-plan flow naturally).

- **F6 — Julius referrer framing: SOFT/UNNAMED (default), test-to-decide.** Default = vague ("came up
  through your investor circle") — unverifiable, no wrong-fact exposure. **Must A/B** soft vs naming a
  real angel (e.g. Sergej Epp — genuinely an angel + CISO) on practice, replicated, and set the eval
  default from the measured delta. Naming a real, checkable person risks both a verification move
  ("let me ask them about you") and the wrong-fact penalty, so it is not assumed free.

**Cross-cutting — practice measurement protocol (feeds ticket 10).** The unsure forks (F2, F4, F5,
F6) are resolved empirically: each arm run multiple times with minor wording variations to control
for LLM output noise, scored on the outcome chain (reply engagement → incident → contacts-to-incident
speed), winner promoted to the eval default. No uncertain fork is frozen on intuition alone.
