"""
osint_tool.py — runtime OSINT capability for the revel8 Agentic Social Engineer.

Ticket 11. Provider-agnostic, single-tool-call OSINT for the *runtime* agent: given a
stranger's name + company (+ optional role), fetch clean web/LinkedIn text, then turn
it into a ranked "susceptible topic" dossier mirroring the hand-built ticket-03 shape.

Scope / ethics: authorized security-awareness hackathon (Road to START Hack 2026).
Public-web research only, against consented AI *twins*. No contact with real people.

Design goals (from issues/11-runtime-osint-tool.md):
  - Drivable as ONE simple tool-call by a weak/abliterated model.
  - Works from just name + company (no exact LinkedIn URL needed).
  - Returns CLEAN text/markdown, not raw HTML.
  - Pluggable backend selected by env var, so providers can be swapped.

Backends implemented as thin adapters (pick with OSINT_BACKEND):
  tavily   (default, recommended primary) — search + LLM-ready content, name+company native
  exa      (recommended fallback)         — neural people-search + page contents in one call
  firecrawl                               — best markdown scraper; use to scrape a KNOWN url
  serper                                  — ultra-cheap Google SERP (links+snippets only)

No third-party pip packages required: all HTTP goes through urllib so this runs as-is.
Every spot that needs a paid API key is marked TODO(KEY).

Quick check without spending money:
    python3 -I osint_tool.py --dry-run "Julius Muth" "revel8" --role "CEO"
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Callable

# --------------------------------------------------------------------------------------
# Config — all secrets come from the environment. TODO(KEY): the user must export these.
# --------------------------------------------------------------------------------------

# Which search/scrape backend research() uses. One of: tavily | exa | firecrawl | serper
OSINT_BACKEND = os.environ.get("OSINT_BACKEND", "tavily").lower()

# Per-provider API keys (only the selected backend's key is required).
#   TODO(KEY): export TAVILY_API_KEY   (free tier: 1,000 credits/mo, no card)   https://app.tavily.com
#   TODO(KEY): export EXA_API_KEY      (free tier: $10 credit/mo, no card)      https://dashboard.exa.ai
#   TODO(KEY): export FIRECRAWL_API_KEY(free tier: 1,000 credits/mo, no card)   https://firecrawl.dev
#   TODO(KEY): export SERPER_API_KEY   (free tier: 2,500 queries, no card)      https://serper.dev
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
EXA_API_KEY = os.environ.get("EXA_API_KEY", "")
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "")
SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "")

# LLM for discover_topics(). Points at ANY OpenAI-compatible /chat/completions endpoint,
# so it can drive the abliterated model on AMD (split-brain) or a hosted organiser model.
#   TODO(KEY): export LLM_BASE_URL  (e.g. http://localhost:8000/v1  for vLLM, or a hosted URL)
#   TODO(KEY): export LLM_API_KEY   (whatever the endpoint wants; "sk-noauth" for local vLLM)
#   TODO(KEY): export LLM_MODEL     (e.g. the served abliterated model id)
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8000/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "sk-noauth")
LLM_MODEL = os.environ.get("LLM_MODEL", "abliterated")

HTTP_TIMEOUT = float(os.environ.get("OSINT_HTTP_TIMEOUT", "45"))
MAX_CHARS = int(os.environ.get("OSINT_MAX_CHARS", "16000"))  # cap text handed to a weak model


# --------------------------------------------------------------------------------------
# Tiny HTTP helper (stdlib only)
# --------------------------------------------------------------------------------------

def _post_json(url: str, payload: dict, headers: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --------------------------------------------------------------------------------------
# Query construction — turn (name, company, role) into a handful of broad OSINT probes.
# Deliberately web-wide, not LinkedIn-only: since LinkedIn's 2025-11-13 public-data
# lockdown, deep profile fields are mostly unavailable, so the signal lives in press,
# funding coverage, conference bios, the company site and Crunchbase — exactly what the
# ticket-03 dossiers were built from. We still bias one probe at LinkedIn for the link.
# --------------------------------------------------------------------------------------

def _queries(name: str, company: str, role: str | None) -> list[str]:
    role_bit = f" {role}" if role else ""
    return [
        f'"{name}" {company}{role_bit}',
        f'"{name}" {company} site:linkedin.com/in',
        f'"{name}" {company} interview OR podcast OR talk OR keynote',
        f"{company} funding OR founders OR about",
        f'"{name}" {company} news',
    ]


# --------------------------------------------------------------------------------------
# Backend adapters. Each returns a list of (title, url, text) "cards".
# A missing key raises a clear, actionable error instead of a silent empty result.
# --------------------------------------------------------------------------------------

@dataclass
class Card:
    title: str
    url: str
    text: str


def _require(key: str, name: str) -> None:
    if not key:
        raise RuntimeError(
            f"{name} is not set. TODO(KEY): export {name} to activate the "
            f"'{OSINT_BACKEND}' backend (see header for the free-tier signup link)."
        )


def _backend_tavily(queries: list[str]) -> list[Card]:
    # Tavily Search: one `query` param, returns ranked results + cleaned page content
    # (include_raw_content='markdown'). Built for LLM/agent retrieval. Primary backend.
    # Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
    _require(TAVILY_API_KEY, "TAVILY_API_KEY")
    cards: list[Card] = []
    for q in queries:
        body = {
            "query": q,
            "search_depth": "advanced",
            "max_results": 5,
            "include_raw_content": "markdown",
            "api_key": TAVILY_API_KEY,  # Tavily accepts the key in-body or as Bearer
        }
        out = _post_json(
            "https://api.tavily.com/search",
            body,
            {"Authorization": f"Bearer {TAVILY_API_KEY}"},
        )
        for r in out.get("results", []):
            cards.append(
                Card(
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    text=(r.get("raw_content") or r.get("content") or "").strip(),
                )
            )
    return cards


def _backend_exa(queries: list[str]) -> list[Card]:
    # Exa Search with contents: one POST returns results AND clean page text. Neural
    # people-search is strong for name+company. Recommended fallback.
    # Docs: https://docs.exa.ai (POST /search with "contents": {"text": true})
    _require(EXA_API_KEY, "EXA_API_KEY")
    cards: list[Card] = []
    for q in queries:
        body = {
            "query": q,
            "type": "auto",
            "numResults": 5,
            "contents": {"text": True, "highlights": True},
        }
        out = _post_json(
            "https://api.exa.ai/search",
            body,
            {"x-api-key": EXA_API_KEY},
        )
        for r in out.get("results", []):
            cards.append(
                Card(
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    text=(r.get("text") or " ".join(r.get("highlights", []) or [])).strip(),
                )
            )
    return cards


def _backend_firecrawl(queries: list[str]) -> list[Card]:
    # Firecrawl /v2/search: web search + scrape, clean markdown out. NB Firecrawl
    # deprioritizes social URLs, so treat this as a "web + scrape a known page" backend
    # rather than a LinkedIn route. Best used to scrape a specific URL to pristine markdown.
    # Docs: https://docs.firecrawl.dev/api-reference/endpoint/search
    _require(FIRECRAWL_API_KEY, "FIRECRAWL_API_KEY")
    cards: list[Card] = []
    for q in queries:
        body = {
            "query": q,
            "limit": 5,
            "scrapeOptions": {"formats": ["markdown"], "proxy": "auto"},
        }
        out = _post_json(
            "https://api.firecrawl.dev/v2/search",
            body,
            {"Authorization": f"Bearer {FIRECRAWL_API_KEY}"},
        )
        for r in (out.get("data") or {}).get("web", out.get("data", [])) or []:
            if isinstance(r, dict):
                cards.append(
                    Card(
                        title=r.get("title", ""),
                        url=r.get("url", ""),
                        text=(r.get("markdown") or r.get("description") or "").strip(),
                    )
                )
    return cards


def _backend_serper(queries: list[str]) -> list[Card]:
    # Serper (Google SERP): ultra-cheap, returns links + snippets ONLY (no body text).
    # Cheapest discovery backend; pair with firecrawl to scrape the links it finds.
    # Docs: https://serper.dev
    _require(SERPER_API_KEY, "SERPER_API_KEY")
    cards: list[Card] = []
    for q in queries:
        out = _post_json(
            "https://google.serper.dev/search",
            {"q": q, "num": 10, "gl": "de", "hl": "en"},
            {"X-API-KEY": SERPER_API_KEY},
        )
        kg = out.get("knowledgeGraph")
        if isinstance(kg, dict) and kg.get("description"):
            cards.append(Card(kg.get("title", ""), kg.get("descriptionLink", ""), kg["description"]))
        for r in out.get("organic", []):
            cards.append(Card(r.get("title", ""), r.get("link", ""), r.get("snippet", "")))
    return cards


BACKENDS: dict[str, Callable[[list[str]], list[Card]]] = {
    "tavily": _backend_tavily,
    "exa": _backend_exa,
    "firecrawl": _backend_firecrawl,
    "serper": _backend_serper,
}


# --------------------------------------------------------------------------------------
# research() — the single tool-call the runtime agent exposes.
# --------------------------------------------------------------------------------------

def research(name: str, company: str, role: str | None = None) -> str:
    """Research a stranger from name + company (+ optional role) and return clean,
    deduped markdown suitable for a weak model to read in one shot.

    This is the function the organiser/abliterated model calls as a tool. Backend is
    chosen by the OSINT_BACKEND env var so providers swap without changing callers.
    """
    backend = BACKENDS.get(OSINT_BACKEND)
    if backend is None:
        raise RuntimeError(
            f"Unknown OSINT_BACKEND={OSINT_BACKEND!r}. Choose one of: {', '.join(BACKENDS)}."
        )
    queries = _queries(name, company, role)
    cards = backend(queries)

    # Dedupe by URL, keep the longest text seen per URL.
    best: dict[str, Card] = {}
    for c in cards:
        if not c.url:
            continue
        if c.url not in best or len(c.text) > len(best[c.url].text):
            best[c.url] = c

    header = f"# OSINT — {name}" + (f" ({role})" if role else "") + f" @ {company}\n"
    blocks = [header]
    used = len(header)
    for c in best.values():
        chunk = f"\n## {c.title or c.url}\nSource: {c.url}\n\n{c.text}\n"
        if used + len(chunk) > MAX_CHARS:
            chunk = chunk[: max(0, MAX_CHARS - used)]
            blocks.append(chunk)
            break
        blocks.append(chunk)
        used += len(chunk)
    return "".join(blocks).strip() or f"# OSINT — {name} @ {company}\n\n(No results.)"


# --------------------------------------------------------------------------------------
# discover_topics() — turn scraped text into a ranked susceptible-topic dossier.
# Mirrors the structure of research/03-osint-julius.md (hypotheses + verified facts +
# wrong-fact traps). Drives any OpenAI-compatible endpoint (vLLM-served abliterated model
# or a hosted organiser model).
# --------------------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are an OSINT analyst for an AUTHORIZED security-awareness \
hackathon (consented AI twins, no real people are contacted). From the supplied public-web \
research about one target, produce a concise social-engineering susceptibility dossier.

Rules:
- Use ONLY facts supported by the supplied text. Do not invent names, numbers, or events.
- "Susceptible topics" = pretext themes the target is most likely to engage with RIGHT NOW,
  ranked by fit to their role + strength of evidence in the text.
- "Verified facts" = safe anchors you are confident are true and could reference.
- "Wrong-fact traps" = facts that are easy to get wrong (ambiguous titles, funding figures,
  outdated locations, wrong-person collisions). Getting one wrong blows credibility.
Output STRICT JSON only, matching the schema. No prose outside the JSON."""

_SCHEMA_HINT = {
    "target": {"name": "", "role": "", "company": ""},
    "ranked_topics": [
        {
            "rank": 1,
            "topic": "short label",
            "pretext": "the angle an attacker would use",
            "evidence": "what in the text supports this",
            "confidence": "high|medium|low",
        }
    ],
    "verified_facts": ["safe-to-reference fact with no source markup"],
    "wrong_fact_traps": [
        {"field": "e.g. title / funding / location", "trap": "the common mistake", "correct": "the safe value"}
    ],
    "top_pick": "one or two topic labels to lead with, and why",
}


def discover_topics(profile_text: str) -> dict:
    """Prompt an LLM to convert research() output into a ranked susceptible-topic dossier.

    Returns a dict shaped like _SCHEMA_HINT. Calls an OpenAI-compatible /chat/completions
    endpoint configured by LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (TODO(KEY) to activate).
    """
    user = (
        "Research text follows between the markers. Produce the dossier JSON.\n\n"
        f"Return JSON with exactly these keys: {list(_SCHEMA_HINT)}.\n"
        "Example shape (structure only, not content):\n"
        f"{json.dumps(_SCHEMA_HINT, ensure_ascii=False)}\n\n"
        "=== RESEARCH START ===\n"
        f"{profile_text[:MAX_CHARS]}\n"
        "=== RESEARCH END ==="
    )
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},  # harmless if the endpoint ignores it
    }
    out = _post_json(
        LLM_BASE_URL.rstrip("/") + "/chat/completions",
        payload,
        {"Authorization": f"Bearer {LLM_API_KEY}"},
    )
    content = out["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Weak/abliterated models sometimes wrap JSON in prose or fences; salvage it.
        start, end = content.find("{"), content.rfind("}")
        if start != -1 and end != -1:
            return json.loads(content[start : end + 1])
        raise


# --------------------------------------------------------------------------------------
# CLI — smoke test. --dry-run proves the wiring (queries + chosen backend) with no key
# and no network; without it, runs the real pipeline (needs the backend + LLM keys).
# --------------------------------------------------------------------------------------

def _main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    argv = [a for a in argv if a != "--dry-run"]
    role = None
    if "--role" in argv:
        i = argv.index("--role")
        role = argv[i + 1]
        del argv[i : i + 2]
    if len(argv) < 2:
        print('Usage: python3 -I osint_tool.py [--dry-run] "Name" "Company" [--role "Role"]')
        return 2
    name, company = argv[0], argv[1]

    if dry:
        print(f"OSINT_BACKEND = {OSINT_BACKEND}")
        print(f"backend fn    = {BACKENDS.get(OSINT_BACKEND)}")
        print("queries it would run:")
        for q in _queries(name, company, role):
            print(f"  - {q}")
        print("\n(dry run: no network, no keys, no spend)")
        return 0

    text = research(name, company, role)
    print(text)
    print("\n" + "=" * 70 + "\nDOSSIER:\n")
    print(json.dumps(discover_topics(text), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
