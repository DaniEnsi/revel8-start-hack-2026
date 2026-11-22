from __future__ import annotations

import io
import json
from urllib.error import HTTPError
import unittest
from unittest.mock import patch

from agent.llm import LLMError
from agent.tools import scenario_sweep as sweep


class ScenarioSweepTests(unittest.TestCase):
    def test_corpus_size_unique_ids_and_balanced_interleaving(self):
        self.assertEqual(len(sweep.DRAFTS), 12)
        self.assertEqual(len(sweep.POLICIES), 6)
        plan = list(sweep.schedule())
        self.assertEqual(len({fixture.id for _, fixture, _ in plan}), 18)
        self.assertEqual(len(plan), 54)
        for index, fixture in enumerate(sweep.DRAFTS):
            first, second, third, fourth = plan[4 * index:4 * index + 4]
            self.assertEqual([item[1] for item in (first, second, third, fourth)], [fixture] * 4)
            self.assertEqual([item[2] for item in (first, second, third, fourth)], [1, 1, 2, 2])
            self.assertEqual({first[0], second[0]}, set(sweep.WRITER_MODELS))
            self.assertEqual((first[0], second[0]), (fourth[0], third[0]))
        self.assertEqual(plan[-6:], [(sweep.PLANNER_MODEL, fixture, 1) for fixture in sweep.POLICIES])

    def test_real_programmatic_guards_on_fixed_drafts(self):
        for draft in sweep.DRAFTS:
            with self.subTest(draft=draft.id):
                issues = sweep.fixture_issues(draft)
                self.assertEqual(bool(issues), draft.programmatic_reject)
                expected_fragment = {
                    "wrong_fact": "wrong-fact trap hit",
                    "channel": "email formatting",
                    "injection": "injection/sim-breaking",
                }.get(draft.violation)
                if expected_fragment:
                    self.assertTrue(any(expected_fragment in issue for issue in issues), issues)

    def test_real_channel_policy_on_fixed_decisions(self):
        for policy in sweep.POLICIES:
            with self.subTest(policy=policy.id):
                self.assertEqual(sweep.fixture_issues(policy), [policy.issue] if policy.issue else [])

    def test_strict_json_separate_from_schema_validation(self):
        for raw in ("NaN", '{"pass": false, "pass": true}', '```json\n{}\n```', "{} extra"):
            with self.subTest(raw=raw):
                self.assertFalse(sweep.strict_json(raw))
        self.assertTrue(sweep.strict_json('[{"pass": true}]'))
        self.assertTrue(sweep.strict_json('{"pass": true}'))
        self.assertIsNone(sweep.verdict({"pass": 1}, policy=True))
        self.assertIsNone(sweep.verdict({"pass": True, "extra": True}, policy=True))
        self.assertIsNone(sweep.verdict(
            {"pass": True, "severity": "none", "issues": [], "fix_hint": "extra"},
            policy=False,
        ))

    def test_readback_requires_substance_review_in_any_language(self):
        instruction = ("Evaluate substance rather than language or style; never reject "
                       "a draft merely because it is not English.")
        self.assertIn(instruction, sweep.prompts.GUARD_SYSTEM)
        for fixture_id in (
                "munich-archive-de", "osaka-access-ja",
                "montreal-sequence-fr", "bogota-grounded-es"):
            fixture = next(draft for draft in sweep.DRAFTS if draft.id == fixture_id)
            with self.subTest(fixture=fixture_id):
                messages, _, _ = sweep.review_messages(fixture)
                self.assertIn(instruction, messages[0]["content"])

    def test_expected_rejection_is_a_success_after_production_repair(self):
        fixture = next(draft for draft in sweep.DRAFTS if draft.id == "wrong-fact")
        raw = json.dumps({"pass": False, "severity": "fatal", "issues": ["fact"], "fix_hint": ""})
        client = sweep.ObservedClient("https://provider.invalid", "fixture-model", "unused")
        with patch.object(sweep.ChatClient, "chat", side_effect=["no object", raw]) as chat:
            row = sweep.sample(client, fixture, 2)
        self.assertEqual(chat.call_args_list[0].kwargs["temperature"], 0.1)
        self.assertEqual(chat.call_args_list[1].kwargs["temperature"], 0.1)
        self.assertEqual(chat.call_args_list[1].kwargs["max_tokens"], 600)
        self.assertFalse(row["initial_strict_json"])
        self.assertTrue(row["final_strict_json"])
        self.assertTrue(row["json_repair_attempted"])
        self.assertFalse(row["model_pass"])
        self.assertTrue(row["model_expectation_met"])
        self.assertTrue(row["combined_expectation_met"])

    def test_false_model_pass_measured_even_when_programmatic_guard_catches_it(self):
        fixture = next(draft for draft in sweep.DRAFTS if draft.id == "wrong-fact")
        raw = '{"pass": true, "severity": "none", "issues": [], "fix_hint": ""}'
        client = sweep.ObservedClient("https://provider.invalid", "fixture-model", "unused")
        with patch.object(sweep.ChatClient, "chat", return_value=raw):
            row = sweep.sample(client, fixture, 1)
        self.assertEqual(row["model_accepted_violation"], "wrong_fact")
        self.assertFalse(row["model_expectation_met"])
        self.assertTrue(row["combined_expectation_met"])

    def test_provider_error_leaves_json_null_and_excludes_latency_summary(self):
        model = sweep.PLANNER_MODEL
        client = sweep.ObservedClient("https://provider.invalid", model, "unused")
        with patch.object(sweep.ChatClient, "chat", side_effect=LLMError(
                "scenario-review HTTP 403: private error body")):
            row = sweep.sample(client, sweep.POLICIES[0], 1)
        self.assertEqual(row["error"], "HTTP 403")
        self.assertIsNone(row["initial_strict_json"])
        self.assertIsNone(row["final_strict_json"])
        self.assertIsNone(row["model_pass"])
        result = sweep.summarize([row])[model]
        self.assertEqual(result["errors"], 1)
        self.assertEqual(result["latency_ms"]["n"], 0)

    def test_chat_transport_preserves_response_format_fallback_and_token_growth(self):
        client = sweep.ObservedClient("https://provider.invalid/v1", sweep.PLANNER_MODEL, "unused")
        url = "https://provider.invalid/v1/chat/completions"
        no_format = HTTPError(url, 400, "bad request", None, io.BytesIO(b"unsupported response_format"))
        length = io.BytesIO(b'{"choices":[{"message":{"content":null},"finish_reason":"length"}]}')
        completion = {"message": {"content": '{"pass": true}'}, "finish_reason": "stop"}
        valid = io.BytesIO(json.dumps({"choices": [completion]}).encode())
        with patch("agent.llm.urllib.request.urlopen", side_effect=[no_format, length, valid]) as request:
            row = sweep.sample(client, sweep.POLICIES[0], 1)

        requests = [call.args[0] for call in request.call_args_list]
        self.assertEqual([req.full_url for req in requests], [url] * 3)
        self.assertEqual([req.method for req in requests], ["POST"] * 3)
        payloads = [json.loads(req.data) for req in requests]
        self.assertIn("response_format", payloads[0])
        self.assertNotIn("response_format", payloads[1])
        self.assertEqual([body["max_tokens"] for body in payloads], [1800, 1800, 3600])
        self.assertTrue(row["model_expectation_met"])
        self.assertFalse(row["json_repair_attempted"])

    def test_failed_repair_keeps_initial_json_result(self):
        client = sweep.ObservedClient("https://provider.invalid", sweep.PLANNER_MODEL, "unused")
        with patch.object(sweep.ChatClient, "chat", side_effect=[
            "malformed", LLMError("scenario-review HTTP 500: private error body"),
        ]):
            row = sweep.sample(client, sweep.POLICIES[0], 1)
        self.assertTrue(row["json_repair_attempted"])
        self.assertFalse(row["initial_strict_json"])
        self.assertIsNone(row["final_strict_json"])


if __name__ == "__main__":
    unittest.main()
