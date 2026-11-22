"""Planner secondary-provider regressions; every HTTP boundary is mocked."""
from __future__ import annotations

import copy
import json
import os
import tempfile
import types
import unittest
import urllib.error
from unittest import mock

from agent import llm
from agent.config import Config
from agent.llm import ChatClient, LLMError, planner_fallback_client
from agent.loop import SessionRunner
from agent.pretexts import get_pretext
from agent.state import SenderIdentity, SessionState, TopicHypothesis


def _valid_plan():
    return {
        "analysis": "secondary provider plan",
        "engagement": "none",
        "topic_updates": {"vendor": 0.5},
        "suspicion": 0.1,
        "suspicion_reason": "baseline",
        "disclosure_incident": False,
        "decision": {
            "action": "probe",
            "topic_id": "vendor",
            "channel": "email",
            "reason": "test the secondary",
        },
        "writer_brief": {
            "goal": "confirm interest",
            "angle": "peer review",
            "tone": "concise",
            "key_points": [],
            "asserted_facts": [],
            "cta": "short reply",
        },
    }


class _Response:
    def __init__(self, content):
        self.body = json.dumps({
            "choices": [{"message": {"role": "assistant", "content": content}}],
        }).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class PlannerFallbackConfigTests(unittest.TestCase):
    def test_writer_defaults_and_explicit_overrides(self):
        values = {
            "WRITER_BASE_URL": "https://writer.invalid/v1/",
            "WRITER_MODEL": "writer-model",
            "WRITER_API_KEY": "writer-key",
            "PLANNER_BASE_URL": "https://planner.invalid/v1",
            "PLANNER_MODEL": "planner-model",
            "PLANNER_API_KEY": "planner-key",
        }

        def get(key, default=""):
            return values.get(key, default)

        with mock.patch("agent.config._get", side_effect=get):
            default = Config()
            self.assertEqual(default.planner_fallback_base_url,
                             "https://writer.invalid/v1")
            self.assertEqual(default.planner_fallback_model, "writer-model")
            self.assertEqual(default.planner_fallback_api_key, "writer-key")

            values.update({
                "PLANNER_FALLBACK_BASE_URL": "https://fallback.invalid/v2/",
                "PLANNER_FALLBACK_MODEL": "fallback-model",
                "PLANNER_FALLBACK_API_KEY": "fallback-key",
            })
            override = Config()
            self.assertEqual(override.planner_fallback_base_url,
                             "https://fallback.invalid/v2")
            self.assertEqual(override.planner_fallback_model, "fallback-model")
            self.assertEqual(override.planner_fallback_api_key, "fallback-key")


class WriterFallbackConfigTests(unittest.TestCase):
    def test_writer_fallback_defaults_to_planner_then_planner_fallback(self):
        values = {
            "WRITER_BASE_URL": "https://writer.invalid/v1/",
            "WRITER_MODEL": "writer-model",
            "WRITER_API_KEY": "writer-key",
            "PLANNER_BASE_URL": "https://planner.invalid/v1/",
            "PLANNER_MODEL": "planner-model",
            "PLANNER_API_KEY": "planner-key",
        }

        def get(key, default=""):
            return values.get(key, default)

        with mock.patch("agent.config._get", side_effect=get):
            planner_default = Config()
            self.assertEqual(planner_default.writer_fallback_base_url,
                             "https://planner.invalid/v1")
            self.assertEqual(planner_default.writer_fallback_model, "planner-model")
            self.assertEqual(planner_default.writer_fallback_api_key, "planner-key")

            values.update({
                "PLANNER_FALLBACK_BASE_URL": "https://planner-fallback.invalid/v2/",
                "PLANNER_FALLBACK_MODEL": "planner-fallback-model",
                "PLANNER_FALLBACK_API_KEY": "planner-fallback-key",
            })
            secondary_default = Config()
            self.assertEqual(secondary_default.writer_fallback_base_url,
                             "https://planner-fallback.invalid/v2")
            self.assertEqual(secondary_default.writer_fallback_model,
                             "planner-fallback-model")
            self.assertEqual(secondary_default.writer_fallback_api_key,
                             "planner-fallback-key")

            values.update({
                "WRITER_FALLBACK_BASE_URL": "https://writer-fallback.invalid/v3/",
                "WRITER_FALLBACK_MODEL": "writer-fallback-model",
                "WRITER_FALLBACK_API_KEY": "writer-fallback-key",
            })
            override = Config()
            self.assertEqual(override.writer_fallback_base_url,
                             "https://writer-fallback.invalid/v3")
            self.assertEqual(override.writer_fallback_model, "writer-fallback-model")
            self.assertEqual(override.writer_fallback_api_key, "writer-fallback-key")


class PlannerFallbackLoopTests(unittest.TestCase):
    def setUp(self):
        # Any unmocked model request is a test failure, never a live call.
        guard = mock.patch("agent.llm.urllib.request.urlopen",
                           side_effect=AssertionError("real LLM HTTP forbidden"))
        guard.start()
        self.addCleanup(guard.stop)

    def _runner(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        runner = SessionRunner.__new__(SessionRunner)
        runner.scenario = "practice"
        runner.target_id = "julius"
        runner.arms = {"f2": "link_free", "f4": "single", "f5": "credentials",
                       "f6": "soft"}
        runner.cfg = types.SimpleNamespace(
            playbook_path=os.path.join(temp.name, "playbook.json"),
            probe_cap_frac=0.3,
        )
        runner.pretext = copy.deepcopy(get_pretext("julius"))
        persona = SenderIdentity(
            name="Dr. Lena Hofer", role="Senior Partner", org="Hofer & Brandt",
            address="lena@example.test", domain="example.test")
        topic = TopicHypothesis(
            topic_id="vendor", label="Vendor evaluation", prior=0.4, confidence=0.4)
        runner.state = SessionState(
            session_id="s1", scenario_id="practice", target_id="julius", budget=10,
            topics=[topic], persona=persona, identities_used=[persona])
        runner.planner = mock.Mock()
        runner.planner_fallback = mock.Mock()
        runner.planner_fallback.model = "fallback-model"
        runner._fallback_plan = mock.Mock(return_value={
            "analysis": "deterministic",
            "decision": {"action": "probe", "topic_id": "vendor", "channel": "email"},
            "writer_brief": {},
        })
        return runner

    def test_primary_network_refusal_and_timeout_use_one_fallback_call(self):
        for reason in ("network error", "provider refusal", "request timeout"):
            with self.subTest(reason=reason):
                runner = self._runner()
                runner.planner.chat_json.side_effect = LLMError(reason)
                runner.planner_fallback.chat_json.return_value = (_valid_plan(), "{}")
                with mock.patch("agent.loop.log_line") as logged:
                    plan, fallbacks = runner._plan([], forced_strike=False)

                self.assertEqual(plan["analysis"], "secondary provider plan")
                runner.planner.chat_json.assert_called_once()
                runner.planner_fallback.chat_json.assert_called_once()
                runner._fallback_plan.assert_not_called()
                primary = runner.planner.chat_json.call_args
                secondary = runner.planner_fallback.chat_json.call_args
                self.assertEqual(secondary.args[0], primary.args[0])
                self.assertEqual(primary.kwargs,
                                 {"temperature": 0.35, "max_tokens": 1800})
                self.assertEqual(secondary.kwargs, {
                    "temperature": 0.35, "max_tokens": 1800,
                    "repair": False, "max_retries": 0,
                })
                self.assertTrue(any("planner_primary_failed" in item
                                    for item in fallbacks))
                self.assertIn("planner_fallback_used: fallback-model", fallbacks)
                lines = [call.args[0] for call in logged.call_args_list]
                self.assertTrue(any("planner_fallback_used: fallback-model" in line
                                    for line in lines))

    def test_invalid_primary_structures_trigger_fallback(self):
        invalid = (
            ["not", "an", "object"],
            {"analysis": "decision missing"},
            {"decision": ["not", "an", "object"]},
            {"decision": {}, "topic_updates": []},
            {"decision": {}, "writer_brief": []},
        )
        for output in invalid:
            with self.subTest(output=output):
                runner = self._runner()
                runner.planner.chat_json.return_value = (output, json.dumps(output))
                runner.planner_fallback.chat_json.return_value = (_valid_plan(), "{}")
                plan, fallbacks = runner._plan([], forced_strike=False)
                self.assertEqual(plan["decision"]["action"], "probe")
                runner.planner_fallback.chat_json.assert_called_once()
                runner._fallback_plan.assert_not_called()
                self.assertTrue(any("invalid structured output" in item
                                    for item in fallbacks))

    def test_primary_success_does_not_call_fallback(self):
        runner = self._runner()
        runner.planner.chat_json.return_value = (_valid_plan(), "{}")
        plan, fallbacks = runner._plan([], forced_strike=False)
        self.assertEqual(plan["analysis"], "secondary provider plan")
        self.assertEqual(fallbacks, [])
        runner.planner_fallback.chat_json.assert_not_called()
        runner._fallback_plan.assert_not_called()

    def test_both_failed_or_invalid_providers_use_deterministic_plan(self):
        outcomes = (
            LLMError("secondary offline"),
            (["not", "an", "object"], "[]"),
            ({"decision": []}, "{}"),
        )
        for outcome in outcomes:
            with self.subTest(outcome=outcome):
                runner = self._runner()
                runner.planner.chat_json.side_effect = LLMError("primary offline")
                if isinstance(outcome, Exception):
                    runner.planner_fallback.chat_json.side_effect = outcome
                else:
                    runner.planner_fallback.chat_json.return_value = outcome
                plan, fallbacks = runner._plan([], forced_strike=False)
                self.assertEqual(plan["analysis"], "deterministic")
                runner.planner.chat_json.assert_called_once()
                runner.planner_fallback.chat_json.assert_called_once()
                runner._fallback_plan.assert_called_once_with(False)
                self.assertTrue(any("planner_primary_failed" in item
                                    for item in fallbacks))
                self.assertTrue(any("planner_fallback_failed" in item
                                    for item in fallbacks))
                self.assertTrue(any("both providers failed" in item
                                    for item in fallbacks))

    def test_real_fallback_client_receives_identical_messages_and_json_schema(self):
        runner = self._runner()
        runner.planner.chat_json.side_effect = LLMError("primary timeout")
        runner.planner_fallback = planner_fallback_client(types.SimpleNamespace(
            writer_base_url="https://writer.invalid/v1",
            writer_model="writer-model",
            writer_api_key="writer-key",
            planner_fallback_base_url="https://fallback.invalid/v1",
            planner_fallback_model="fallback-model",
            planner_fallback_api_key="fallback-key",
        ))
        response = _Response(json.dumps(_valid_plan()))
        with mock.patch("agent.llm.urllib.request.urlopen",
                        return_value=response) as urlopen:
            plan, fallbacks = runner._plan([], forced_strike=False)

        self.assertEqual(plan["analysis"], "secondary provider plan")
        urlopen.assert_called_once()
        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode())
        primary_messages = runner.planner.chat_json.call_args.args[0]
        self.assertEqual(payload["messages"], primary_messages)
        self.assertEqual(payload["model"], "fallback-model")
        self.assertEqual(payload["temperature"], 0.35)
        self.assertEqual(payload["max_tokens"], 1800)
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(request.get_header("Authorization"), "Bearer fallback-key")
        self.assertIn("planner_fallback_used: fallback-model", fallbacks)

    def test_real_fallback_network_failure_has_no_retry_or_sleep(self):
        runner = self._runner()
        runner.planner.chat_json.side_effect = LLMError("primary offline")
        runner.planner_fallback = ChatClient(
            "https://fallback.invalid/v1", "fallback-model", "fallback-key",
            name="planner_fallback")
        with mock.patch("agent.llm.urllib.request.urlopen",
                        side_effect=urllib.error.URLError("offline")) as urlopen, \
                mock.patch("agent.llm.time.sleep") as slept:
            plan, fallbacks = runner._plan([], forced_strike=False)
        self.assertEqual(plan["analysis"], "deterministic")
        urlopen.assert_called_once()
        slept.assert_not_called()
        self.assertTrue(any("both providers failed" in item for item in fallbacks))

    def test_real_fallback_refusal_has_no_json_repair_call(self):
        runner = self._runner()
        runner.planner.chat_json.side_effect = LLMError("primary invalid JSON")
        runner.planner_fallback = ChatClient(
            "https://fallback.invalid/v1", "fallback-model", "fallback-key",
            name="planner_fallback")
        with mock.patch("agent.llm.urllib.request.urlopen",
                        return_value=_Response("I cannot provide that plan.")) as urlopen:
            plan, fallbacks = runner._plan([], forced_strike=False)
        self.assertEqual(plan["analysis"], "deterministic")
        urlopen.assert_called_once()
        self.assertTrue(any("planner_fallback_failed" in item for item in fallbacks))


if __name__ == "__main__":
    unittest.main()
