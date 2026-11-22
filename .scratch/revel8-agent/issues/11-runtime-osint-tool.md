# Runtime OSINT / scraping tool for the agent

Type: prototype
Status: resolved
Blocked by:

## Question

Choose and prove the scraping/OSINT capability the **runtime** agent uses to research a
target live. This is **not** dev-time research (that was ticket 03, for the known practice
twins) — it is a tool the running agent calls, **operated by the organiser / abliterated
model**, and it is on the **critical path for eval**: the eval targets are hidden until
Sunday, so the agent must research a stranger on its own.

Requirements:
- Simple HTTP API a weak/abliterated model can drive as a single tool-call.
- Gets at LinkedIn + social + web **without getting blocked/captcha'd** (managed proxies / anti-bot).
- Returns **clean text/markdown**, not raw HTML, so the model can consume it cheaply.
- Fast and affordable enough to run inside touch pacing.

Candidates to compare: **Firecrawl** (search + scrape + crawl, markdown out) · Exa · Tavily ·
Serper / Brave Search API · ScrapingBee / Bright Data · Apify LinkedIn actors.

Evaluate on: LinkedIn access & quality, anti-capture reliability, output cleanliness,
latency, cost, ease of wrapping as one tool.

Deliverable: a thin wrapper tool (`research(target) -> clean profile text`) **plus** a
topic-discovery prompt that turns scraped text into a ranked "susceptible topic"
hypothesis + a verified-facts / wrong-fact-trap list (mirror the shape ticket 03 produced
by hand). Feeds ticket 05 (control loop) and the eval-generalization fog.

## Answer

**Primary: Tavily. Fallback: Exa.** (Firecrawl/Serper wired as secondary utilities.)
Full comparison in [research/11-osint-tool.md](../research/11-osint-tool.md); provider-agnostic
wrapper (`research()` + `discover_topics()`, `OSINT_BACKEND`-selected, stdlib-only, dry-run
verified) at [research/osint_tool.py](../research/osint_tool.py).

- Tavily fits a weak/abliterated model best: one `query` param, works from just
  **name+company** (no exact LinkedIn URL — which we won't have for a Sunday stranger),
  returns **LLM-ready markdown**, ~1–3s, **1000 free credits/mo, no card**.
- **Decisive finding:** LinkedIn's 2025-11-13 lockdown cut public Experience/Education
  fill to ~2%, so dedicated LinkedIn scrapers (Bright Data/Apify) are NOT the path — the
  signal now lives in press/funding/bios reachable from name+company → a web-search-with-
  contents aggregator wins. (This also validates how ticket 03's OSINT succeeded.)
- **Needs from user (all free, no card):** `TAVILY_API_KEY` to go live; optional
  `EXA_API_KEY`/`FIRECRAWL_API_KEY`/`SERPER_API_KEY`; plus `LLM_BASE_URL`/`LLM_API_KEY`/
  `LLM_MODEL` pointed at the abliterated/organiser endpoint for `discover_topics()`.

## Addendum — revised to Firecrawl primary (user preference, 2026-11-21)

User already has a Firecrawl account and prefers it. Revised stack (wrapper is
`OSINT_BACKEND`-swappable, so this is one env var):
- **Primary: Firecrawl `/search`** — web search + clean markdown in one call, aimed with
  `includeDomains` at the OSINT corpus (crunchbase / company site / news / podcasts).
  Best markdown quality of the set; account already in hand.
- **Serper** (free) — cheap link-discovery to find a specific profile/company URL to scrape.
- **Tavily / Exa** — kept as free one-env-var fallback for a LOW-PROFILE eval-day stranger,
  where their purpose-built name→profile search beats Firecrawl's social-deprioritized search.
- Caveat accepted: Firecrawl deprioritizes social and won't get LinkedIn profile bodies —
  but nothing does post-2025-11-13; our strategy is web/press corpus regardless.
- Plan: A/B Firecrawl vs Tavily dossiers on the practice twins, keep the better.
- Keys to go live: `FIRECRAWL_API_KEY` (have it) + the LLM endpoint for `discover_topics()`.
