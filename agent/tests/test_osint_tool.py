"""Unit tests for OSINT request wiring; all HTTP is mocked."""
from __future__ import annotations

import json
import unittest
from unittest import mock

from agent import osint_tool
from agent.llm import ChatClient


class _FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _research(cards, *, name="Tom Müller", company="revel8", role="Co-Founder", location="Munich,Bavaria,Germany", country="DE"):
    backend = mock.Mock(return_value=cards)
    with mock.patch.dict(osint_tool.BACKENDS, {"fixture": backend}), \
            mock.patch.object(osint_tool, "OSINT_BACKEND", "fixture"):
        return osint_tool.research(
            name, company, role, location=location, country=country,
        )


def _card(title, text, url="https://example.test/person", **kwargs):
    return osint_tool.Card(title=title, url=url, text=text, **kwargs)


class DiscoverTopicsRequestTests(unittest.TestCase):
    def test_gateway_headers_match_working_chatclient(self):
        dossier = {
            "target": {"name": "Example", "role": "Founder", "company": "revel8"},
            "ranked_topics": [{
                "rank": 1,
                "topic": "Security awareness",
                "pretext": "Discuss realistic simulations.",
                "evidence": "The supplied company page describes realistic simulations.",
                "confidence": "high",
            }],
            "verified_facts": ["Example is a founder at revel8."],
            "wrong_fact_traps": [],
            "top_pick": "Security awareness",
        }
        response = _FakeResponse(json.dumps({
            "choices": [{"message": {"content": json.dumps(dossier)}}],
        }).encode())
        profile = _research(
            [_card("Example — revel8", "Example is a founder at revel8, based in Munich.", "https://example.test/founder")],
            name="Example", company="revel8", role="Founder",
        )

        with mock.patch.object(osint_tool, "LLM_BASE_URL", "https://example.invalid/v1"), \
                mock.patch.object(osint_tool, "LLM_MODEL", "kimi-test"), \
                mock.patch.object(osint_tool, "LLM_API_KEY", "test-key"), \
                mock.patch.object(osint_tool.urllib.request, "urlopen", return_value=response) as urlopen:
            ChatClient("https://example.invalid/v1", "kimi-test", "test-key").chat(
                [{"role": "user", "content": "Return JSON."}], want_json=True,
            )
            result = osint_tool.discover_topics(profile)

        self.assertEqual(result, dossier)
        chat_request = urlopen.call_args_list[0].args[0]
        osint_request = urlopen.call_args_list[1].args[0]
        for header in ("User-agent", "Accept", "Authorization", "Content-type"):
            self.assertEqual(
                osint_request.get_header(header),
                chat_request.get_header(header),
                header,
            )
        self.assertTrue(osint_request.get_header("User-agent").startswith("Mozilla/5.0"))
        self.assertEqual(osint_request.get_header("Accept"), "application/json")


class QueryAndFirecrawlTests(unittest.TestCase):
    def test_queries_combine_then_relax_role_and_location(self):
        queries = osint_tool._queries(
            "Tom Müller", "revel8", "Co-Founder", "Munich,Bavaria,Germany",
        )
        self.assertIn('"Tom Müller" "revel8" Co-Founder Munich,Bavaria,Germany', queries[0])
        self.assertTrue(all('"Tom Müller" "revel8"' in query for query in queries))
        self.assertTrue(any("Co-Founder" not in query and "Munich" in query for query in queries))
        self.assertTrue(any("Co-Founder" in query and "Munich" not in query for query in queries))

    def test_firecrawl_uses_search_location_not_scrape_proxy_location(self):
        result = {
            "data": {"web": [{
                "title": "Tom Mueller — revel8",
                "url": "https://example.test/original",
                "description": "fallback snippet",
                "markdown": "Tom Mueller is Co-Founder of revel8, based in Munich.",
                "metadata": {
                    "sourceURL": "https://example.test/original",
                    "url": "https://example.test/final",
                    "statusCode": 200,
                },
            }]},
        }
        with mock.patch.object(osint_tool, "FIRECRAWL_API_KEY", "test-key"), \
                mock.patch.object(osint_tool, "_post_json", return_value=result) as post:
            cards = osint_tool._backend_firecrawl(
                ['"Tom Müller" "revel8"'], location="Munich,Bavaria,Germany", country="de",
            )
        body = post.call_args.args[1]
        self.assertEqual(body["location"], "Munich,Bavaria,Germany")
        self.assertEqual(body["country"], "DE")
        self.assertNotIn("location", body["scrapeOptions"])
        self.assertNotIn("country", body["scrapeOptions"])
        self.assertEqual(body["scrapeOptions"]["formats"], [{"type": "markdown"}])
        self.assertEqual(cards[0].source_url, "https://example.test/original")
        self.assertEqual(cards[0].final_url, "https://example.test/final")
        self.assertEqual(cards[0].content_kind, "scraped")

    def test_three_positional_arguments_remain_compatible(self):
        profile = _research(
            [_card("Example at revel8", "Example is a founder at revel8.")],
            name="Example", role="Founder", location=None, country=None,
        )
        self.assertIsInstance(profile, str)
        self.assertIn("name=exact", profile)
        self.assertIn("company:revel8", profile)

    def test_dedupe_prefers_scraped_content_over_longer_snippet(self):
        url = "https://example.test/person"
        cards = [
            _card("snippet", "x" * 500, url, content_kind="snippet"),
            _card("scraped", "full page", url, content_kind="scraped"),
        ]
        deduped = osint_tool._dedupe_cards(cards)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0].content_kind, "scraped")

    def test_size_budget_retains_later_accepted_source_metadata(self):
        cards = [
            _card("Tom Müller — first", "Tom Müller is Co-Founder of revel8, based in Munich.", "https://example.test/first"),
            _card("Tom Müller — second", "Tom Müller is Co-Founder of revel8, based in Munich.", "https://example.test/second"),
        ]
        with mock.patch.object(osint_tool, "MAX_CHARS", 0):
            profile = _research(cards)
        self.assertIn("https://example.test/second", profile)
        self.assertIn("Evidence text omitted by size budget", profile)

    def test_size_budget_preserves_evidence_from_multiple_sources(self):
        cards = [
            _card(
                "Tom Müller — first",
                "Tom Müller is Co-Founder of revel8, based in Munich. FIRST_SOURCE_ONLY " + "x" * 200,
                "https://example.test/first",
            ),
            _card(
                "Tom Müller — second",
                "Tom Müller is Co-Founder of revel8, based in Munich. SECOND_SOURCE_ONLY",
                "https://example.test/second",
            ),
        ]
        with mock.patch.object(osint_tool, "MAX_CHARS", 240):
            profile = _research(cards)
        self.assertIn("FIRST_SOURCE_ONLY", profile)
        self.assertIn("SECOND_SOURCE_ONLY", profile)

    def test_invalid_country_fails_before_network(self):
        backend = mock.Mock()
        with mock.patch.dict(osint_tool.BACKENDS, {"fixture": backend}), \
                mock.patch.object(osint_tool, "OSINT_BACKEND", "fixture"):
            with self.assertRaisesRegex(ValueError, "two-letter"):
                osint_tool.research("Example", "revel8", country="Germany")
        backend.assert_not_called()


class IdentityValidationTests(unittest.TestCase):
    def _assess(self, card, **overrides):
        target = {
            "name": "Tom Müller", "company": "revel8", "role": "Co-Founder",
            "location": "Munich,Bavaria,Germany", "country": "DE",
        }
        target.update(overrides)
        return osint_tool._validate_card(card, **target)

    def test_normalized_name_company_role_location_and_redirect_evidence(self):
        card = _card(
            "Tom Mueller — Co-Founder, revel8",
            "Tom Mueller is Co-Founder of revel8, based in Munich, Germany.",
            "https://example.test/final",
            source_url="https://example.test/redirect",
            final_url="https://example.test/final",
            status_code=200,
        )
        result = self._assess(card)
        self.assertTrue(result.accepted, result.reasons)
        self.assertEqual(result.name_match, "normalized")
        self.assertIn("company:revel8", result.signals)
        self.assertIn("role:Co-Founder", result.signals)
        self.assertTrue(any(signal.startswith("location:") for signal in result.signals))
        self.assertEqual(result.card.source_url, "https://example.test/redirect")

    def test_same_name_wrong_company_is_quarantined(self):
        result = self._assess(_card(
            "Tom Müller — CEO at Rivero",
            "Tom Müller is CEO at Rivero, based in Zurich, Switzerland.",
            "https://example.test/rivero",
        ))
        self.assertFalse(result.accepted)
        self.assertTrue(any("company" in reason for reason in result.reasons))
        self.assertIn("Rivero", result.conflict_values)

    def test_same_name_right_company_wrong_city_is_quarantined(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder at revel8, based in Berlin, Germany.",
            "https://example.test/berlin",
        ))
        self.assertFalse(result.accepted)
        self.assertTrue(any("conflicting location" in reason for reason in result.reasons))
        self.assertIn("Berlin", result.conflict_values)

    def test_country_location_does_not_reject_city_in_that_country(self):
        result = self._assess(
            _card(
                "Tom Müller — revel8",
                "Tom Müller is Co-Founder at revel8, based in Berlin, Germany.",
            ),
            location="Germany", country="DE",
        )
        self.assertTrue(result.accepted, result.reasons)
        self.assertIn("country:DE", result.signals)
        self.assertEqual(result.conflict_values, [])

    def test_german_wrong_city_demonym_is_quarantined(self):
        result = self._assess(_card(
            "revel8 mit 7 Millionen Euro Seed",
            "Das Berliner Startup revel8 wurde von Tom Müller mitgegründet.",
            "https://example.test/berlin-demonym",
        ))
        self.assertFalse(result.accepted, result.reasons)
        self.assertIn("Berlin", result.conflict_values)

    def test_current_location_with_historical_conflict_is_accepted_as_trap_only(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder of revel8, based in Munich. revel8 was formerly based in Berlin.",
        ))
        self.assertTrue(result.accepted, result.reasons)
        self.assertIn("Berlin", result.conflict_values)
        self.assertTrue(any("historical/unverified" in conflict for conflict in result.conflicts))

    def test_uppercase_industry_terms_are_not_location_conflicts(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder of revel8, based in Munich. revel8 has offices in AI.",
        ))
        self.assertTrue(result.accepted, result.reasons)
        self.assertNotIn("AI", result.conflict_values)

    def test_explicit_same_name_ambiguity_is_quarantined(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder of revel8, based in Munich. This is a different person from the footballer.",
        ))
        self.assertFalse(result.accepted)
        self.assertTrue(any("ambiguous" in reason for reason in result.reasons))

    def test_name_role_location_without_company_is_not_accepted(self):
        result = self._assess(_card(
            "Tom Müller — founder in Munich",
            "Tom Müller is a founder based in Munich; no employer is stated.",
        ))
        self.assertFalse(result.accepted)
        self.assertTrue(any("company" in reason for reason in result.reasons))

    def test_social_snippet_cannot_verify_identity_even_with_all_signals(self):
        result = self._assess(_card(
            "Tom Müller — Co-Founder at revel8 in Munich",
            "Tom Müller is Co-Founder at revel8, based in Munich.",
            "https://www.linkedin.com/in/tom-mueller",
            content_kind="snippet",
        ))
        self.assertFalse(result.accepted)
        self.assertTrue(any("social snippet" in reason for reason in result.reasons))

    def test_non_success_http_is_not_accepted(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder of revel8, based in Munich.",
            status_code=403,
        ))
        self.assertFalse(result.accepted)
        self.assertIn("HTTP status 403", result.reasons)

    def test_based_out_of_is_explicit_location_evidence(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is based out of Munich, Bavaria and is the Co-Founder of revel8.",
        ))
        self.assertTrue(result.accepted, result.reasons)
        self.assertIn("location:Munich,Bavaria,Germany", result.signals)

    def test_event_city_is_not_location_corroboration(self):
        result = self._assess(
            _card(
                "Julius Muth — revel8 events",
                "Julius Muth of revel8 spoke at a Munich event.",
            ),
            name="Julius Muth", role="CEO",
        )
        self.assertTrue(result.accepted, result.reasons)
        self.assertIn("location:not-corroborated", result.signals)
        self.assertNotIn("location:Munich,Bavaria,Germany", result.signals)

    def test_planned_relocation_does_not_override_current_location_conflict(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder of revel8. Founded in 2024 and headquartered in Berlin, "
            "with a relocation to Munich planned for early 2026, revel8 is expanding.",
        ))
        self.assertFalse(result.accepted)
        self.assertIn("Berlin", result.conflict_values)
        self.assertTrue(any("conflicting location" in reason for reason in result.reasons))

    def test_competitor_location_is_not_target_conflict(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder of revel8, based in Munich. revel8 adds mitigation features, "
            "whereas Frame is US-based and US-hosted.",
        ))
        self.assertTrue(result.accepted, result.reasons)
        self.assertNotIn("US", result.conflict_values)

    def test_based_out_of_does_not_swallow_role_clause(self):
        result = self._assess(_card(
            "Julius Muth — revel8",
            "Julius Muth is based out of Berlin and is the CEO and Co-Founder of revel8.",
        ), name="Julius Muth", role="CEO")
        self.assertFalse(result.accepted)
        self.assertEqual(result.conflict_values, ["Berlin"])

    def test_headquarters_table_is_explicit_location_evidence(self):
        result = self._assess(
            _card(
                "Grounding page — revel8",
                "| Founders | Julius Muth (CEO) |\n| Brand name | revel8 |\n"
                "| Headquarters | Sandstraße 3, 80335 Munich, Germany |",
            ),
            name="Julius Muth", role="CEO",
        )
        self.assertTrue(result.accepted, result.reasons)
        self.assertIn("location:Munich,Bavaria,Germany", result.signals)
        self.assertNotIn("location:not-corroborated", result.signals)

    def test_explicit_postal_address_conflict_is_quarantined(self):
        result = self._assess(_card(
            "Tom Müller — revel8",
            "Tom Müller is Co-Founder at revel8.\n\n# revel8\n\n"
            "[Max-Urich-Str. 3, AI Campus, Berlin, 13355, Germany]"
            "(https://www.google.com/maps/search/?api=1&query=Max-Urich-Str.+Berlin)",
        ))
        self.assertFalse(result.accepted)
        self.assertIn("Berlin", result.conflict_values)

    def test_verification_interstitial_is_not_accepted_evidence(self):
        result = self._assess(_card(
            "Tom Müller – Co-Founder at revel8",
            "Verifying your request\n\nYou'll be able to continue in a few seconds. Don't refresh this page.",
            "https://www.google.com/goto?url=example",
        ))
        self.assertFalse(result.accepted)
        self.assertTrue(any("interstitial" in reason for reason in result.reasons))

    def test_german_in_city_ansässig_conflict_is_quarantined(self):
        result = self._assess(
            _card(
                "Robert Seilbeck — revel8",
                "Robert Seilbeck ist Co-Founder & CTO von revel8. 4.65/5 on kununu.\n\n"
                "## Unsere Geschichte\n\nWir sind ein in Berlin ansässiges Team (früher Company Shield).",
            ),
            name="Robert Seilbeck", role="Co-Founder & CTO",
        )
        self.assertFalse(result.accepted)
        self.assertIn("Berlin", result.conflict_values)

    def test_osint_capability_is_not_a_location_conflict(self):
        result = self._assess(
            _card(
                "Robert Seilbeck — revel8",
                "Robert Seilbeck is Co-Founder & CTO at revel8, based in Munich. "
                "revel8 has offices in OSINT.",
            ),
            name="Robert Seilbeck", role="Co-Founder & CTO",
        )
        self.assertTrue(result.accepted, result.reasons)
        self.assertNotIn("OSINT", result.conflict_values)


class NegativeControlPipelineTests(unittest.TestCase):
    def test_quarantined_people_and_places_cannot_become_verified_facts(self):
        accepted_text = "Tom Müller is Co-Founder of revel8, based in Munich. ACCEPTED_EVIDENCE_ONLY."
        profile = _research([
            _card("Tom Müller — revel8", accepted_text, "https://example.test/accepted"),
            _card(
                "Tom Müller — CEO at Rivero",
                "Tom Müller is CEO at Rivero, based in Zurich. WRONG_COMPANY_RAW_TEXT.",
                "https://example.test/wrong-company",
            ),
            _card(
                "Tom Müller — revel8 Berlin",
                "Tom Müller is Co-Founder at revel8, based in Berlin. WRONG_CITY_RAW_TEXT.",
                "https://example.test/wrong-city",
            ),
        ])
        self.assertIn("ACCEPTED_EVIDENCE_ONLY", profile)
        self.assertNotIn("WRONG_COMPANY_RAW_TEXT", profile)
        self.assertNotIn("WRONG_CITY_RAW_TEXT", profile)
        validated, conflicts = osint_tool._validated_profile_for_llm(profile)
        self.assertIn("ACCEPTED_EVIDENCE_ONLY", validated)
        self.assertNotIn("WRONG_COMPANY_RAW_TEXT", validated)
        self.assertNotIn("WRONG_CITY_RAW_TEXT", validated)
        self.assertTrue(any("Rivero" in conflict for conflict in conflicts))
        self.assertTrue(any("Berlin" in conflict for conflict in conflicts))

        planner_output = {
            "target": {"name": "Tom Müller", "role": "Co-Founder", "company": "revel8"},
            "ranked_topics": [],
            "verified_facts": [
                "Tom Müller is Co-Founder of revel8.",
                "Tom Müller is CEO at Rivero.",
                "Tom Müller is based in Berlin.",
            ],
            "wrong_fact_traps": [],
            "top_pick": "none",
        }
        response = _FakeResponse(json.dumps({
            "choices": [{"message": {"content": json.dumps(planner_output)}}],
        }).encode())
        with mock.patch.object(osint_tool.urllib.request, "urlopen", return_value=response) as urlopen:
            dossier = osint_tool.discover_topics(profile)
        request_body = json.loads(urlopen.call_args.args[0].data)
        prompt = request_body["messages"][1]["content"]
        self.assertNotIn("QUARANTINED SOURCES", prompt)
        self.assertNotIn("WRONG_COMPANY_RAW_TEXT", prompt)
        self.assertNotIn("WRONG_CITY_RAW_TEXT", prompt)
        self.assertEqual(dossier["verified_facts"], ["Tom Müller is Co-Founder of revel8."])
        trap_text = json.dumps(dossier["wrong_fact_traps"], ensure_ascii=False)
        self.assertIn("Rivero", trap_text)
        self.assertIn("Berlin", trap_text)

    def test_raw_or_empty_research_never_calls_planner(self):
        for profile in ("Tom Müller is a founder at revel8.", _research([])):
            with self.subTest(profile=profile[:30]):
                with mock.patch.object(osint_tool.urllib.request, "urlopen") as urlopen:
                    with self.assertRaises(ValueError):
                        osint_tool.discover_topics(profile)
                urlopen.assert_not_called()

    def test_rejected_raw_text_appears_only_in_quarantine_section(self):
        profile = _research([
            _card("Tom Müller — revel8", "Tom Müller is Co-Founder of revel8, based in Munich."),
            _card(
                "Tom Müller — Rivero",
                "Tom Müller is CEO at Rivero. DO_NOT_SEND_THIS_RAW_RECORD.",
                "https://example.test/rivero",
            ),
        ])
        accepted = profile.split(osint_tool._ACCEPTED_START, 1)[1].split(osint_tool._ACCEPTED_END, 1)[0]
        quarantine = profile.split(osint_tool._QUARANTINE_START, 1)[1]
        self.assertNotIn("DO_NOT_SEND_THIS_RAW_RECORD", accepted)
        # Quarantine intentionally stores metadata/reasons, not the rejected page body.
        self.assertNotIn("DO_NOT_SEND_THIS_RAW_RECORD", quarantine)


if __name__ == "__main__":
    unittest.main()
