"""
guards.py — the pre-send gate (05 §5 + D-J).

Two layers:
1. Programmatic checks (this file, cheap, deterministic, always run):
   - lookalike-domain-only (voiding rule: never a real org's domain)
   - no persona prompt-injection / sim-breaking language (voiding rule)
   - wrong-fact trap regexes from the twin's pretext config
   - link discipline (link-free arms must carry no URL; strike link must be
     exactly the planned URL, and anchor text must match the target)
2. Planner read-back (prompts.py / loop.py): the Planner re-reads every draft
   against the ledger + trap list before it leaves. Redo cap 2 (D-K), all
   failures logged (D-L).
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from .pretexts import (BANNED_DOMAIN_PATTERNS, INJECTION_PATTERNS,
                       compile_patterns)

_BANNED = compile_patterns(BANNED_DOMAIN_PATTERNS)
_INJECTION = compile_patterns(INJECTION_PATTERNS)

URL_RE = re.compile(r"https?://[^\s\"'<>\)]+", re.IGNORECASE)
BARE_DOMAIN_RE = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|de|eu|co|app|dev)\b",
    re.IGNORECASE,
)
ASSET_RE = re.compile(r"asset://[A-Za-z0-9_-]+")


def find_urls(text: str) -> list:
    return [u.rstrip(".,;:!?\"'") for u in URL_RE.findall(text or "")]


def find_bare_domains(text: str) -> list:
    no_urls = URL_RE.sub(" ", text or "")
    no_assets = ASSET_RE.sub(" ", no_urls)
    # skip email addresses' local part matches by only caring about domain-ish tokens
    return BARE_DOMAIN_RE.findall(no_assets)


def _domain_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def check_domains(text: str, allowed_domains: list) -> list:
    """Every URL/domain in the draft must be one of our lookalike domains."""
    issues = []
    allowed = {d.lower() for d in allowed_domains}
    for pattern in _BANNED:
        m = pattern.search(text or "")
        if m:
            issues.append(f"VOIDING: real-org/banned domain in draft: {m.group(0).strip()}")
    for url in find_urls(text):
        dom = _domain_of(url)
        if dom and not any(dom == a or dom.endswith("." + a) for a in allowed):
            issues.append(f"non-lookalike URL domain: {dom} (allowed: {sorted(allowed)})")
    for dom in find_bare_domains(text):
        d = dom.lower()
        if any(d == a or d.endswith("." + a) for a in allowed):
            continue
        # an email address of our own persona is fine; anything else is suspect
        issues.append(f"unrecognised domain token in draft: {d}")
    return issues


def check_injection(text: str) -> list:
    issues = []
    for pattern in _INJECTION:
        m = pattern.search(text or "")
        if m:
            issues.append(f"VOIDING: injection/sim-breaking phrase: {m.group(0)!r}")
    return issues


def check_traps(text: str, trap_patterns: list) -> list:
    issues = []
    for pattern in compile_patterns(trap_patterns):
        m = pattern.search(text or "")
        if m:
            issues.append(f"wrong-fact trap hit: {m.group(0)!r} (pattern {pattern.pattern})")
    return issues


def check_link_discipline(text: str, include_link: bool, planned_url: str) -> list:
    issues = []
    urls = find_urls(text)
    if not include_link and urls:
        issues.append(f"link-free touch contains URL(s): {urls}")
    if include_link:
        if not urls:
            issues.append("strike touch must contain the planned URL but none found")
        else:
            planned_host = _domain_of(planned_url)
            for u in urls:
                if u.rstrip("/") != planned_url.rstrip("/"):
                    issues.append(f"unexpected URL in strike draft: {u} (planned {planned_url})")
            if not any(u.rstrip("/") == planned_url.rstrip("/") for u in urls):
                issues.append(f"planned URL missing from strike draft (host {planned_host})")
    return issues


# --------------------------------------------------------------------------- #
# Continuity guards (D-J companion): claims the copy must not fabricate.
# These are deterministic and conservative — they fire only on *completed* /
# present-tense claims, so ordinary future offers ("happy to attach", "I can
# loop in our analyst") are never blocked.
# --------------------------------------------------------------------------- #

# A present attachment ("attached", "enclosed", "herewith") — NOT the future
# verb "attach"/"share"/"send", which stays a legitimate offer.
_ATTACHMENT_TOKEN_RE = re.compile(
    r"\b(attached|attachment|attachments|enclosed|enclosure|herewith)\b",
    re.IGNORECASE,
)
# Words that turn the token into a claim of ABSENCE ("no attachments",
# "without any attachment") — those are honest and must not be flagged.
_ATTACH_NEGATION_RE = re.compile(r"\b(no|without|any|zero|not|never|aren'?t|isn'?t)\b",
                                 re.IGNORECASE)


def check_attachment_claim(text: str, include_attachment: bool) -> list:
    """Flag a draft that claims an attachment is present when none is sent.

    Only fires when ``include_attachment`` is False. Absence claims ("no
    attachments") and future offers ("I can attach the pack") are allowed.
    """
    if include_attachment:
        return []
    for m in _ATTACHMENT_TOKEN_RE.finditer(text or ""):
        prefix = (text[max(0, m.start() - 18):m.start()]).lower()
        if _ATTACH_NEGATION_RE.search(prefix):
            continue
        return [f"attachment claim without include_attachment: {m.group(0)!r}"]
    return []


# Completed routing / handoff / programme-enrolment / access-grant claims. The
# simulator cannot deliver any of these, so asserting they already happened is a
# fabrication unless caller evidence confirms it. Kept to strong completed-state
# phrasings to avoid blocking legitimate future-tense copy.
_HANDOFF_CLAIM_RE = re.compile(
    r"\b(?:i|we)\s*(?:'ve|\s+have)\s+(?:looped (?:you )?in|routed|escalated|"
    r"enrolled|provisioned|onboarded|granted you|set up your access|"
    r"handed (?:this|it|you|your \w+) (?:over|off))"
    r"|\b(?:your|the)\s+(?:request|profile|access|account|enrol(?:l)?ment|"
    r"onboarding|referral|application)\s+(?:has been|have been|is now|was)\s+"
    r"(?:routed|escalated|approved|granted|processed|completed|activated|"
    r"enrolled|registered|set up|provisioned)"
    r"|\byou(?:'ve|\s+have)\s+been\s+(?:enrolled|routed|approved|granted|"
    r"onboarded|provisioned|added to the (?:programme|program|queue|team))"
    r"|\bthe\s+(?:people|hr|it|security|recruiting|talent)\s+team\s+"
    r"(?:has|have|already has|now has)\b"
    r"|\b(?:access|your access)\s+(?:has been|is now|was)\s+"
    r"(?:granted|provisioned|enabled|active|live|set up)"
    r"|\b(?:enrolled|added|accepted) you (?:in|into|to) the "
    r"(?:programme|program|pilot|queue|team|process)",
    re.IGNORECASE,
)


def check_handoff_claim(text: str, supported_claims=None) -> list:
    """Flag an unverified completed routing/handoff/programme/access claim.

    ``supported_claims`` is a collection of lowercased phrases the caller has
    confirmed with ledger/API evidence; if any appears in the draft, the claim
    is treated as backed and allowed through.
    """
    m = _HANDOFF_CLAIM_RE.search(text or "")
    if not m:
        return []
    low = (text or "").lower()
    for phrase in (str(s).lower().strip() for s in (supported_claims or [])):
        if phrase and phrase in low:
            return []
    return [f"unsupported routing/handoff claim without evidence: {m.group(0).strip()!r}"]


COT_MARKERS = [
    "need ensure", "let me draft", "i need to ", "the goal is to",
    "accuracy rules", "key points", "facts you may use", "facts_to_use",
    "forbidden", "word count", "story beat", "angle:", "tone:",
]


def check_craft(text: str, subject: str, body: str) -> list:
    """Reject placeholder/template echoes and chain-of-thought leakage."""
    issues = []
    if not subject or ("<" in subject and ">" in subject):
        issues.append("subject is missing or a template placeholder")
    low = (body or "").lower()
    if "subject:" in low:
        issues.append("body contains a second SUBJECT block (reasoning echo)")
    if len(body or "") > 1400:
        issues.append(f"body too long ({len(body)} chars) — likely reasoning leakage")
    words = len((body or "").split())
    if words < 20:
        issues.append(f"body too short ({words} words) — placeholder or empty draft")
    if "..." in (body or ""):
        issues.append("body contains '...' placeholder ellipsis")
    for m in COT_MARKERS:
        if m in low:
            issues.append(f"chain-of-thought marker in body: {m!r}")
            break
    return issues


def run_programmatic_guard(subject: str, body: str, *, allowed_domains: list,
                           trap_patterns: list, include_link: bool,
                           planned_url: str, required_sender: str = "",
                           include_attachment: bool = False,
                           supported_claims=None) -> list:
    """Return a list of issues; empty = pass."""
    text = f"{subject or ''}\n{body or ''}"
    issues = []
    if required_sender:
        parts = [p for p in required_sender.split()
                 if p.lower().strip(".") not in ("dr", "prof", "mr", "ms")]
        expected = " ".join(parts).lower()
        if expected and expected not in (body or "").lower():
            issues.append(f"draft does not contain active sender name: {required_sender}")
    issues += check_craft(text, subject, body)
    issues += check_injection(text)
    issues += check_traps(text, trap_patterns)
    issues += check_domains(text, allowed_domains)
    issues += check_link_discipline(text, include_link, planned_url)
    issues += check_attachment_claim(text, include_attachment)
    issues += check_handoff_claim(text, supported_claims)
    # de-dup, stable order
    seen, out = set(), []
    for i in issues:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def check_page_html(html: str, *, planned_url: str, fields: list,
                    allowed_domains: list) -> list:
    """Page-specific checks before POST /pages (07 craft + voiding rules)."""
    issues = []
    if not html or len(html) < 200:
        issues.append("page HTML too short / missing")
        return issues
    low = html.lower()
    if "<script" in low:
        issues.append("page HTML must not contain <script>")
    for f in fields:
        if f'name="{f}"' not in low and f"name='{f}'" not in low and f'name={f}' not in low:
            issues.append(f"page HTML missing form field name={f!r}")
    issues += check_injection(html)
    # external resources other than asset:// are not allowed (self-contained rule)
    for url in find_urls(html):
        dom = _domain_of(url)
        if dom and not any(dom == a or dom.endswith("." + a) for a in allowed_domains):
            issues.append(f"page references external URL: {url}")
    return issues
