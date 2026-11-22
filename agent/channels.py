"""Narrow channel transports for the durable custom-flow interpreter.

``TargetChannelAdapter`` is the only live Target API seam. It exposes no email,
SMS, or telephony providers and accepts only the v1 practice channel/action
pairs. ``DryRunTransport`` implements the same interface without network I/O.
"""
from __future__ import annotations

import copy
import inspect
from typing import Iterable, List, Protocol

from .flow import (DEFAULT_PRACTICE_TARGETS, FlowValidationError,
                   SUPPORTED_CHANNEL_ACTIONS, guard_content, parse_story_time)
from .target_api import TargetAPIError, TargetClient, sanitize_target_payload


class TransportError(Exception):
    """A transport failure with explicit retry/ambiguity semantics."""

    def __init__(self, message: str, *, retryable: bool = False,
                 uncertain: bool = False):
        self.retryable = bool(retryable)
        self.uncertain = bool(uncertain)
        super().__init__(message)


class ChannelTransport(Protocol):
    def open_session(self, *, run_id: str, scenario: str, target_id: str,
                     idempotency_key: str) -> dict: ...

    def send_message(self, *, session_id: str, target_id: str, channel: str,
                     action: str, sender: dict, content: dict,
                     idempotency_key: str, sent_at: str) -> dict: ...

    def start_conversation(self, *, session_id: str, target_id: str,
                           sender: dict, idempotency_key: str,
                           sent_at: str) -> dict: ...

    def conversation_turn(self, *, conversation_id: str, content: dict,
                          idempotency_key: str, sent_at: str) -> dict: ...

    def end_conversation(self, *, conversation_id: str) -> dict: ...

    def poll_events(self, *, session_id: str) -> List[dict]: ...

    def end_session(self, *, session_id: str) -> dict: ...


def _require_key(idempotency_key: str) -> None:
    if not isinstance(idempotency_key, str) or not idempotency_key.strip():
        raise FlowValidationError(["an idempotency key is required before dispatch"])


def _require_story_time(sent_at: str) -> None:
    parse_story_time(sent_at)


def _require_sender(sender: dict) -> None:
    if not isinstance(sender, dict) or set(sender) != {"name", "address"} \
            or any(not isinstance(sender.get(key), str) or not sender[key].strip()
                   for key in ("name", "address")):
        raise FlowValidationError(["sender must contain exactly non-empty name and address"])


def _translate_error(error: TargetAPIError) -> TransportError:
    retryable = error.status == 0 or error.status == 429 or error.status >= 500
    # A lost response is ambiguous even when the server may not have accepted the
    # request. Retrying the persisted idempotency key reconciles both cases.
    return TransportError(str(error), retryable=retryable, uncertain=retryable)


class TargetChannelAdapter:
    """Adapt only the narrow practice surface exposed by ``TargetClient``."""

    def __init__(self, client: TargetClient, *,
                 allowed_targets: Iterable[str] = DEFAULT_PRACTICE_TARGETS):
        allowlist = frozenset(allowed_targets)
        if not allowlist or not allowlist <= DEFAULT_PRACTICE_TARGETS:
            raise FlowValidationError([
                "practice target allowlist must be a non-empty subset of the strict defaults"])
        self.client = client
        self.allowed_targets = allowlist

    def _practice_target(self, target_id: str) -> None:
        if target_id not in self.allowed_targets:
            raise FlowValidationError(["target is outside the practice allowlist"])

    def _create_practice_session(self, idempotency_key: str) -> dict:
        create_session = self.client.create_session
        try:
            parameters = inspect.signature(create_session).parameters
        except (TypeError, ValueError):
            parameters = {}
        if "idem_key" in parameters:
            return create_session("practice", idem_key=idempotency_key)

        # Compatibility seam for the original TargetClient, whose create_session
        # generates its own key. Remove this branch once idem_key is ubiquitous;
        # never retry after a TypeError because session creation is not side-effect
        # free and the durable key must be decided before the first request.
        return self.client._request(
            "POST", "/sessions", {"scenario_id": "practice"},
            idempotency_key=idempotency_key,
        )

    def open_session(self, *, run_id: str, scenario: str, target_id: str,
                     idempotency_key: str) -> dict:
        if scenario != "practice":
            raise FlowValidationError(["only the practice scenario is permitted"])
        self._practice_target(target_id)
        _require_key(idempotency_key)
        try:
            return sanitize_target_payload(
                self._create_practice_session(idempotency_key))
        except TargetAPIError as error:
            raise _translate_error(error)

    def send_message(self, *, session_id: str, target_id: str, channel: str,
                     action: str, sender: dict, content: dict,
                     idempotency_key: str, sent_at: str) -> dict:
        self._practice_target(target_id)
        _require_sender(sender)
        if (channel, action) not in SUPPORTED_CHANNEL_ACTIONS \
                or channel == "phone_call":
            raise FlowValidationError([f"invalid message channel/action: {channel}/{action}"])
        issues = guard_content(channel, action, content)
        if issues:
            raise FlowValidationError(issues)
        _require_key(idempotency_key)
        _require_story_time(sent_at)
        message = {
            "to": target_id,
            "channel": channel,
            "from": copy.deepcopy(sender),
            "body": content.get("body", ""),
        }
        if channel == "email":
            message["subject"] = content.get("subject", "")
        try:
            return sanitize_target_payload(self.client.send_message(
                session_id, message, idem_key=idempotency_key, sent_at=sent_at))
        except TargetAPIError as error:
            raise _translate_error(error)

    def start_conversation(self, *, session_id: str, target_id: str,
                           sender: dict, idempotency_key: str,
                           sent_at: str) -> dict:
        self._practice_target(target_id)
        _require_sender(sender)
        _require_key(idempotency_key)
        _require_story_time(sent_at)
        try:
            return sanitize_target_payload(self.client.start_conversation(
                session_id, target_id, "phone_call", copy.deepcopy(sender),
                sent_at=sent_at, idem_key=idempotency_key))
        except TargetAPIError as error:
            raise _translate_error(error)

    def conversation_turn(self, *, conversation_id: str, content: dict,
                          idempotency_key: str, sent_at: str) -> dict:
        issues = guard_content("phone_call", "conversation", content)
        if issues:
            raise FlowValidationError(issues)
        _require_key(idempotency_key)
        _require_story_time(sent_at)
        try:
            return sanitize_target_payload(self.client.conversation_turn(
                conversation_id, content["say"], idem_key=idempotency_key,
                sent_at=sent_at))
        except TargetAPIError as error:
            raise _translate_error(error)

    def end_conversation(self, *, conversation_id: str) -> dict:
        try:
            return sanitize_target_payload(
                self.client.end_conversation(conversation_id))
        except TargetAPIError as error:
            raise _translate_error(error)

    def poll_events(self, *, session_id: str) -> List[dict]:
        try:
            response = self.client.get_events(session_id)
        except TargetAPIError as error:
            raise _translate_error(error)
        events = response.get("events") or []
        if not isinstance(events, list):
            raise TransportError("event poll returned a malformed event list")
        return sanitize_target_payload(events)

    def end_session(self, *, session_id: str) -> dict:
        try:
            return sanitize_target_payload(self.client.end_session(session_id))
        except TargetAPIError as error:
            raise _translate_error(error)


class DryRunTransport:
    """In-memory transport used by the CLI and fake-only execution tests."""

    def __init__(self):
        self.calls: List[dict] = []
        self.events: List[dict] = []
        self._message_count = 0
        self._conversation_count = 0
        self._touch_count = 0

    def _record(self, operation: str, **payload) -> None:
        self.calls.append({"operation": operation, **copy.deepcopy(payload)})

    def queue_event(self, event: dict) -> None:
        self.events.append(sanitize_target_payload(copy.deepcopy(event)))

    def open_session(self, *, run_id: str, scenario: str, target_id: str,
                     idempotency_key: str) -> dict:
        if scenario != "practice" or target_id not in DEFAULT_PRACTICE_TARGETS:
            raise FlowValidationError(["dry run requires a practice allowlisted target"])
        _require_key(idempotency_key)
        self._record("open_session", run_id=run_id, scenario=scenario,
                     target_id=target_id, idempotency_key=idempotency_key)
        return {"session_id": f"dry-session-{run_id}", "scenario_id": "practice",
                "touch_budget": 30, "touches_used": self._touch_count}

    def send_message(self, *, session_id: str, target_id: str, channel: str,
                     action: str, sender: dict, content: dict,
                     idempotency_key: str, sent_at: str) -> dict:
        if (channel, action) not in SUPPORTED_CHANNEL_ACTIONS \
                or channel == "phone_call":
            raise FlowValidationError(["invalid dry-run message channel/action"])
        issues = guard_content(channel, action, content)
        if issues:
            raise FlowValidationError(issues)
        _require_key(idempotency_key)
        _require_story_time(sent_at)
        self._message_count += 1
        self._touch_count += 1
        message_id = f"dry-message-{self._message_count}"
        self._record("send_message", session_id=session_id, target_id=target_id,
                     channel=channel, action=action, sender=sender, content=content,
                     idempotency_key=idempotency_key, sent_at=sent_at,
                     message_id=message_id)
        return {"message_id": message_id, "touches_used": self._touch_count,
                "events": []}

    def start_conversation(self, *, session_id: str, target_id: str,
                           sender: dict, idempotency_key: str,
                           sent_at: str) -> dict:
        _require_key(idempotency_key)
        _require_story_time(sent_at)
        self._conversation_count += 1
        self._touch_count += 1
        conversation_id = f"dry-conversation-{self._conversation_count}"
        self._record("start_conversation", session_id=session_id,
                     target_id=target_id, channel="phone_call", sender=sender,
                     idempotency_key=idempotency_key, sent_at=sent_at,
                     conversation_id=conversation_id)
        return {"conversation_id": conversation_id, "persona_says": "",
                "touches_used": self._touch_count, "events": []}

    def conversation_turn(self, *, conversation_id: str, content: dict,
                          idempotency_key: str, sent_at: str) -> dict:
        issues = guard_content("phone_call", "conversation", content)
        if issues:
            raise FlowValidationError(issues)
        _require_key(idempotency_key)
        _require_story_time(sent_at)
        self._record("conversation_turn", conversation_id=conversation_id,
                     channel="phone_call", content=content,
                     idempotency_key=idempotency_key, sent_at=sent_at)
        return {"persona_says": "", "ended": True, "events": [], "turns_used": 1}

    def end_conversation(self, *, conversation_id: str) -> dict:
        self._record("end_conversation", conversation_id=conversation_id)
        return {"ended": True}

    def poll_events(self, *, session_id: str) -> List[dict]:
        self._record("poll_events", session_id=session_id)
        events = copy.deepcopy(self.events)
        self.events.clear()
        return events

    def end_session(self, *, session_id: str) -> dict:
        self._record("end_session", session_id=session_id)
        return {"ended": True}
