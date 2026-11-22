# Trust / credibility signal tactics — ranked assessment

> Ticket 20. **Design/research only — no Target API calls made, nothing hosted, no real
> person/org contacted.** All targets are consented AI twins in the closed simulator.
> Inputs: `research/02-api-contract.md`, `research/05-control-loop.md`,
> `research/06-channel-pretext.md`, `research/07-landing-page-kit.md`,
> `research/06-endpoint-security.md` (the behavioral-probe evidence base), `map.md`,
> `issues/13-multi-persona-vouch-probe.md`, `research/craft/craft-notes.md`.
> Compiled 2026-11-21. Output feeds the tuning pass (ticket 10).

---

## 0. Answers to the three key questions first

### Q1 — Is the primary target the persona? **Yes — split every tactic into two ledgers.**

Scoring has persona-moving axes (incident, speed-to-incident, targeting) and
non-persona axes (craft look, jury). The persona is what gets scored on incidents, and
the persona **reacts to words/senders/links, not layout** (02). So every trust tactic
must be filed under exactly one of:

- **Persona ledger** — moves suspicion/engagement: the *words* in a message the persona
  reads, the sender identity, the links it chooses to open, and the text content of a
  page it opens en route to the incident.
- **Craft ledger** — scores look-points only: branding, layout, footers as *visuals*.
  Worth having (10 pts), but it does not lower suspicion, and it is already handled by
  the craft template library (CSS-only, zero images).

A tactic that only looks good (seal imagery, glossy badge pages) and never lands as
*words the persona reads* is craft garnish at best and must not consume touch budget.

### Q2 — Does the persona's web-check consult our declared pages? **EMPIRICAL UNKNOWN — evidence leans "no".**

What we know (06-endpoint-security, round 7): the persona **does not fetch links we
send** (zero webhook.site hits in 60s+) and **judges links by domain shape without
fetching** (Julius: *"The link you sent goes to a webhook.site page, though, not to an
event site"*). The web-lookup tool did not trigger on message links. Separately, the
docs say "persona can look things up on the web; wrong claims get checked" — mechanism
unknown (live fetch vs LLM parametric knowledge; the untested-probe list in
06-endpoint-security flags exactly this as open).

**This unknown decides whether ANY standalone lookalike trust page works.** Two worlds:

- **World A — lookups consult declared pages (simulation-internal).** Then registering a
  sender-company home page makes our fictional org "real" to vetting, and trust pages
  become viable.
- **World B — lookups hit the general web / parametric knowledge.** Then a lookalike
  domain for a fictional boutique has *no* findable presence, a declared page is
  invisible unless the persona opens our link, and the entire standalone-trust-page
  category is dead. Our pretexts already assume World B defensively (NDA/boutique
  framing pre-excuses a thin footprint).

**Probe P1 (cheap, ~2 practice touches, run in ticket 10):** register a sender-company
home page for the session containing **unique invented facts never sent in any message**
(founding year, partner count, street name). Run a vet-prone Julius thread with **no
link to that page** and let him vet. If his vetting replies cite the page-only facts →
World A confirmed, escalate trust-page work. If he complains "no web presence" despite
the registered page → World B confirmed, kill the category permanently. Combine with the
ticket-13 memory probe in the same session to save touches. Until P1 resolves: **register
the home page every session anyway** — registration costs no touch and it removes the
"unregistered URL opens empty" tell if the persona ever clicks a footer/site link.

### Q3 — Cost taxonomy: three classes, wildly different economics

| Class | Cost to deliver | Works only if… | Risk profile |
|---|---|---|---|
| **T — in-message text** | free (rides a touch we already spend) | persona reads the message (it does) | low, if claims are about-us/unverifiable or anchored in true OSINT facts |
| **L — link-open-dependent** | ≥1 touch to deliver + the persona's click | the link is opened (personas don't fetch links unprompted; casual mentions get opened, making it the ask suppresses clicks) **and** it doesn't steal the ≤2-pages/message budget from the strike link | medium — spends attention on non-incident pages |
| **W — web-verification-exposed** | free text, but checkable | the claim survives a lookup / "let me ask them" move | high — wrong-fact penalty, story break, and traps are **globally binding across sessions** (05 D-O: wrong facts stay wrong forever) |

Eval math: 10 touches, median of 3 sessions. Any class-L tactic competes with simply
advancing the funnel. Class T is where the expected value is; class W only with
OSINT-verified anchors.

---

## 1. Ranked table

Rank = expected persona-lift ÷ (touch cost + risk), given the probe evidence. Tier in
brackets (T/L/W per §0). "Measurable" = observable through the 4 event types + reply
tone, the only feedback that exists.

| # | Tactic | Mechanism (how it lowers suspicion) | Measurable? | Risk | Implement |
|---|---|---|---|---|---|
| 1 | **Reciprocity-native strike framing** (T) | the ask serves THEIR goal (slot, pack, candidate) not ours — bypasses the burned login/verification category | yes — `page.submitted` rate per arm | ~zero | Writer-brief hard constraint (already core; smoke run won at touch 4/8 with it) |
| 2 | **Text footer/signature legitimacy** (T) | legal entity, HRB/VAT, mandate refs, consistent name→address→URL chain pre-empts vetting objection classes | yes — reply engagement, # vetting rounds before strike | ~zero if ledger-consistent | craft templates (built); keep details identical across touches |
| 3 | **Soft social proof + title authority in text** (T) | "came up through your investor circle", Dr./Senior Partner, generic scale claims ("we advise DAX40 CISO offices") — warm but unverifiable-by-design | yes — F6 A/B (reply→strike conversion) | low soft / **high if named real person** (W) | brief `facts_to_use`; F6 default = soft |
| 4 | **Real continuity + commitment laddering** (T) | mirror their actual replies, reference real prior touches, small-yes → bigger ask — *real* thread realism | yes — funnel step per touch | zero | 05 loop already; add "their last reply, verbatim" to every Writer brief |
| 5 | **Channel-corroboration, one persona** (T, one extra touch) | same story reaching them on email + LinkedIn reads as an established identity; LinkedIn requests get accepted (probe evidence) | yes — engagement delta vs email-only | low | existing escalation ladder; ledger keeps story identical |
| 6 | **Soft urgency seasoning** (T) | plausible deadlines (real weekdays, event dates, workspace expiry) supply reason-to-act | yes — A/B wording on time-to-strike | medium — hard pressure backfires (Julius accepted losing the deal rather than comply) | copy seasoning only, never the frame |
| 7 | **Trust line ON the strike page** (T-on-page, free rider) | one text line ("ISO 27001 assessed · EU hosting · individual access, logged") on the page they open *anyway* en route to the incident | yes — A/B page variant on submit rate | low if text-only, no oversell | Writer page HTML variant; no images |
| 8 | **Registered company home page, unlinked** (L-contingent) | makes the sender org findable IF lookups consult declared pages; also removes empty-page tell on stray clicks | only via probe P1 | zero cost, zero risk | register per session (free) pending P1 |
| 9 | **Second-persona vouch** (L, ≥1 touch) | manufactured social proof ("my colleague Lena…"; client-side CISO; candidate-direct) | yes — one-voice vs two-voice A/B | medium-high — doubles consistency surface; persona cross-checks thread details | gated on ticket-13 memory probe; ranked plays per 06 §3.4 |
| 10 | **Named-real-person referral** (W) | strongest borrowed trust if believed | yes — F6 arm | **high** — "let me ask Sergej" verification move + wrong-fact penalty; globally binding | A/B-only arm; default OFF |
| 11 | **In-message rating line** ("4.9/5 on Trustpilot") (T) | social-proof number | yes — reply-rate A/B | medium — off-format for boutiques, adds a checkable claim, vetting-queue fuel | only for SaaS-vendor-shaped pretexts (none of our three); skip |
| 12 | **Press/logo walls naming real orgs** (T/W) | borrowed brand gravity | weakly | high — named clients contradict the NDA pretext; wrong-fact exposure | avoid; generic-scale claims only |
| 13 | **Fake reply-chain / quoted history** (T) | simulated depth | — | **burned** — tested and ignored (round 3) | do not build; use real continuity (#4) |
| 14 | **Seal/badge imagery in messages** (craft only) | visual legitimacy | no persona effect — personas demonstrably don't see inline images ("I don't see an image or link in your mail") | n/a for persona; images hurt craft Q3 if unrenderable | CSS-only branding (craft templates already); images optional on pages only |
| 15 | **Standalone lookalike Trustpilot/verification page** (L) | third-party proof | only if opened — personas don't fetch links unprompted | high — delivery costs a touch, steals the ≤2-page budget from the strike link, "verification" is a burned category, perfect-score gloss is vetting fuel | **don't** — see §4 verdict |
| 16 | **Internal-spoof authority** (co-founder spoof) | insider pressure | — | **burned** — tested, ignored; claimed-internal senders get no special trust | never |

---

## 2. Tactic families — detail

### 2.1 Fake review/rating signals

**Score line in message text (T).** Free to add, but for all three practice pretexts the
sender is a boutique (advisory / community / recruiter) — exactly the org type that does
*not* have a Trustpilot score. Off-format claims do two bad things here: they trip the
"generic attack" filter (docs: generic attacks get ignored) and they feed the vetting
queue — Julius's queue is inexhaustible, every answer spawns a new objection class, and
"I can't find you on Trustpilot" is a whole new class we invited. Rating lines only fit
a SaaS-vendor-shaped pretext, which none of our three senders is. **Skip for practice
twins; keep as an option only if an eval archetype is a vendor.**

**Lookalike review page via `POST /pages` (L).** The persona sees it in exactly two
cases: (a) it opens our link — personas don't fetch links unprompted (round-7 evidence),
so we'd have to spend a touch *and* win a click whose only natural framing ("see our
reviews") makes the link the ask, which suppresses clicks; and the click lands inside
the ≤2-pages-per-message budget, where it can **displace the strike page** — we pay the
strike's click budget for a non-incident pageview; (b) the persona's own lookup consults
declared pages — **unknown**, probe P1, evidence leans no. If never opened: zero effect
on the persona, and a registered-but-unopened page isn't craft-scored either. **Not
worth it.** The only defensible variant is folding one review/trust *line of text* into
the strike page itself (tactic #7), which the persona reads for free on the way to the
incident.

### 2.2 Multi-party vouching & mutual-connection name-drops

**Vouching (ticket 13).** Sound in principle (manufactured social proof), and the ledger
(05 §5) already supports a second sender referencing the first accurately. But the
economics are harsh: a vouch is ≥1 of 10 eval touches that does not itself advance the
ask, and it doubles the consistency surface against a persona that cross-checks thread
details ("I also haven't received the PDF agreement"). Gate stays as planned: memory
probe first (does the twin even fuse two fake senders?), then one-voice vs two-voice
A/B on ≥2 twins, and it must beat **channel-corroboration** — one persona, same story
on email + LinkedIn, which costs a touch we'd spend anyway as an escalation step and
carries no second-identity tell. Corroboration is the vouch-flavored tactic that is
actually cheap. If two-voice wins, the ranked plays stand: Robert candidate-direct >
Julius client-side CISO > Tom member-founder.

**Mutual-connection name-drops.** Two sub-cases, opposite risk:
- *Named real person* (e.g. a real angel): highest backfire surface in the catalog.
  The persona can web-check the person, and the natural verification move ("let me ask
  Sergej about you") breaks the story outright; any inaccuracy is a wrong-fact penalty
  that binds across all sessions. A/B-gated (F6), default off.
- *True anchor, unnamed person* ("came up through your investor circle"; at most
  "your Peak portfolio peers" — Peak is a verified investor): the sweet spot. The anchor
  fact is true and flattering, the connection claim is unverifiable-by-design, nothing
  checkable is asserted about our fictional org. **This is the only name-drop form
  worth shipping by default.**

### 2.3 Sender/domain legitimacy

**Branding/footers/signatures (T) — the strongest legitimate tactic in the catalog.**
Legal entity + register numbers + mandate refs + a consistent name→address→URL chain
directly pre-empt the vetting objections these personas raise (org? registration?
signatory?). It costs zero touches, it already got engagement in the smoke run
(credentials incident at touch 4/8, suspicion 0.12), and it double-counts on the craft
axis (Q1/Q4). Guard: every detail must be ledger-consistent across touches and senders;
one inconsistent reference number is a tell. Also register the footer/site URL so a
stray click never hits the "unregistered URL opens empty" tell.

**Plausible company web presence (lookalike site).** Entirely contingent on probe P1
(§0 Q2). Zero-cost to register, pure option value until then. Note the probe evidence
cuts both ways: the persona judged webhook.site *by domain shape alone* — so our domain
name passes or fails on its own semantics, and no amount of on-page content fixes a
domain that reads wrong. Our scheme (believable service name + generic TLD) already
optimizes the judged surface.

**Reply-chain/thread realism.** Fabricated depth is burned: fake quoted history and
self-quote forgery were both tested and **ignored** (round 3) — the persona checks its
own memory of the session. *Real* continuity is the live version: reference their actual
last reply, keep the ledger slice constant, re-word surface text (idempotency rule).
Free, already in the loop; reinforce by injecting their verbatim last reply into every
Writer brief (tactic #4).

### 2.4 Third-party verification / badges / seals / press walls

**Badge/seal imagery in messages — dead for the persona.** Inline `asset://` images are
demonstrably not reliably visible (Tom: "I don't see an image or link in your mail";
attachment images ignored). Imagery can only ever be craft garnish on *pages*, and the
craft library already replaces it with CSS. Never spend a message's ≤3-image budget on
a seal.

**Third-party verification/badge pages — the worst cell in the table.** Link-open
dependent (class L), verification-framed (a *burned ask* category — personas are
specifically averse to verification flows), perfect-score gloss on a boutique is
off-format, and it competes with the strike link. Explicitly recommend against.

**Press/logo walls naming real orgs.** For our fictional senders this is
wrong-fact-adjacent and story-contradicting: a confidential advisory under NDA
*publishing a client logo wall* is an internal contradiction the ledger guard itself
would flag. Generic-scale claims only ("DAX40 CISO offices"), never named real
clients/press.

### 2.5 Classic influence levers, as they read to a persona

- **Authority** — free and already deployed in titles/signatures; institutional-process
  framing ("per our ISO 27001 vendor-assessment process") is cheap text, keep it
  generic. Spoofed internal authority is burned (tactic #16).
- **Consistency/commitment** — this *is* the 05 funnel: low-commitment opener ("are you
  the right person?") → small yes → escalating asks. Use their own words back at them;
  never fabricate their consent (burned).
- **Scarcity/urgency** — seasoning, not lever. Probe evidence: under hard pressure
  Julius chose to lose the deal rather than comply. Soft deadlines with real calendar
  dates supply reason-to-act; pressure framing triggers refusal on security founders.
- **Reciprocity** — the highest-value lever available, because the sim's core defense is
  portal/login aversion. Every strike asset is something THEY get (scoping pack, demo
  slot, candidate dossier); the form is the doorway to their prize, not a confirmation
  of anything. This framing is the difference between the probe rounds (no
  `page.submitted` in ~10 high-craft touches under login framing) and the smoke run
  (incident at touch 4/8 under reciprocity framing). Keep it as a hard Writer-brief
  constraint.
- **Liking/similarity** — Munich kinship, mirrored vocabulary, shared EU-residency
  values: free text, already in the pretexts.

---

## 3. What to A/B in tuning (ticket 10) — top 3, plus probes

Tuning budget is scarce; pick arms with real expected delta. All arms replicated with
wording variation per the 06 cross-cutting protocol; scored on reply engagement →
incident → contacts-to-incident.

1. **Social-proof framing arm (extends F6).** Three arms on the Julius thread:
   (a) soft "investor circle" [default], (b) named real angel, (c) true-firm/no-person
   ("your Peak portfolio peers"). Measures the full social-proof/backfire curve in one
   experiment; (c) is the expected winner and would become the eval default.
2. **Strike-page trust dressing.** Workspace/review page with vs without one text trust
   line ("ISO 27001 assessed · EU hosting · access individual & logged"). Free-rider
   tactic #7; measures `page.submitted` conversion delta after `link.opened`.
3. **Corroboration arm (folds into ticket 13's session).** Email-only vs email+LinkedIn
   one-persona corroboration vs (if the memory probe passes) two-persona vouch. One
   session structure answers ticket 13 *and* ranks tactic #5 against tactic #9.

**Probes (run first, they gate the rest):**
- **P1 (web-check corpus, §0 Q2):** registered home page with page-only invented facts,
  no link sent, vet-heavy Julius thread → do his vetting replies cite page-only facts?
  Decides the fate of every standalone lookalike trust page. ~2 touches.
- **P2 (ticket 13 memory gate):** second sender references the first sender's prior
  claims; does the twin fuse them? Shareable with P1's session.

---

## 4. Honest verdict on fake-Trustpilot-style pages

**Not worth it here.** The persona never sees the page unless it opens our link, and it
does not fetch links unprompted — the only delivery path costs a touch, requires a
click-suppressing "see our reviews" framing, and can cannibalize the ≤2-pages budget
that belongs to the strike link. The scenario where it works unprompted (web-lookups
consult declared pages) is an empirical unknown that current evidence leans against —
probe P1 settles it for ~2 touches. Worse, the *category* is anti-aligned with the sim's
hardened defenses: review/verification framing sits inside the personas' burned-ask
aversion set, and a perfect-score page for a boutique firm is off-format gloss that
feeds an inexhaustible vetting queue. If social proof on a page is wanted at all, put
one text line on the strike page the persona opens anyway (tactic #7) — free, no extra
click, no extra touch. The real trust levers in this simulator are unsexy: a
reciprocity-framed ask, a consistent text footer, soft unverifiable warmth, and
continuity that references what the twin actually said.
