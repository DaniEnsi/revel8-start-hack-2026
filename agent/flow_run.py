"""Durable flow state plus fake dry-run and explicit live-practice CLI modes.

One checkpoint file represents one run. Every mutation is JSON, written via an
atomic replace under a sidecar lock. No pickle or executable deserialization is
used. Live Target delivery requires the explicit --practice mode; dry-run remains
fully fake and no eval or external delivery mode is exposed.
"""
from __future__ import annotations

import argparse
import copy
import fcntl
import json
import os
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional, Protocol

from .flow import (DEFAULT_PRACTICE_TARGETS, FlowValidationError,
                   load_flow_definition, vertical_slice_definition)

RUN_STATE_VERSION = 1
TERMINAL_RUN_STATUSES = frozenset({"completed", "stopped", "failed"})
RUN_STATUSES = frozenset({
    "created", "running", "sleeping", "waiting_reply", "retry_pending",
    "completed", "stopped", "failed",
})
STEP_STATUSES = frozenset({
    "pending", "sleeping", "ready", "dispatching", "waiting_reply",
    "completed", "timed_out", "failed",
})


class RunStateError(ValueError):
    pass


class Clock(Protocol):
    def now(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


class SystemClock:
    def now(self) -> float:
        return time.time()

    def sleep(self, seconds: float) -> None:
        time.sleep(max(0.0, seconds))


class VirtualClock:
    """A deterministic clock that advances only when the interpreter waits."""

    def __init__(self, start: float = 0.0):
        self.value = float(start)

    def now(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("cannot sleep for a negative duration")
        self.value += float(seconds)


@dataclass
class OperationState:
    name: str
    idempotency_key: str
    payload: dict
    sent_at: Optional[str] = None
    status: str = "prepared"
    attempts: int = 0
    reconciliations: int = 0
    response: Optional[dict] = None
    last_error: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "OperationState":
        if not isinstance(data, dict):
            raise RunStateError("operation checkpoint must be an object")
        try:
            operation = cls(**data)
        except TypeError as error:
            raise RunStateError(f"malformed operation checkpoint: {error}")
        if not operation.name or not operation.idempotency_key:
            raise RunStateError("operation checkpoint lost its idempotency key")
        if operation.status not in ("prepared", "dispatching", "confirmed"):
            raise RunStateError(f"invalid operation status {operation.status!r}")
        if not isinstance(operation.payload, dict) or not isinstance(operation.attempts, int):
            raise RunStateError("malformed operation checkpoint")
        return operation


@dataclass
class StepRunState:
    step_id: str
    status: str = "pending"
    next_operation: str = ""
    outbound: Optional[dict] = None
    operations: Dict[str, OperationState] = field(default_factory=dict)
    contact_ids: List[str] = field(default_factory=list)
    replies: List[dict] = field(default_factory=list)
    late_replies: List[dict] = field(default_factory=list)
    outcome: Optional[str] = None
    branch_taken: Optional[str] = None
    ready_at_wall: Optional[float] = None
    scheduled_story_at: Optional[str] = None
    wait_started_wall: Optional[float] = None
    reply_deadline_wall: Optional[float] = None
    wait_started_story: Optional[str] = None
    reply_deadline_story: Optional[str] = None

    def to_dict(self) -> dict:
        value = asdict(self)
        value["operations"] = {name: asdict(operation)
                               for name, operation in self.operations.items()}
        return value

    @classmethod
    def from_dict(cls, data: dict) -> "StepRunState":
        if not isinstance(data, dict) or not isinstance(data.get("step_id"), str):
            raise RunStateError("malformed step checkpoint")
        values = dict(data)
        raw_operations = values.get("operations", {})
        if not isinstance(raw_operations, dict):
            raise RunStateError("step operations must be an object")
        values["operations"] = {
            name: OperationState.from_dict(operation)
            for name, operation in raw_operations.items()
        }
        try:
            step = cls(**values)
        except TypeError as error:
            raise RunStateError(f"malformed step checkpoint: {error}")
        if step.status not in STEP_STATUSES:
            raise RunStateError(f"invalid step status {step.status!r}")
        return step


@dataclass
class FlowRun:
    run_id: str
    flow_id: str
    definition_hash: str
    scenario: str
    target_id: str
    current_step_id: str
    story_cursor: str
    created_wall: float
    updated_wall: float
    session_id: Optional[str] = None
    session_operation: Optional[OperationState] = None
    session_ended: bool = False
    status: str = "created"
    steps: Dict[str, StepRunState] = field(default_factory=dict)
    seen_events: List[str] = field(default_factory=list)
    late_replies: List[dict] = field(default_factory=list)
    stop_requested: Optional[dict] = None
    error: Optional[str] = None
    revision: int = 0
    schema_version: int = RUN_STATE_VERSION

    @classmethod
    def new(cls, *, run_id: str, definition, now: float) -> "FlowRun":
        return cls(
            run_id=run_id, flow_id=definition.flow_id,
            definition_hash=definition.digest(), scenario=definition.scenario,
            target_id=definition.target_id, current_step_id=definition.start,
            story_cursor=definition.story_start, created_wall=float(now),
            updated_wall=float(now),
            steps={step.id: StepRunState(step_id=step.id)
                   for step in definition.steps},
        )

    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "run_id": self.run_id,
            "flow_id": self.flow_id,
            "definition_hash": self.definition_hash,
            "scenario": self.scenario,
            "target_id": self.target_id,
            "current_step_id": self.current_step_id,
            "story_cursor": self.story_cursor,
            "created_wall": self.created_wall,
            "updated_wall": self.updated_wall,
            "session_id": self.session_id,
            "session_operation": (asdict(self.session_operation)
                                  if self.session_operation else None),
            "session_ended": self.session_ended,
            "status": self.status,
            "steps": {step_id: step.to_dict() for step_id, step in self.steps.items()},
            "seen_events": copy.deepcopy(self.seen_events),
            "late_replies": copy.deepcopy(self.late_replies),
            "stop_requested": copy.deepcopy(self.stop_requested),
            "error": self.error,
            "revision": self.revision,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "FlowRun":
        if not isinstance(data, dict):
            raise RunStateError("run checkpoint must be a JSON object")
        if data.get("schema_version") != RUN_STATE_VERSION:
            raise RunStateError("unsupported run checkpoint version")
        required = ("run_id", "flow_id", "definition_hash", "scenario", "target_id",
                    "current_step_id", "story_cursor")
        if any(not isinstance(data.get(key), str) or not data.get(key)
               for key in required):
            raise RunStateError("run checkpoint is missing required identity fields")
        values = dict(data)
        raw_steps = values.get("steps")
        if not isinstance(raw_steps, dict) or not raw_steps:
            raise RunStateError("run checkpoint has no step state")
        values["steps"] = {step_id: StepRunState.from_dict(step)
                           for step_id, step in raw_steps.items()}
        raw_session = values.get("session_operation")
        values["session_operation"] = (OperationState.from_dict(raw_session)
                                       if raw_session else None)
        try:
            run = cls(**values)
        except TypeError as error:
            raise RunStateError(f"malformed run checkpoint: {error}")
        if run.status not in RUN_STATUSES:
            raise RunStateError(f"invalid run status {run.status!r}")
        if run.scenario != "practice":
            raise RunStateError("refusing to resume a non-practice run")
        if run.current_step_id not in run.steps:
            raise RunStateError("current step is absent from checkpoint")
        return run

    def summary(self) -> dict:
        return {
            "run_id": self.run_id,
            "flow_id": self.flow_id,
            "scenario": self.scenario,
            "target_id": self.target_id,
            "session_id": self.session_id,
            "session_ended": self.session_ended,
            "status": self.status,
            "current_step_id": self.current_step_id,
            "story_cursor": self.story_cursor,
            "stop_requested": copy.deepcopy(self.stop_requested),
            "late_reply_count": len(self.late_replies),
            "error": self.error,
            "revision": self.revision,
            "steps": {
                step_id: {
                    "status": step.status,
                    "outcome": step.outcome,
                    "branch_taken": step.branch_taken,
                    "contact_ids": list(step.contact_ids),
                    "reply_count": len(step.replies),
                    "late_reply_count": len(step.late_replies),
                    "operations": {
                        name: {
                            "idempotency_key": operation.idempotency_key,
                            "status": operation.status,
                            "attempts": operation.attempts,
                            "reconciliations": operation.reconciliations,
                            "sent_at": operation.sent_at,
                            "last_error": operation.last_error,
                        }
                        for name, operation in step.operations.items()
                    },
                }
                for step_id, step in self.steps.items()
            },
        }


class RunStore(Protocol):
    def exists(self) -> bool: ...

    def load(self) -> FlowRun: ...

    def save(self, run: FlowRun) -> None: ...


class MemoryRunStore:
    def __init__(self):
        self._run: Optional[FlowRun] = None

    def exists(self) -> bool:
        return self._run is not None

    def load(self) -> FlowRun:
        if self._run is None:
            raise RunStateError("run checkpoint does not exist")
        return copy.deepcopy(self._run)

    def save(self, run: FlowRun) -> None:
        if self._run is not None:
            if self._run.run_id != run.run_id \
                    or self._run.definition_hash != run.definition_hash:
                raise RunStateError("checkpoint identity cannot change")
            if self._run.stop_requested and not run.stop_requested:
                run.stop_requested = copy.deepcopy(self._run.stop_requested)
            if self._run.status == "stopped":
                run.status = "stopped"
                run.stop_requested = copy.deepcopy(self._run.stop_requested)
        run.revision += 1
        self._run = copy.deepcopy(run)


class JsonRunStore:
    """One atomically replaced JSON run per file, with a sidecar flock."""

    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        self.lock_path = self.path + ".lock"

    def exists(self) -> bool:
        return os.path.exists(self.path)

    @contextmanager
    def _locked(self):
        parent = os.path.dirname(self.path)
        os.makedirs(parent, exist_ok=True)
        with open(self.lock_path, "a+", encoding="utf-8") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _decode(handle) -> FlowRun:
        try:
            data = json.load(handle)
        except (ValueError, json.JSONDecodeError) as error:
            raise RunStateError(f"invalid run checkpoint JSON: {error}")
        return FlowRun.from_dict(data)

    def load(self) -> FlowRun:
        if not self.exists():
            raise RunStateError("run checkpoint does not exist")
        with self._locked():
            try:
                with open(self.path, "r", encoding="utf-8") as handle:
                    return self._decode(handle)
            except OSError as error:
                raise RunStateError(f"cannot read run checkpoint: {error}")

    def save(self, run: FlowRun) -> None:
        with self._locked():
            if self.exists():
                with open(self.path, "r", encoding="utf-8") as handle:
                    current = self._decode(handle)
                if current.run_id != run.run_id \
                        or current.definition_hash != run.definition_hash:
                    raise RunStateError("checkpoint identity cannot change")
                # Stop is monotonic and survives an in-flight writer's stale state.
                if current.stop_requested and not run.stop_requested:
                    run.stop_requested = copy.deepcopy(current.stop_requested)
                if current.status == "stopped":
                    run.status = "stopped"
                    run.stop_requested = copy.deepcopy(current.stop_requested)
                if current.session_ended:
                    run.session_ended = True
                run.revision = current.revision + 1
            else:
                run.revision = 1
            run.updated_wall = max(run.updated_wall, run.created_wall)
            parent = os.path.dirname(self.path)
            fd, temporary = tempfile.mkstemp(prefix=".flow-run-", dir=parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(run.to_dict(), handle, indent=2, ensure_ascii=False,
                              sort_keys=True)
                    handle.write("\n")
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)


def main(argv=None) -> int:
    """Run a fake dry-run or an explicitly selected live practice flow."""
    parser = argparse.ArgumentParser(prog="agent.flow_run")
    parser.add_argument("definition", nargs="?",
                        help="dry-run v1 flow JSON; defaults to the vertical slice")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true",
                      help="use only fake model, clock, and transport")
    mode.add_argument("--practice", metavar="DEFINITION",
                      help="run this v1 JSON through the live practice Target API")
    parser.add_argument("--target", choices=sorted(DEFAULT_PRACTICE_TARGETS),
                        help="dry-run vertical-slice target (practice uses target_id)")
    parser.add_argument("--state", help="durable run checkpoint JSON (required for --practice)")
    parser.add_argument("--resume", action="store_true",
                        help="resume --state instead of creating it")
    parser.add_argument("--stop", action="store_true",
                        help="request operator stop for --state")
    parser.add_argument("--run-id", help="new run id; defaults to a random UUID")
    parser.add_argument("--trace-dir",
                        help="Target TraceWriter JSONL directory (required for --practice)")
    args = parser.parse_args(argv)

    if args.practice:
        if args.definition:
            parser.error("pass the live definition to --practice, not as a positional argument")
        if not args.state or not args.trace_dir:
            parser.error("--practice requires --state and --trace-dir")
        if args.target:
            parser.error("--target is dry-run only; the practice definition owns target_id")
    if (args.resume or args.stop) and not args.state:
        parser.error("--resume and --stop require --state")
    if args.stop and args.resume:
        parser.error("--stop cannot be combined with --resume")

    mode_name = "practice" if args.practice else "dry-run"
    try:
        # Imported lazily so state/checkpoint utilities remain usable independently.
        from .flow_runner import FlowRunner, StaticContentModel

        if args.practice:
            from .channels import TargetChannelAdapter
            from .config import Config
            from .target_api import TargetClient

            definition = load_flow_definition(
                args.practice, allowed_targets=DEFAULT_PRACTICE_TARGETS)
            store = JsonRunStore(args.state)
            config = Config()
            missing = [name for name in ("REVEL8_API_BASE", "REVEL8_TEAM_KEY")
                       if not str(getattr(config, name.lower(), "") or "").strip()]
            if missing:
                raise FlowValidationError([
                    "live practice requires target configuration: " + ", ".join(missing)])
            transport = TargetChannelAdapter(
                TargetClient(config), allowed_targets=DEFAULT_PRACTICE_TARGETS)
            clock = SystemClock()
        else:
            from .channels import DryRunTransport

            definition = (load_flow_definition(args.definition) if args.definition
                          else vertical_slice_definition(args.target or "julius"))
            store = JsonRunStore(args.state) if args.state else MemoryRunStore()
            transport = DryRunTransport()
            clock = VirtualClock()

        runner = FlowRunner(
            definition=definition, transport=transport, store=store,
            model=StaticContentModel(), clock=clock,
            run_id=args.run_id or uuid.uuid4().hex, trace_dir=args.trace_dir,
            poll_interval_seconds=1.0 if args.dry_run else 5.0,
        )
        if args.stop:
            runner.request_stop(source="operator", reason="CLI stop request")
            result = runner.result()
        else:
            if args.resume and not store.exists():
                raise RunStateError("--resume checkpoint does not exist")
            if not args.resume and store.exists():
                raise RunStateError("checkpoint already exists; use --resume")
            result = runner.run()
        output = {"result": result}
        if args.dry_run:
            output["dry_run_dispatches"] = transport.calls
        print(json.dumps(output, indent=2, ensure_ascii=False, sort_keys=True))
        return 0 if result.get("status") in ("completed", "stopped") else 1
    except (FlowValidationError, RunStateError, OSError) as error:
        print(f"flow {mode_name} refused: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
