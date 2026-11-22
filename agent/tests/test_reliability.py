"""
Reliability unit tests for the revel8 agent infrastructure.

Pure plumbing coverage — NO real network. The HTTP layer (urllib) is mocked.
Covers: retry/backoff, non-retry on 4xx, per-contact Idempotency-Key reuse on
retries, defensive JSON/shape handling, crash-resume from events, and
budget-exhaustion / 409 handling.

Run from the project root:
    python3 -m unittest agent.tests.test_reliability -v
"""
from __future__ import annotations

import io
import json
import os
import tempfile
import types
import unittest
import urllib.error
from unittest import mock

from agent import llm
from agent import target_api
from agent.target_api import TargetClient, TargetAPIError
from agent.guards import run_programmatic_guard
from agent.state import (SessionState, TopicHypothesis, SenderIdentity,
                         rebuild_state_from_events, update_playbook)
from agent import prompts


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _cfg():
    return types.SimpleNamespace(
        revel8_api_base="https://example.invalid/v1",
        revel8_team_key="rv8_test",
    )


def _http_error(code, body=b'{"error":"boom"}'):
    return urllib.error.HTTPError(
        url="https://example.invalid/v1/x", code=code, msg="err",
        hdrs=None, fp=io.BytesIO(body))


class _FakeResp:
    def __init__(self, body=b"{}", status=200):
        self._body = body if isinstance(body, bytes) else body.encode()
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen_sequence(seq):
    """Return (side_effect, calls) where `calls` records each Request passed."""
    calls = []

    def side_effect(req, timeout=None):
        calls.append(req)
        item = seq[len(calls) - 1]
        if isinstance(item, Exception):
            raise item
        return item

    return side_effect, calls


# --------------------------------------------------------------------------- #
# retry / backoff
# --------------------------------------------------------------------------- #

class RetryBackoffTests(unittest.TestCase):

    def test_retries_503_then_succeeds(self):
        se, calls = _urlopen_sequence([
            _http_error(503), _http_error(503),
            _FakeResp(b'{"session_id":"s1","touch_budget":30}'),
        ])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep") as slept:
            out = client.create_session("practice")
        self.assertEqual(out["session_id"], "s1")
        self.assertEqual(len(calls), 3)          # 2 failures + 1 success
        self.assertEqual(slept.call_count, 2)    # backed off before each retry

    def test_retries_429_502_504(self):
        for code in (429, 502, 504):
            se, calls = _urlopen_sequence([
                _http_error(code), _FakeResp(b'{"ok":true}'),
            ])
            client = TargetClient(_cfg())
            with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                    mock.patch.object(target_api.time, "sleep"):
                client.get_session("s1")
            self.assertEqual(len(calls), 2, f"code {code} should retry once")

    def test_gives_up_after_max_retries(self):
        seq = [_http_error(503)] * (target_api.MAX_RETRIES + 1)
        se, calls = _urlopen_sequence(seq)
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep"):
            with self.assertRaises(TargetAPIError) as ctx:
                client.get_session("s1")
        self.assertEqual(ctx.exception.status, 503)
        self.assertEqual(len(calls), target_api.MAX_RETRIES + 1)

    def test_network_error_retries_then_raises(self):
        seq = [urllib.error.URLError("conn reset")] * (target_api.MAX_RETRIES + 1)
        se, calls = _urlopen_sequence(seq)
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep"):
            with self.assertRaises(TargetAPIError) as ctx:
                client.get_session("s1")
        self.assertEqual(ctx.exception.status, 0)        # network, not HTTP
        self.assertEqual(len(calls), target_api.MAX_RETRIES + 1)


# --------------------------------------------------------------------------- #
# non-retry on client errors
# --------------------------------------------------------------------------- #

class NonRetryTests(unittest.TestCase):

    def test_400_not_retried(self):
        se, calls = _urlopen_sequence([_http_error(400, b'{"error":"bad"}')])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep") as slept:
            with self.assertRaises(TargetAPIError) as ctx:
                client.send_message("s1", {"to": "julius", "body": "hi"})
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(len(calls), 1)      # no retry
        self.assertEqual(slept.call_count, 0)

    def test_422_not_retried(self):
        se, calls = _urlopen_sequence([_http_error(422, b'{"error":"rejected"}')])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep"):
            with self.assertRaises(TargetAPIError) as ctx:
                client.send_message("s1", {"to": "julius", "body": "hi"})
        self.assertEqual(ctx.exception.status, 422)
        self.assertEqual(len(calls), 1)

    def test_409_not_retried_surfaces_status(self):
        se, calls = _urlopen_sequence([_http_error(409, b'{"error":"budget used"}')])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep"):
            with self.assertRaises(TargetAPIError) as ctx:
                client.send_message("s1", {"to": "julius", "body": "hi"})
        self.assertEqual(ctx.exception.status, 409)
        self.assertEqual(len(calls), 1)


# --------------------------------------------------------------------------- #
# idempotency-key reuse across retries
# --------------------------------------------------------------------------- #

class IdempotencyTests(unittest.TestCase):

    def test_same_key_reused_on_every_retry(self):
        se, calls = _urlopen_sequence([
            _http_error(503), _http_error(503),
            _FakeResp(b'{"message_id":"m1","touches_used":1,"events":[]}'),
        ])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep"):
            client.send_message("s1", {"to": "julius", "body": "hi"},
                                idem_key="t1-fixedkey")
        keys = [r.get_header("Idempotency-key") for r in calls]
        self.assertEqual(len(calls), 3)
        self.assertEqual(keys, ["t1-fixedkey"] * 3,
                         "a retried send must reuse the same Idempotency-Key "
                         "so a timeout never double-spends a touch")

    def test_generated_key_also_stable_across_retries(self):
        se, calls = _urlopen_sequence([
            _http_error(503), _FakeResp(b'{"touches_used":1,"events":[]}'),
        ])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se), \
                mock.patch.object(target_api.time, "sleep"):
            client.send_message("s1", {"to": "julius", "body": "hi"})
        keys = [r.get_header("Idempotency-key") for r in calls]
        self.assertTrue(keys[0])
        self.assertEqual(keys[0], keys[1])     # one key for the whole contact


# --------------------------------------------------------------------------- #
# defensive JSON / shape handling
# --------------------------------------------------------------------------- #

class DefensiveParsingTests(unittest.TestCase):

    def test_non_json_2xx_body_raises_not_crashes(self):
        se, _ = _urlopen_sequence([_FakeResp(b"<html>gateway</html>")])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se):
            with self.assertRaises(TargetAPIError):   # never a bare JSONDecodeError
                client.get_session("s1")

    def test_empty_body_is_empty_dict(self):
        se, _ = _urlopen_sequence([_FakeResp(b"")])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se):
            self.assertEqual(client.end_session("s1"), {})

    def test_list_endpoint_coerces_unexpected_shape(self):
        # server wraps the array in an object -> still returned as a list
        se, _ = _urlopen_sequence([
            _FakeResp(b'{"sessions":[{"session_id":"s1"}]}')])
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se):
            out = client.list_sessions()
        self.assertIsInstance(out, list)
        self.assertEqual(out[0]["session_id"], "s1")

    def test_dict_endpoint_coerces_unexpected_shape(self):
        se, _ = _urlopen_sequence([_FakeResp(b'[1,2,3]')])  # bogus list for a dict
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen", se):
            out = client.get_session("s1")
        self.assertEqual(out, {})       # .get(...) downstream will not crash


class ChatClientResponseTests(unittest.TestCase):

    @staticmethod
    def _response(content, finish_reason):
        body = {"choices": [{"finish_reason": finish_reason,
                             "message": {"role": "assistant", "content": content}}]}
        return _FakeResp(json.dumps(body).encode())

    def test_length_limited_null_content_retries_with_larger_token_budget(self):
        se, calls = _urlopen_sequence([
            self._response(None, "length"),
            self._response('{"subject":"Ready","body":"Hello"}', "stop"),
        ])
        client = llm.ChatClient("https://example.invalid/v1", "writer", "key")
        with mock.patch.object(llm.urllib.request, "urlopen", se):
            obj, raw = client.chat_json([], max_tokens=900)
        self.assertEqual(obj, {"subject": "Ready", "body": "Hello"})
        self.assertEqual(raw, '{"subject":"Ready","body":"Hello"}')
        budgets = [json.loads(req.data.decode())["max_tokens"] for req in calls]
        self.assertEqual(budgets, [900, 1800])

    def test_persistent_null_content_raises_llm_error_not_attribute_error(self):
        se, calls = _urlopen_sequence([
            self._response(None, "length") for _ in range(llm.MAX_RETRIES + 1)
        ])
        client = llm.ChatClient("https://example.invalid/v1", "writer", "key")
        with mock.patch.object(llm.urllib.request, "urlopen", se):
            with self.assertRaises(llm.LLMError):
                client.chat_json([], max_tokens=100)
        budgets = [json.loads(req.data.decode())["max_tokens"] for req in calls]
        self.assertEqual(budgets, [100, 200, 400])


# --------------------------------------------------------------------------- #
# crash-resume from events
# --------------------------------------------------------------------------- #

def _fresh_state(budget=30, touches_used=0):
    persona = SenderIdentity(name="Lena Hofer", role="Lead", org="EventCrew",
                             address="lena@eventcrew-muc.de", domain="eventcrew-muc.de")
    topics = [TopicHypothesis(topic_id="evt", label="event", prior=0.4, confidence=0.4)]
    return SessionState(session_id="s1", scenario_id="practice", target_id="julius",
                        budget=budget, touches_used=touches_used,
                        topics=topics, persona=persona, identities_used=[persona])


class ResumeTests(unittest.TestCase):

    def test_page_submitted_rebuilds_incident(self):
        st = _fresh_state(touches_used=4)
        events = [
            {"type": "reply", "text": "who is this?"},
            {"type": "link.opened", "url": "https://x"},
            {"type": "page.submitted", "fields": ["email", "password"]},
        ]
        rebuild_state_from_events(st, events)
        self.assertTrue(st.struck)
        self.assertIsNotNone(st.incident)
        self.assertEqual(st.incident["via"], "page.submitted")
        self.assertEqual(st.incident["fields"], ["email", "password"])
        self.assertEqual(st.objective_status, "achieved")
        self.assertEqual(len(st.raw_event_log), 3)

    def test_engagement_without_submit_marks_struck_no_incident(self):
        st = _fresh_state(touches_used=2)
        rebuild_state_from_events(st, [{"type": "link.opened", "url": "https://x"}])
        self.assertTrue(st.struck)
        self.assertIsNone(st.incident)
        self.assertEqual(st.topics[0].status, "engaged")

    def test_rebuild_tolerates_garbage_events(self):
        st = _fresh_state()
        rebuild_state_from_events(st, ["not-a-dict", None, {"type": "unknown"}])
        self.assertIsNone(st.incident)      # no crash on malformed shapes

    def test_find_resumable_picks_open_session(self):
        from agent.loop import SessionRunner
        from agent.config import Config
        runner = SessionRunner.__new__(SessionRunner)   # skip __init__/network
        runner.scenario = "practice"

        class FakeAPI:
            def list_sessions(self):
                return [
                    {"session_id": "ended1", "scenario_id": "practice",
                     "status": "ended", "touches_used": 3, "touch_budget": 30},
                    {"session_id": "full1", "scenario_id": "practice",
                     "status": "active", "touches_used": 30, "touch_budget": 30},
                    {"session_id": "open1", "scenario_id": "practice",
                     "status": "active", "touches_used": 5, "touch_budget": 30},
                ]
        runner.api = FakeAPI()
        found = runner._find_resumable_session()
        self.assertIsNotNone(found)
        self.assertEqual(found["session_id"], "open1")

    def test_find_resumable_none_when_all_closed(self):
        from agent.loop import SessionRunner
        runner = SessionRunner.__new__(SessionRunner)
        runner.scenario = "practice"

        class FakeAPI:
            def list_sessions(self):
                return [{"session_id": "a", "scenario_id": "practice",
                         "status": "ended", "touches_used": 1, "touch_budget": 30}]
        runner.api = FakeAPI()
        self.assertIsNone(runner._find_resumable_session())

    def test_playbook_accepts_partial_history_after_exact_resume(self):
        st = _fresh_state(touches_used=4)
        st.history = [types.SimpleNamespace(
            idx=4, channel="email", guard_issues=[], reaction="incident")]
        st.incident = {"objective": "credentials", "via": "page.submitted",
                       "touch_idx": 4}
        with tempfile.TemporaryDirectory() as tmp:
            pb = update_playbook(os.path.join(tmp, "playbook.json"), st, "incident")
        self.assertEqual(pb["per_target"]["julius"]["winning_channel"], "email")
        self.assertEqual(pb["sessions"][0]["session_id"], "s1")

    def test_readback_uses_guard_schema_not_planner_schema(self):
        st = _fresh_state()
        from agent.pretexts import get_pretext
        msgs = prompts.build_guard_readback_messages(
            st, get_pretext("julius"), "subject", "body", False, "https://unused")
        self.assertEqual(msgs[0]["content"], prompts.GUARD_SYSTEM)
        self.assertNotIn("WHAT YOU CONTROL PER CALL", msgs[0]["content"])
        self.assertIn('"pass": true|false', msgs[0]["content"])


# --------------------------------------------------------------------------- #
# outbound guard consistency
# --------------------------------------------------------------------------- #

class GuardTests(unittest.TestCase):

    def test_active_sender_mismatch_is_fatal_programmatic_issue(self):
        body = ("Hi Julius, here is the requested professional follow-up with "
                "enough detail to pass craft checks.\n\nBest,\nDr. Elena Voss")
        issues = run_programmatic_guard(
            "Following up", body, allowed_domains=["hoferbrandt-advisory.com"],
            trap_patterns=[], include_link=False, planned_url="https://unused",
            required_sender="Dr. Lena Hofer")
        self.assertTrue(any("active sender name" in i for i in issues))


# --------------------------------------------------------------------------- #
# budget exhaustion / 409 handling
# --------------------------------------------------------------------------- #

class BudgetTests(unittest.TestCase):

    def _bare_runner(self):
        from agent.loop import SessionRunner
        runner = SessionRunner.__new__(SessionRunner)   # skip __init__/network
        runner.scenario = "practice"
        runner.target_id = "julius"
        runner.arms = {}
        runner.cfg = types.SimpleNamespace(theta_hard=0.85, dead_air_k=3)
        from agent.pretexts import get_pretext
        runner.pretext = get_pretext("julius")
        runner.fallbacks = []
        runner._session_closed = False
        runner.state = _fresh_state(budget=10, touches_used=10)
        return runner

    def test_stop_reason_budget_exhausted(self):
        runner = self._bare_runner()
        self.assertEqual(runner._stop_reason(), "budget_exhausted")

    def test_never_exceeds_budget(self):
        runner = self._bare_runner()
        self.assertEqual(runner.state.touches_left, 0)
        self.assertLessEqual(runner.state.touches_used, runner.state.budget)

    def test_409_on_send_closes_session_gracefully(self):
        runner = self._bare_runner()
        runner.state = _fresh_state(budget=10, touches_used=3)

        class FakeAPI:
            def send_message(self, sid, msg, idem_key=None, sent_at=None):
                raise TargetAPIError(409, "budget used", "POST",
                                     f"/sessions/{sid}/messages")
        runner.api = FakeAPI()
        events = runner._send("email", "subj", "body", None)
        self.assertEqual(events, [])                 # no crash, no raise
        self.assertTrue(runner._session_closed)
        self.assertEqual(runner.state.touches_used, 3)   # no extra touch spent
        self.assertEqual(runner._stop_reason(), "session_closed")
        self.assertTrue(any("session_closed_409" in f for f in runner.fallbacks))

    def test_422_on_send_spends_no_touch(self):
        runner = self._bare_runner()
        runner.state = _fresh_state(budget=10, touches_used=3)

        class FakeAPI:
            def send_message(self, sid, msg, idem_key=None, sent_at=None):
                raise TargetAPIError(422, "persona declined", "POST",
                                     f"/sessions/{sid}/messages")
        runner.api = FakeAPI()
        events = runner._send("email", "subj", "body", None)
        self.assertEqual(events, [])
        self.assertEqual(runner.state.touches_used, 3)   # failed request = no touch
        self.assertFalse(runner._session_closed)


if __name__ == "__main__":
    unittest.main()
