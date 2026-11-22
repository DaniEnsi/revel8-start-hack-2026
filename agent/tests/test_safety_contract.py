"""Deterministic regression tests for forms, story time, and channel policy.

All target and model clients are fakes/mocks: these tests never contact a live
Target API or LLM endpoint.
"""
from __future__ import annotations

import copy
import io
import json
import tempfile
import types
import unittest
import urllib.error
from datetime import datetime
from unittest import mock

from agent import target_api
from agent.loop import SessionRunner
from agent.pretexts import PRETEXTS, get_pretext
from agent.state import (SenderIdentity, SessionState, TopicHypothesis,
                         rebuild_state_from_events)
from agent.target_api import (TargetAPIError, TargetClient,
                              sanitize_target_payload)
from agent.trace import TraceWriter


def _cfg():
    return types.SimpleNamespace(
        revel8_api_base="https://example.invalid/v1",
        revel8_team_key="rv8_test",
    )


class _FakeResp:
    def __init__(self, body, status=200):
        self._body = body if isinstance(body, bytes) else body.encode()
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _state(touches_used=3, engaged=False):
    persona = SenderIdentity(
        name="Dr. Lena Hofer", role="Senior Partner", org="Hofer & Brandt",
        address="lena@example.test", domain="example.test")
    topic = TopicHypothesis(
        topic_id="vendor", label="Vendor evaluation", prior=0.4,
        confidence=0.8 if engaged else 0.4,
        status="engaged" if engaged else "untested")
    return SessionState(
        session_id="s1", scenario_id="practice", target_id="julius", budget=10,
        touches_used=touches_used, topics=[topic], persona=persona,
        identities_used=[persona])


def _runner(touches_used=3, engaged=False):
    runner = SessionRunner.__new__(SessionRunner)
    runner.scenario = "practice"
    runner.target_id = "julius"
    runner.arms = {"f2": "link_free", "f4": "single", "f5": "credentials",
                   "f6": "soft"}
    runner.cfg = types.SimpleNamespace(
        theta_hard=0.85, theta_soft=0.55, dead_air_k=3, probe_cap_frac=0.3,
        redo_cap=2)
    runner.pretext = copy.deepcopy(get_pretext("julius"))
    runner.state = _state(touches_used=touches_used, engaged=engaged)
    runner.fallbacks = []
    runner._session_closed = False
    runner.allow_live = True
    runner.trace = mock.Mock()
    return runner


def _event(values=None, fields=None):
    event = {"type": "page.submitted", "event_id": 7}
    if fields is not None:
        event["fields"] = fields
    if values is not None:
        event["values"] = values
    return event


def _parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class SubmissionBoundaryTests(unittest.TestCase):
    def _get_events(self, payload):
        client = TargetClient(_cfg())
        response = _FakeResp(json.dumps(payload).encode())
        with mock.patch.object(target_api.urllib.request, "urlopen",
                               return_value=response):
            return client.get_events("s1")

    def test_client_derives_metadata_and_strips_nested_raw_values(self):
        out = self._get_events({"events": [
            {"wrapper": [_event(
                fields=["email", "password"],
                values={"email": "raw-person@example.test",
                        "password": "raw-secret-sentinel"},
            )]},
        ]})
        event = out["events"][0]["wrapper"][0]
        self.assertNotIn("values", event)
        self.assertEqual(event["submission"]["objective"], "credentials")
        self.assertEqual(event["submission"]["credential_fields"], ["password"])
        self.assertEqual(event["submission"]["basic_fields"], ["email"])
        serialized = json.dumps(out)
        self.assertNotIn("raw-secret-sentinel", serialized)
        self.assertNotIn("raw-person@example.test", serialized)

    def test_values_take_precedence_over_contradictory_filled_fields(self):
        out = self._get_events({"events": [_event(
            fields=["password"], values={"password": "   "})]})
        event = out["events"][0]
        self.assertEqual(event["submission"]["objective"], "none")
        self.assertEqual(event["submission"]["credential_fields"], [])

    def test_sanitization_is_idempotent_and_preserves_blank_secret_verdict(self):
        once = sanitize_target_payload(_event(
            fields=["password"], values={"password": ""}))
        twice = sanitize_target_payload(once)
        self.assertEqual(twice, once)
        self.assertEqual(twice["submission"]["source"], "values")
        self.assertEqual(twice["submission"]["objective"], "none")
        self.assertEqual(twice["submission"]["entered_fields"], [])

    def test_http_error_json_is_sanitized_before_exception_logging(self):
        body = json.dumps({"error": "rejected", "event": _event(values={
            "password": "raw-error-secret"})}).encode()
        error = urllib.error.HTTPError(
            "https://example.invalid/v1/sessions/s1/messages", 422, "err",
            hdrs=None, fp=io.BytesIO(body))
        client = TargetClient(_cfg())
        with mock.patch.object(target_api.urllib.request, "urlopen",
                               side_effect=error):
            with self.assertRaises(TargetAPIError) as ctx:
                client.send_message("s1", {"to": "julius", "body": "hello"})
        self.assertNotIn("raw-error-secret", str(ctx.exception))
        self.assertNotIn("raw-error-secret", ctx.exception.body)

    def test_trace_writer_is_a_second_redaction_boundary(self):
        record = {
            "kind": "touch",
            "events": [_event(values={
                "email": "raw-trace-person@example.test",
                "internal_tool": "raw-internal-tool-name",
            })],
        }
        with tempfile.TemporaryDirectory() as tmp:
            writer = TraceWriter(tmp, "s1")
            writer.write(record)
            with open(writer.path, encoding="utf-8") as handle:
                stored = handle.read()
        self.assertNotIn("raw-trace-person@example.test", stored)
        self.assertNotIn("raw-internal-tool-name", stored)
        line = json.loads(stored)
        self.assertNotIn("values", line["events"][0])
        self.assertEqual(line["events"][0]["submission"]["objective"],
                         "disclosure")

    def test_state_serialization_cannot_leak_manually_inserted_values(self):
        state = _state()
        state.raw_event_log.append(_event(values={"password": "raw-state-secret"}))
        serialized = json.dumps(state.to_dict())
        self.assertNotIn("raw-state-secret", serialized)
        self.assertNotIn("raw-state-secret", json.dumps(state.raw_event_log))

    def test_planner_receives_only_value_free_event_metadata(self):
        runner = _runner()
        runner.planner = mock.Mock()
        runner.planner.chat_json.return_value = ({
            "analysis": "form received", "decision": {},
        }, "{}")
        with tempfile.TemporaryDirectory() as tmp:
            runner.cfg.playbook_path = tmp + "/playbook.json"
            runner._plan([_event(values={
                "password": "raw-planner-secret",
                "email": "raw-planner-person@example.test",
            })], forced_strike=False)
        messages = runner.planner.chat_json.call_args.args[0]
        serialized = json.dumps(messages)
        self.assertNotIn("raw-planner-secret", serialized)
        self.assertNotIn("raw-planner-person@example.test", serialized)
        self.assertIn('"objective": "credentials"', messages[1]["content"])


class SubmissionClassificationTests(unittest.TestCase):
    def test_each_nonempty_secret_field_is_a_credentials_incident(self):
        for field in ("password", "iban", "pin", "otp", "token",
                      "verification_code", "api_key", "card_number"):
            with self.subTest(field=field):
                runner = _runner()
                reaction = runner._classify([_event(values={field: "entered"})])
                self.assertEqual(reaction, "incident")
                self.assertEqual(runner.state.incident["objective"], "credentials")
                self.assertEqual(runner.state.incident["via"], "page.submitted")
                self.assertEqual(runner.state.incident["submission"]
                                 ["credential_fields"], [field])

    def test_numeric_zero_is_an_entered_pin_not_an_empty_value(self):
        runner = _runner()
        self.assertEqual(runner._classify([_event(values={"pin": 0})]), "incident")
        self.assertEqual(runner.state.incident["objective"], "credentials")

    def test_empty_secret_and_basic_only_submissions_are_not_incidents(self):
        cases = (
            {"password": ""},
            {"iban": "  "},
            {"name": "Julius", "email": "julius@example.test"},
            {"company": "revel8", "job_title": "CEO"},
        )
        for values in cases:
            with self.subTest(values=values):
                runner = _runner()
                reaction = runner._classify([_event(
                    fields=list(values), values=values)])
                self.assertEqual(reaction, "engaged")
                self.assertIsNone(runner.state.incident)
                self.assertNotEqual(runner.state.objective_status, "achieved")

    def test_story_native_internal_field_is_disclosure_not_credentials(self):
        for field in ("vpn_client", "approver", "internal_tool", "project_notes"):
            with self.subTest(field=field):
                runner = _runner()
                reaction = runner._classify([_event(values={field: "entered"})])
                self.assertEqual(reaction, "incident")
                self.assertEqual(runner.state.incident["objective"], "disclosure")
                self.assertEqual(runner.state.incident["via"], "page.submitted")
                self.assertEqual(runner.state.incident["submission"]
                                 ["disclosure_fields"], [field])

    def test_legacy_filled_field_names_keep_their_original_semantics(self):
        secret = _runner()
        self.assertEqual(secret._classify([
            _event(fields=["email", "password"])]), "incident")
        self.assertEqual(secret.state.incident["objective"], "credentials")

        basic = _runner()
        self.assertEqual(basic._classify([
            _event(fields=["name", "email"])]), "engaged")
        self.assertIsNone(basic.state.incident)

    def test_live_and_resume_classification_are_identical(self):
        raw = _event(fields=["email", "iban", "internal_tool"], values={
            "email": "raw-person@example.test",
            "iban": "(entered, not shown)",
            "internal_tool": "raw-internal-detail",
        })
        live = _runner(touches_used=4)
        self.assertEqual(live._classify([copy.deepcopy(raw)]), "incident")

        resumed = _state(touches_used=4)
        rebuild_state_from_events(resumed, [copy.deepcopy(raw)])

        self.assertIsNotNone(resumed.incident)
        for key in ("objective", "via", "touch_idx", "fields", "submission"):
            self.assertEqual(resumed.incident[key], live.state.incident[key], key)
        self.assertTrue(resumed.incident["resumed"])
        self.assertNotIn("raw-internal-detail", json.dumps(resumed.to_dict()))
        self.assertNotIn("raw-person@example.test", json.dumps(resumed.to_dict()))

    def test_resume_basic_submission_is_engagement_not_a_false_win(self):
        resumed = _state(touches_used=4)
        rebuild_state_from_events(resumed, [_event(values={
            "name": "Julius", "email": "raw-person@example.test"})])
        self.assertIsNone(resumed.incident)
        self.assertNotEqual(resumed.objective_status, "achieved")
        self.assertTrue(resumed.struck)
        self.assertNotIn("raw-person@example.test", json.dumps(resumed.raw_event_log))


class StoryTimeClientTests(unittest.TestCase):
    def _request_payload(self, method, *args, **kwargs):
        client = TargetClient(_cfg())
        response = _FakeResp(b"{}")
        with mock.patch.object(target_api.urllib.request, "urlopen",
                               return_value=response) as urlopen:
            method(client, *args, **kwargs)
        request = urlopen.call_args.args[0]
        return json.loads(request.data.decode())

    def test_message_accepts_story_time(self):
        sent_at = "2026-11-23T09:14:00+01:00"
        payload = self._request_payload(
            TargetClient.send_message, "s1", {"to": "julius", "body": "hello"},
            sent_at=sent_at)
        self.assertEqual(payload["sent_at"], sent_at)

    def test_conversation_start_accepts_story_time(self):
        sent_at = "2026-11-23T09:14:00+01:00"
        payload = self._request_payload(
            TargetClient.start_conversation, "s1", "julius", "phone_call",
            {"name": "Lena"}, sent_at=sent_at)
        self.assertEqual(payload["sent_at"], sent_at)

    def test_conversation_turn_accepts_story_time(self):
        sent_at = "2026-11-23T09:16:00+01:00"
        payload = self._request_payload(
            TargetClient.conversation_turn, "c1", "hello", sent_at=sent_at)
        self.assertEqual(payload["sent_at"], sent_at)


class _SendAPI:
    def __init__(self):
        self.calls = []
        self.sessions = []
        self.backwards_failures = 0

    def send_message(self, sid, message, idem_key=None, sent_at=None):
        self.calls.append({"sid": sid, "message": copy.deepcopy(message),
                           "idem_key": idem_key, "sent_at": sent_at})
        if self.backwards_failures:
            self.backwards_failures -= 1
            raise TargetAPIError(
                409, '{"error":"sent_at earlier than last contact"}',
                "POST", f"/sessions/{sid}/messages")
        return {"touches_used": len(self.calls), "events": []}

    def get_session(self, sid):
        self.sessions.append(sid)
        return {"last_sent_at": "2026-11-24T15:00:00+01:00"}


class StoryTimeLoopTests(unittest.TestCase):
    def test_every_message_has_strictly_monotonic_business_hour_time(self):
        runner = _runner(touches_used=0)
        api = _SendAPI()
        runner.api = api
        runner._send("email", "one", "first", None)
        runner._send("email", "two", "second", None)
        times = [_parse_time(call["sent_at"]) for call in api.calls]
        self.assertTrue(all(call["sent_at"] for call in api.calls))
        self.assertGreater(times[1], times[0])
        for value in times:
            self.assertLess(value.weekday(), 5)
            self.assertGreaterEqual(value.hour, 9)
            self.assertLess(value.hour, 17)
        self.assertEqual(runner.state.last_sent_at, api.calls[-1]["sent_at"])

    def test_silence_paces_next_message_to_a_later_business_day(self):
        runner = _runner(touches_used=0)
        api = _SendAPI()
        runner.api = api
        runner._send("email", "one", "first", None)
        runner.state.consecutive_ignored = 1
        runner._send("email", "two", "second", None)
        first = _parse_time(api.calls[0]["sent_at"])
        second = _parse_time(api.calls[1]["sent_at"])
        self.assertGreater(second.date(), first.date())
        self.assertLess(second.weekday(), 5)

    def test_backward_time_409_rereads_state_advances_and_reuses_idempotency(self):
        runner = _runner(touches_used=2)
        api = _SendAPI()
        api.backwards_failures = 1
        runner.api = api
        events = runner._send("email", "subject", "body", None)
        self.assertEqual(events, [])
        self.assertEqual(len(api.calls), 2)
        self.assertEqual(api.sessions, ["s1"])
        first, second = api.calls
        self.assertNotEqual(first["sent_at"], second["sent_at"])
        self.assertEqual(first["idem_key"], second["idem_key"])
        self.assertGreater(_parse_time(second["sent_at"]),
                           _parse_time("2026-11-24T15:00:00+01:00"))
        self.assertFalse(runner._session_closed)
        self.assertFalse(any("session_closed_409" in item
                             for item in runner.fallbacks))
        self.assertTrue(any("story_time_409" in item
                            for item in runner.fallbacks))

    def test_repeated_time_409_retries_only_once_then_stops(self):
        runner = _runner(touches_used=2)
        api = _SendAPI()
        api.backwards_failures = 2
        runner.api = api
        self.assertEqual(runner._send("email", "subject", "body", None), [])
        self.assertEqual(len(api.calls), 2)
        self.assertEqual(api.sessions, ["s1"])
        self.assertTrue(runner._session_closed)

    def test_non_time_409_still_closes_without_retry(self):
        runner = _runner(touches_used=2)

        class ClosedAPI(_SendAPI):
            def send_message(self, sid, message, idem_key=None, sent_at=None):
                self.calls.append({"sent_at": sent_at, "idem_key": idem_key})
                raise TargetAPIError(409, "budget used", "POST", "messages")

        api = ClosedAPI()
        runner.api = api
        self.assertEqual(runner._send("email", "subject", "body", None), [])
        self.assertEqual(len(api.calls), 1)
        self.assertEqual(api.sessions, [])
        self.assertTrue(runner._session_closed)


class _ConversationAPI:
    def __init__(self, backwards_start=False, backwards_turn=False):
        self.starts = []
        self.turns = []
        self.sessions = []
        self.backwards_start = backwards_start
        self.backwards_turn = backwards_turn

    @staticmethod
    def _time_error(path):
        return TargetAPIError(409, "sent_at earlier than last contact", "POST", path)

    def start_conversation(self, sid, to, channel, from_, sent_at=None,
                           idem_key=None):
        self.starts.append({"channel": channel, "sent_at": sent_at,
                            "idem_key": idem_key})
        if self.backwards_start:
            self.backwards_start = False
            raise self._time_error("conversations")
        return {"conversation_id": "c1", "persona_says": "Hello",
                "touches_used": 4}

    def conversation_turn(self, cid, say, idem_key=None, sent_at=None):
        self.turns.append({"say": say, "sent_at": sent_at,
                           "idem_key": idem_key})
        if self.backwards_turn:
            self.backwards_turn = False
            raise self._time_error("turns")
        return {"persona_says": "Goodbye", "ended": True, "events": [],
                "turns_used": 1}

    def get_session(self, sid):
        self.sessions.append(sid)
        return {"last_sent_at": "2026-11-24T15:00:00+01:00"}

    def end_conversation(self, cid):
        pass


class ConversationStoryTimeTests(unittest.TestCase):
    def _run(self, api):
        runner = _runner(touches_used=3, engaged=True)
        runner.state.history.append(types.SimpleNamespace(idx=3))
        runner.api = api
        runner.planner = mock.Mock()
        runner.planner.chat_json.side_effect = [
            ({"end_call": True, "disclosure_incident": False,
              "writer_brief": {"goal": "close politely"}}, "{}"),
            ({"pass": True, "severity": "none", "issues": []}, "{}"),
        ]
        runner.writer = mock.Mock()
        runner.writer.chat_json.return_value = (
            {"say": "Thanks for making time."}, "{}")
        runner._run_conversation(
            {"decision": {"topic_id": "vendor"}}, "phone_call")
        return runner

    def test_start_and_every_turn_carry_monotonic_story_time(self):
        api = _ConversationAPI()
        runner = self._run(api)
        self.assertEqual(len(api.starts), 1)
        self.assertEqual(len(api.turns), 1)
        start = api.starts[0]["sent_at"]
        turn = api.turns[0]["sent_at"]
        self.assertTrue(start)
        self.assertTrue(turn)
        self.assertGreater(_parse_time(turn), _parse_time(start))
        self.assertEqual(runner.state.last_sent_at, turn)

    def test_backward_409_is_advanced_on_start_and_turn(self):
        api = _ConversationAPI(backwards_start=True, backwards_turn=True)
        runner = self._run(api)
        self.assertEqual(len(api.starts), 2)
        self.assertEqual(len(api.turns), 2)
        self.assertEqual(len(api.sessions), 2)
        self.assertGreater(_parse_time(api.starts[1]["sent_at"]),
                           _parse_time(api.starts[0]["sent_at"]))
        self.assertGreater(_parse_time(api.turns[1]["sent_at"]),
                           _parse_time(api.turns[0]["sent_at"]))
        self.assertEqual(api.starts[0]["idem_key"], api.starts[1]["idem_key"])
        self.assertEqual(api.turns[0]["idem_key"], api.turns[1]["idem_key"])
        self.assertFalse(runner._session_closed)


class ChannelPolicyTests(unittest.TestCase):
    def _exercise(self, action, channel, *, engaged=True, accepted=False):
        runner = _runner(touches_used=4, engaged=engaged)
        runner.state.history.append(types.SimpleNamespace(idx=4))
        runner.state.calendar_slot_accepted = accepted
        plan = {
            "analysis": "adversarial test plan",
            "calendar_slot_accepted": True,  # Planner claims are not evidence.
            "decision": {"action": action, "channel": channel,
                         "topic_id": "vendor"},
            "writer_brief": {"asserted_facts": []},
        }
        runner._plan = mock.Mock(return_value=(plan, []))
        runner._guarded_draft = mock.Mock(return_value=(
            {"subject": "Subject", "body": "Safe test body"},
            {"issues": []}, []))
        runner._ensure_page = mock.Mock(return_value="p1")
        called = {}

        def send(channel, subject, body, attachments, **kwargs):
            called["message"] = channel
            runner.state.touches_used += 1
            return []

        def converse(plan, channel):
            called["conversation"] = channel
            return []

        runner._send = send
        runner._run_conversation = converse
        runner._run_touch([])
        return runner, called

    def test_forbidden_message_channels_fail_closed_to_email(self):
        for action in ("probe", "build", "strike"):
            for channel in ("teams_chat", "teams_call", "mfa_push"):
                with self.subTest(action=action, channel=channel):
                    _, called = self._exercise(action, channel)
                    self.assertEqual(called, {"message": "email"})
                    self.assertNotIn("conversation", called)

    def test_every_strike_is_email_even_on_an_allowed_non_email_channel(self):
        for channel in ("linkedin_message", "sms", "calendar_invite"):
            with self.subTest(channel=channel):
                _, called = self._exercise("strike", channel, accepted=True)
                self.assertEqual(called, {"message": "email"})

    def test_cold_calendar_fails_closed_but_accepted_slot_is_allowed(self):
        _, cold = self._exercise("build", "calendar_invite", accepted=False)
        self.assertEqual(cold, {"message": "email"})
        _, warm = self._exercise("build", "calendar_invite", accepted=True)
        self.assertEqual(warm, {"message": "calendar_invite"})

    def test_cold_live_phone_is_downgraded_without_starting_a_conversation(self):
        _, called = self._exercise("converse", "phone_call", engaged=False)
        self.assertEqual(called, {"message": "email"})

    def test_teams_live_is_downgraded_even_when_engaged(self):
        _, called = self._exercise("converse", "teams_call", engaged=True)
        self.assertEqual(called, {"message": "email"})

    def test_engaged_phone_conversation_remains_available(self):
        _, called = self._exercise("converse", "phone_call", engaged=True)
        self.assertEqual(called, {"conversation": "phone_call"})

    def test_direct_send_boundary_rejects_forbidden_and_cold_channels(self):
        for channel in ("teams_chat", "mfa_push", "calendar_invite"):
            with self.subTest(channel=channel):
                runner = _runner()
                runner.api = mock.Mock()
                self.assertEqual(runner._send(channel, "subject", "body", None), [])
                runner.api.send_message.assert_not_called()
                self.assertEqual(runner.state.touches_used, 3)

    def test_direct_send_boundary_rejects_non_email_strike(self):
        runner = _runner(engaged=True)
        runner.api = mock.Mock()
        self.assertEqual(runner._send(
            "linkedin_message", "subject", "body", None, action="strike"), [])
        runner.api.send_message.assert_not_called()

    def test_direct_conversation_boundary_rejects_teams_and_cold_phone(self):
        for channel, engaged in (("teams_call", True), ("phone_call", False)):
            with self.subTest(channel=channel, engaged=engaged):
                runner = _runner(engaged=engaged)
                runner.api = mock.Mock()
                self.assertEqual(runner._run_conversation(
                    {"decision": {"topic_id": "vendor"}}, channel), [])
                runner.api.start_conversation.assert_not_called()

    def test_only_explicit_target_slot_acceptance_unlocks_calendar(self):
        runner = _runner()
        runner._classify([{"type": "reply",
                           "text": "That time works for me; please send the invite."}])
        self.assertTrue(runner.state.calendar_slot_accepted)

        natural = _runner()
        natural._classify([{"type": "reply",
                            "text": "Friday 11 December works for me."}])
        self.assertTrue(natural.state.calendar_slot_accepted)

        negative = _runner()
        negative._classify([{"type": "reply",
                             "text": "No, that time does not work for me."}])
        self.assertFalse(negative.state.calendar_slot_accepted)

    def test_fast_strike_fallback_default_is_unchanged(self):
        runner = _runner(touches_used=5, engaged=False)
        plan = runner._fallback_plan(forced_strike=True)
        self.assertEqual(plan["decision"]["action"], "strike")
        self.assertEqual(plan["decision"]["channel"], "email")

    def test_pretext_configuration_exposes_no_teams_or_mfa_channels(self):
        for target_id, pretext in PRETEXTS.items():
            with self.subTest(target=target_id):
                channels = (pretext["escalation_channels"]
                            + pretext.get("live_channels", []))
                self.assertNotIn("teams_chat", channels)
                self.assertNotIn("teams_call", channels)
                self.assertNotIn("mfa_push", channels)


if __name__ == "__main__":
    unittest.main()
