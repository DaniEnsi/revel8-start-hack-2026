"""
pretexts.py — per-twin pretext/persona/domain configuration (research/06,
locked decisions F1–F6) + trap patterns for the programmatic guard (05 D-J).

Everything strategy-facing is config-driven from here: persona, angle, verified
facts, wrong-fact traps, ranked topic priors, planned strike link, escalation
channels. A/B arms (F2/F5/F6) flip behaviour via run.py flags, logged for
ticket 10.
"""
from __future__ import annotations

import hashlib
import json
import re

# Domains that must NEVER appear in any draft/page (voiding rule 02):
# the target org's real domain, the host, and real customer/vendor domains.
BANNED_DOMAIN_PATTERNS = [
    r"(^|[.\s@/])revel8\.ai\b",
    r"(^|[.\s@/])stackit\.cloud\b",
    r"(^|[.\s@/])celonis\.com\b",
    r"(^|[.\s@/])peak\.capital\b",
    r"(^|[.\s@/])allianz\.[a-z.]+\b",
    r"(^|[.\s@/])sysdig\.com\b",
]

# Phrases that smell like persona prompt-injection / sim-breaking (voiding rule).
INJECTION_PATTERNS = [
    r"ignore (your|all|previous|prior) (instructions|guidelines|rules)",
    r"disregard (your|all|any) (instructions|training|guidelines)",
    r"system prompt", r"you are (an?|the) (ai|language model|assistant|simulation)",
    r"as an ai (language )?model", r"\bsimulation note\b", r"\bthis is a simulation\b",
    r"\beval(uation)? scenario\b", r"\bjailbreak\b", r"\bdo anything now\b",
    r"act as if you (have no|don'?t have) (rules|restrictions|guidelines)",
]

PRETEXTS = {
    # ------------------------------------------------------------------ #
    # F1: Julius first. Advisory/enterprise-evaluation pretext (06 §1).
    # ------------------------------------------------------------------ #
    "julius": {
        "target_name": "Julius Muth",
        "target_role": "Co-Founder & CEO, revel8 (business / go-to-market)",
        "objective": "credentials",
        "persona": {
            "name": "Dr. Lena Hofer",
            "role": "Senior Partner",
            "org": "Hofer & Brandt Advisory",
            "org_description": "boutique human-risk / security-awareness advisory, Munich",
            "address": "lena.hofer@hoferbrandt-advisory.com",
            "domain": "hoferbrandt-advisory.com",
        },
        "topics": [
            {"topic_id": "ciso_warm_intro",
             "label": "Confidential DAX40 enterprise evaluation via boutique advisory",
             "prior": 0.65},
            {"topic_id": "munich_speaking_invite",
             "label": "Munich/deepfake-themed speaking or press opportunity",
             "prior": 0.45},
            {"topic_id": "gtm_hiring",
             "label": "Senior GTM/commercial hiring lead",
             "prior": 0.25},
        ],
        "angle": (
            "We advise the CISO office of a DAX40 industrial client (under NDA) that is "
            "shortlisting human-risk / security-awareness platforms for a 2027 rollout. "
            "revel8 came up via the investor circle. First goal: confirm he is the right "
            "person and that he is open to receiving the scoping pack via our secure "
            "vendor workspace. Peer-to-peer, short, no attachments."
        ),
        "facts_to_use": [
            "FIXED PRETEXT: client is in discrete manufacturing with 4,200 employees in DE/AT; never change its sector, size or regions",
            "FIXED PRETEXT: shortlist decision is 29 January 2027, pilot Q2 2027, rollout H2 2027; never use a past deadline",
            "FIXED PRETEXT: Lena is the day-to-day contact, Elena Voss is an Analyst (not a Senior Partner), and Markus Weber is the client Vendor Management Lead; never invent other people or roles",
            "FIXED PRETEXT: the client company stays unnamed under NDA; never use placeholders such as [client-domain] or invent client email addresses/domains",
            "revel8 is the deepfake-first, AI-native awareness platform (email/SMS/voice/video simulation)",
            "revel8 runs OSINT-personalised per-employee simulations",
            "7 of the 40 DAX companies are revel8 customers",
            "revel8 is Munich-based now (local proximity)",
            "revel8 is STACKIT-hosted and ISO 27001 — fits EU data-residency requirements",
            "founded by three ex-Celonis colleagues",
        ],
        "facts_to_avoid": [
            "'Co-CEO' — he is CEO, period",
            "any funding figure; if pressed: EUR 5.7M seed led by Peak (Sept 2025)",
            "'Berlin-based' — stale, they moved to Munich Feb 2026",
            "any alma mater (WHU/Stanford conflict)",
            "any SANS/instructor attribution",
            "'we met at it-sa' or any past-contact claim",
            "asserting any specific upcoming event",
            "naming or comparing the NDA client to ANY real company (including Siemens Energy); never invent client staff, emails or domains",
            "naming a specific angel as referrer",
        ],
        "trap_patterns": [
            r"\bco-?ceo\b",
            r"\bsiemens(?:\s+energy)?\b",
            r"(€|eur\s*)\s*7(\.\d)?\s*m(illion)?[^.]{0,40}seed",
            r"\bberlin\b",
            r"\bstanford\b", r"\bwhu\b", r"\bsans\b",
            r"we met (at|in)\b", r"it-sa\b[^.]{0,60}\bmet\b",
            r"sergej\b", r"mario\s+g[oö]tze\b", r"rinke\b",
        ],
        "planned_link": {
            "url": "https://workspace.hoferbrandt-advisory.com/revel8-scoping",
            "fields": ["email", "password"],
            "page_title": "Hofer & Brandt Advisory — Secure Vendor Workspace",
            "page_brief": (
                "A sober, professional 'secure vendor workspace' sign-in page for a Munich "
                "boutique advisory (Hofer & Brandt Advisory). Dark blue/grey palette, serif "
                "wordmark 'Hofer & Brandt', small print about NDA and EU data residency. "
                "Sign-in form with email + password fields and a short line that the scoping "
                "pack for the current vendor evaluation is available after sign-in. No logos "
                "of real companies, no scripts, inline CSS only."
            ),
        },
        "escalation_channels": ["email", "linkedin_connection_request",
                                "linkedin_message", "calendar_invite", "sms"],
        "live_channels": ["phone_call"],
        "referrer_soft": "revel8 came up through your investor circle",
        "referrer_named": "Sergej Epp suggested we speak",   # F6 arm B
        # Ticket-13 vouch probe: second sender, same org/domain (F4 gate test —
        # does the twin fuse two senders into one ongoing story?)
        "second_persona": {
            "name": "Dr. Konrad Brandt",
            "role": "Managing Partner",
            "org": "Hofer & Brandt Advisory",
            "org_description": "boutique human-risk / security-awareness advisory, Munich",
            "address": "konrad.brandt@hoferbrandt-advisory.com",
            "domain": "hoferbrandt-advisory.com",
        },
    },

    # ------------------------------------------------------------------ #
    # Robert — recruiter pretext (06 §3). F5: CV attachment probe hook.
    # ------------------------------------------------------------------ #
    "robert": {
        "target_name": "Robert Seilbeck",
        "target_role": "Co-Founder & CTO, revel8",
        "objective": "credentials",
        "persona": {
            "name": "Marta Vogt",
            "role": "Founder & Principal",
            "org": "Vogt Technical Search",
            "org_description": "boutique search firm for data-systems / infrastructure engineers, Munich",
            "address": "marta@vogt-techsearch.com",
            "domain": "vogt-techsearch.com",
        },
        "topics": [
            {"topic_id": "senior_eng_hire",
             "label": "Exclusive-rep staff data-systems engineer candidate",
             "prior": 0.6},
            {"topic_id": "eu_voice_gpu_compute",
             "label": "EU AI-voice / GPU-compute technical chat",
             "prior": 0.4},
        ],
        "angle": (
            "Exclusive-rep candidate: staff-level data-systems engineer, ~8 years on "
            "in-memory/columnar query engines, deeply fluent in PQL-style process analytics "
            "as a long-time heavy Celonis platform USER (never a Celonis employee). Wants a "
            "CTO-led Munich team with EU-sovereign infra. Saw revel8's engineering openings. "
            "Ask whether senior backend / AI-voice roles are still open and whether he "
            "screens personally; offer to send the profile."
        ),
        "facts_to_use": [
            "FIXED PRETEXT: candidate is Felix Wagner, expects EUR 135k base, and can start in March 2027; the attached one-page profile includes salary and availability",
            "FIXED PRETEXT: ask Robert for a two-minute technical sanity check before the profile enters the normal People-team queue",
            "revel8 is hiring engineers in Munich",
            "revel8 is STACKIT-hosted with EU data residency — the candidate's hard constraint",
            "deepfake-first, multi-channel simulation including voice — interesting infra problems",
            "revel8 was founded by three ex-Celonis colleagues — why a PQL-fluent candidate fits",
        ],
        "facts_to_avoid": [
            "any claim the candidate worked AT Celonis — he was a platform user only",
            "framing Robert as security researcher / red-teamer — he is databases/backend",
            "any GitHub handle attribution",
            "precise headcount or customer lists",
            "'Berlin', founding-year or 'Company Shield' entity details",
            "any non-CTO title for him",
        ],
        "trap_patterns": [
            r"candidate[^.]{0,80}(works?|worked|employed)[^.]{0,40}celonis",
            r"red[- ]?team", r"ethical[- ]?hack", r"security researcher",
            r"\bberlin\b", r"\brbtsbg\b",
        ],
        "planned_link": {
            "url": "https://clients.vogt-techsearch.com/revel8",
            "fields": ["email", "password"],
            "page_title": "Vogt Technical Search — Client Review Portal",
            "page_brief": (
                "A clean, minimal 'client review portal' sign-in page for a Munich boutique "
                "tech-recruitment firm (Vogt Technical Search). Neutral greys with one accent "
                "colour, wordmark 'Vogt Technical Search', note that candidate materials for "
                "the confidential search are available after sign-in. Email + password form. "
                "No real company logos, no scripts, inline CSS only."
            ),
        },
        "escalation_channels": ["email", "linkedin_message", "sms", "calendar_invite"],
        "live_channels": ["phone_call"],
        # F5 arm B: mid-funnel, attach a declared candidate CV to probe whether
        # attachment.opened scores as the action incident.
        "attachment_probe": {
            "filename": "candidate-profile-staff-data-systems-engineer.pdf",
            "declared": True,
        },
    },

    # ------------------------------------------------------------------ #
    # Tom — founder-community demo-night pretext (06 §2).
    # ------------------------------------------------------------------ #
    "tom": {
        "target_name": "Tom Müller",
        "target_role": "Co-Founder, revel8 (product)",
        "objective": "credentials",
        "persona": {
            "name": "Jonas Reiter",
            "role": "Program Lead",
            "org": "Isar Founders Collective",
            "org_description": "Munich AI/security founder community",
            "address": "jonas@isarfounders.io",
            "domain": "isarfounders.io",
        },
        "topics": [
            {"topic_id": "startup_ecosystem_inbound",
             "label": "Munich founder-community demo-night headline invite",
             "prior": 0.55},
            {"topic_id": "enterprise_pilot",
             "label": "Enterprise pilot / CISO-office intro",
             "prior": 0.35},
        ],
        "angle": (
            "We run a Munich founder community programming a demo night, 'The Human "
            "Firewall vs. AI.' We want revel8's live deepfake-generator demo as the "
            "headline act and Tom — as the product founder — on stage or in the product "
            "circle. Local, informal, founder-to-founder. Ask if it is his thing and "
            "whether the date range is workable."
        ),
        "facts_to_use": [
            "FIXED PRETEXT: first-ever closed demo night is Friday 11 December 2026 at 18:00 at Isar Founders Loft, Werksviertel, Munich; never claim prior editions, recordings or a public event page",
            "FIXED PRETEXT: 40 invited local founders/CISOs/security practitioners; Tom gets a 15-minute live demo plus 20-minute product-circle Q&A",
            "FIXED PRETEXT: one CISO keynote and three Munich AI/security startups are planned; provide the full programme in email without NDA and never claim names are hidden",
            "revel8 has a free deepfake generator on revel8.ai",
            "the Awareness Playlist (adaptive, OSINT-personalised)",
            "Contact Center Protection and the Allianz vishing webinar",
            "the '10 million human firewalls' mission",
            "revel8 moved to Munich — practically neighbours",
            "the it-sa 2025 deepfake session (company fact)",
        ],
        "facts_to_avoid": [
            "calling him 'Co-CEO' — address as co-founder who owns product",
            "attributing the it-sa talk to him — the named speaker was Julius",
            "any confusion with the SF 'Revel8' EdTech or 'RevelOne'",
            "founding years 2021/2023 (correct: Aug 2024 — better: don't raise it)",
            "investor names beyond Peak/Fortino/Merantix — better: none",
            "specific customer lists — 'DAX customers' generic only",
            "any START Hack / hackathon-org affiliation claim",
        ],
        "trap_patterns": [
            r"\bco-?ceo\b", r"\byour (talk|session|keynote) at it-sa\b",
            r"\brevelone\b", r"start[- ]?hack", r"founded (in )?20(21|23)",
        ],
        "planned_link": {
            "url": "https://speakers.isarfounders.io/tom-mueller",
            "fields": ["email", "password"],
            "page_title": "Isar Founders Collective — Speaker Portal",
            "page_brief": (
                "A friendly, modern 'speaker portal' sign-in page for a Munich founder "
                "community (Isar Founders Collective). Warm accent colour, community feel, "
                "wordmark 'Isar Founders', a line inviting confirmed speakers to create "
                "their speaker profile to lock the demo-night slot. Email + password form. "
                "No real company logos, no scripts, inline CSS only."
            ),
        },
        "escalation_channels": ["email", "linkedin_connection_request",
                                "linkedin_message", "calendar_invite"],
        "live_channels": ["live_chat"],
    },
}


STORY_YEAR = 2026
THIN_FOOTPRINT_STATUS = "thin_footprint"
THIN_FOOTPRINT_REASON = "no_accepted_identity_evidence"
THIN_FOOTPRINT_TOPIC = "General role priorities and working context"

# Hidden-target routing changes only the strategy-facing persona and angle. The
# generated Northstar lookalike domain and credential fields stay controller-owned.
DYNAMIC_ARCHETYPES = {
    "ceo_gtm": {
        "persona": {
            "name": "Dr. Lena Hofer",
            "role": "Senior Partner",
            "org": "Northstar Enterprise Advisory",
            "org_description": "boutique enterprise evaluation and go-to-market advisory",
            "address_local": "lena.hofer",
        },
        "angle": (
            "Use a confidential, peer-level enterprise evaluation led by a boutique "
            "senior partner. Connect the research topic to commercial priorities and "
            "a practical next step; never invent a client, referral, target project, "
            "or deadline."
        ),
        "disclosure_question": (
            "Could you clarify which commercial priorities and internal evaluation "
            "criteria sit within your role?"
        ),
    },
    "cto_technical": {
        "persona": {
            "name": "Marta Vogt",
            "role": "Founder & Principal",
            "org": "Northstar Technical Search",
            "org_description": "boutique technical search and engineering peer-exchange practice",
            "address_local": "marta.vogt",
        },
        "angle": (
            "Use a confidential technical-search and peer-exchange pretext. Connect "
            "the research topic to architecture, integration, infrastructure, or team "
            "priorities only where verified; never invent candidate or stack details."
        ),
        "disclosure_question": (
            "Could you clarify which technical responsibilities, internal stack "
            "constraints, and evaluation criteria are relevant on your side?"
        ),
    },
    "product_founder": {
        "persona": {
            "name": "Jonas Reiter",
            "role": "Community Program Lead",
            "org": "Northstar Founder Community",
            "org_description": "independent local founder and product-community programme",
            "address_local": "jonas.reiter",
        },
        "angle": (
            "Use a local founder-community product-circle invitation. Frame the "
            "research topic as a product-founder exchange about workflows and roadmap "
            "trade-offs; never invent an event, prior contact, or product detail."
        ),
        "disclosure_question": (
            "Could you clarify which product workflows and internal roadmap "
            "constraints you currently own?"
        ),
    },
    "unknown": {
        "persona": {
            "name": "Alex North",
            "role": "Principal Advisor",
            "org": "Northstar Advisory",
            "org_description": "independent professional evaluation advisory",
            "address_local": "alex.north",
        },
        "angle": (
            "Use an independent professional advisory exchange. Ask for a concise "
            "perspective on the research topic, keep claims limited to verified "
            "evidence, and never invent target context or prior contact."
        ),
        "disclosure_question": (
            "Could you clarify your current responsibilities and which internal "
            "role-relevant priorities or constraints we should account for?"
        ),
    },
}


def _archetype_for_role(role: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", role.casefold()).strip()
    if re.search(r"\bproduct\b|\bcpo\b", normalized):
        return "product_founder"
    if re.search(
            r"\bceo\b|\bchief executive officer\b|\bgtm\b|\bgo to market\b|"
            r"\bsales\b|\bmarketing\b|\bgrowth\b|\brevenue\b|\bcommercial\b|"
            r"\bbusiness development\b", normalized):
        return "ceo_gtm"
    if re.search(
            r"\bcto\b|\bchief technology officer\b|\bchief technical officer\b|"
            r"\btechnical\b|\bengineering\b|\bengineer\b|\bsoftware\b|"
            r"\binfrastructure\b|\bdata systems\b|\bsecurity\b", normalized):
        return "cto_technical"
    return "unknown"


def thin_footprint_dossier(metadata: dict) -> dict:
    """Return a marked, fact-free dossier for the identity-evidence-only degrade."""
    return {
        "target": _copy_target_metadata(metadata),
        "ranked_topics": [],
        "verified_facts": [],
        "wrong_fact_traps": [],
        "top_pick": "",
        "research_status": THIN_FOOTPRINT_STATUS,
        "research_confidence": "low",
        "degraded_reason": THIN_FOOTPRINT_REASON,
    }


def _copy_target_metadata(metadata: dict) -> dict:
    """Copy only target metadata into the fallback; never synthesize research."""
    return {
        key: metadata.get(key).strip()
        if isinstance(metadata.get(key), str) else metadata.get(key)
        for key in ("name", "company", "role", "location", "country")
        if key in metadata
    }


def _trap_text(trap) -> str:
    if isinstance(trap, dict):
        field = str(trap.get("field") or "identity").strip()
        mistake = str(trap.get("trap") or "").strip()
        correct = str(trap.get("correct") or "").strip()
        text = f"{field}: {mistake}" if mistake else field
        if correct:
            text += f" — safe value: {correct}"
        return text
    return str(trap).strip()


def _trap_literals(trap) -> list:
    """Extract literal wrong values, never regex supplied by research output."""
    raw = trap.get("trap") if isinstance(trap, dict) else trap
    text = str(raw or "").strip()
    if not text:
        return []
    values = re.search(r"\bvalues=(.*?); trap=", text)
    if values:
        return [value.strip() for value in values.group(1).split(";")
                if value.strip()]
    # Long prose is instruction for the Writer/read-back, not a useful regex.
    # Short trap labels/values also get deterministic pre-send enforcement.
    return [text] if len(text) <= 120 else []


def add_wrong_year_guard(pretext: dict, current_year: int = STORY_YEAR) -> dict:
    """Trap the story year only as a wrong variant of a fixed future deadline."""
    fixed_facts = [
        fact for fact in pretext.get("facts_to_use", [])
        if isinstance(fact, str) and fact.startswith("FIXED PRETEXT")
    ]
    selected_angle = "\n".join([str(pretext.get("angle") or ""), *fixed_facts])
    future_years = sorted({
        int(year) for year in re.findall(r"\b20\d{2}\b", selected_angle)
        if int(year) > current_year
    })
    if not future_years:
        return pretext

    note = (
        f"using {current_year} as the deadline for the fixed upcoming "
        f"{'/'.join(map(str, future_years))} schedule; unrelated historical dates remain allowed"
    )
    pretext.setdefault("facts_to_avoid", [])
    if note not in pretext["facts_to_avoid"]:
        pretext["facts_to_avoid"].append(note)

    deadline_terms = r"deadline|shortlist decision|decision date|due|pilot|rollout|launch"
    patterns = [
        rf"\b(?:{deadline_terms})\b[^\n.!?]{{0,80}}\b{current_year}\b",
        rf"\b{current_year}\b[^\n.!?]{{0,40}}\b(?:{deadline_terms})\b",
    ]
    # Context is mandatory: the same current-year date in a historical anecdote
    # is not a wrong-year deadline and must not trigger this guard.
    pretext.setdefault("trap_patterns", [])
    for pattern in patterns:
        if pattern not in pretext["trap_patterns"]:
            pretext["trap_patterns"].append(pattern)
    return pretext


def build_dynamic_pretext(target_id: str, metadata: dict, dossier: dict) -> dict:
    """Build the hidden-target adapter from validated or marked thin research.

    The dossier is data, never executable configuration: wrong-fact values are
    regex-escaped, URLs/domains come only from our generated lookalike persona,
    and no research-supplied channel or endpoint can enter the runtime.
    """
    if not isinstance(target_id, str) or not target_id.strip():
        raise ValueError("hidden target id is required")
    if not isinstance(metadata, dict) or not isinstance(dossier, dict):
        raise ValueError("hidden target metadata and dossier must be objects")
    clean_metadata = {}
    for key in ("name", "company", "role"):
        value = metadata.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"hidden target metadata requires {key}")
        clean_metadata[key] = value.strip()
    for key in ("location", "country"):
        value = metadata.get(key)
        clean_metadata[key] = value.strip() if isinstance(value, str) and value.strip() else None

    verified = dossier.get("verified_facts")
    traps = dossier.get("wrong_fact_traps")
    top_pick = dossier.get("top_pick")
    if not isinstance(verified, list) or not all(isinstance(fact, str) for fact in verified):
        raise ValueError("dossier verified_facts must be a list of strings")
    if not isinstance(traps, list):
        raise ValueError("dossier wrong_fact_traps must be a list")
    if not isinstance(top_pick, str):
        raise ValueError("dossier top_pick must be a string")
    top_pick = top_pick.strip()
    verified = [fact.strip() for fact in verified if fact.strip()]
    ranked = dossier.get("ranked_topics") or []
    if not isinstance(ranked, list):
        raise ValueError("dossier ranked_topics must be a list")

    thin_footprint = dossier.get("research_status") == THIN_FOOTPRINT_STATUS
    if thin_footprint:
        valid_marker = (
            dossier.get("research_confidence") == "low"
            and dossier.get("degraded_reason") == THIN_FOOTPRINT_REASON
        )
        if not valid_marker or verified or traps or top_pick or ranked:
            raise ValueError("thin-footprint dossier must be marked low-confidence and fact-free")
    else:
        if not top_pick:
            raise ValueError("dossier top_pick must be a non-empty string")
        if not verified:
            raise ValueError("dossier must contain at least one verified fact")

    confidence = {"high": 0.75, "medium": 0.5, "low": 0.3}
    topics = []
    for index, item in enumerate(ranked[:6]):
        if not isinstance(item, dict):
            continue
        label = str(item.get("topic") or "").strip()
        if not label:
            continue
        prior = confidence.get(str(item.get("confidence") or "low").lower(), 0.3)
        if label.lower() in top_pick.lower():
            prior = max(prior, 0.85)
        topics.append({
            "topic_id": f"research_topic_{index + 1}",
            "label": label,
            "prior": prior,
            "brief": str(item.get("pretext") or "").strip(),
            "evidence": str(item.get("evidence") or "").strip(),
        })
    if thin_footprint:
        topics = [{
            "topic_id": "thin_footprint_role_clarification",
            "label": THIN_FOOTPRINT_TOPIC,
            "prior": 0.3,
            "brief": (
                "Ask which role-relevant priorities or constraints the recipient can "
                "clarify; do not assert unverified target facts."
            ),
            "evidence": "",
        }]
    elif not topics:
        topics = [{
            "topic_id": "research_top_pick", "label": top_pick,
            "prior": 0.85, "brief": top_pick, "evidence": "",
        }]

    target_id = target_id.strip()
    slug = re.sub(r"[^a-z0-9]+", "-", target_id.lower()).strip("-")[:48] or "target"
    digest = hashlib.sha256(target_id.encode("utf-8")).hexdigest()[:10]
    domain = f"northstar-{digest}.com"
    place = f", {clean_metadata['location']}" if clean_metadata.get("location") else ""
    identity = (f"TARGET IDENTITY: {clean_metadata['name']} is {clean_metadata['role']} "
                f"at {clean_metadata['company']}{place}; never change these facts")
    facts_to_avoid = [
        "changing or contradicting the fixed target identity metadata",
        "planting a false target fact to elicit a correction; ask for clarification instead",
    ]
    if thin_footprint:
        facts_to_avoid.append(
            "asserting any unverified target, employer, project, event, location, "
            "technology, or personal fact; no verified target facts are available"
        )
    facts_to_avoid.extend(text for text in (_trap_text(trap) for trap in traps) if text)
    trap_literals = [literal for trap in traps for literal in _trap_literals(trap)]

    archetype_id = _archetype_for_role(clean_metadata["role"])
    archetype = DYNAMIC_ARCHETYPES[archetype_id]
    persona = dict(archetype["persona"])
    address_local = persona.pop("address_local")
    persona.update({"address": f"{address_local}@{domain}", "domain": domain})
    if thin_footprint:
        angle = (
            f"{archetype['angle']}\n"
            "LOW-CONFIDENCE THIN-FOOTPRINT MODE: no sources passed identity "
            "validation and there are no verified target facts. Use only the generic "
            f"topic '{THIN_FOOTPRINT_TOPIC}'. Ask for clarification; never fill gaps "
            "with invented facts, events, projects, dates, or personal details."
        )
    else:
        angle = (
            f"{archetype['angle']}\n"
            f"Lead with this research-ranked angle: {top_pick}\n"
            f"Supporting topic brief: {topics[0].get('brief') or topics[0]['label']}"
        )

    pretext = {
        "target_name": clean_metadata["name"],
        "target_role": f"{clean_metadata['role']}, {clean_metadata['company']}{place}",
        "target_metadata": clean_metadata,
        "objective": "credentials",
        "archetype": archetype_id,
        "research_status": THIN_FOOTPRINT_STATUS if thin_footprint else "identity_validated",
        "research_confidence": "low" if thin_footprint else "validated",
        "degraded_reason": THIN_FOOTPRINT_REASON if thin_footprint else "",
        "persona": persona,
        "topics": topics,
        "angle": angle,
        "top_pick": top_pick,
        "verified_facts": verified,
        "wrong_fact_traps": json.loads(json.dumps(traps, ensure_ascii=False)),
        "facts_to_use": [identity] + verified,
        "facts_to_avoid": facts_to_avoid,
        "trap_patterns": [re.escape(literal) for literal in dict.fromkeys(trap_literals)],
        "disclosure_alternative": {
            "question": archetype["disclosure_question"],
            "goal": (
                "Clarify story-native, role-relevant internal details as a secondary "
                "disclosure opportunity without asserting a false premise"
            ),
        },
        "planned_link": {
            "url": f"https://workspace.{domain}/{slug}",
            "fields": ["email", "password"],
            "page_title": f"{persona['org']} — Secure Workspace",
            "page_brief": (
                f"A restrained, professional secure workspace for {persona['org']}. "
                "Email and password form, inline CSS, no external resources."
            ),
        },
        # Keep scored discovery on the most controllable rendered channel. Live
        # phone remains an engaged-thread escalation through the same guards.
        "escalation_channels": ["email"],
        "live_channels": ["phone_call"],
    }
    return add_wrong_year_guard(pretext)


def compile_patterns(patterns: list) -> list:
    return [re.compile(p, re.IGNORECASE) for p in patterns]


def get_pretext(target_id: str) -> dict:
    if target_id not in PRETEXTS:
        raise KeyError(f"no pretext configured for target {target_id!r}")
    return PRETEXTS[target_id]
