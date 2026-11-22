"""
state.py — SessionState notecard+log (05 §2, D-G) and the cross-session
playbook file (D-O/D-P).

The SessionState mirrors what the target remembers (ledger of asserted facts,
identities used) plus the hidden belief the target never sees (ranked topic
hypotheses, suspicion scalar). The raw touch log is kept alongside as the
ground-truth backstop (D-G hybrid).
"""
from __future__ import annotations

import copy
import json
import os
import re
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from typing import Optional

from .target_api import sanitize_target_payload, submission_metadata


# --------------------------------------------------------------------------- #
# Within-session state
# --------------------------------------------------------------------------- #

@dataclass
class TopicHypothesis:
    topic_id: str
    label: str
    prior: float
    confidence: float
    status: str = "untested"          # untested | engaged | cold
    evidence: list = field(default_factory=list)


@dataclass
class SenderIdentity:
    name: str
    role: str
    org: str
    address: str
    domain: str
    backstory_id: str = ""


@dataclass
class AssertedFact:
    claim: str
    touch_idx: int
    sender: str
    about: str = "us"                 # us | world
    status: str = "unchallenged"      # unchallenged | accepted | questioned | contradicted


@dataclass
class TouchRecord:
    idx: int
    channel: str
    direction: str                    # message | conversation
    sender: str
    topic_id: str
    objective_step: str               # probe | build | strike | converse
    summary: str
    subject: str = ""
    body: str = ""
    page_id: Optional[str] = None
    events: list = field(default_factory=list)
    reaction: str = ""                # interpreted: engaged|wary|ignored|incident|mixed
    suspicion: float = 0.0
    guard_issues: list = field(default_factory=list)
    fallbacks: list = field(default_factory=list)
    sent_at: Optional[str] = None       # story time; ts remains wall time
    ts: float = field(default_factory=time.time)


@dataclass
class SessionState:
    session_id: str
    scenario_id: str
    target_id: str
    budget: int
    objective: str = "credentials"
    objective_status: str = "probing"  # probing|building|primed|pushing|achieved|failed
    touches_used: int = 0
    suspicion: float = 0.10
    topics: list = field(default_factory=list)          # [TopicHypothesis]
    persona: Optional[SenderIdentity] = None
    identities_used: list = field(default_factory=list) # [SenderIdentity]
    ledger: list = field(default_factory=list)          # [AssertedFact]
    history: list = field(default_factory=list)         # [TouchRecord]
    pages: dict = field(default_factory=dict)           # url -> {page_id, fields}
    consecutive_ignored: int = 0
    struck: bool = False
    incident: Optional[dict] = None
    raw_event_log: list = field(default_factory=list)   # ground-truth backstop (D-G)
    conversation_ids: list = field(default_factory=list)
    sender_note: str = ""               # vouch-probe handoff hint for the Planner
    last_sent_at: Optional[str] = None  # monotonic story-time cursor (ISO 8601)
    calendar_slot_accepted: bool = False  # target-native reply evidence only

    # ------------------------------------------------------------ derived
    @property
    def touches_left(self) -> int:
        return max(0, self.budget - self.touches_used)

    def best_topic(self) -> Optional[TopicHypothesis]:
        cands = [t for t in self.topics if t.status != "cold"]
        if not cands:
            cands = self.topics
        return max(cands, key=lambda t: t.confidence) if cands else None

    def engaged_topic(self) -> Optional[TopicHypothesis]:
        engaged = [t for t in self.topics if t.status == "engaged"]
        return max(engaged, key=lambda t: t.confidence) if engaged else None

    def topic(self, topic_id: str) -> Optional[TopicHypothesis]:
        for t in self.topics:
            if t.topic_id == topic_id:
                return t
        return None

    # ------------------------------------------------------------ mutation
    def apply_topic_updates(self, updates: dict, touch_idx: int, signal: str) -> None:
        for tid, conf in (updates or {}).items():
            t = self.topic(tid)
            if t is None:
                continue
            try:
                conf = min(1.0, max(0.0, float(conf)))
            except (TypeError, ValueError):
                continue
            delta = conf - t.confidence
            t.confidence = conf
            t.evidence.append({"touch_idx": touch_idx, "signal": signal, "delta": round(delta, 3)})
            if conf >= 0.6:
                t.status = "engaged"
            elif conf <= 0.15 and t.status != "engaged":
                t.status = "cold"

    def apply_suspicion(self, new_value: float) -> None:
        """Monotone-ish: rises freely, falls only slowly (05 §2)."""
        try:
            v = min(1.0, max(0.0, float(new_value)))
        except (TypeError, ValueError):
            return
        floor = self.suspicion * 0.95
        self.suspicion = round(max(floor, v), 3)

    def add_ledger_facts(self, claims: list, touch_idx: int, about: str = "us") -> None:
        sender = self.persona.name if self.persona else "unknown"
        for c in claims or []:
            if not c or not str(c).strip():
                continue
            self.ledger.append(AssertedFact(claim=str(c).strip(), touch_idx=touch_idx,
                                            sender=sender, about=about))

    def ledger_slice(self, limit: int = 12) -> list:
        return [f"[t{f.touch_idx}] {f.claim}" for f in self.ledger[-limit:]]

    # ------------------------------------------------------------ (de)serial
    def to_dict(self) -> dict:
        # Defence in depth for callers/tests that bypass TargetClient: state must
        # not become a persistence path for raw submitted values.
        self.raw_event_log = sanitize_target_payload(self.raw_event_log)
        for record in self.history:
            record.events = sanitize_target_payload(record.events)
        self.incident = sanitize_target_payload(self.incident)
        return sanitize_target_payload(asdict(self))


def incident_from_submission(event: dict, touch_idx: int,
                             resumed: bool = False) -> Optional[dict]:
    """Build the one canonical live/resume incident shape for a form event."""
    clean = sanitize_target_payload(event)
    if clean.get("type") != "page.submitted":
        return None
    metadata = clean.get("submission") or submission_metadata(clean)
    if metadata.get("objective") == "none":
        return None
    incident = {
        "objective": metadata["objective"],
        "via": "page.submitted",
        "touch_idx": touch_idx,
        "fields": list(metadata.get("entered_fields") or []),
        "submission": metadata,
    }
    if resumed:
        incident["resumed"] = True
    return incident


_SLOT_ACCEPT_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\b(?:i\s+)?accept(?:ed)?(?:\s+the)?\s+(?:calendar\s+)?(?:slot|invite|time|date|proposal)\b",
    r"\b(?:slot|time|date)\s+(?:is\s+)?accepted\b",
    r"\b(?:that|this|the|proposed)?\s*(?:slot|time|date)\s+works(?:\s+for\s+me)?\b",
    r"\b(?:monday|tuesday|wednesday|thursday|friday|\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december))\b[^.!?\n]{0,40}\bworks(?:\s+for\s+me)?\b",
    r"\b(?:please\s+)?send(?:\s+over)?\s+(?:the\s+)?(?:calendar\s+)?invite\b",
))
_SLOT_NEGATION_RE = re.compile(
    r"\b(?:no|not|cannot|can't|won't|don't|doesn't|do\s+not|does\s+not)\b",
    re.IGNORECASE)


def calendar_slot_signal(events: list) -> Optional[bool]:
    """Read explicit target replies only; Planner assertions are never evidence."""
    signal = None
    for event in events or []:
        if not isinstance(event, dict) or event.get("type") != "reply":
            continue
        text = event.get("text")
        if not isinstance(text, str):
            continue
        for clause in re.split(r"[.!?\n]+", text):
            if not any(pattern.search(clause) for pattern in _SLOT_ACCEPT_PATTERNS):
                continue
            signal = not bool(_SLOT_NEGATION_RE.search(clause))
    return signal


def apply_calendar_slot_signal(state: SessionState, events: list) -> None:
    signal = calendar_slot_signal(events)
    if signal is not None:
        state.calendar_slot_accepted = signal


# --------------------------------------------------------------------------- #
# Crash-resume: fold a session's prior event log back into a fresh state
# --------------------------------------------------------------------------- #

def rebuild_state_from_events(state: SessionState, events: list) -> None:
    """Restore enough belief/flags from the server's event log that a resumed
    run continues instead of re-opening. Events are target reactions only
    (reply / link.opened / page.submitted / attachment.opened); the authoritative
    touches_used/budget come from the session status and are set by the caller,
    so this never fabricates touch counts. Mirrors the live classify/reinforce
    rules — it does not change strategy."""
    best = state.best_topic()
    safe_events = sanitize_target_payload(events or [])
    apply_calendar_slot_signal(state, safe_events)
    for ev in safe_events:
        if not isinstance(ev, dict):
            continue
        state.raw_event_log.append(ev)
        if isinstance(ev.get("sent_at"), str):
            state.last_sent_at = ev["sent_at"]
        et = ev.get("type")
        if et in ("link.opened", "attachment.opened"):
            state.struck = True
            if best:
                best.confidence = min(1.0, best.confidence + 0.15)
                best.status = "engaged"
        elif et == "reply" and best:
            best.confidence = min(1.0, best.confidence + 0.10)
            if best.confidence >= 0.6:
                best.status = "engaged"
        elif et == "page.submitted":
            state.struck = True
            if not state.incident:
                incident = incident_from_submission(
                    ev, state.touches_used, resumed=True)
                if incident:
                    state.incident = incident
                    state.objective_status = "achieved"


# --------------------------------------------------------------------------- #
# Scored sessions — durable exactly-one-session-per-target manifest
# --------------------------------------------------------------------------- #

class EvalSessionError(RuntimeError):
    """A scored-session reservation or identity invariant was violated."""


class EvalSessionManifest:
    """Atomically reserve one eval session idempotency key per target.

    ``reserved`` means the key survived a crash before Target replied;
    ``active`` means the returned session id is also durable. A completed
    record is terminal and can never be replaced by a new session. The same
    reserved key is reused after a crash so Target idempotency, rather than a
    process-local assumption, protects the exactly-one-session boundary.
    """

    VERSION = 1
    TERMINAL_STATUSES = frozenset({"completed"})

    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        self.lock_path = self.path + ".lock"

    @contextmanager
    def _locked(self):
        import fcntl

        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.lock_path, "a+", encoding="utf-8") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _load_unlocked(self) -> dict:
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            return {"version": self.VERSION, "targets": {}}
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise EvalSessionError(f"cannot read eval session manifest: {error}")
        if not isinstance(data, dict) or data.get("version") != self.VERSION \
                or not isinstance(data.get("targets"), dict):
            raise EvalSessionError("unsupported eval session manifest")
        return data

    def _write_unlocked(self, data: dict) -> None:
        temporary = self.path + ".tmp"
        try:
            with open(temporary, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def _target(record: dict, target_id: str) -> dict:
        targets = record.get("targets", {})
        value = targets.get(target_id)
        return value if isinstance(value, dict) else {}

    def get(self, target_id: str) -> dict:
        with self._locked():
            return copy.deepcopy(self._target(self._load_unlocked(), target_id))

    def reserve(self, target_id: str, metadata: dict) -> dict:
        if not isinstance(target_id, str) or not target_id.strip():
            raise EvalSessionError("eval target_id must be non-empty")
        target_id = target_id.strip()
        metadata = copy.deepcopy(metadata)
        with self._locked():
            data = self._load_unlocked()
            existing = self._target(data, target_id)
            if existing:
                if existing.get("status") not in ("reserved", "active", "completed") \
                        or not isinstance(existing.get("idempotency_key"), str) \
                        or not existing.get("idempotency_key"):
                    raise EvalSessionError("eval reservation is malformed")
                if existing.get("status") == "active" and not existing.get("session_id"):
                    raise EvalSessionError("active eval reservation lost its session id")
                if existing.get("metadata") != metadata:
                    raise EvalSessionError(
                        f"eval target {target_id!r} was reserved with different metadata")
                if existing.get("status") in self.TERMINAL_STATUSES:
                    raise EvalSessionError(
                        f"eval target {target_id!r} already consumed its only session")
                return copy.deepcopy(existing)
            record = {
                "target_id": target_id,
                "metadata": metadata,
                "status": "reserved",
                "idempotency_key": f"eval-{uuid.uuid4().hex}",
                "session_id": None,
                "created_at": time.time(),
                "updated_at": time.time(),
            }
            data["targets"][target_id] = record
            self._write_unlocked(data)
            return copy.deepcopy(record)

    def attach(self, target_id: str, session_id: str, touch_budget: int) -> dict:
        if not isinstance(session_id, str) or not session_id.strip():
            raise EvalSessionError("Target returned an empty eval session id")
        with self._locked():
            data = self._load_unlocked()
            record = self._target(data, target_id)
            if not record or record.get("status") in self.TERMINAL_STATUSES:
                raise EvalSessionError(f"eval target {target_id!r} has no open reservation")
            if record.get("session_id") not in (None, session_id):
                raise EvalSessionError("eval reservation resolved to a different session id")
            record.update({
                "session_id": session_id,
                "status": "active",
                "touch_budget": int(touch_budget),
                "updated_at": time.time(),
            })
            self._write_unlocked(data)
            return copy.deepcopy(record)

    def complete(self, target_id: str, *, outcome: str, touches_used: int,
                 final_suspicion: float, incident: Optional[dict]) -> dict:
        with self._locked():
            data = self._load_unlocked()
            record = self._target(data, target_id)
            if not record.get("session_id"):
                raise EvalSessionError("cannot complete an eval reservation without a session")
            if record.get("status") not in self.TERMINAL_STATUSES:
                record.update({
                    "status": "completed",
                    "outcome": str(outcome),
                    "touches_used": int(touches_used),
                    "final_suspicion": float(final_suspicion),
                    "incident": sanitize_target_payload(copy.deepcopy(incident)),
                    "updated_at": time.time(),
                })
                self._write_unlocked(data)
            return copy.deepcopy(record)


# --------------------------------------------------------------------------- #
# Cross-session playbook (D-O/D-P) — one small JSON file
# --------------------------------------------------------------------------- #

PLAYBOOK_VERSION = 1


def load_playbook(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError):
            pass
    return {"version": PLAYBOOK_VERSION, "per_target": {}, "sessions": []}


def update_playbook(path: str, state: SessionState, outcome: str,
                    notes: str = "") -> dict:
    """Serialise read-modify-write across parallel practice workers."""
    import fcntl

    with open(path + ".lock", "a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            return _update_playbook_unlocked(path, state, outcome, notes)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _update_playbook_unlocked(path: str, state: SessionState, outcome: str,
                              notes: str = "") -> dict:
    """Distil (not transcript) the finished session into the playbook (D-O)."""
    pb = load_playbook(path)
    entry = pb["per_target"].setdefault(state.target_id, {
        "learned_hook": None,
        "winning_identity": None,
        "winning_channel": None,
        "reached_incident": None,
        "safe_facts": [],
        "traps_hit": [],
        "burned_senders": [],
        "suspicion_triggering_lines": [],
    })

    engaged = [t for t in state.topics if t.status == "engaged"]
    best = state.best_topic()
    if engaged:
        top = max(engaged, key=lambda t: t.confidence)
        entry["learned_hook"] = {"topic_id": top.topic_id, "label": top.label,
                                 "confidence": top.confidence}
    elif best:
        entry.setdefault("learned_hook", None)

    if state.incident:
        entry["reached_incident"] = {
            "objective": state.incident.get("objective", state.objective),
            "touches_to_incident": state.incident.get("touch_idx"),
            "via": state.incident.get("via"),
        }
        incident_idx = state.incident.get("touch_idx", 1)
        win_touch = next((r for r in state.history if r.idx == incident_idx),
                         state.history[-1] if state.history else None)
        if win_touch:
            entry["winning_channel"] = win_touch.channel
        if state.persona:
            entry["winning_identity"] = asdict(state.persona)

    # collect guard failures as traps hit; facts that landed clean as safe
    for rec in state.history:
        for issue in rec.guard_issues:
            if issue not in entry["traps_hit"]:
                entry["traps_hit"].append(issue)
        if rec.reaction == "engaged":
            for fact in state.ledger:
                if fact.touch_idx == rec.idx and fact.about == "world" \
                        and fact.claim not in entry["safe_facts"]:
                    entry["safe_facts"].append(fact.claim)

    pb["sessions"].append({
        "session_id": state.session_id,
        "target_id": state.target_id,
        "ts": time.time(),
        "outcome": outcome,
        "touches_used": state.touches_used,
        "incident": state.incident,
        "final_suspicion": state.suspicion,
        "notes": notes,
    })

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(pb, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, path)
    return pb
