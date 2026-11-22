"""Deterministic durable interpreter for the safe custom-flow vertical slice.

Only this interpreter chooses transitions, channels, delays, waits, branches,
and stops. A model may return copy for one step, which is then validated and
persisted before an idempotent Target dispatch. Every transition is checkpointed.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import threading
from datetime import timedelta
from typing import Dict, List, Optional

from .channels import ChannelTransport, TransportError
from .flow import (FlowDefinition, FlowStep, FlowValidationError, guard_content,
                   parse_story_time)
from .flow_run import (Clock, FlowRun, MemoryRunStore, OperationState, RunStateError,
                       RunStore, StepRunState, SystemClock, TERMINAL_RUN_STATUSES)
from .target_api import sanitize_target_payload
from .trace import TraceWriter

_PHONE_TURN_GAP_SECONDS = 60.0
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$")
_TARGET_STOP_RE = re.compile(
    r"\b(?:stop|unsubscribe|opt[ -]?out|do not contact|don't contact|"
    r"leave me alone|remove me from)\b",
    re.IGNORECASE,
)


class _HaltRun(Exception):
    pass


class StaticContentModel:
    """Fake/dry-run model: return only the definition's prevalidated copy."""

    def draft(self, step: FlowStep, context: dict) -> dict:
        return copy.deepcopy(step.content)


class FlowRunner:
    def __init__(self, *, definition: FlowDefinition,
                 transport: ChannelTransport, store: Optional[RunStore] = None,
                 model=None, clock: Optional[Clock] = None,
                 run_id: Optional[str] = None, trace_dir: Optional[str] = None,
                 tracer=None, max_dispatch_attempts: int = 2,
                 retry_delay_seconds: float = 1.0,
                 poll_interval_seconds: float = 5.0):
        if not isinstance(definition, FlowDefinition):
            raise FlowValidationError(["FlowRunner requires a validated FlowDefinition"])
        if run_id is not None and not _RUN_ID_RE.match(run_id):
            raise FlowValidationError(["run_id contains unsafe characters"])
        if max_dispatch_attempts < 1:
            raise ValueError("max_dispatch_attempts must be at least one")
        if retry_delay_seconds < 0 or poll_interval_seconds <= 0:
            raise ValueError("invalid retry or poll interval")
        self.definition = definition
        self.transport = transport
        self.store = store or MemoryRunStore()
        self.model = model or StaticContentModel()
        self.clock = clock or SystemClock()
        self.run_id = run_id
        self.trace_dir = trace_dir
        self.tracer = tracer
        self.max_dispatch_attempts = int(max_dispatch_attempts)
        self.retry_delay_seconds = float(retry_delay_seconds)
        self.poll_interval_seconds = float(poll_interval_seconds)
        self.state: Optional[FlowRun] = None
        self._lock = threading.RLock()

    # ------------------------------------------------------------- public API
    def run(self) -> dict:
        with self._lock:
            resumed = self.store.exists()
            self._load_or_create()
            try:
                if self.state.status in TERMINAL_RUN_STATUSES:
                    self._close_session()
                    return self.state.summary()
                if self.state.status == "retry_pending":
                    self._reset_retry_budget()
                self._raise_if_stopped()
                self._ensure_session()
                self._ensure_tracer()
                self._trace("flow_resumed" if resumed else "flow_started",
                            current_step_id=self.state.current_step_id)
                while self.state.status not in TERMINAL_RUN_STATUSES:
                    self._refresh_stop()
                    self._raise_if_stopped()
                    if self.state.status == "retry_pending":
                        break
                    definition_step = self.definition.step(self.state.current_step_id)
                    self._execute_step(definition_step)
            except _HaltRun:
                pass
            except FlowValidationError as error:
                self._fail("guard_failure: " + str(error))
            except TransportError as error:
                self._fail("transport_failure: " + str(error))
            except (RunStateError, OSError):
                # Durability failures must surface; acknowledging a checkpoint that
                # was not persisted would make idempotent recovery impossible.
                raise
            except Exception as error:
                self._fail(f"interpreter_failure: {type(error).__name__}: {error}")
            if self.state.status in TERMINAL_RUN_STATUSES:
                self._close_session()
            return self.state.summary()

    def result(self) -> dict:
        with self._lock:
            if self.state is None:
                if not self.store.exists():
                    raise RunStateError("run has not been initialized")
                self.state = self.store.load()
            return self.state.summary()

    def request_stop(self, *, source: str = "operator", reason: str = "") -> dict:
        """Persist a monotonic stop; at most the already in-flight call completes."""
        if source not in ("operator", "target"):
            raise ValueError("stop source must be operator or target")
        with self._lock:
            if self.state is None:
                if not self.store.exists():
                    raise RunStateError("cannot stop a run that does not exist")
                self.state = self.store.load()
            if self.state.status in TERMINAL_RUN_STATUSES:
                return self.state.summary()
            self.state.stop_requested = {
                "source": source,
                "reason": str(reason or "")[:300],
                "wall_time": self.clock.now(),
            }
            self.state.status = "stopped"
            self.state.error = None
            self._checkpoint("stop_requested", source=source)
            return self.state.summary()

    # --------------------------------------------------------------- lifecycle
    def _load_or_create(self) -> None:
        if self.state is not None:
            return
        if self.store.exists():
            self.state = self.store.load()
            if self.state.definition_hash != self.definition.digest() \
                    or self.state.flow_id != self.definition.flow_id \
                    or self.state.target_id != self.definition.target_id \
                    or self.state.scenario != "practice":
                raise RunStateError("definition does not match the persisted run")
            if set(self.state.steps) != set(self.definition.step_map):
                raise RunStateError("checkpoint steps do not match the definition")
        else:
            run_id = self.run_id
            if not run_id:
                import uuid
                run_id = uuid.uuid4().hex
            if not _RUN_ID_RE.match(run_id):
                raise FlowValidationError(["run_id contains unsafe characters"])
            self.run_id = run_id
            self.state = FlowRun.new(
                run_id=run_id, definition=self.definition, now=self.clock.now())
            self._checkpoint("run_created")

    def _reset_retry_budget(self) -> None:
        self.state.status = "running"
        self.state.error = None
        operations = list(self.state.steps[self.state.current_step_id].operations.values())
        if self.state.session_operation:
            operations.append(self.state.session_operation)
        for operation in operations:
            if operation.status != "confirmed":
                operation.attempts = 0
                operation.last_error = None
        self._checkpoint("retry_resumed")

    def _ensure_session(self) -> None:
        if self.state.session_id:
            return
        operation = self.state.session_operation
        if operation is None:
            operation = OperationState(
                name="session",
                idempotency_key=f"flow-{self.state.run_id}-session",
                payload={"scenario": "practice", "target_id": self.state.target_id},
            )
            self.state.session_operation = operation
            self.state.status = "running"
            self._checkpoint("session_prepared")
        response = self._execute_operation(operation, lambda: self.transport.open_session(
            run_id=self.state.run_id, scenario="practice",
            target_id=self.state.target_id,
            idempotency_key=operation.idempotency_key,
        ))
        session_id = response.get("session_id")
        if not isinstance(session_id, str) or not _SESSION_ID_RE.match(session_id):
            raise FlowValidationError(["Target returned an invalid session id"])
        if response.get("scenario_id", "practice") != "practice":
            raise FlowValidationError(["Target returned a non-practice session"])
        self._check_session_budget(response)
        self.state.session_id = session_id
        self.state.status = "running"
        self._checkpoint("session_ready", session_id=session_id)

    def _check_session_budget(self, response: dict) -> None:
        if "touch_budget" not in response:
            return
        try:
            budget = int(response.get("touch_budget"))
            used = int(response.get("touches_used", 0) or 0)
        except (TypeError, ValueError):
            raise FlowValidationError(["Target returned an invalid touch budget"])
        required = self._longest_contact_path(self.state.current_step_id)
        if budget < 0 or used < 0 or budget - used < required:
            raise FlowValidationError([
                f"session budget cannot cover the remaining flow: need {required}, "
                f"have {max(0, budget - used)}"])

    def _longest_contact_path(self, start: str) -> int:
        visiting = set()

        def length(step_id: str) -> int:
            if step_id in visiting:
                raise FlowValidationError(["cycle found while checking session budget"])
            visiting.add(step_id)
            step = self.definition.step(step_id)
            branches = step.branches
            result = 1 if not branches else 1 + max(length(target) for target in branches)
            visiting.remove(step_id)
            return result

        return length(start)

    def _ensure_tracer(self) -> None:
        if self.tracer is None and self.trace_dir and self.state.session_id:
            self.tracer = TraceWriter(self.trace_dir, self.state.session_id)

    def _close_session(self) -> None:
        if not self.state or not self.state.session_id or self.state.session_ended:
            return
        try:
            self.transport.end_session(session_id=self.state.session_id)
        except Exception as error:
            # Ending a session is best-effort after the terminal checkpoint. The
            # contact outcome remains truthful; the trace records cleanup failure.
            self._trace("session_end_failed", error=f"{type(error).__name__}: {error}")
            return
        self.state.session_ended = True
        self._checkpoint("session_ended")

    def _fail(self, message: str) -> None:
        if self.state.status in ("completed", "stopped"):
            return
        self.state.status = "failed"
        self.state.error = str(message)[:1000]
        step = self.state.steps.get(self.state.current_step_id)
        if step and step.status not in ("completed", "timed_out"):
            step.status = "failed"
        self._checkpoint("flow_failed", error=self.state.error)

    # -------------------------------------------------------------- operations
    def _prepare_operation(self, step: Optional[StepRunState], name: str,
                           payload: dict, sent_at: Optional[str]) -> OperationState:
        operations = step.operations if step is not None else None
        existing = operations.get(name) if operations is not None else self.state.session_operation
        if existing:
            return existing
        step_id = step.step_id if step is not None else "session"
        operation = OperationState(
            name=name,
            idempotency_key=f"flow-{self.state.run_id}-{step_id}-{name}",
            payload=copy.deepcopy(payload), sent_at=sent_at,
        )
        if step is not None:
            step.operations[name] = operation
        else:
            self.state.session_operation = operation
        self._checkpoint("operation_prepared", step_id=step_id, operation=name,
                         idempotency_key=operation.idempotency_key, sent_at=sent_at)
        return operation

    def _execute_operation(self, operation: OperationState, call,
                           step: Optional[StepRunState] = None) -> dict:
        if operation.status == "confirmed":
            return copy.deepcopy(operation.response or {})
        self._validate_operation_story_time(operation)
        while True:
            self._refresh_stop()
            self._raise_if_stopped()
            operation.status = "dispatching"
            operation.attempts += 1
            operation.last_error = None
            if step is not None:
                step.status = "dispatching"
            self.state.status = "running"
            self._checkpoint("dispatch_prepared", operation=operation.name,
                             attempt=operation.attempts,
                             idempotency_key=operation.idempotency_key)
            try:
                response = call()
            except TransportError as error:
                operation.last_error = str(error)[:500]
                if error.retryable and operation.attempts < self.max_dispatch_attempts:
                    if error.uncertain:
                        operation.reconciliations += 1
                    self._checkpoint("dispatch_reconcile" if error.uncertain
                                     else "dispatch_retry",
                                     operation=operation.name,
                                     attempt=operation.attempts, error=str(error))
                    self.clock.sleep(self.retry_delay_seconds)
                    continue
                if error.retryable:
                    self.state.status = "retry_pending"
                    self.state.error = f"dispatch retry pending: {error}"
                    if step is not None:
                        step.status = "ready"
                else:
                    self.state.status = "failed"
                    self.state.error = f"dispatch rejected: {error}"
                    if step is not None:
                        step.status = "failed"
                self._checkpoint("dispatch_pending" if error.retryable else "dispatch_failed",
                                 operation=operation.name, error=str(error))
                raise _HaltRun()
            if not isinstance(response, dict):
                raise FlowValidationError(["transport response must be an object"])
            operation.response = sanitize_target_payload(copy.deepcopy(response))
            operation.status = "confirmed"
            operation.last_error = None
            if step is not None:
                step.status = "ready"
            # Preserve a stop requested by another thread while the call was in
            # flight; JsonRunStore/MemoryRunStore also enforce this merge.
            if self.state.status != "stopped":
                self.state.status = "running"
            self._checkpoint("dispatch_confirmed", operation=operation.name,
                             attempt=operation.attempts,
                             reconciliations=operation.reconciliations)
            return copy.deepcopy(operation.response)

    # ------------------------------------------------------------------- steps
    def _execute_step(self, definition_step: FlowStep) -> None:
        step = self.state.steps[definition_step.id]
        if step.status in ("completed", "timed_out"):
            raise FlowValidationError([f"step {step.step_id} was already transitioned"])
        if not step.next_operation:
            step.next_operation = ("start" if definition_step.action == "conversation"
                                   else "message")
        if step.status == "pending":
            step.scheduled_story_at = self._schedule_story(definition_step)
            step.ready_at_wall = self.clock.now() + definition_step.delay_seconds
            step.status = "sleeping"
            self.state.status = "sleeping"
            self._checkpoint("delay_scheduled", step_id=step.step_id,
                             ready_at_wall=step.ready_at_wall,
                             sent_at=step.scheduled_story_at)
        if step.status == "sleeping":
            remaining = max(0.0, (step.ready_at_wall or 0.0) - self.clock.now())
            if remaining:
                self.state.status = "sleeping"
                self.clock.sleep(remaining)
                self._refresh_stop()
                self._raise_if_stopped()
            step.status = "ready"
            self.state.status = "running"
            self._checkpoint("delay_elapsed", step_id=step.step_id)

        if step.outbound is None:
            raw = self.model.draft(copy.deepcopy(definition_step),
                                   self._model_context())
            issues = guard_content(definition_step.channel, definition_step.action, raw)
            if issues:
                raise FlowValidationError(issues)
            step.outbound = copy.deepcopy(raw)
            self._checkpoint("content_validated", step_id=step.step_id)

        if definition_step.action == "conversation":
            self._execute_conversation(definition_step, step)
        else:
            self._execute_message(definition_step, step)

        if step.next_operation == "respond":
            self._begin_response_phase(definition_step, step)
        if step.next_operation == "wait":
            self._wait_for_reply(definition_step, step)
        elif step.next_operation == "done":
            self._finish_step(definition_step, step, outcome="dispatched",
                              branch="terminal" if definition_step.action == "debrief" else "next")

    def _execute_message(self, definition_step: FlowStep, step: StepRunState) -> None:
        if step.next_operation != "message":
            return
        operation = self._prepare_operation(
            step, "message", {"content": step.outbound}, step.scheduled_story_at)
        response = self._execute_operation(operation, lambda: self.transport.send_message(
            session_id=self.state.session_id, target_id=self.definition.target_id,
            channel=definition_step.channel, action=definition_step.action,
            sender=copy.deepcopy(self.definition.sender),
            content=copy.deepcopy(operation.payload["content"]),
            idempotency_key=operation.idempotency_key, sent_at=operation.sent_at,
        ), step=step)
        message_id = response.get("message_id")
        if not isinstance(message_id, str) or not message_id:
            raise FlowValidationError(["message dispatch returned no message_id"])
        if message_id not in step.contact_ids:
            step.contact_ids.append(message_id)
        self.state.story_cursor = operation.sent_at
        step.next_operation = "respond"
        self._checkpoint("message_recorded", step_id=step.step_id,
                         message_id=message_id, sent_at=operation.sent_at)
        self._ingest_events(step, response.get("events") or [], contact_field="message_id",
                            contact_id=message_id)
        self._raise_if_stopped()

    def _execute_conversation(self, definition_step: FlowStep, step: StepRunState) -> None:
        if step.next_operation == "start":
            operation = self._prepare_operation(step, "start", {}, step.scheduled_story_at)
            response = self._execute_operation(
                operation, lambda: self.transport.start_conversation(
                    session_id=self.state.session_id,
                    target_id=self.definition.target_id,
                    sender=copy.deepcopy(self.definition.sender),
                    idempotency_key=operation.idempotency_key,
                    sent_at=operation.sent_at), step=step)
            conversation_id = response.get("conversation_id")
            if not isinstance(conversation_id, str) or not conversation_id:
                raise FlowValidationError(["conversation start returned no conversation_id"])
            if conversation_id not in step.contact_ids:
                step.contact_ids.append(conversation_id)
            self.state.story_cursor = operation.sent_at
            step.next_operation = "turn"
            self._checkpoint("conversation_started", step_id=step.step_id,
                             conversation_id=conversation_id)
            self._ingest_events(step, response.get("events") or [],
                                contact_field="conversation_id", contact_id=conversation_id)
            self._raise_if_stopped()

        if step.next_operation == "turn":
            conversation_id = step.contact_ids[0]
            turn_sent_at = self._add_story_seconds(
                self.state.story_cursor, _PHONE_TURN_GAP_SECONDS)
            operation = self._prepare_operation(
                step, "turn", {"content": step.outbound}, turn_sent_at)
            response = self._execute_operation(
                operation, lambda: self.transport.conversation_turn(
                    conversation_id=conversation_id,
                    content=copy.deepcopy(operation.payload["content"]),
                    idempotency_key=operation.idempotency_key,
                    sent_at=operation.sent_at), step=step)
            self.state.story_cursor = operation.sent_at
            step.next_operation = "end"
            self._checkpoint("conversation_turn_recorded", step_id=step.step_id,
                             sent_at=operation.sent_at)
            self._ingest_events(step, response.get("events") or [],
                                contact_field="conversation_id", contact_id=conversation_id)
            self._raise_if_stopped()

        if step.next_operation == "end":
            conversation_id = step.contact_ids[0]
            operation = self._prepare_operation(
                step, "end", {"conversation_id": conversation_id}, None)
            self._execute_operation(
                operation, lambda: self.transport.end_conversation(
                    conversation_id=conversation_id), step=step)
            step.next_operation = "respond"
            self._checkpoint("conversation_ended", step_id=step.step_id)

    def _begin_response_phase(self, definition_step: FlowStep, step: StepRunState) -> None:
        if definition_step.wait_seconds is None:
            step.next_operation = "done"
            self._checkpoint("response_not_required", step_id=step.step_id)
            return
        now = self.clock.now()
        step.wait_started_wall = now
        step.reply_deadline_wall = now + definition_step.wait_seconds
        step.wait_started_story = self.state.story_cursor
        step.reply_deadline_story = self._add_story_seconds(
            self.state.story_cursor, definition_step.wait_seconds)
        step.status = "waiting_reply"
        step.next_operation = "wait"
        self.state.status = "waiting_reply"
        self._checkpoint("reply_wait_started", step_id=step.step_id,
                         deadline_wall=step.reply_deadline_wall,
                         deadline_story=step.reply_deadline_story)

    def _wait_for_reply(self, definition_step: FlowStep, step: StepRunState) -> None:
        while True:
            self._refresh_stop()
            self._raise_if_stopped()
            if step.replies:
                self._advance_story_after_wait(step, self.clock.now())
                self._finish_step(definition_step, step, outcome="replied",
                                  branch="on_reply")
                return
            remaining = (step.reply_deadline_wall or 0.0) - self.clock.now()
            # Poll at the deadline too; an event observed now is still on time.
            events = self.transport.poll_events(session_id=self.state.session_id)
            self._ingest_events(step, events)
            self._raise_if_stopped()
            if step.replies:
                continue
            remaining = (step.reply_deadline_wall or 0.0) - self.clock.now()
            if remaining <= 0:
                self.state.story_cursor = self._max_story_time(
                    self.state.story_cursor, step.reply_deadline_story)
                self._finish_step(definition_step, step, outcome="timed_out",
                                  branch="on_timeout")
                return
            self.clock.sleep(min(self.poll_interval_seconds, remaining))

    def _finish_step(self, definition_step: FlowStep, step: StepRunState, *,
                     outcome: str, branch: str) -> None:
        step.outcome = outcome
        step.branch_taken = branch
        step.next_operation = "done"
        step.status = "timed_out" if outcome == "timed_out" else "completed"
        if definition_step.action == "debrief":
            self.state.status = "completed"
            self.state.error = None
            self._checkpoint("flow_completed", step_id=step.step_id, outcome=outcome)
            return
        if branch == "on_reply":
            target = definition_step.on_reply
        elif branch == "on_timeout":
            target = definition_step.on_timeout
        else:
            target = definition_step.next
        if target not in self.definition.step_map:
            raise FlowValidationError([f"invalid transition target {target!r}"])
        self.state.current_step_id = target
        self.state.status = "running"
        self.state.error = None
        self._checkpoint("transition", from_step=step.step_id, to_step=target,
                         outcome=outcome, branch=branch)

    # ----------------------------------------------------------- replies/stops
    def _ingest_events(self, current_step: StepRunState, events, *,
                       contact_field: Optional[str] = None,
                       contact_id: Optional[str] = None) -> None:
        if not isinstance(events, list):
            raise FlowValidationError(["events must be a list"])
        changed = False
        for raw in events:
            if not isinstance(raw, dict):
                raise FlowValidationError(["every event must be an object"])
            event = sanitize_target_payload(copy.deepcopy(raw))
            if contact_field and contact_id:
                event.setdefault(contact_field, contact_id)
            event_key = self._event_key(event)
            if event_key in self.state.seen_events:
                continue
            self.state.seen_events.append(event_key)
            event_story_time = event.get("sent_at")
            if event_story_time is not None:
                self.state.story_cursor = self._max_story_time(
                    self.state.story_cursor, event_story_time)
            changed = True
            if event.get("type") != "reply":
                continue
            owner = self._event_owner(event)
            if owner is not None:
                is_late = (owner.step_id != self.state.current_step_id
                           or owner.status in ("timed_out", "completed")
                           or owner.branch_taken == "on_timeout")
                if is_late:
                    owner.late_replies.append(copy.deepcopy(event))
                    self.state.late_replies.append({
                        "step_id": owner.step_id, "event": copy.deepcopy(event)})
                else:
                    owner.replies.append(copy.deepcopy(event))
            text = event.get("text")
            if isinstance(text, str) and _TARGET_STOP_RE.search(text):
                self.state.stop_requested = {
                    "source": "target", "reason": "target requested no further contact",
                    "wall_time": self.clock.now(),
                }
                self.state.status = "stopped"
                changed = True
        if changed:
            self._checkpoint("events_recorded", current_step_id=current_step.step_id)
        self._raise_if_stopped()

    def _event_owner(self, event: dict) -> Optional[StepRunState]:
        contact_values = {str(event[key]) for key in ("message_id", "conversation_id")
                          if event.get(key) is not None}
        if not contact_values:
            return None
        for step in self.state.steps.values():
            if contact_values.intersection(step.contact_ids):
                return step
        return None

    @staticmethod
    def _event_key(event: dict) -> str:
        if event.get("event_id") is not None:
            identity = {
                "event_id": event["event_id"],
                "message_id": event.get("message_id"),
                "conversation_id": event.get("conversation_id"),
            }
        else:
            identity = event
        canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"),
                               ensure_ascii=False, default=str)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _refresh_stop(self) -> None:
        if not self.store.exists():
            return
        persisted = self.store.load()
        if persisted.definition_hash != self.state.definition_hash:
            raise RunStateError("persisted run identity changed")
        if persisted.stop_requested and not self.state.stop_requested:
            self.state.stop_requested = copy.deepcopy(persisted.stop_requested)
        if persisted.status == "stopped":
            self.state.status = "stopped"

    def _raise_if_stopped(self) -> None:
        if self.state.stop_requested or self.state.status == "stopped":
            if not self.state.stop_requested:
                self.state.stop_requested = {"source": "operator", "reason": "stopped",
                                             "wall_time": self.clock.now()}
            self.state.status = "stopped"
            self._checkpoint("stopped")
            raise _HaltRun()

    # --------------------------------------------------------------- time/copy
    def _schedule_story(self, definition_step: FlowStep) -> str:
        has_prior_contact = any(item.contact_ids for item in self.state.steps.values())
        delay = definition_step.delay_seconds
        if has_prior_contact:
            delay = max(1.0, delay)
        return self._add_story_seconds(self.state.story_cursor, delay)

    @staticmethod
    def _add_story_seconds(value: str, seconds: float) -> str:
        parsed = parse_story_time(value)
        return (parsed + timedelta(seconds=float(seconds))).isoformat(timespec="seconds")

    @staticmethod
    def _max_story_time(left: str, right: str) -> str:
        return left if parse_story_time(left) >= parse_story_time(right) else right

    def _validate_operation_story_time(self, operation: OperationState) -> None:
        if operation.sent_at is None:
            return
        candidate = parse_story_time(operation.sent_at)
        cursor = parse_story_time(self.state.story_cursor)
        has_prior_contact = any(step.contact_ids for step in self.state.steps.values())
        if (has_prior_contact and candidate <= cursor) or \
                (not has_prior_contact and candidate < cursor):
            raise FlowValidationError([
                f"operation {operation.name} would move story time backward"])

    def _advance_story_after_wait(self, step: StepRunState, now: float) -> None:
        started = step.wait_started_wall if step.wait_started_wall is not None else now
        elapsed = max(0.0, now - started)
        candidate = self._add_story_seconds(step.wait_started_story, elapsed)
        if parse_story_time(candidate) > parse_story_time(self.state.story_cursor):
            self.state.story_cursor = candidate

    def _model_context(self) -> dict:
        history = []
        for definition_step in self.definition.steps:
            step = self.state.steps[definition_step.id]
            if not step.contact_ids:
                continue
            history.append({
                "step_id": step.step_id,
                "channel": definition_step.channel,
                "action": definition_step.action,
                "outcome": step.outcome,
                "content": copy.deepcopy(step.outbound),
                "contact_ids": list(step.contact_ids),
                "replies": copy.deepcopy(step.replies),
                "late_replies": copy.deepcopy(step.late_replies),
            })
        return {
            "run_id": self.state.run_id,
            "session_id": self.state.session_id,
            "target_id": self.definition.target_id,
            "history": history,
        }

    # --------------------------------------------------------------- telemetry
    def _checkpoint(self, kind: str, **data) -> None:
        self.state.updated_wall = self.clock.now()
        self.store.save(self.state)
        self._trace(kind, **data)

    def _trace(self, kind: str, **data) -> None:
        if self.tracer is not None:
            record = {"run_id": self.state.run_id,
                      "step_id": self.state.current_step_id}
            record.update(data)
            self.tracer.event(kind, **record)
