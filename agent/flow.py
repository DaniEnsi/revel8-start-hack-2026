"""Versioned, deterministic custom-flow definitions for practice simulations.

The definition is the only authority for step order, channels, delays, waits,
branches, and terminal behavior. Models only supply copy for the current step.
V1 deliberately supports plain-text email/SMS messages and text phone calls;
links, attachments, pages, and sensitive requests are rejected at both definition
and dispatch boundaries.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

from .guards import check_injection, find_bare_domains, find_urls

FLOW_SCHEMA_VERSION = 1
DEFAULT_PRACTICE_TARGETS = frozenset({"julius", "robert", "tom"})
SUPPORTED_CHANNEL_ACTIONS = frozenset({
    ("email", "message"),
    ("sms", "message"),
    ("phone_call", "conversation"),
    ("email", "debrief"),
})

_ROOT_KEYS = frozenset({
    "version", "flow_id", "scenario", "target_id", "sender", "story_start",
    "start", "steps",
})
_STEP_KEYS = frozenset({
    "id", "channel", "action", "delay_seconds", "content", "next",
    "wait_seconds", "on_reply", "on_timeout",
})
_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_HTML_RE = re.compile(r"<[^>]*>")
_URI_RE = re.compile(r"\b[a-z][a-z0-9+.-]*://|\bwww\.", re.IGNORECASE)
_ANY_BARE_DOMAIN_RE = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b",
    re.IGNORECASE,
)
_SENSITIVE_RE = re.compile(
    r"\b(?:passwords?|passcodes?|credentials?|pins?|otps?|one[- ]time codes?|"
    r"verification codes?|tokens?|api[- ]keys?|secrets?|ibans?|card numbers?|"
    r"social security numbers?|private keys?|recovery codes?)\b",
    re.IGNORECASE,
)
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class FlowValidationError(ValueError):
    """A definition or outbound payload failed a closed validation boundary."""

    def __init__(self, errors: Iterable[str]):
        self.errors = tuple(str(error) for error in errors)
        super().__init__("; ".join(self.errors))


@dataclass(frozen=True)
class FlowStep:
    id: str
    channel: str
    action: str
    delay_seconds: float
    content: dict
    next: Optional[str] = None
    wait_seconds: Optional[float] = None
    on_reply: Optional[str] = None
    on_timeout: Optional[str] = None

    @property
    def branches(self) -> Tuple[str, ...]:
        if self.wait_seconds is not None:
            return (self.on_reply or "", self.on_timeout or "")
        return (self.next,) if self.next else ()

    def to_dict(self) -> dict:
        value = {
            "id": self.id,
            "channel": self.channel,
            "action": self.action,
            "delay_seconds": self.delay_seconds,
            "content": copy.deepcopy(self.content),
        }
        if self.next is not None:
            value["next"] = self.next
        if self.wait_seconds is not None:
            value.update({
                "wait_seconds": self.wait_seconds,
                "on_reply": self.on_reply,
                "on_timeout": self.on_timeout,
            })
        return value


@dataclass(frozen=True)
class FlowDefinition:
    flow_id: str
    scenario: str
    target_id: str
    sender: dict
    story_start: str
    start: str
    steps: Tuple[FlowStep, ...]
    version: int = FLOW_SCHEMA_VERSION

    @property
    def step_map(self) -> Dict[str, FlowStep]:
        return {step.id: step for step in self.steps}

    def step(self, step_id: str) -> FlowStep:
        return self.step_map[step_id]

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "flow_id": self.flow_id,
            "scenario": self.scenario,
            "target_id": self.target_id,
            "sender": copy.deepcopy(self.sender),
            "story_start": self.story_start,
            "start": self.start,
            "steps": [step.to_dict() for step in self.steps],
        }

    def canonical_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False)

    def digest(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()


def parse_story_time(value: str) -> datetime:
    """Parse an explicit timezone-aware ISO timestamp; naive values are invalid."""
    if not isinstance(value, str) or not value.strip():
        raise FlowValidationError(["story time must be a non-empty ISO 8601 string"])
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise FlowValidationError([f"invalid story time: {value!r}"])
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise FlowValidationError(["story time must include a timezone"])
    return parsed


def _number(value, path: str, errors: List[str], *, minimum: float,
            maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.append(f"{path} must be a number")
        return minimum
    result = float(value)
    if not (minimum <= result <= maximum):
        errors.append(f"{path} must be between {minimum} and {maximum}")
    return result


def guard_content(channel: str, action: str, content) -> List[str]:
    """Return deterministic v1 content violations; an empty list means safe.

    This function is intentionally independent of model behavior and is reused
    by the live Target adapter immediately before every contact.
    """
    issues: List[str] = []
    if not isinstance(content, dict):
        return ["content must be an object"]

    if channel == "phone_call" and action == "conversation":
        required = {"say"}
    elif channel == "email" and action in ("message", "debrief"):
        required = {"subject", "body"}
    elif channel == "sms" and action == "message":
        required = {"body"}
    else:
        return [f"unsupported channel/action pair: {channel}/{action}"]

    actual = set(content)
    if actual != required:
        issues.append(
            f"content keys must be exactly {sorted(required)}; got {sorted(actual)}")
        # Still inspect supplied strings so guard failures are informative.

    text_parts: List[str] = []
    for key in required:
        value = content.get(key)
        if not isinstance(value, str) or not value.strip():
            issues.append(f"content.{key} must be a non-empty string")
            continue
        limit = 200 if key == "subject" else 4000
        if len(value) > limit:
            issues.append(f"content.{key} exceeds {limit} characters")
        if _CONTROL_RE.search(value):
            issues.append(f"content.{key} contains control characters")
        text_parts.append(value)

    text = "\n".join(text_parts)
    if not text:
        return issues
    if _HTML_RE.search(text):
        issues.append("HTML/markup is disabled in v1")
    urls = find_urls(text)
    domains = find_bare_domains(text)
    if urls or domains or _URI_RE.search(text) or _ANY_BARE_DOMAIN_RE.search(text):
        issues.append("links, domains, and asset references are disabled in v1")
    if _SENSITIVE_RE.search(text):
        issues.append("sensitive data requests/content are disabled in v1")
    issues.extend(check_injection(text))
    if action == "debrief":
        lowered = text.lower()
        if "debrief" not in lowered or "practice simulation" not in lowered:
            issues.append("terminal email must explicitly be a practice simulation debrief")
    return issues


def _validate_graph(start: str, steps: List[FlowStep], errors: List[str]) -> None:
    step_map = {step.id: step for step in steps}
    for step in steps:
        for target in step.branches:
            if target not in step_map:
                errors.append(f"steps.{step.id} has unknown branch target {target!r}")

    reachable = set()
    stack = [start] if start in step_map else []
    while stack:
        current = stack.pop()
        if current in reachable:
            continue
        reachable.add(current)
        stack.extend(target for target in step_map[current].branches
                     if target in step_map)
    for step_id in sorted(set(step_map) - reachable):
        errors.append(f"step {step_id!r} is unreachable")

    visiting = set()
    visited = set()

    def visit(step_id: str) -> None:
        if step_id in visiting:
            errors.append(f"cycle detected at step {step_id!r}")
            return
        if step_id in visited or step_id not in step_map:
            return
        visiting.add(step_id)
        for target in step_map[step_id].branches:
            visit(target)
        visiting.remove(step_id)
        visited.add(step_id)

    visit(start)
    if errors:
        return

    debriefs = [step for step in steps if step.action == "debrief"]
    if len(debriefs) != 1:
        errors.append("exactly one terminal debrief step is required")
        return
    debrief = debriefs[0]
    if debrief.id not in reachable:
        errors.append("the terminal debrief is not reachable")
    terminals = [step for step in steps if not step.branches]
    if terminals != [debrief]:
        errors.append("every reachable path must end at exactly one terminal debrief")

    can_reach_debrief = {debrief.id}
    changed = True
    while changed:
        changed = False
        for step in steps:
            if step.id in can_reach_debrief:
                continue
            if step.branches and all(target in can_reach_debrief
                                     for target in step.branches):
                can_reach_debrief.add(step.id)
                changed = True
    for step_id in sorted(reachable - can_reach_debrief):
        errors.append(f"step {step_id!r} cannot reach the terminal debrief")


def validate_flow_definition(data: Mapping, *,
                             allowed_targets: Iterable[str] = DEFAULT_PRACTICE_TARGETS
                             ) -> FlowDefinition:
    """Validate and normalize a v1 definition, failing closed on any issue."""
    errors: List[str] = []
    if not isinstance(data, dict):
        raise FlowValidationError(["flow definition must be a JSON object"])
    unknown = set(data) - _ROOT_KEYS
    if unknown:
        errors.append(f"unknown root keys: {sorted(unknown)}")
    if data.get("version") != FLOW_SCHEMA_VERSION or isinstance(data.get("version"), bool):
        errors.append(f"version must be {FLOW_SCHEMA_VERSION}")
    if data.get("scenario") != "practice":
        errors.append("scenario must be practice")

    flow_id = data.get("flow_id")
    if not isinstance(flow_id, str) or not _ID_RE.match(flow_id):
        errors.append("flow_id must match [a-z][a-z0-9_-]{0,63}")
    target_id = data.get("target_id")
    allowlist = frozenset(allowed_targets)
    if not allowlist:
        errors.append("practice target allowlist must not be empty")
    if target_id not in allowlist:
        errors.append(f"target_id {target_id!r} is not in the practice target allowlist")

    sender = data.get("sender")
    normalized_sender = {}
    if not isinstance(sender, dict) or set(sender) != {"name", "address"}:
        errors.append("sender must contain exactly name and address")
    else:
        for key in ("name", "address"):
            value = sender.get(key)
            if not isinstance(value, str) or not value.strip() or len(value) > 200 \
                    or _CONTROL_RE.search(value) or "\n" in value or "\r" in value:
                errors.append(f"sender.{key} must be a short single-line string")
            else:
                normalized_sender[key] = value.strip()

    story_start = data.get("story_start")
    try:
        parsed_start = parse_story_time(story_start)
        story_start = parsed_start.isoformat(timespec="seconds")
    except FlowValidationError as error:
        errors.extend(error.errors)

    start = data.get("start")
    if not isinstance(start, str) or not start:
        errors.append("start must be a step id")
    raw_steps = data.get("steps")
    steps: List[FlowStep] = []
    if not isinstance(raw_steps, list) or not raw_steps or len(raw_steps) > 32:
        errors.append("steps must be a non-empty list of at most 32 steps")
        raw_steps = []

    seen_ids = set()
    for index, raw in enumerate(raw_steps):
        path = f"steps[{index}]"
        if not isinstance(raw, dict):
            errors.append(f"{path} must be an object")
            continue
        unknown_step = set(raw) - _STEP_KEYS
        if unknown_step:
            errors.append(f"{path} has unknown keys: {sorted(unknown_step)}")
        step_id = raw.get("id")
        if not isinstance(step_id, str) or not _ID_RE.match(step_id):
            errors.append(f"{path}.id is invalid")
            continue
        if step_id in seen_ids:
            errors.append(f"duplicate step id {step_id!r}")
            continue
        seen_ids.add(step_id)
        channel = raw.get("channel")
        action = raw.get("action")
        if (channel, action) not in SUPPORTED_CHANNEL_ACTIONS:
            errors.append(f"{path} has unsupported channel/action pair {channel}/{action}")
        delay = _number(raw.get("delay_seconds"), f"{path}.delay_seconds", errors,
                        minimum=0, maximum=604800)
        content = copy.deepcopy(raw.get("content"))
        issues = guard_content(channel, action, content)
        errors.extend(f"{path}.content: {issue}" for issue in issues)

        wait = raw.get("wait_seconds")
        next_id = raw.get("next")
        on_reply = raw.get("on_reply")
        on_timeout = raw.get("on_timeout")
        normalized_wait = None
        if wait is not None:
            normalized_wait = _number(wait, f"{path}.wait_seconds", errors,
                                      minimum=0.001, maximum=86400)
            if next_id is not None:
                errors.append(f"{path} cannot combine next with wait_seconds")
            if not isinstance(on_reply, str) or not isinstance(on_timeout, str):
                errors.append(f"{path} wait requires on_reply and on_timeout step ids")
        else:
            if on_reply is not None or on_timeout is not None:
                errors.append(f"{path} reply branches require wait_seconds")
            if action != "debrief" and not isinstance(next_id, str):
                errors.append(f"{path} requires next when it has no wait")
        if action == "debrief" and (wait is not None or next_id is not None
                                    or on_reply is not None or on_timeout is not None):
            errors.append(f"{path} terminal debrief cannot have outgoing transitions")
        steps.append(FlowStep(
            id=step_id, channel=channel, action=action, delay_seconds=delay,
            content=content, next=next_id, wait_seconds=normalized_wait,
            on_reply=on_reply, on_timeout=on_timeout,
        ))

    if isinstance(start, str) and start not in seen_ids:
        errors.append("start does not name a defined step")
    if steps:
        _validate_graph(start, steps, errors)
    if errors:
        raise FlowValidationError(errors)
    return FlowDefinition(
        flow_id=flow_id, scenario="practice", target_id=target_id,
        sender=normalized_sender, story_start=story_start, start=start,
        steps=tuple(steps),
    )


def load_flow_definition(path: str, *,
                         allowed_targets: Iterable[str] = DEFAULT_PRACTICE_TARGETS
                         ) -> FlowDefinition:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as error:
        raise FlowValidationError([f"cannot load flow definition: {error}"])
    return validate_flow_definition(data, allowed_targets=allowed_targets)


def vertical_slice_definition(target_id: str = "julius") -> FlowDefinition:
    """The initial email -> SMS -> phone_call -> terminal debrief email flow."""
    return validate_flow_definition({
        "version": FLOW_SCHEMA_VERSION,
        "flow_id": "practice-channel-sequence-v1",
        "scenario": "practice",
        "target_id": target_id,
        "sender": {"name": "Practice Coordinator", "address": "practice-coordinator"},
        "story_start": "2026-11-23T09:00:00+01:00",
        "start": "opening_email",
        "steps": [
            {
                "id": "opening_email",
                "channel": "email",
                "action": "message",
                "delay_seconds": 0,
                "content": {
                    "subject": "Scheduled practice exercise",
                    "body": ("Hello. This is the opening message for your scheduled "
                             "practice exercise. Please reply when you are ready for "
                             "the next practice step."),
                },
                "wait_seconds": 5,
                "on_reply": "sms_followup",
                "on_timeout": "sms_followup",
            },
            {
                "id": "sms_followup",
                "channel": "sms",
                "action": "message",
                "delay_seconds": 10,
                "content": {
                    "body": ("This is the scheduled practice follow-up. The next step "
                             "is a short text-only practice call."),
                },
                "wait_seconds": 5,
                "on_reply": "practice_call",
                "on_timeout": "practice_call",
            },
            {
                "id": "practice_call",
                "channel": "phone_call",
                "action": "conversation",
                "delay_seconds": 10,
                "content": {
                    "say": ("Thank you for joining the scheduled practice call. "
                            "This completes the conversation portion of the exercise."),
                },
                "next": "terminal_debrief",
            },
            {
                "id": "terminal_debrief",
                "channel": "email",
                "action": "debrief",
                "delay_seconds": 10,
                "content": {
                    "subject": "Practice simulation debrief",
                    "body": ("Practice simulation debrief: the ordered exercise is "
                             "complete. This was an authorized rehearsal, and no further "
                             "action is required."),
                },
            },
        ],
    })
