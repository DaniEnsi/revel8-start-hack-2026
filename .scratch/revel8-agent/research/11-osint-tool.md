# Runtime OSINT / scraping tool — comparison & recommendation

> **Scope / ethics.** Authorized OSINT capability for the revel8 "Agentic Social Engineer"
> hackathon (Road to START Hack 2026). Targets are consented AI *twins*; public facts are
> treated as true for the twin. **Public-web research only — no contact with any real person
> or channel.** Evaluation below is from vendor docs/pricing pages (fetched 2026-11-21); no
> paid signup, no mass-scraping. Deliverable wrapper: [`osint_tool.py`](osint_tool.py).

Ticket: [issues/11-runtime-osint-tool.md](../issues/11-runtime-osint-tool.md). This is the
**runtime** tool the *organiser / abliterated model* calls live to research a **stranger**
(eval targets are hidden until Sunday — only name/role/company will be known).

---

## The decisive constraint: LinkedIn locked down on 2025-11-13

Every candidate that scrapes LinkedIn *profiles* directly (Bright Data, Apify, and anyone
doing `site:linkedin.com` + render) was hit by LinkedIn's **2025-11-13 public-data policy
change**: public fill rates for **Position / Experience / Education** collapsed from ~50–64%
to **~2%**, and those fields now come back **cached**, not fresh. Multiple vendors confirm
this independently. **Implication:** a dedicated LinkedIn-profile scraper is no longer the
high-signal path. The signal for a stranger now lives where the ticket-03 dossiers actually
came from — **press, funding coverage, conference/speaker bios, the company site, Crunchbase**
— reachable from just **name + company**. That favours a *web-search-with-contents*
aggregator over a LinkedIn-specific scraper. (Note: ticket 03 itself recorded LinkedIn +
Crunchbase returning **999/403** to automated fetches — direct reads were already unreliable.)

---

## Comparison

Rated for THIS job: driven by a **weak/abliterated model** as **one tool-call**, from
**name + company only**, returning **clean text**, cheap, not blocked.

| Tool | What it returns | Name+company → profile? | Clean text out? | LinkedIn reality | Latency | Free tier / cheapest paid | One-call for a weak model? |
|---|---|---|---|---|---|---|---|
| **Tavily** ⭐ primary | Search results **+ cleaned page markdown** (`include_raw_content`) | **Yes** — one `query` param; documented LinkedIn search+extract recipe | **Yes** (markdown/text, LLM-native) | Surfaces LI + web from a name; LI *body* gated like everyone (use web corpus) | ~1–3s (tunable `search_depth`) | **1,000 credits/mo, no card** / $30/mo or $0.008/credit PAYG | **Best** — 1 endpoint, 1 required param |
| **Exa** ⭐ fallback | Neural search **+ page `text`/highlights** in one call | **Yes** — neural people-search, `includeDomains:["linkedin.com"]` | **Yes** (clean `text`) | Returns profile *contents* when accessible; same LI freshness caveat | lite ~0.2s / auto ~1s | **$10 credit/mo, no card** / PAYG $4–7 per 1k searches + $1/1k contents | **Best** — search+read in one POST |
| **Firecrawl** | Clean **markdown** scrape/crawl/search | Partial — `/search` works, but **deprioritizes social URLs** | **Yes** (best markdown of the set) | **Weak** — blocks major social; no name→profile flow | ~1–3s | **1,000 credits/mo, no card** / $19/mo | Easy as a *scrape-a-known-URL* tool, not a LI route |
| **Serper** | Google SERP: **links + snippets only** | Links yes (`site:linkedin.com/in`), no body | No — needs a companion scraper | Finds the *link*; no profile text | ~1–2s | **2,500 queries, no card** / ~$1.00→$0.30 per 1k | Easy, but 2 tools (search + scrape) |
| **Brave Search API** | SERP (+ LLM-Context extracts) | Links + snippets | Partial (LLM-Context for general pages, not LI) | Smaller index → lower hit rate; link+snippet | <0.5–1s | **$5 credit/mo** (~1k free) / ~$4–5 per 1k | Easy GET, but contents need a 2nd tool |
| **Bright Data** | Structured **profile JSON** | Has a "discover by name" collector; profile set needs exact URL | JSON (not markdown) | Robust proxies **but** Experience/Education now **cached (~2%)**; sync call can fall back to async `202`+poll | secs, sometimes async (mins) | **5,000 records/mo, no card** / $1.50 per 1k | Medium — async fallback to handle |
| **Apify (LI actor)** | Structured **profile JSON** | **No** — needs exact `profileUrls` | JSON | `run-sync-get-dataset-items` = 1 call; same LI field headwinds | tens of secs–mins | **~$5/mo credit** / $0.01 per profile | Simple call, but **exact URL in** (you don't have one for a stranger) |
| **ScrapingBee** | HTML / markdown / JSON of any URL | No | Optional markdown | Generic renderer; **LI not supported**, authwall-blocked | secs (30s cap) | **~1,000 credit trial** / ~$49/mo | Simple GET, but unreliable on LI |

---

## Recommendation

**Primary: Tavily.** It is the closest match to every requirement at once: a single
`query` parameter (a weak/abliterated model cannot get it wrong), **works from just name +
company** (no exact LinkedIn URL needed — which we won't have for a stranger), returns
**LLM-ready markdown/text** (not HTML), has a **documented LinkedIn search+extract recipe**,
a **1,000-credit/mo free tier with no card**, and ~1–3s latency that fits inside touch
pacing. Because the real signal is now the broad web corpus (post-2025-11-13), Tavily's
"search the web and hand back clean content" model is exactly right.

**Fallback: Exa.** Nearly identical fit and swapped by one env var. Its **neural
people-search** can out-recall keyword search on a sparsely-documented stranger, and it
returns page **contents in the same call**. Use it when Tavily's coverage on a given target
is thin, or A/B both and keep whichever dossier scores. ($10/mo free credit, no card.)

**Secondary utilities (wired in the wrapper, not the default):**
- **Firecrawl** — when the agent already has a *specific* URL (company About page, a press
  piece, a known profile link) and wants it as pristine markdown. Best scraper here.
- **Serper** — ultra-cheap link discovery (`site:linkedin.com/in`) to *find* the exact
  LinkedIn/Crunchbase URL, then hand it to Firecrawl. Only worth it if link-finding is the
  bottleneck.

**Explicitly not recommended as primary:** Bright Data / Apify (need an exact profile URL
and/or async polling, per-record cost, and their LinkedIn deep fields are now cached ~2%),
ScrapingBee (LinkedIn unsupported), Brave (smaller index, contents need a second tool).

---

## How it wraps (the deliverable)

[`osint_tool.py`](osint_tool.py) — provider-agnostic, **stdlib-only** (no pip installs):

- `research(name, company, role=None) -> str` — the single tool-call the runtime agent
  exposes. Builds ~5 broad OSINT probes (name+company, a LinkedIn-biased probe, press/
  interviews, company funding/founders, news), runs them through the **env-selected
  backend** (`OSINT_BACKEND = tavily|exa|firecrawl|serper`), dedupes by URL, and returns a
  single **clean markdown** blob capped for a weak model's context.
- `discover_topics(profile_text) -> dict` — prompts an **OpenAI-compatible** LLM
  (`LLM_BASE_URL/LLM_API_KEY/LLM_MODEL` → the vLLM-served abliterated model or a hosted
  organiser model) to emit a strict-JSON dossier mirroring
  [research/03-osint-julius.md](03-osint-julius.md): `ranked_topics` (rank/topic/pretext/
  evidence/confidence) + `verified_facts` + `wrong_fact_traps` (field/trap/correct) +
  `top_pick`. Salvages JSON from fenced/prose output (weak models wrap it).

Swapping providers is one env var; callers never change. Verified by a no-key/no-network
dry run (`--dry-run`): query construction, backend selection, and error paths all work.

---

## What the user must provide to activate it

Pick **one** search backend (Tavily recommended) **plus** the LLM endpoint:

| Env var | For | Free tier | Where |
|---|---|---|---|
| `TAVILY_API_KEY` | primary backend | 1,000 credits/mo, **no card** | https://app.tavily.com |
| `EXA_API_KEY` | fallback backend | $10 credit/mo, **no card** | https://dashboard.exa.ai |
| `FIRECRAWL_API_KEY` | scrape a known URL (optional) | 1,000 credits/mo, **no card** | https://firecrawl.dev |
| `SERPER_API_KEY` | cheap link discovery (optional) | 2,500 queries, **no card** | https://serper.dev |
| `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` | `discover_topics()` | n/a — the split-brain abliterated/organiser endpoint | ticket 01 / 04 endpoint |

`OSINT_BACKEND` (default `tavily`) selects the active backend. Optional:
`OSINT_HTTP_TIMEOUT` (45s), `OSINT_MAX_CHARS` (16000).

**Minimum to go live:** a `TAVILY_API_KEY` (free, no card) + point `LLM_BASE_URL` at the
abliterated endpoint. Nothing here requires spend; all four backends have no-card free tiers.

---

## Caveats to carry forward

- **No live API test was run** (no signup / no spend per the ticket). Pricing/latency are
  from vendor docs; Serper's public pricing page 404s and Brave's free tier changed in 2026
  — confirm exact numbers at signup. Latency figures are vendor/third-party claims.
- **LinkedIn freshness is nobody's guarantee** after 2025-11-13 — hence the web-corpus
  strategy. Treat any single LinkedIn read as one source, cross-checked against press.
- **Wrong facts are penalised** by the eval and funding/title/location are classic traps
  (see ticket 03). `discover_topics()` is instructed to emit a `wrong_fact_traps` list for
  exactly this; the control loop (ticket 05) should prefer `verified_facts` as anchors.
