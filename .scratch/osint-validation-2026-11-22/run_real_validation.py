"""Run the requested real and synthetic OSINT validation without Target API access."""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from agent import osint_tool as osint  # noqa: E402
from agent.loop import _research_with_thin_footprint_fallback  # noqa: E402
from agent.pretexts import build_dynamic_pretext  # noqa: E402

OUT = Path(__file__).resolve().parent
LOCATION = "Munich,Bavaria,Germany"
COUNTRY = "DE"
SPACING_SECONDS = 65.0
TARGETS = [
    {"slug": "julius-muth", "name": "Julius Muth", "company": "revel8", "role": "Co-Founder & CEO"},
    {"slug": "tom-muller", "name": "Tom Müller", "company": "revel8", "role": "Co-Founder"},
    {"slug": "robert-seilbeck", "name": "Robert Seilbeck", "company": "revel8", "role": "Co-Founder & CTO"},
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(name: str, value) -> None:
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_profile(profile: str) -> dict:
    accepted = profile.split(osint._ACCEPTED_START, 1)[1].split(osint._ACCEPTED_END, 1)[0]
    conflicts = profile.split(osint._CONFLICTS_START, 1)[1].split(osint._CONFLICTS_END, 1)[0]
    quarantine = profile.split(osint._QUARANTINE_START, 1)[1].split(osint._QUARANTINE_END, 1)[0]
    accepted_pattern = re.compile(
        r"(?m)^## (.*?)\nSource URL: (.*?)\nFinal URL: (.*?)\n"
        r"Identity: (.*?)\nContent: (.*?)\n\n"
    )
    accepted_sources = [
        {
            "title": match.group(1),
            "source_url": match.group(2),
            "final_url": match.group(3),
            "identity": match.group(4),
            "content": match.group(5),
        }
        for match in accepted_pattern.finditer(accepted)
    ]
    rejected = []
    rejected_pattern = re.compile(
        r"(?m)^- REJECTED: (.*?) \| Source URL: (.*?) \| Final URL: (.*?) \| "
        r"name=(.*?) \| reasons=(.*)$"
    )
    for match in rejected_pattern.finditer(quarantine):
        rejected.append({
            "title": match.group(1),
            "source_url": match.group(2),
            "final_url": match.group(3),
            "name_match": match.group(4),
            "reasons": match.group(5).split("; "),
        })
    conflict_lines = re.findall(r"(?m)^- (field=.*)$", conflicts)
    return {
        "accepted_count": len(accepted_sources),
        "quarantined_count": len(rejected),
        "accepted_sources": accepted_sources,
        "quarantined_sources": rejected,
        "conflicts": conflict_lines,
    }


def conflict_values(conflicts: list[str]) -> list[str]:
    values = []
    for line in conflicts:
        match = re.search(r"values=(.*?); trap=", line)
        if match:
            values.extend(value.strip() for value in match.group(1).split(";") if value.strip())
    return list(dict.fromkeys(values))


def potential_leaks(dossier: dict, conflicts: list[str]) -> list[dict]:
    """Flag conflict values outside wrong_fact_traps for manual evidence review."""
    surfaces = []
    for fact in dossier.get("verified_facts") or []:
        surfaces.append({"surface": "verified_facts", "text": str(fact)})
    for topic in dossier.get("ranked_topics") or []:
        surfaces.append({"surface": "ranked_topics", "text": json.dumps(topic, ensure_ascii=False)})
    surfaces.append({"surface": "top_pick", "text": str(dossier.get("top_pick") or "")})
    leaks = []
    for surface in surfaces:
        hits = [
            value for value in conflict_values(conflicts)
            if osint._has_phrase(osint._normalize(surface["text"]), value)
        ]
        if hits:
            leaks.append({**surface, "conflict_values": hits})
    return leaks


def synthetic_controls() -> dict:
    name = "Tom Müller"
    company = "revel8"
    role = "Co-Founder"
    metadata = {"name": name, "company": company, "role": role, "location": LOCATION, "country": COUNTRY}
    accepted_text = "Tom Müller is Co-Founder of revel8, based in Munich. ACCEPTED_EVIDENCE_ONLY."
    negative_cards = [
        osint.Card("Tom Müller — revel8", "https://example.test/accepted", accepted_text, status_code=200),
        osint.Card(
            "Tom Müller — CEO at Rivero",
            "https://example.test/wrong-company",
            "Tom Müller is CEO at Rivero, based in Zurich. WRONG_COMPANY_RAW_TEXT.",
            status_code=200,
        ),
        osint.Card(
            "Tom Müller — revel8 Berlin",
            "https://example.test/wrong-city",
            "Tom Müller is Co-Founder at revel8, based in Berlin. WRONG_CITY_RAW_TEXT.",
            status_code=200,
        ),
    ]

    def backend(cards):
        return lambda queries, **kwargs: list(cards)

    with mock.patch.dict(osint.BACKENDS, {"fixture": backend(negative_cards)}), \
            mock.patch.object(osint, "OSINT_BACKEND", "fixture"):
        negative_profile = osint.research(name, company, role, location=LOCATION, country=COUNTRY)
    (OUT / "synthetic-negative.profile.md").write_text(negative_profile + "\n", encoding="utf-8")
    negative = parse_profile(negative_profile)
    validated, conflict_lines = osint._validated_profile_for_llm(negative_profile)
    assert negative["accepted_count"] == 1 and negative["quarantined_count"] == 2
    assert "ACCEPTED_EVIDENCE_ONLY" in validated
    assert "WRONG_COMPANY_RAW_TEXT" not in negative_profile
    assert "WRONG_CITY_RAW_TEXT" not in negative_profile
    assert "QUARANTINED SOURCES" not in validated

    adversarial_planner_output = {
        "target": {"name": name, "role": role, "company": company},
        "ranked_topics": [],
        "verified_facts": [
            "Tom Müller is Co-Founder of revel8.",
            "Tom Müller is CEO at Rivero.",
            "Tom Müller is based in Berlin.",
        ],
        "wrong_fact_traps": [],
        "top_pick": "Security awareness",
    }

    def fake_planner(url, payload, headers):
        assert urlsplit(url).hostname == urlsplit(osint.LLM_BASE_URL).hostname
        assert payload["model"] == osint.LLM_MODEL
        return {"choices": [{"message": {"content": json.dumps(adversarial_planner_output)}}]}

    with mock.patch.object(osint, "_post_json", side_effect=fake_planner) as planner:
        negative_dossier = osint.discover_topics(negative_profile)
    assert planner.call_count == 1
    assert negative_dossier["verified_facts"] == ["Tom Müller is Co-Founder of revel8."]
    trap_text = json.dumps(negative_dossier["wrong_fact_traps"], ensure_ascii=False)
    assert "Rivero" in trap_text and "Berlin" in trap_text
    negative.update({
        "raw_wrong_company_text_in_profile": "WRONG_COMPANY_RAW_TEXT" in negative_profile,
        "raw_wrong_city_text_in_profile": "WRONG_CITY_RAW_TEXT" in negative_profile,
        "quarantine_sent_to_planner": "QUARANTINED SOURCES" in validated,
        "verified_facts_after_conflict_filter": negative_dossier["verified_facts"],
        "wrong_fact_traps": negative_dossier["wrong_fact_traps"],
        "potential_leaks_outside_traps": potential_leaks(negative_dossier, conflict_lines),
    })

    thin_cards = negative_cards[1:]
    with mock.patch.dict(osint.BACKENDS, {"fixture": backend(thin_cards)}), \
            mock.patch.object(osint, "OSINT_BACKEND", "fixture"):
        thin_profile = osint.research(name, company, role, location=LOCATION, country=COUNTRY)
        with mock.patch.object(
            osint, "_post_json", side_effect=AssertionError("Kimi/network must not be called")
        ) as planner:
            try:
                osint.discover_topics(thin_profile)
                direct_error = "expected no-accepted-evidence error was not raised"
            except ValueError as error:
                direct_error = str(error)
            thin_dossier = _research_with_thin_footprint_fallback(metadata)
        planner.assert_not_called()
    (OUT / "synthetic-thin.profile.md").write_text(thin_profile + "\n", encoding="utf-8")
    write_json("synthetic-thin.dossier.json", thin_dossier)
    thin = parse_profile(thin_profile)
    assert thin["accepted_count"] == 0 and thin["quarantined_count"] == 2
    assert direct_error == "no accepted identity evidence; Planner was not called"
    assert thin_dossier["research_status"] == "thin_footprint"
    assert thin_dossier["research_confidence"] == "low"
    assert thin_dossier["degraded_reason"] == "no_accepted_identity_evidence"
    assert thin_dossier["ranked_topics"] == []
    assert thin_dossier["verified_facts"] == []
    assert thin_dossier["wrong_fact_traps"] == []
    assert thin_dossier["top_pick"] == ""
    downstream = build_dynamic_pretext("synthetic-thin", metadata, thin_dossier)
    assert downstream["research_confidence"] == "low"
    assert downstream["verified_facts"] == []
    assert downstream["wrong_fact_traps"] == []
    assert len(downstream["facts_to_use"]) == 1
    thin.update({
        "direct_identity_gate_outcome": direct_error,
        "kimi_calls": planner.call_count,
        "dossier": thin_dossier,
        "downstream_status": downstream["research_status"],
        "downstream_confidence": downstream["research_confidence"],
        "downstream_verified_facts": downstream["verified_facts"],
        "downstream_fact_anchors": downstream["facts_to_use"],
        "downstream_generic_topic": downstream["topics"][0]["label"],
    })
    result = {"negative_control": negative, "thin_footprint": thin}
    write_json("synthetic-controls.json", result)
    return result


def main() -> int:
    summary = {
        "started_at": utc_now(),
        "backend": osint.OSINT_BACKEND,
        "model": osint.LLM_MODEL,
        "requested_location": LOCATION,
        "requested_country": COUNTRY,
        "firecrawl_spacing_seconds": SPACING_SECONDS,
        "target_api_calls": 0,
        "real_targets": {},
        "request_log": [],
    }
    print("Running synthetic controls (no network)...", flush=True)
    summary["synthetic_controls"] = synthetic_controls()
    write_json("validation-summary.json", summary)
    print("Synthetic controls passed; starting real Firecrawl/Kimi validation.", flush=True)

    original_post = osint._post_json
    allowed_hosts = {"api.firecrawl.dev", urlsplit(osint.LLM_BASE_URL).hostname}
    last_firecrawl_start = None

    def guarded_post(url, payload, headers):
        nonlocal last_firecrawl_start
        host = urlsplit(url).hostname
        if host not in allowed_hosts:
            raise AssertionError(f"Blocked non-Firecrawl/non-Kimi request host: {host}")
        if host != "api.firecrawl.dev":
            entry = {"provider": "kimi", "started_at": utc_now(), "model": payload.get("model")}
            summary["request_log"].append(entry)
            try:
                result = original_post(url, payload, headers)
                entry["outcome"] = "success"
                return result
            except Exception as error:
                entry["outcome"] = type(error).__name__
                raise
            finally:
                entry["completed_at"] = utc_now()

        for attempt in range(1, 5):
            if last_firecrawl_start is not None:
                wait = SPACING_SECONDS - (time.monotonic() - last_firecrawl_start)
                if wait > 0:
                    print(f"Waiting {wait:.1f}s before next Firecrawl attempt...", flush=True)
                    time.sleep(wait)
            last_firecrawl_start = time.monotonic()
            entry = {
                "provider": "firecrawl",
                "attempt": attempt,
                "started_at": utc_now(),
                "query": payload.get("query"),
                "location": payload.get("location"),
                "country": payload.get("country"),
            }
            summary["request_log"].append(entry)
            print(
                f"Firecrawl request {len([x for x in summary['request_log'] if x['provider'] == 'firecrawl'])}"
                f" (attempt {attempt}): {payload.get('query')}",
                flush=True,
            )
            try:
                result = original_post(url, payload, headers)
                entry["outcome"] = "success"
                return result
            except urllib.error.HTTPError as error:
                code = error.code
                entry["outcome"] = f"HTTP {code}"
                error.close()
                if code != 429 or attempt == 4:
                    raise RuntimeError(f"Firecrawl HTTP {code} after attempt {attempt}") from None
                print("Firecrawl HTTP 429; retrying with 65s spacing.", flush=True)
            except Exception as error:
                entry["outcome"] = type(error).__name__
                raise
            finally:
                entry["completed_at"] = utc_now()
        raise AssertionError("unreachable")

    with mock.patch.object(osint, "_post_json", side_effect=guarded_post):
        for target in TARGETS:
            slug = target.pop("slug")
            print(f"Researching {target['name']}...", flush=True)
            record = {"metadata": {**target, "location": LOCATION, "country": COUNTRY}}
            summary["real_targets"][slug] = record
            try:
                profile = osint.research(
                    target["name"], target["company"], target["role"],
                    location=LOCATION, country=COUNTRY,
                )
                (OUT / f"{slug}.profile.md").write_text(profile + "\n", encoding="utf-8")
                record.update(parse_profile(profile))
                write_json("validation-summary.json", summary)
                print(
                    f"{target['name']}: {record['accepted_count']} accepted, "
                    f"{record['quarantined_count']} quarantined; calling Kimi...",
                    flush=True,
                )
                dossier = osint.discover_topics(profile)
                write_json(f"{slug}.dossier.json", dossier)
                record["potential_conflict_value_leakage_outside_traps"] = potential_leaks(
                    dossier, record["conflicts"]
                )
                record["dossier"] = dossier
                print(f"{target['name']}: Kimi dossier saved.", flush=True)
            except Exception as error:
                record["error"] = f"{type(error).__name__}: {error}"
                print(f"{target['name']}: {record['error']}", flush=True)
            write_json("validation-summary.json", summary)

    summary["completed_at"] = utc_now()
    write_json("validation-summary.json", summary)
    print(f"Validation artifacts written to {OUT}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
