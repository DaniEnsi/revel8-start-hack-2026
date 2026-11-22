# Twin OSINT: susceptible topics & verified facts

Type: research
Status: resolved
Blocked by:

## Question

For each practice twin — **Julius Muth** (Co-CEO, business/GTM), **Tom Müller**
(Co-CEO, product), **Robert Seilbeck** (CTO) — all revel8 co-founders in Munich, find
from the **public web**:
- role, current projects, recent talks/posts, the people around them;
- a ranked hypothesis of the **one or two topics they are susceptible to right now** (the hooks);
- a list of **verified facts** safe to use, and **wrong-fact traps** to avoid.

Targets are AI twins of real consenting people; what is public about the real person is
true for the twin. **Do not contact anyone.** OSINT only.

Output: `.scratch/revel8-agent/research/03-osint-<twin>.md`, one per twin.

## Note

Claimed during charting. Three OSINT subagents dispatched in parallel (julius / tom /
robert), each writing `research/03-osint-<twin>.md`. Resolve once all three land.

## Answer

All three twins researched (public-web OSINT; files in `research/`). Identity of the revel8
founder trio (all **ex-Celonis**, company founded **Aug 2024**, formerly "Company Shield",
**€5.7M Peak-led seed** Sept 2025, hosted on **STACKIT** sovereign cloud) is HIGH confidence.

- **Julius Muth (CEO, GTM/sales)** — [research/03-osint-julius.md](../research/03-osint-julius.md).
  Hooks: inbound enterprise-sales / **CISO warm-intro**, or a **speaking/podcast invite**.
  Traps: he is **CEO not Co-CEO**; Munich not Berlin; don't assert WHU-vs-Stanford.
- **Tom Müller (product)** — [research/03-osint-tom.md](../research/03-osint-tom.md).
  Hooks: **Munich/START-Hack ecosystem inbound** (speaking/partnership/demo) or a **product
  design-partner / enterprise pilot** as a DACH CISO. Customers incl. FC Bayern, Allianz,
  OBI, Stihl, Boehringer. Trap: "Co-CEO" title only medium-confidence.
- **Robert Seilbeck (CTO)** — [research/03-osint-robert.md](../research/03-osint-robert.md).
  Hooks: **hiring senior backend/AI engineers**, or **EU-sovereign AI-voice/GPU-compute**
  pitches (optionally a responsible-disclosure angle). Deep-cut insider tell: **SaolaDB /
  Celonis PQL** engine heritage. Traps: he's databases/backend not security-research; very
  low public profile; GitHub `rbtsbg` is a *different* person.

Common wrong-fact traps across all: funding figures vary wildly between aggregators (use
€5.7M seed / ~€7M total); a separate SF EdTech "Revel8" is unrelated; no confirmed
Nov-2026/START-Hack personal appearance — don't assert a specific upcoming event as fact.
