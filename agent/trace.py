"""
trace.py — per-touch trace writer (05 D-Q) + run log.

One JSONL file per session under agent/traces/<session_id>.jsonl: touch number,
angle/topic, channel, the brief sent to the Writer, the draft, guard results,
events returned, how the notecard changed, and any fallback/error. This is the
debug record for a run and the data the dashboard (ticket 12) reads.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import uuid
from pathlib import Path

from .target_api import sanitize_target_payload


def run_provenance(cfg) -> dict:
    """Model IDs and source fingerprints for auditing a run or resume."""
    source_dir = Path(__file__).resolve().parent
    return {
        "models": {
            "planner": cfg.planner_model,
            "writer": cfg.writer_model,
            "planner_fallback": None,
        },
        "source_sha256": {
            name: hashlib.sha256((source_dir / name).read_bytes()).hexdigest()
            for name in ("prompts.py", "pretexts.py", "loop.py")
        },
    }


def write_run_manifest(traces_dir: str, *, session_id: str, scenario: str,
                       resumed: bool, provenance: dict) -> str:
    """Persist an audit record per invocation, including resumes."""
    run_id = uuid.uuid4().hex
    destination = Path(traces_dir) / f"run-{run_id}.manifest.json"
    record = {
        "version": 1,
        "run_id": run_id,
        "session_id": session_id,
        "scenario": scenario,
        "resumed": resumed,
        "provenance": provenance,
    }
    with tempfile.NamedTemporaryFile(dir=traces_dir, mode="w", encoding="utf-8",
                                     delete=False) as handle:
        temporary = handle.name
        try:
            json.dump(record, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            os.replace(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return run_id


def build_send_receipt(*, target: str, channel: str, sender: str, address: str,
                       subject: str, idempotency_key: str, sent_at,
                       api_message_id=None, attachment_count: int = 0,
                       touches_used=None, sent: bool = True,
                       reason: str = "") -> dict:
    """A redacted, audit-safe record of what actually left the agent.

    Contains only resolved *outbound* send metadata — never any target-submitted
    value, draft body, or event payload. The subject is our own outbound line,
    not target data, so it is safe to keep. ``sent=False`` records a send the
    controller blocked (budget/channel policy/upstream close) with a reason.
    """
    receipt = {
        "sent": bool(sent),
        "target": target,
        "channel": channel,
        "sender": sender,
        "address": address,
        "subject": subject,
        "idempotency_key": idempotency_key,
        "sent_at": sent_at,
        "api_message_id": api_message_id,
        "attachment_count": int(attachment_count or 0),
        "touches_used": touches_used,
    }
    if reason:
        receipt["reason"] = reason
    return receipt


class TraceWriter:
    def __init__(self, traces_dir: str, session_id: str):
        os.makedirs(traces_dir, exist_ok=True)
        self.path = os.path.join(traces_dir, f"{session_id}.jsonl")

    def write(self, record: dict) -> None:
        record = sanitize_target_payload(dict(record))
        record.setdefault("ts", time.time())
        try:
            line = json.dumps(record, ensure_ascii=False, default=str) + "\n"
        except (TypeError, ValueError):
            # a trace line must never take the run down; keep the file valid
            line = json.dumps(
                {"kind": "trace_error", "ts": record.get("ts"),
                 "note": "record not serializable"}) + "\n"
        data = line.encode("utf-8")
        # O_APPEND makes each record a single atomic append, and flush+fsync
        # means a crash mid-run leaves a valid JSONL truncated at a line break
        # (never a half-written line).
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
        try:
            os.write(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)

    def touch(self, *, state, plan: dict, brief: dict, draft: dict,
              guard: dict, events: list, reaction: str,
              fallbacks: list, send_receipt: dict = None,
              extra: dict = None) -> None:
        rec = {
            "kind": "touch",
            "touch_idx": state.touches_used,
            "target_id": state.target_id,
            "objective": state.objective,
            "suspicion": state.suspicion,
            "touches_left": state.touches_left,
            "topics": {t.topic_id: {"confidence": t.confidence, "status": t.status}
                       for t in state.topics},
            "plan": plan,
            "writer_brief": brief,
            "draft": draft,
            "guard": guard,
            "events": events,
            "reaction": reaction,
            "fallbacks": fallbacks,
        }
        if send_receipt is not None:
            rec["send_receipt"] = send_receipt
        if extra:
            rec.update(extra)
        self.write(rec)

    def event(self, kind: str, **data) -> None:
        self.write({"kind": kind, **data})


def log_line(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)
