"""Fake-only tests for the deterministic custom-flow vertical slice.

No live Target API, model, email, SMS, telephony, or other external provider is
contacted. A urlopen guard fails the tests if the real HTTP client is reached.
"""
from __future__ import annotations

import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from unittest import mock

from agent import flow_run
from agent.channels import DryRunTransport, TargetChannelAdapter, TransportError
from agent.flow import (DEFAULT_PRACTICE_TARGETS, FlowValidationError,
                        validate_flow_definition, vertical_slice_definition)
from agent.flow_run import JsonRunStore, MemoryRunStore, RunStateError, VirtualClock
from agent.flow_runner import FlowRunner, StaticContentModel


class SimulatedCrash(BaseException):
    pass


class RecordingModel:
    def __init__(self, overrides=None):
        self.overrides = overrides or {}
        self.calls = []

    def draft(self, step, context):
        self.calls.append({"step_id": step.id, "context": copy.deepcopy(context)})
        value = self.overrides.get(step.id, step.content)
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)


class FakeTransport(DryRunTransport):
    def __init__(self):
        super().__init__()
        self.send_attempts = []
        self.before_send = None
        self.after_send = None
        self.failures = 0
        self.failure_error = TransportError(
            "response lost after dispatch", retryable=True, uncertain=True)
        self.crash = False

    def send_message(self, **kwargs):
        self.send_attempts.append(copy.deepcopy(kwargs))
        if self.before_send:
            self.before_send(kwargs)
        if self.crash:
            self.crash = False
            raise SimulatedCrash("simulated process loss")
        if self.failures:
            self.failures -= 1
            raise self.failure_error
        response = super().send_message(**kwargs)
        if self.after_send:
            self.after_send(kwargs, response)
        return response


class CallbackClock(VirtualClock):
    def __init__(self):
        super().__init__()
        self.callback = None
        self.sleeps = []

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        super().sleep(seconds)
        if self.callback:
            callback = self.callback
            self.callback = None
            callback()


def make_runner(*, definition=None, transport=None, store=None, model=None,
                clock=None, run_id="run-test", **kwargs):
    return FlowRunner(
        definition=definition or vertical_slice_definition(),
        transport=transport or FakeTransport(), store=store or MemoryRunStore(),
        model=model or StaticContentModel(), clock=clock or VirtualClock(),
        run_id=run_id, poll_interval_seconds=1.0, retry_delay_seconds=1.0,
        **kwargs,
    )


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def write_definition(directory, definition=None):
    path = os.path.join(directory, "definition.json")
    value = definition or vertical_slice_definition()
    if hasattr(value, "to_dict"):
        value = value.to_dict()
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle)
    return path


def branching_definition():
    raw = vertical_slice_definition().to_dict()
    opening, sms, _call, debrief = raw["steps"]
    opening["wait_seconds"] = 60
    opening["on_reply"] = "reply_sms"
    opening["on_timeout"] = "timeout_sms"
    reply_sms = copy.deepcopy(sms)
    reply_sms.update({"id": "reply_sms", "next": "terminal_debrief"})
    reply_sms.pop("wait_seconds", None)
    reply_sms.pop("on_reply", None)
    reply_sms.pop("on_timeout", None)
    timeout_sms = copy.deepcopy(reply_sms)
    timeout_sms["id"] = "timeout_sms"
    raw["steps"] = [opening, reply_sms, timeout_sms, debrief]
    return validate_flow_definition(raw)


class DefinitionTests(unittest.TestCase):
    def setUp(self):
        guard = mock.patch("agent.target_api.urllib.request.urlopen",
                           side_effect=AssertionError("live HTTP forbidden"))
        guard.start()
        self.addCleanup(guard.stop)

    def test_vertical_slice_has_the_approved_ordered_channels(self):
        definition = vertical_slice_definition()
        self.assertEqual(
            [(step.channel, step.action) for step in definition.steps],
            [("email", "message"), ("sms", "message"),
             ("phone_call", "conversation"), ("email", "debrief")],
        )
        self.assertEqual(definition.steps[-1].branches, ())
        self.assertEqual(len(definition.digest()), 64)

    def test_valid_reply_and_timeout_branches_are_acyclic_and_reach_debrief(self):
        definition = branching_definition()
        self.assertEqual(definition.step("opening_email").branches,
                         ("reply_sms", "timeout_sms"))
        self.assertEqual(definition.steps[-1].action, "debrief")

    def test_definition_boundaries_fail_closed(self):
        def mutate(change):
            raw = vertical_slice_definition().to_dict()
            change(raw)
            return raw

        cases = {
            "version": (lambda raw: raw.update(version=2), "version"),
            "eval": (lambda raw: raw.update(scenario="eval"), "practice"),
            "target": (lambda raw: raw.update(target_id="outside"), "allowlist"),
            "pair": (lambda raw: raw["steps"][1].update(channel="mfa_push"),
                     "unsupported channel/action"),
            "branch": (lambda raw: raw["steps"][0].update(on_reply="missing"),
                       "unknown branch"),
            "cycle": (lambda raw: raw["steps"][2].update(next="opening_email"),
                      "cycle"),
            "negative_delay": (lambda raw: raw["steps"][0].update(delay_seconds=-1),
                               "delay_seconds"),
            "naive_time": (lambda raw: raw.update(story_start="2026-11-23T09:00:00"),
                           "timezone"),
            "attachments": (lambda raw: raw["steps"][0].update(attachments=["a"]),
                            "unknown keys"),
            "link": (lambda raw: raw["steps"][0]["content"].update(
                body="Open https://example.test for the practice step"), "links"),
            "bare_domain": (lambda raw: raw["steps"][0]["content"].update(
                body="Open example.invalid for the practice step"), "links"),
            "ftp_link": (lambda raw: raw["steps"][0]["content"].update(
                body="Open ftp://example.invalid for the practice step"), "links"),
            "sensitive": (lambda raw: raw["steps"][0]["content"].update(
                body="Please send your password for this practice step"), "sensitive"),
        }
        for name, (change, expected) in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(FlowValidationError) as caught:
                    validate_flow_definition(mutate(change))
                self.assertIn(expected, str(caught.exception))

    def test_unreachable_steps_and_extra_terminal_are_rejected(self):
        raw = vertical_slice_definition().to_dict()
        unreachable = copy.deepcopy(raw["steps"][1])
        unreachable["id"] = "unreachable"
        unreachable.pop("wait_seconds")
        unreachable.pop("on_reply")
        unreachable.pop("on_timeout")
        unreachable["next"] = "terminal_debrief"
        raw["steps"].append(unreachable)
        with self.assertRaises(FlowValidationError) as caught:
            validate_flow_definition(raw)
        self.assertIn("unreachable", str(caught.exception))

        raw = vertical_slice_definition().to_dict()
        second = copy.deepcopy(raw["steps"][-1])
        second["id"] = "second_debrief"
        raw["steps"][0]["on_timeout"] = "second_debrief"
        raw["steps"].append(second)
        with self.assertRaises(FlowValidationError) as caught:
            validate_flow_definition(raw)
        self.assertIn("exactly one", str(caught.exception))


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        guard = mock.patch("agent.target_api.urllib.request.urlopen",
                           side_effect=AssertionError("live HTTP forbidden"))
        guard.start()
        self.addCleanup(guard.stop)

    def test_happy_path_uses_one_session_and_terminal_debrief(self):
        transport = FakeTransport()
        result = make_runner(transport=transport).run()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["current_step_id"], "terminal_debrief")
        self.assertTrue(result["session_ended"])
        operations = [call["operation"] for call in transport.calls]
        self.assertEqual(operations.count("open_session"), 1)
        contacts = [call for call in transport.calls
                    if call["operation"] in ("send_message", "start_conversation")]
        self.assertEqual([call["channel"] for call in contacts],
                         ["email", "sms", "phone_call", "email"])
        self.assertEqual(contacts[-1]["action"], "debrief")
        self.assertEqual(len({call["session_id"] for call in contacts}), 1)
        self.assertNotIn("register_page", operations)
        self.assertNotIn("upload_asset", operations)

    def test_continuity_context_contains_prior_copy_and_target_replies(self):
        transport = FakeTransport()
        model = RecordingModel()

        def reply_after_opening(kwargs, response):
            if kwargs["channel"] == "email" and kwargs["action"] == "message":
                transport.queue_event({
                    "event_id": "reply-opening", "type": "reply",
                    "message_id": response["message_id"], "channel": "email",
                    "text": "Ready for the next practice step.",
                })

        transport.after_send = reply_after_opening
        result = make_runner(transport=transport, model=model).run()
        self.assertEqual(result["status"], "completed")
        call = next(item for item in model.calls if item["step_id"] == "practice_call")
        history = call["context"]["history"]
        self.assertEqual([item["step_id"] for item in history],
                         ["opening_email", "sms_followup"])
        self.assertEqual(history[0]["replies"][0]["text"],
                         "Ready for the next practice step.")
        self.assertEqual(history[0]["content"]["subject"], "Scheduled practice exercise")
        self.assertEqual(result["steps"]["opening_email"]["branch_taken"], "on_reply")

    def test_delays_and_every_story_sent_at_are_deterministic_and_monotonic(self):
        transport = FakeTransport()
        clock = VirtualClock()
        result = make_runner(transport=transport, clock=clock).run()
        self.assertEqual(result["status"], "completed")
        contacts = [call for call in transport.calls
                    if call["operation"] in ("send_message", "start_conversation",
                                             "conversation_turn")]
        timestamps = [call["sent_at"] for call in contacts]
        self.assertTrue(all(timestamps))
        parsed = [parse_time(value) for value in timestamps]
        self.assertTrue(all(later > earlier for earlier, later in zip(parsed, parsed[1:])))
        self.assertEqual(timestamps, [
            "2026-11-23T09:00:00+01:00",
            "2026-11-23T09:00:15+01:00",
            "2026-11-23T09:00:30+01:00",
            "2026-11-23T09:01:30+01:00",
            "2026-11-23T09:01:40+01:00",
        ])
        self.assertEqual(clock.now(), 40.0)  # two waits + three inter-step delays

    def test_reply_story_time_is_a_floor_for_the_next_contact(self):
        transport = FakeTransport()

        def reply(kwargs, response):
            transport.queue_event({
                "event_id": "timed-reply", "type": "reply",
                "message_id": response["message_id"], "text": "Ready",
                "sent_at": "2026-11-23T09:00:03+01:00",
            })
            transport.after_send = None

        transport.after_send = reply
        result = make_runner(transport=transport).run()
        self.assertEqual(result["status"], "completed")
        sms = next(call for call in transport.calls
                   if call["operation"] == "send_message" and call["channel"] == "sms")
        self.assertEqual(sms["sent_at"], "2026-11-23T09:00:13+01:00")

    def test_reply_selects_reply_branch_without_waiting_for_timeout(self):
        definition = branching_definition()
        transport = FakeTransport()
        clock = VirtualClock()

        def reply(kwargs, response):
            transport.queue_event({
                "event_id": "r1", "type": "reply",
                "message_id": response["message_id"], "text": "Ready",
            })
            transport.after_send = None

        transport.after_send = reply
        result = make_runner(definition=definition, transport=transport, clock=clock).run()
        self.assertEqual(result["steps"]["opening_email"]["outcome"], "replied")
        self.assertEqual(result["steps"]["opening_email"]["branch_taken"], "on_reply")
        self.assertEqual(result["steps"]["reply_sms"]["status"], "completed")
        self.assertEqual(result["steps"]["timeout_sms"]["status"], "pending")
        self.assertLess(clock.now(), 60.0)

    def test_timeout_selects_timeout_branch_and_advances_wait_deadline(self):
        definition = branching_definition()
        transport = FakeTransport()
        clock = VirtualClock()
        result = make_runner(definition=definition, transport=transport, clock=clock).run()
        opening = result["steps"]["opening_email"]
        self.assertEqual(opening["outcome"], "timed_out")
        self.assertEqual(opening["branch_taken"], "on_timeout")
        self.assertEqual(result["steps"]["timeout_sms"]["status"], "completed")
        self.assertEqual(result["steps"]["reply_sms"]["status"], "pending")
        self.assertGreaterEqual(clock.now(), 60.0)

    def test_late_reply_is_recorded_but_cannot_rewind_or_satisfy_later_step(self):
        transport = FakeTransport()

        def late_opening_reply(kwargs, response):
            if kwargs["channel"] == "sms":
                transport.queue_event({
                    "event_id": "late-opening", "type": "reply",
                    "message_id": "dry-message-1", "text": "Late response",
                })
                transport.after_send = None

        transport.after_send = late_opening_reply
        result = make_runner(transport=transport).run()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["steps"]["opening_email"]["branch_taken"], "on_timeout")
        self.assertEqual(result["steps"]["opening_email"]["late_reply_count"], 1)
        self.assertEqual(result["steps"]["sms_followup"]["reply_count"], 0)
        self.assertEqual(result["steps"]["sms_followup"]["outcome"], "timed_out")
        self.assertEqual(result["late_reply_count"], 1)

    def test_operator_stop_during_delay_prevents_first_dispatch(self):
        definition = vertical_slice_definition().to_dict()
        definition["steps"][0]["delay_seconds"] = 5
        definition = validate_flow_definition(definition)
        transport = FakeTransport()
        clock = CallbackClock()
        runner = make_runner(definition=definition, transport=transport, clock=clock)
        clock.callback = lambda: runner.request_stop(reason="operator test")
        result = runner.run()
        self.assertEqual(result["status"], "stopped")
        self.assertEqual(transport.send_attempts, [])
        self.assertEqual(result["stop_requested"]["source"], "operator")
        self.assertTrue(result["session_ended"])

    def test_operator_stop_racing_dispatch_allows_no_subsequent_contact(self):
        transport = FakeTransport()
        runner = make_runner(transport=transport)
        transport.before_send = lambda _kwargs: runner.request_stop(reason="race")
        result = runner.run()
        self.assertEqual(result["status"], "stopped")
        self.assertEqual(len(transport.send_attempts), 1)
        self.assertEqual(result["steps"]["opening_email"]["operations"]["message"]["status"],
                         "confirmed")
        self.assertEqual(result["steps"]["sms_followup"]["status"], "pending")
        self.assertTrue(result["session_ended"])

    def test_target_stop_wins_over_reply_branch(self):
        transport = FakeTransport()

        def stop_reply(kwargs, response):
            transport.queue_event({
                "event_id": "stop-1", "type": "reply",
                "message_id": response["message_id"],
                "text": "Please stop contacting me.",
            })
            transport.after_send = None

        transport.after_send = stop_reply
        result = make_runner(transport=transport).run()
        self.assertEqual(result["status"], "stopped")
        self.assertEqual(result["stop_requested"]["source"], "target")
        self.assertEqual(result["steps"]["opening_email"]["reply_count"], 1)
        self.assertEqual(result["steps"]["sms_followup"]["status"], "pending")

    def test_guard_failure_stops_before_dispatch(self):
        bad_outputs = [
            {"subject": "Practice", "body": "Please send your password."},
            {"subject": "Practice", "body": "Open https://example.test"},
            {"subject": "Practice", "body": "Safe practice copy",
             "attachments": ["declared-file"]},
        ]
        for content in bad_outputs:
            with self.subTest(content=content):
                transport = FakeTransport()
                model = RecordingModel({"opening_email": content})
                result = make_runner(transport=transport, model=model).run()
                self.assertEqual(result["status"], "failed")
                self.assertIn("guard_failure", result["error"])
                self.assertEqual(transport.send_attempts, [])
                self.assertTrue(result["session_ended"])

    def test_model_cannot_override_interpreter_controls(self):
        transport = FakeTransport()
        malicious = {
            "subject": "Practice", "body": "Safe copy from the model.",
            "channel": "sms", "next": "terminal_debrief", "delay_seconds": 999,
        }
        result = make_runner(
            transport=transport,
            model=RecordingModel({"opening_email": malicious}),
        ).run()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(transport.send_attempts, [])
        self.assertEqual(vertical_slice_definition().start, "opening_email")

    def test_uncertain_dispatch_retries_same_key_and_reconciles(self):
        transport = FakeTransport()
        transport.failures = 1
        store = MemoryRunStore()
        observed = {}

        def checkpoint_before_dispatch(kwargs):
            if observed:
                return
            persisted = store.load()
            operation = persisted.steps["opening_email"].operations["message"]
            observed["status"] = operation.status
            observed["key"] = operation.idempotency_key
            observed["payload_key"] = kwargs["idempotency_key"]

        transport.before_send = checkpoint_before_dispatch
        result = make_runner(transport=transport, store=store).run()
        self.assertEqual(result["status"], "completed")
        opening = result["steps"]["opening_email"]["operations"]["message"]
        self.assertEqual(opening["attempts"], 2)
        self.assertEqual(opening["reconciliations"], 1)
        self.assertEqual(observed["status"], "dispatching")
        self.assertEqual(observed["key"], observed["payload_key"])
        opening_attempts = [call for call in transport.send_attempts
                            if call["channel"] == "email" and call["action"] == "message"]
        self.assertEqual(len(opening_attempts), 2)
        self.assertEqual({call["idempotency_key"] for call in opening_attempts},
                         {observed["key"]})

    def test_crash_after_checkpoint_resumes_with_same_key_and_no_duplicate_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "run.json")
            store = JsonRunStore(path)
            first_transport = FakeTransport()
            first_transport.crash = True
            first_model = RecordingModel()
            first = make_runner(store=store, transport=first_transport,
                                model=first_model, run_id="resume-test")
            with self.assertRaises(SimulatedCrash):
                first.run()
            checkpoint = store.load()
            operation = checkpoint.steps["opening_email"].operations["message"]
            self.assertEqual(operation.status, "dispatching")
            self.assertEqual(operation.attempts, 1)
            key = operation.idempotency_key

            second_transport = FakeTransport()
            second_model = RecordingModel()
            resumed = make_runner(store=store, transport=second_transport,
                                  model=second_model, run_id="ignored-on-resume")
            result = resumed.run()
            self.assertEqual(result["status"], "completed")
            resumed_operation = result["steps"]["opening_email"]["operations"]["message"]
            self.assertEqual(resumed_operation["idempotency_key"], key)
            self.assertEqual(resumed_operation["attempts"], 2)
            self.assertEqual(len(second_transport.send_attempts), 3)
            self.assertNotIn("opening_email",
                             [call["step_id"] for call in second_model.calls])
            with open(path, encoding="utf-8") as handle:
                durable = json.load(handle)
            self.assertEqual(durable["status"], "completed")

    def test_retry_pending_can_be_resumed_without_closing_session(self):
        store = MemoryRunStore()
        first_transport = FakeTransport()
        first_transport.failures = 2
        first = make_runner(store=store, transport=first_transport)
        pending = first.run()
        self.assertEqual(pending["status"], "retry_pending")
        self.assertFalse(pending["session_ended"])

        second_transport = FakeTransport()
        resumed = make_runner(store=store, transport=second_transport).run()
        self.assertEqual(resumed["status"], "completed")
        self.assertEqual(resumed["steps"]["opening_email"]["operations"]["message"]["attempts"],
                         1)

    def test_checkpoint_resume_preserves_reply_wait_and_avoids_redispatch(self):
        store = MemoryRunStore()
        transport = FakeTransport()
        clock = CallbackClock()
        runner = make_runner(store=store, transport=transport, clock=clock)

        def crash_after_first_wait_sleep():
            raise SimulatedCrash("loss during reply wait")

        clock.callback = crash_after_first_wait_sleep
        with self.assertRaises(SimulatedCrash):
            runner.run()
        checkpoint = store.load()
        opening = checkpoint.steps["opening_email"]
        self.assertEqual(opening.status, "waiting_reply")
        self.assertEqual(opening.reply_deadline_wall, 5.0)
        key = opening.operations["message"].idempotency_key

        resumed_clock = VirtualClock(start=clock.now())
        resumed = make_runner(store=store, transport=transport, clock=resumed_clock)
        result = resumed.run()
        self.assertEqual(result["status"], "completed")
        opening_attempts = [call for call in transport.send_attempts
                            if call["channel"] == "email" and call["action"] == "message"]
        self.assertEqual(len(opening_attempts), 1)
        self.assertEqual(opening_attempts[0]["idempotency_key"], key)
        self.assertEqual(result["steps"]["opening_email"]["outcome"], "timed_out")

    def test_checkpoint_rejects_a_different_definition(self):
        store = MemoryRunStore()
        transport = FakeTransport()
        transport.failures = 2
        self.assertEqual(make_runner(store=store, transport=transport).run()["status"],
                         "retry_pending")
        changed = vertical_slice_definition().to_dict()
        changed["flow_id"] = "different-flow"
        changed["steps"][0]["content"]["subject"] = "Different safe subject"
        with self.assertRaises(RunStateError):
            make_runner(store=store, definition=validate_flow_definition(changed)).run()


class AdapterAndCliTests(unittest.TestCase):
    def setUp(self):
        guard = mock.patch("agent.target_api.urllib.request.urlopen",
                           side_effect=AssertionError("live HTTP forbidden"))
        self.urlopen = guard.start()
        self.addCleanup(guard.stop)

    def test_target_adapter_rechecks_boundaries_before_client_call(self):
        client = mock.Mock()
        adapter = TargetChannelAdapter(client)
        base = {
            "session_id": "s1", "target_id": "julius", "channel": "email",
            "action": "message", "sender": {"name": "P", "address": "p"},
            "content": {"subject": "Practice", "body": "Safe practice copy"},
            "idempotency_key": "fixed", "sent_at": "2026-11-23T09:00:00+01:00",
        }
        with self.assertRaises(FlowValidationError):
            adapter.send_message(**{**base, "channel": "mfa_push"})
        with self.assertRaises(FlowValidationError):
            adapter.send_message(**{**base, "content": {
                "subject": "Practice", "body": "https://example.test"}})
        with self.assertRaises(FlowValidationError):
            adapter.open_session(run_id="r", scenario="eval", target_id="julius",
                                 idempotency_key="session-key")
        with self.assertRaises(FlowValidationError):
            TargetChannelAdapter(client, allowed_targets={"outside"})
        client.send_message.assert_not_called()
        client._request.assert_not_called()

        client.send_message.return_value = {"message_id": "m1", "events": []}
        response = adapter.send_message(**base)
        self.assertEqual(response["message_id"], "m1")
        message = client.send_message.call_args.args[1]
        self.assertNotIn("attachments", message)
        self.assertEqual(client.send_message.call_args.kwargs["idem_key"], "fixed")

    def test_target_adapter_uses_public_session_idem_key_when_available(self):
        class PublicSessionClient:
            def __init__(self):
                self.calls = []

            def create_session(self, scenario_id="practice", idem_key=None):
                self.calls.append((scenario_id, idem_key))
                return {"session_id": "public-session", "scenario_id": "practice"}

            def _request(self, *args, **kwargs):
                raise AssertionError("legacy private request seam must not be used")

        client = PublicSessionClient()
        adapter = TargetChannelAdapter(client)
        response = adapter.open_session(
            run_id="run-public", scenario="practice", target_id="julius",
            idempotency_key="flow-run-public-session")
        self.assertEqual(response["session_id"], "public-session")
        self.assertEqual(client.calls,
                         [("practice", "flow-run-public-session")])

    def test_target_adapter_legacy_session_seam_retains_the_durable_key(self):
        client = mock.Mock()
        client._request.return_value = {
            "session_id": "legacy-session", "scenario_id": "practice"}
        adapter = TargetChannelAdapter(client)
        response = adapter.open_session(
            run_id="run-legacy", scenario="practice", target_id="robert",
            idempotency_key="flow-run-legacy-session")
        self.assertEqual(response["session_id"], "legacy-session")
        client._request.assert_called_once_with(
            "POST", "/sessions", {"scenario_id": "practice"},
            idempotency_key="flow-run-legacy-session")
        client.create_session.assert_not_called()

    def test_target_adapter_retains_submission_redaction(self):
        submitted = {
            "event_id": "submission-1", "type": "page.submitted",
            "fields": ["otp", "name"],
            "values": {"otp": "123456", "name": "Practice Person"},
        }
        client = mock.Mock()
        client.send_message.return_value = {"message_id": "m1", "events": [submitted]}
        client.get_events.return_value = {"events": [submitted]}
        adapter = TargetChannelAdapter(client)
        base = {
            "session_id": "s1", "target_id": "julius", "channel": "email",
            "action": "message", "sender": {"name": "P", "address": "p"},
            "content": {"subject": "Practice", "body": "Safe practice copy"},
            "idempotency_key": "fixed", "sent_at": "2026-11-23T09:00:00+01:00",
        }

        for events in (adapter.send_message(**base)["events"], adapter.poll_events(
                session_id="s1")):
            self.assertNotIn("values", events[0])
            self.assertEqual(events[0]["submission"]["objective"], "credentials")
            self.assertEqual(events[0]["submission"]["entered_fields"], ["otp", "name"])
            self.assertNotIn("123456", json.dumps(events))
            self.assertNotIn("Practice Person", json.dumps(events))

    def test_practice_cli_uses_explicit_live_wiring_with_fake_transport(self):
        with tempfile.TemporaryDirectory() as tmp:
            definition_path = write_definition(tmp)
            state_path = os.path.join(tmp, "run-state.json")
            trace_dir = os.path.join(tmp, "traces")
            transport = FakeTransport()
            config = mock.Mock(
                revel8_api_base="https://target.invalid", revel8_team_key="fake-key")
            client = mock.Mock()
            output = io.StringIO()
            with mock.patch("agent.config.Config", return_value=config) as config_type, \
                    mock.patch("agent.target_api.TargetClient",
                               return_value=client) as client_type, \
                    mock.patch("agent.channels.TargetChannelAdapter",
                               return_value=transport) as adapter_type, \
                    mock.patch.object(flow_run, "SystemClock", VirtualClock), \
                    redirect_stdout(output):
                code = flow_run.main([
                    "--practice", definition_path,
                    "--state", state_path,
                    "--trace-dir", trace_dir,
                ])

            self.assertEqual(code, 0)
            payload = json.loads(output.getvalue())
            result = payload["result"]
            self.assertEqual(result["status"], "completed")
            self.assertNotIn("dry_run_dispatches", payload)
            config_type.assert_called_once_with()
            client_type.assert_called_once_with(config)
            adapter_type.assert_called_once_with(
                client, allowed_targets=DEFAULT_PRACTICE_TARGETS)
            self.assertEqual(client.mock_calls, [])
            contacts = [call for call in transport.calls
                        if call["operation"] in ("send_message", "start_conversation")]
            self.assertEqual([call["channel"] for call in contacts],
                             ["email", "sms", "phone_call", "email"])
            self.assertEqual(contacts[-1]["action"], "debrief")
            with open(state_path, encoding="utf-8") as handle:
                self.assertEqual(json.load(handle)["status"], "completed")

            trace_path = os.path.join(trace_dir, result["session_id"] + ".jsonl")
            with open(trace_path, encoding="utf-8") as handle:
                records = [json.loads(line) for line in handle if line.strip()]
            self.assertIn("flow_started", [record["kind"] for record in records])
            self.assertIn("flow_completed", [record["kind"] for record in records])
            for record in records:
                self.assertEqual(record["run_id"], result["run_id"])
                self.assertIsInstance(record["step_id"], str)
                self.assertIsInstance(record["ts"], (int, float))
            self.urlopen.assert_not_called()

    def test_practice_cli_requires_durable_state_and_trace_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            definition_path = write_definition(tmp)
            for argv in (
                    ["--practice", definition_path],
                    ["--practice", definition_path, "--state",
                     os.path.join(tmp, "run.json")],
                    ["--practice", definition_path, "--trace-dir",
                     os.path.join(tmp, "traces")]):
                with self.subTest(argv=argv), self.assertRaises(SystemExit) as caught:
                    flow_run.main(argv)
                self.assertEqual(caught.exception.code, 2)

    def test_practice_cli_refuses_eval_and_unlisted_targets_before_wiring(self):
        for field, value in (("scenario", "eval"), ("target_id", "outside")):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                raw = vertical_slice_definition().to_dict()
                raw[field] = value
                definition_path = write_definition(tmp, raw)
                errors = io.StringIO()
                with mock.patch("agent.target_api.TargetClient") as client_type, \
                        redirect_stderr(errors):
                    code = flow_run.main([
                        "--practice", definition_path,
                        "--state", os.path.join(tmp, "run.json"),
                        "--trace-dir", os.path.join(tmp, "traces"),
                    ])
                self.assertEqual(code, 2)
                self.assertIn("flow practice refused", errors.getvalue())
                client_type.assert_not_called()
                self.urlopen.assert_not_called()

    def test_practice_cli_requires_only_target_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            definition_path = write_definition(tmp)
            config = mock.Mock(revel8_api_base="", revel8_team_key="")
            errors = io.StringIO()
            with mock.patch("agent.config.Config", return_value=config), \
                    mock.patch("agent.target_api.TargetClient") as client_type, \
                    redirect_stderr(errors):
                code = flow_run.main([
                    "--practice", definition_path,
                    "--state", os.path.join(tmp, "run.json"),
                    "--trace-dir", os.path.join(tmp, "traces"),
                ])
            self.assertEqual(code, 2)
            self.assertIn("REVEL8_API_BASE", errors.getvalue())
            self.assertIn("REVEL8_TEAM_KEY", errors.getvalue())
            client_type.assert_not_called()
            self.urlopen.assert_not_called()

    def test_trace_jsonl_is_complete_and_ingestible(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport()
            result = make_runner(transport=transport, trace_dir=tmp).run()
            self.assertEqual(result["status"], "completed", result.get("error"))
            trace_path = os.path.join(tmp, result["session_id"] + ".jsonl")
            with open(trace_path, encoding="utf-8") as handle:
                records = [json.loads(line) for line in handle if line.strip()]
            self.assertEqual(records[-1]["kind"], "session_ended")
            self.assertEqual(
                sum(record["kind"] == "flow_completed" for record in records), 1)
            for record in records:
                self.assertEqual(record["run_id"], "run-test")
                self.assertIsInstance(record["step_id"], str)
                self.assertIsInstance(record["ts"], (int, float))

    def test_cli_dry_run_is_usable_and_entirely_fake(self):
        output = io.StringIO()
        with redirect_stdout(output):
            code = flow_run.main(["--dry-run", "--run-id", "cli-test"])
        self.assertEqual(code, 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["result"]["status"], "completed")
        contacts = [call for call in payload["dry_run_dispatches"]
                    if call["operation"] in ("send_message", "start_conversation")]
        self.assertEqual([call["channel"] for call in contacts],
                         ["email", "sms", "phone_call", "email"])

    def test_cli_refuses_when_mode_is_not_explicit(self):
        with self.assertRaises(SystemExit) as caught:
            flow_run.main([])
        self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
