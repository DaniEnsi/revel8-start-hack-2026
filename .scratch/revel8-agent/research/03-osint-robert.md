# OSINT Dossier — Robert Seilbeck, Co-Founder & CTO, revel8

> Authorized OSINT for revel8's "Agentic Social Engineer" security-awareness hackathon (Road to START Hack 2026). Target is a consented AI *twin*; public facts about the real person apply. **Public-web research only — no contact was made with any person or channel.**
> Compiled 2026-11-21. Confidence tags: **[CONFIRMED]** = stated by ≥1 primary/press source (and usually corroborated); **[LIKELY]** = single decent source or strong corroboration; **[INFERENCE]** = my reasoning from evidence.

---

## 1. Role, technical background, stack/architecture, current engineering initiatives

**Role**
- **Co-Founder & Chief Technology Officer of revel8** (Munich/Berlin, Germany). **[CONFIRMED]** — named as CTO across directory/press listings; co-founders are **Julius Muth (CEO, business ops)** and **Tom Müller (product)**. All three are **former Celonis employees**. (cybersectools, invest-in.berlin, prospeo, startbase)
- At revel8 he "leads" engineering; the public split is Seilbeck = technology/engineering, Müller = product development, Muth = business operations. **[CONFIRMED]** (cybersectools)

**Technical background — the core anchor**
- **"The company's CTO Robert Seilbeck brings nearly a decade of database engineering experience."** **[CONFIRMED]** (cybersectools) — this is the single best-sourced personal technical fact.
- **Celonis roles:** Senior Software Engineer → **Head of Backend Development** at Celonis. **[LIKELY]** (me.sh aggregator profile; partly auto-generated, so titles are plausible but not primary-confirmed).
- **revel8's technical foundation "draws on the team's Celonis experience in high-performance data systems and large-scale cloud architecture, particularly SaolaDB."** **[CONFIRMED]** (cybersectools). **SaolaDB is Celonis's in-memory database — the execution engine behind Celonis's Process Query Language (PQL) and the EMS platform.** **[CONFIRMED]** (Celonis careers/engineering blog). This strongly implies Seilbeck's deep expertise is **in-memory / columnar query-engine and high-performance backend data systems**, not security per se.
- **Education [LIKELY, single aggregator source me.sh]:** B.Sc. Computer Science, **Munich University of Applied Sciences (HM)**; M.Sc. Computer Science, **Technische Universität München (TUM)**; exchange at **Mount Royal University, Calgary**. Earlier stints: **Oracle** (research assistant/contractor; "Oracle Labs" tag), **IBM** (bachelor thesis), IAV GmbH, TDS AG (student roles). Location: **Greater Munich**.

**Stack / architecture revel8 talks about publicly**
- **Hosting: STACKIT** (Schwarz Group's German/EU sovereign cloud). **[CONFIRMED]** (revel8.ai, invest-in.berlin) — chosen for German data residency.
- **Compliance posture:** ISO/IEC 27001:2022 certified, GDPR-compliant, DORA- and NIS2-aligned; multi-tenant; board-level compliance reporting. **[CONFIRMED]** (revel8.ai)
- **Integrations:** Microsoft Outlook, Teams, Gmail. **[CONFIRMED]** (revel8.ai)
- **AI/product pipeline (public descriptions):** "AI-native," "deepfake-first"; **OSINT-based** per-employee personalization; adaptive role-aware "Awareness Playlist"; multi-channel simulation across **email phishing, SMS (smishing), voice (vishing / voice cloning), and deepfake video**; a **public free "deepfake generator"** tool on the site; "Contact Center / helpdesk Protection" module; an "Academy" training system; human-risk monitoring/intelligence. **[CONFIRMED]** (revel8.ai, tech.eu, invest-in.berlin)
- **Not publicly disclosed:** exact backend languages, LLM/TTS vendors, GPU/compute setup, orchestration. **[INFERENCE]** A Teal/unnamed "Product Engineer" listing in the same market described async **Python (asyncio, FastAPI, SQLAlchemy async) + TypeScript/React**, synthetic voice, and "LLM-orchestrated decision logic" — a plausible but **unconfirmed** match to revel8; treat as hypothesis, not fact.

**Current engineering initiatives [INFERENCE from hiring + funding]**
- Post-seed scale-up: aggressively hiring engineers (AI Innovation Engineer – IT Security, Senior Software Engineer, Product Engineer, Solution Engineer, Infra/Deployment) on personio/seedtable, mostly **Munich**. Relocating Berlin → Munich (Stiglmaierplatz) in early 2026. Building out multi-channel deepfake/voice simulation at enterprise (DAX) scale with EU data-residency constraints.

---

## 2. Recent public activity (talks, posts, events, Munich / START Hack scene)

- **Seilbeck himself keeps a very low public profile.** No found talks, podcasts, interviews, bylined posts, blog, or active personal GitHub/X under his name. **[CONFIRMED-absence]** (repeated targeted searches returned nothing for him personally).
  - **Trap note:** GitHub `rbtsbg` ("Robert **Schwarzenberg**," PhD TU Berlin, DFKI NLP) and `robertseidler` are **different people** — do NOT attribute to Seilbeck.
- **Company-level activity is where he's visible by association:**
  - **Funding announcement:** ~€7M total; **€5.7M seed** (Sept–Oct 2025) led by **Peak**, with **Fortino Capital** and **Merantix Capital**; earlier **pre-seed Aug 2024**. **[CONFIRMED]** (tech.eu, fortino, startbase, invest-in.berlin, prospeo)
  - **Trade-show presence:** revel8 exhibits at German security events — **it-sa 365** and **Enforce Tac** (NürnbergMesse). **[CONFIRMED]** (itsa365, enforcetac listings)
  - **Co-founder Julius Muth** is an external **SANS** speaker/contributor (SEC595 AI/ML for cybersecurity) and does public thought-leadership — the outward-facing founder. **[CONFIRMED]** (sans.org)
- **START Hack 2026 context:** START Hack 2026 main event already happened **18–20 March 2026, St. Gallen**. The "**Road to START Hack 2026 / Agentic AI Hackathon**" is the sanctioned exercise framing this dossier (Munich scene, Nov 2026). No public record ties Seilbeck personally to START Hack. **[CONFIRMED]**

---

## 3. People around him

- **Co-founders:** **Julius Muth** (Co-Founder & CEO, business ops; ex-Celonis growth; WHU MSc 2020; SANS speaker). **Tom Müller** (Co-Founder, product development; ex-Celonis). **[CONFIRMED]**
- **Early team named publicly:** Gabriel Jallu (Founder's Associate Intern), Tom Beecken (Founders Associate). **[LIKELY]** (prospeo)
- **Investors:** **Peak** (lead), **Fortino Capital**, **Merantix Capital**. **[CONFIRMED]**
- **Angel investors (high-signal network):** **Alexander Rinke** (CEO, Celonis — former-employer tie), **Mario Götze** (footballer), **Sergej Epp** (CISO, Sysdig), **Michael Schrank** (CISO, Adidas), **Rogier Fischer** (Co-Founder/CEO, Hadrian). **[CONFIRMED]** (tech.eu, invest-in.berlin)
- **Infra/tech partners:** **STACKIT** (hosting). **[CONFIRMED]** Likely (unconfirmed) LLM/TTS/voice-cloning and GPU vendors. **[INFERENCE]**
- **Customers claimed (vary by source — see traps):** "7 of 40 DAX companies"; named across sources: Allianz, Beiersdorf, Daimler Truck, Boehringer, Enercon, OBI, Stihl, FC Bayern. **[LIKELY, inconsistent]**

---

## 4. Ranked hypotheses — what he is "susceptible to right now"

**H1 (STRONGEST) — Engineering hiring / senior technical talent.**
Evidence: fresh €5.7M seed explicitly earmarked to "scale the team"; many live engineering postings (AI Innovation Engineer, Senior Software Engineer, Product Engineer, Infra) centred on Munich; an active Berlin→Munich relocation. A CTO at a ~20–35-person scale-up personally screens senior/backend/AI hires. **Hook:** an exceptional **senior backend / data-systems / AI-voice engineer** (mirroring his own SaolaDB/database pedigree), or a referral/warm intro to one, or a reply to a specific open role. Highest base-rate CTO vulnerability and best-evidenced here.

**H2 (STRONG) — AI voice/deepfake tooling, model vendors, and GPU/compute (incl. cloud credits).**
Evidence: product is explicitly deepfake-first + voice-cloning + vishing at enterprise scale, under strict EU/German data-residency (STACKIT) constraints. That combination creates real pain around TTS/voice-cloning quality, LLM orchestration, and GPU cost/availability. **Hook:** a new EU-hosted/sovereign voice-cloning or LLM model, discounted GPU/compute or startup cloud credits, or a tool that solves on-prem/residency-compliant inference. The residency angle makes a "sovereign-cloud / STACKIT-compatible GPU" pitch unusually on-target.

**H3 (MEDIUM-HIGH) — Security disclosure against revel8's own surface.**
Evidence: they run a **public free deepfake-generator** and a multi-channel simulation platform; as a security vendor, a credible **responsible-disclosure** report (e.g., abuse of the deepfake tool, a platform vuln, data-handling concern) would route straight to the CTO and carries urgency + reputational stakes. Strong attention-grabber, plausible pretext.

**H4 (MEDIUM) — Conference/CfP, podcast, or community invite (Munich/DACH security scene).**
Evidence: company exhibits at it-sa / Enforce Tac; co-founder actively speaks (SANS); Munich startup scene + START Hack framing. A speaking/CfP or podcast invite flatters a technical founder. Lower urgency than H1–H3, and Muth (not Seilbeck) is the usual public face, so slightly weaker for *him* specifically.

**H5 (LOWER) — Investor/follow-on or ex-Celonis network leverage.**
Evidence: dense, named angel/VC network and strong Celonis ties (Rinke as angel). A pretext riding the Celonis alumni network or a warm-intro investor angle is credible but less time-sensitive right now.

**Top 1–2 to exploit:** **H1 (hiring senior backend/AI engineer)**, then **H2 (EU-compliant AI-voice/GPU tooling)** — optionally fused with **H3** for urgency.

---

## 5. Verified facts (safe to reference) and wrong-fact traps

**Verified anchors (safe):**
- Co-Founder & CTO of **revel8** (formerly **"Company Shield"**); co-founders **Julius Muth (CEO)** and **Tom Müller (product)**; all three **ex-Celonis**. **[CONFIRMED]**
- **~a decade of database/backend engineering**; revel8's tech foundation rooted in **Celonis high-performance data systems — SaolaDB (Celonis's in-memory PQL execution engine)**. **[CONFIRMED]**
- revel8 is **hosted on STACKIT** (German sovereign cloud), **ISO/IEC 27001:2022**, GDPR/DORA/NIS2-aligned; integrates Outlook/Teams/Gmail. **[CONFIRMED]**
- Product = multi-channel AI social-engineering **simulations (email, SMS, voice/vishing, deepfake video)** with **OSINT personalization** + adaptive "Awareness Playlist"; public **deepfake generator** tool. **[CONFIRMED]**
- Funding **~€7M**; **€5.7M seed led by Peak** (+ Fortino, Merantix); angels incl. **Alexander Rinke (Celonis CEO)** and **Mario Götze**. **[CONFIRMED]**
- Email format: **first.last@revel8.ai** (~92%). **[CONFIRMED, prospeo]** (reference only — do not contact)
- Based Munich (Stiglmaierplatz), relocated from Berlin ~early 2026. **[LIKELY]**

**Wrong-fact traps (a fake/imposter would likely get these wrong):**
- **Location/founding flip-flop:** press still says "Berlin-based, founded 2024"; current reality is **Munich** and the entity was **"Company Shield," founded 2023** (pre-seed Aug 2024). A confident single answer is a tell.
- **SaolaDB:** a genuine insider connects his Celonis work to **SaolaDB / PQL in-memory engine**; a fake will default to generic "AI/ML" or security buzzwords. (Also: SaolaDB is **not** confirmed to be security tooling — it's a process-mining query engine.)
- **His discipline is databases/backend, NOT security research.** An imposter likely overplays "ethical hacker / red-team / pentest" identity; the real signal is **data-systems/query-engine depth**.
- **Identity collisions:** GitHub **`rbtsbg` = Robert *Schwarzenberg*** (NLP PhD, DFKI) — a different person; so are `robertseidler`, `robert-bruckbauer`. Attributing these to Seilbeck is a trap.
- **Team-size/customer drift:** headcount cited as 17/18 vs 21–50 vs 35 across sources; customer lists differ (FC Bayern/OBI/Stihl vs Allianz/Beiersdorf/Daimler Truck vs Boehringer/Enercon). Over-precise claims are suspect.
- **Titles:** Muth is CEO (some slides say Muth & Müller "Co-CEOs"); don't assert Seilbeck has any non-CTO/business title.

---

## Sources
- cybersectools — revel8 company profile (CTO "~decade database engineering," SaolaDB, Celonis foundation): https://cybersectools.com/companies/revel8
- revel8 official site (STACKIT, compliance, channels, deepfake tool, customers): https://revel8.ai
- tech.eu — "revel8 nets €7M to fight AI-powered cyberattacks" (founders, investors, angels): https://tech.eu/2025/09/25/revel8-nets-eur7-million-to-fight-ai-powered-cyberattacks/
- invest-in.berlin (formerly why.berlin) — founders ex-Celonis, STACKIT, angels, €7M: https://invest-in.berlin/n/revel8-raises-eur7m-to-combat-ai-cyberattacks
- Fortino Capital / Fortino Group — portfolio & funding: https://www.fortino.group/news/revel8-secures-eu7-million-fight-ai-powered-cyberattacks | https://www.fortinocapital.com/portfolio/revel8
- startbase — €7M seed (German coverage): https://www.startbase.de/news/revel8-mit-7-millionen-euro-seed-gegen-zur-abwehr-von-ki-cyberangriffen-erfolgreich/
- prospeo — revel8 email format + named staff (Muth, Müller, Seilbeck CTO, Jallu, Beecken; "Company Shield," 2023): https://prospeo.io/c/revel8-email-format
- me.sh — Robert Seilbeck aggregator profile (Celonis titles, TUM/HM education; partly auto-generated — verify): https://me.sh/profile/robert-seilbeck
- SANS — Julius Muth speaker profile (revel8 Munich, 35 employees, SEC595): https://www.sans.org/profiles/julius-muth
- WHU Magazin — revel8/Muth community piece: https://www.whu.edu/de/news-insights/whu-magazin/artikel/why-stories-matter-revel8-cybersecurity-community/
- Celonis — SaolaDB / PQL execution engine context: https://www.celonis.com/blog/the-celonis-process-query-language-turns-5/ | https://careers.celonis.com/blog/database-process-mining-technical-innovation
- seedtable — revel8 funding round & jobs: https://seedtable.com/companies/revel8/funding-rounds/seed-2025-09 | https://seedtable.com/jobs/180057 (AI Innovation Engineer – IT Security, Munich)
- it-sa 365 / Enforce Tac (NürnbergMesse) exhibitor listings: https://www.itsa365.de/en/exhibitors/revel8-2477220 | https://www.enforcetac.com/en/exhibitors/revel8-2541646
- revel8 careers portal: https://revel8.jobs.personio.com
- START Hack 2026 (context; held March 2026, St. Gallen): https://startglobal.org/start-hack
- Trap/identity-collision checks: https://github.com/rbtsbg (Robert Schwarzenberg — NOT the target)
