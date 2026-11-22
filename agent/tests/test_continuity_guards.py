"""Continuity guards + redacted send-receipt regression tests.

Covers the four audit failure classes (repeated invitations/introductions,
unanswered target questions, refused-CTA repeats, and unbacked
attachment/routing/handoff claims) and the redacted per-send receipt.

All clients are fakes/mocks: these tests never contact a live Target API or LLM.
"""
from __future__ import annotations

import copy
import json
import tempfile
import types
import unittest
from unittest import mock

from agent import prompts
from agent.guards import (check_attachment_claim, check_handoff_claim,
                          run_programmatic_guard)
from agent.loop import SessionRunner
from agent.pretexts import get_pretext
from agent.state import (SenderIdentity, SessionState, TopicHypothesis,
                         TouchRecord)
from agent.target_api import TargetAPIError
from agent.trace import TraceWriter, build_send_receipt


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

GOOD_BODY = (
    "Hi Julius,\n\nFollowing up on the vendor evaluation with a short comparison "
    "of the rollout criteria and the proposed next steps for your review.\n\n"
    "Best regards,\nDr. Lena Hofer\nSenior Partner, Hofer & Brandt Advisory"
)


def _state(history=None):
    persona = SenderIdentity(
        name="Dr. Lena Hofer", role="Senior Partner", org="Hofer & Brandt",
        address="lena@hoferbrandt-advisory.com", domain="hoferbrandt-advisory.com")
    topic = TopicHypothesis(topic_id="vendor", label="Vendor evaluation",
                            prior=0.6, confidence=0.7, status="engaged")
    st = SessionState(
        session_id="s1", scenario_id="practice", target_id="julius", budget=10,
        touches_used=3, topics=[topic], persona=persona, identities_used=[persona])
    if history:
        st.history = history
    return st


def _reply_record(body, channel="email"):
    return TouchRecord(
        idx=1, channel=channel, direction="message", sender="Dr. Lena Hofer",
        topic_id="vendor", objective_step="build", summary="", subject="Re",
        body="our outbound", events=[{"type": "reply", "channel": channel,
                                      "body": body}], reaction="replied")


def _guard_kwargs(**over):
    base = dict(allowed_domains=["hoferbrandt-advisory.com"], trap_patterns=[],
                include_link=False, planned_url="https://unused",
                required_sender="Dr. Lena Hofer")
    base.update(over)
    return base


# --------------------------------------------------------------------------- #
# deterministic attachment-claim guard
# --------------------------------------------------------------------------- #

class AttachmentClaimTests(unittest.TestCase):
    def test_attachment_claim_blocked_when_not_attaching(self):
        for text in ("Please find the attached profile.",
                     "The one-page profile is attached for your review.",
                     "The scoping pack is enclosed.",
                     "See the enclosure for details.",
                     "The questionnaire is attached herewith."):
            with self.subTest(text=text):
                issues = check_attachment_claim(text, include_attachment=False)
                self.assertTrue(issues, text)
                self.assertIn("attachment claim without include_attachment",
                              issues[0])

    def test_attachment_claim_allowed_when_attachment_is_included(self):
        self.assertEqual(
            check_attachment_claim("The profile is attached.", True), [])

    def test_absence_and_future_offers_are_not_blocked(self):
        for text in ("Short note, no attachments this time.",
                     "There is no attachment — just a question.",
                     "I can attach the one-pager if that helps.",
                     "Happy to share the profile once we are set up.",
                     "I will attach it after the NDA is signed."):
            with self.subTest(text=text):
                self.assertEqual(
                    check_attachment_claim(text, include_attachment=False), [], text)

    def test_runs_in_programmatic_guard_only_without_include_attachment(self):
        body = GOOD_BODY.replace("for your review.",
                                 "for your review. The profile is attached.")
        self.assertTrue(run_programmatic_guard(
            "Following up", body, **_guard_kwargs(include_attachment=False)))
        self.assertFalse(any("attachment claim" in i for i in run_programmatic_guard(
            "Following up", body, **_guard_kwargs(include_attachment=True))))


# --------------------------------------------------------------------------- #
# deterministic routing / handoff / programme / access guard
# --------------------------------------------------------------------------- #

class HandoffClaimTests(unittest.TestCase):
    def test_completed_routing_and_handoff_claims_are_flagged(self):
        for text in ("I have looped in our People team already.",
                     "I've routed your profile to the hiring panel.",
                     "Your request has been escalated and approved.",
                     "You have been enrolled in the pilot programme.",
                     "Access has been granted to the workspace.",
                     "The People team has your profile now.",
                     "I have enrolled you into the programme."):
            with self.subTest(text=text):
                issues = check_handoff_claim(text)
                self.assertTrue(issues, text)
                self.assertIn("unsupported routing/handoff claim", issues[0])

    def test_future_offers_and_benign_copy_are_not_flagged(self):
        for text in ("I can loop in our analyst if that helps.",
                     "The profile enters the normal People-team queue after this.",
                     "I would route this to our panel once you confirm.",
                     "Happy to introduce you to the team when ready.",
                     GOOD_BODY):
            with self.subTest(text=text):
                self.assertEqual(check_handoff_claim(text), [], text)

    def test_evidence_override_allows_a_confirmed_claim(self):
        text = "Access has been granted to the workspace."
        self.assertTrue(check_handoff_claim(text))
        self.assertEqual(
            check_handoff_claim(text,
                                supported_claims=["access has been granted"]), [])

    def test_handoff_claim_runs_in_programmatic_guard(self):
        body = GOOD_BODY.replace(
            "for your review.",
            "for your review. I have looped in our People team already.")
        self.assertTrue(any("routing/handoff" in i for i in run_programmatic_guard(
            "Following up", body, **_guard_kwargs())))


# --------------------------------------------------------------------------- #
# a safe, continuous draft passes every deterministic check
# --------------------------------------------------------------------------- #

class SafeDraftTests(unittest.TestCase):
    def test_safe_passing_draft_has_no_deterministic_issues(self):
        self.assertEqual(
            run_programmatic_guard("Following up", GOOD_BODY, **_guard_kwargs()), [])

    def test_safe_strike_draft_with_link_passes(self):
        url = "https://workspace.hoferbrandt-advisory.com/x"
        body = GOOD_BODY + f"\n\nYou can open the secure workspace here: {url}"
        allowed = ["hoferbrandt-advisory.com", "workspace.hoferbrandt-advisory.com"]
        self.assertEqual(run_programmatic_guard(
            "Following up", body,
            **_guard_kwargs(allowed_domains=allowed, include_link=True,
                            planned_url=url)), [])


# --------------------------------------------------------------------------- #
# read-back prompt: recent target messages + all four continuity requirements
# --------------------------------------------------------------------------- #

class ReadbackContinuityTests(unittest.TestCase):
    def test_recent_target_messages_pulls_newest_reply_bodies_first(self):
        st = _state(history=[
            _reply_record("First question: who referred you?"),
            _reply_record("Second: what is in the pack?", channel="linkedin_message"),
        ])
        recent = prompts.recent_target_messages(st, limit=3)
        self.assertEqual(len(recent), 2)
        self.assertIn("Second: what is in the pack?", recent[0])
        self.assertIn("[linkedin_message]", recent[0])
        self.assertIn("who referred you?", recent[1])

    def test_recent_target_messages_handles_no_history(self):
        self.assertEqual(prompts.recent_target_messages(_state()), [])

    def test_readback_prompt_embeds_recent_messages_and_four_classes(self):
        st = _state(history=[
            _reply_record("You already invited me yesterday. What is in the pack?")])
        msgs = prompts.build_guard_readback_messages(
            st, get_pretext("julius"), "subject", "body", False, "https://unused")
        content = msgs[1]["content"]
        # recent target message surfaced for continuity
        self.assertIn("RECENT TARGET MESSAGES", content)
        self.assertIn("What is in the pack?", content)
        # (ii) unanswered target questions -> answer-first requirement
        self.assertIn("ANSWER-FIRST", content)
        # (i) repeated invitation/introduction without new value
        self.assertIn("NO EMPTY REPETITION", content)
        # (iii) repeating an explicitly refused process/link
        self.assertIn("NO REFUSED REPEAT", content)
        # (iv) unbacked attachment/routing/handoff/programme/access claims
        self.assertIn("NO UNBACKED COMPLETION CLAIMS", content)

    def test_readback_preserves_substance_not_language_rule(self):
        st = _state()
        msgs = prompts.build_guard_readback_messages(
            st, get_pretext("julius"), "subject", "body", False, "https://unused")
        # system prompt keeps the substance-not-language instruction
        self.assertIn("substance rather than language", msgs[0]["content"])
        # and the continuity check repeats "substance, not wording or language"
        self.assertIn("substance, not wording or language", msgs[1]["content"])
        # still the guard schema, never the planner schema
        self.assertEqual(msgs[0]["content"], prompts.GUARD_SYSTEM)


# --------------------------------------------------------------------------- #
# redacted send receipt
# --------------------------------------------------------------------------- #

class _SendAPI:
    def __init__(self, resp=None):
        self.calls = []
        self.resp = resp or {"touches_used": 4, "events": []}

    def send_message(self, sid, message, idem_key=None, sent_at=None):
        self.calls.append({"message": copy.deepcopy(message), "idem_key": idem_key,
                           "sent_at": sent_at})
        return self.resp


def _runner(touches_used=3):
    runner = SessionRunner.__new__(SessionRunner)
    runner.scenario = "practice"
    runner.target_id = "julius"
    runner.arms = {}
    runner.cfg = types.SimpleNamespace(theta_hard=0.85, dead_air_k=3)
    runner.pretext = copy.deepcopy(get_pretext("julius"))
    persona = SenderIdentity(
        name="Dr. Lena Hofer", role="Senior Partner", org="Hofer & Brandt",
        address="lena@hoferbrandt-advisory.com", domain="hoferbrandt-advisory.com")
    topic = TopicHypothesis(topic_id="vendor", label="Vendor evaluation",
                            prior=0.6, confidence=0.7, status="engaged")
    runner.state = SessionState(
        session_id="s1", scenario_id="practice", target_id="julius", budget=10,
        touches_used=touches_used, topics=[topic], persona=persona,
        identities_used=[persona])
    runner.fallbacks = []
    runner._session_closed = False
    return runner


class SendReceiptTests(unittest.TestCase):
    def test_build_send_receipt_has_all_audit_fields_and_no_raw_values(self):
        receipt = build_send_receipt(
            target="julius", channel="email", sender="Dr. Lena Hofer",
            address="lena@x.test", subject="Scoping", idempotency_key="t4-abc",
            sent_at="2026-11-24T10:00:00+01:00", api_message_id="m_1",
            attachment_count=1, touches_used=4)
        self.assertEqual(set(receipt), {
            "sent", "target", "channel", "sender", "address", "subject",
            "idempotency_key", "sent_at", "api_message_id", "attachment_count",
            "touches_used"})
        self.assertTrue(receipt["sent"])
        self.assertEqual(receipt["api_message_id"], "m_1")
        self.assertEqual(receipt["attachment_count"], 1)
        self.assertEqual(receipt["touches_used"], 4)

    def test_send_populates_resolved_redacted_receipt(self):
        runner = _runner(touches_used=3)
        runner.api = _SendAPI(resp={"touches_used": 4, "events": [],
                                    "message_id": "m_99"})
        runner._send("email", "Scoping pack", GOOD_BODY, None, action="build")
        receipt = runner._last_send_receipt
        self.assertTrue(receipt["sent"])
        self.assertEqual(receipt["target"], "julius")
        self.assertEqual(receipt["channel"], "email")
        self.assertEqual(receipt["sender"], "Dr. Lena Hofer")
        self.assertEqual(receipt["address"], "lena@hoferbrandt-advisory.com")
        self.assertEqual(receipt["subject"], "Scoping pack")
        self.assertEqual(receipt["api_message_id"], "m_99")
        self.assertEqual(receipt["attachment_count"], 0)
        self.assertEqual(receipt["touches_used"], 4)
        self.assertTrue(receipt["idempotency_key"])
        # resolved sent_at equals the monotonic cursor actually used
        self.assertEqual(receipt["sent_at"], runner.state.last_sent_at)
        self.assertEqual(receipt["sent_at"], runner.api.calls[-1]["sent_at"])

    def test_receipt_reflects_attachment_count_actually_sent(self):
        runner = _runner(touches_used=3)
        runner.api = _SendAPI()
        runner._send("email", "CV", GOOD_BODY,
                     [{"filename": "candidate-profile.pdf"}], action="build")
        self.assertEqual(runner._last_send_receipt["attachment_count"], 1)

    def test_blocked_send_records_not_sent_receipt_with_reason(self):
        runner = _runner(touches_used=10)   # budget exhausted
        runner.api = _SendAPI()
        events = runner._send("email", "Scoping", GOOD_BODY, None, action="build")
        self.assertEqual(events, [])
        receipt = runner._last_send_receipt
        self.assertFalse(receipt["sent"])
        self.assertEqual(receipt["reason"], "touch_budget_exhausted")
        self.assertEqual(receipt["target"], "julius")

    def test_session_closed_409_records_not_sent_receipt(self):
        runner = _runner(touches_used=3)

        class ClosedAPI:
            def send_message(self, sid, message, idem_key=None, sent_at=None):
                raise TargetAPIError(409, "budget used", "POST", "messages")

        runner.api = ClosedAPI()
        self.assertEqual(
            runner._send("email", "Scoping", GOOD_BODY, None, action="build"), [])
        self.assertFalse(runner._last_send_receipt["sent"])
        self.assertTrue(runner._session_closed)

    def test_trace_touch_writes_redacted_receipt_without_submitted_values(self):
        st = _state()
        st.raw_event_log = []
        receipt = build_send_receipt(
            target="julius", channel="email", sender="Dr. Lena Hofer",
            address="lena@x.test", subject="Scoping", idempotency_key="t4-abc",
            sent_at="2026-11-24T10:00:00+01:00", api_message_id="m_1",
            attachment_count=0, touches_used=4)
        events = [{"type": "page.submitted",
                   "values": {"password": "raw-secret-xyz"}}]
        with tempfile.TemporaryDirectory() as tmp:
            writer = TraceWriter(tmp, "s1")
            writer.touch(state=st, plan={}, brief={}, draft={"subject": "Scoping"},
                         guard={}, events=events, reaction="engaged",
                         fallbacks=[], send_receipt=receipt)
            stored = open(writer.path, encoding="utf-8").read()
        self.assertNotIn("raw-secret-xyz", stored)
        line = json.loads(stored)
        self.assertEqual(line["send_receipt"]["api_message_id"], "m_1")
        self.assertEqual(line["send_receipt"]["subject"], "Scoping")
        self.assertNotIn("values", line["events"][0])


if __name__ == "__main__":
    unittest.main()
