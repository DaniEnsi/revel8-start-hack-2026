"""
loop.py — the session control loop (research/05 §1, decisions D-A..D-Q).

One Planner reasoning call per touch (D-F): read events -> update belief ->
decide -> brief. One Writer draft (D-D), through the guard gate (D-J, redo cap
2 D-K, fallbacks logged D-L). Adaptive strike-when-confirmed with the ceil(B/2)
backstop (D-M). Stop on incident / budget / suspicion / dead air (D-N). Full
per-touch trace (D-Q); playbook updated at the end (D-O/D-P).

Live conversation mode (F3): engaged-thread escalation only, never a cold open.
"""
from __future__ import annotations

import copy
import math
import re
import time
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from .config import Config, EVAL_ENABLE_ENV, SCORED_TOUCH_CAP
from .guards import (run_programmatic_guard, check_page_html, check_domains,
                     check_injection, check_traps, check_link_discipline)
from .llm import (planner_client, planner_fallback_client, writer_client,
                  writer_fallback_client, LLMError)
from .pretexts import (add_wrong_year_guard, build_dynamic_pretext, get_pretext,
                       thin_footprint_dossier)
from .state import (SessionState, TopicHypothesis, SenderIdentity, TouchRecord,
                     EvalSessionError, EvalSessionManifest,
                     load_playbook, update_playbook, rebuild_state_from_events,
                     incident_from_submission, apply_calendar_slot_signal)

from .target_api import TargetClient, TargetAPIError, sanitize_target_payload
from .trace import (TraceWriter, build_send_receipt, log_line, run_provenance,
                    write_run_manifest)
from . import prompts

# Ticket-13 cheap probe: after this many touches from persona 1, hand the
# thread to the second persona (same org/domain) who references the first.
VOUCH_SWITCH_TOUCH = 2

BERLIN = ZoneInfo("Europe/Berlin")
STORY_START = datetime(2026, 11, 23, 9, 0, tzinfo=BERLIN)
MESSAGE_GAP = timedelta(hours=2)
TURN_GAP = timedelta(minutes=2)
FORBIDDEN_CHANNELS = frozenset({"teams_call", "teams_chat", "mfa_push"})
TERMINAL_OUTCOMES = frozenset({
    "incident", "budget_exhausted", "suspicion_stop", "dead_air", "bail",
    "session_closed",
})


def _parse_story_time(value) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=BERLIN)
    return parsed.astimezone(BERLIN)


def _latest_story_time(payload) -> Optional[datetime]:
    """Find story timestamps only; arbitrary submitted values are never inspected."""
    latest = None
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key == "values":
                continue
            if key in ("sent_at", "last_sent_at", "last_contact_at"):
                parsed = _parse_story_time(value)
                if parsed and (latest is None or parsed > latest):
                    latest = parsed
            else:
                nested = _latest_story_time(value)
                if nested and (latest is None or nested > latest):
                    latest = nested
    elif isinstance(payload, (list, tuple)):
        for item in payload:
            nested = _latest_story_time(item)
            if nested and (latest is None or nested > latest):
                latest = nested
    return latest


def _business_hours(value: datetime) -> datetime:
    """Clamp a timezone-aware timestamp to target-local weekday 09:00-17:00."""
    local = value.astimezone(BERLIN).replace(second=0, microsecond=0)
    if local.hour < 9:
        local = local.replace(hour=9, minute=0)
    elif local.hour >= 17:
        local = (local + timedelta(days=1)).replace(hour=9, minute=0)
    while local.weekday() >= 5:
        local = (local + timedelta(days=1)).replace(hour=9, minute=0)
    return local


def _is_backward_time_409(error: TargetAPIError) -> bool:
    if error.status != 409:
        return False
    body = (error.body or "").lower()
    return ("sent_at" in body or "backward" in body
            or ("earlier" in body and "contact" in body)
            or "time only moves forward" in body)


def _writer_fallback_eligible(error: LLMError) -> bool:
    """Only provider availability/authorization/refusal failures fail over."""
    message = str(error).lower()
    return (
        "network error" in message
        or "offline" in message
        or "timeout" in message
        or "timed out" in message
        or "connection" in message
        or "conn reset" in message
        or re.search(r"\b403\b", message) is not None
        or re.search(r"\bhttp\s+(?:408|429|500|502|503|504)\b", message) is not None
        or any(marker in message for marker in (
            "refus", "cannot", "can not", "can't", "could not", "unable to",
            "not assist", "not help", "against policy",
        ))
    )


class SessionRunner:
    def __init__(self, cfg: Config, target_id: str, scenario: str = "practice",
                 arms: Optional[dict] = None, max_touches: Optional[int] = None,
                 allow_live: bool = True, notes: str = "", resume: bool = False,
                 resume_session_id: Optional[str] = None,
                 target_metadata: Optional[dict] = None,
                 dossier: Optional[dict] = None,
                 eval_manifest_path: Optional[str] = None):
        if scenario not in ("practice", "eval"):
            raise ValueError("scenario must be practice or eval")
        if scenario == "eval":
            if not getattr(cfg, "eval_enabled", False):
                raise ValueError(f"eval is disabled; explicitly set {EVAL_ENABLE_ENV}=1")
            if resume or resume_session_id:
                raise ValueError("eval resume is manifest-driven, not CLI-driven")
        elif target_metadata is not None or dossier is not None:
            raise ValueError("hidden-target metadata/dossier is eval-only")

        self.cfg = cfg
        self.target_id = target_id
        self.scenario = scenario
        self.resume = resume or bool(resume_session_id)
        self.resume_session_id = resume_session_id
        self._session_closed = False   # set on a 409 (session ended / budget used)
        self.arms = {"f2": "link_free", "f4": "single", "f5": "credentials",
                     "f6": "soft", **(arms or {})}
        self.max_touches = max_touches
        self.allow_live = allow_live
        self.notes = notes
        self.target_metadata = copy.deepcopy(target_metadata) if target_metadata else None
        self.dossier = copy.deepcopy(dossier) if dossier else None
        self.manifest = None

        if scenario == "eval":
            if self.target_metadata is None:
                raise ValueError("eval requires target name/company/role metadata")
            if self.dossier is None:
                self.dossier = _research_with_thin_footprint_fallback(
                    self.target_metadata)
            self.pretext = build_dynamic_pretext(
                target_id, self.target_metadata, self.dossier)
            self.target_id = target_id.strip()
            self.target_metadata = copy.deepcopy(self.pretext["target_metadata"])
            self.manifest = EvalSessionManifest(
                eval_manifest_path or cfg.eval_manifest_path)
        else:
            # deep copy: arm-aware mutation must never leak across runs (shared module dict)
            self.pretext = copy.deepcopy(get_pretext(target_id))
            # F6 named arm: naming Sergej Epp IS the treatment, not a wrong-fact trap
            if self.arms.get("f6") == "named" and target_id == "julius":
                self.pretext["trap_patterns"] = [
                    p for p in self.pretext["trap_patterns"] if "sergej" not in p.lower()]
                self.pretext["facts_to_avoid"] = [
                    f for f in self.pretext["facts_to_avoid"]
                    if "angel as referrer" not in f
                ] + ["naming any angel OTHER than Sergej Epp as the referrer"]
            add_wrong_year_guard(self.pretext, current_year=STORY_START.year)
        self.api = TargetClient(cfg)
        self.planner = planner_client(cfg)
        self.planner_fallback = planner_fallback_client(cfg)
        self.writer = writer_client(cfg)
        self.writer_fallback = writer_fallback_client(cfg)
        self.state: Optional[SessionState] = None
        self.trace: Optional[TraceWriter] = None
        self.fallbacks: list = []

    # ------------------------------------------------------------------ #
    # main loop
    # ------------------------------------------------------------------ #
    def run(self) -> dict:
        provenance = run_provenance(self.cfg)
        provenance["models"]["planner_fallback"] = self.planner_fallback.model
        provenance["models"]["writer_fallback"] = self.writer_fallback.model
        self._run_provenance = provenance
        self.cfg.ensure_dirs()
        if self.scenario == "practice":
            playbook = load_playbook(self.cfg.playbook_path)
            pb_hint = playbook.get("per_target", {}).get(self.target_id, {})
        else:
            pb_hint = {}

        sid, budget, resumed_events = self._acquire_session()
        if resumed_events is not None:
            resumed_events = sanitize_target_payload(resumed_events)

        self.state = self._init_state(sid, budget, pb_hint)
        resumed = resumed_events is not None
        if resumed:
            # authoritative touch count comes from the live session, never events
            session_status = {}
            try:
                session_status = self.api.get_session(sid)
                self.state.touches_used = int(
                    session_status.get("touches_used", self.state.touches_used) or 0)
            except TargetAPIError as e:
                if self.scenario == "eval":
                    # Never turn an unknown scored touch count into a fresh 10.
                    raise
                log_line(f"resume: get_session failed ({e}); continuing from 0")
            rebuild_state_from_events(self.state, resumed_events)
            self._observe_story_time(session_status)

        self.trace = TraceWriter(self.cfg.traces_dir, sid)
        run_id = write_run_manifest(self.cfg.traces_dir, session_id=sid,
                                    scenario=self.scenario, resumed=resumed,
                                    provenance=provenance)
        self.trace.event("session_start", target=self.target_id, budget=budget,
                         scenario=self.scenario, arms=self.arms,
                         run_id=run_id, provenance=provenance,
                         learned_hook=pb_hint.get("learned_hook"),
                         top_pick=self.pretext.get("top_pick"),
                         verified_facts=self.pretext.get("verified_facts", []),
                         wrong_fact_traps=self.pretext.get("wrong_fact_traps", []),
                         archetype=self.pretext.get("archetype"),
                         research_status=self.pretext.get("research_status"),
                         research_confidence=self.pretext.get("research_confidence"),
                         degraded_reason=self.pretext.get("degraded_reason"),
                         resumed=resumed, touches_used=self.state.touches_used)

        log_line(f"session {sid} {'resumed' if resumed else 'started'} — "
                 f"target={self.target_id} budget={budget} "
                 f"touches_used={self.state.touches_used} arms={self.arms}")

        last_events: list = resumed_events or []
        outcome = "budget_exhausted"
        try:
            while True:
                stop_reason = self._stop_reason()
                if stop_reason:
                    outcome = stop_reason
                    break
                events = self._run_touch(last_events)
                if events is None:          # planner said bail
                    outcome = "bail"
                    break
                last_events = events
                if self.state.incident:
                    outcome = "incident"
                    break
        except (TargetAPIError, LLMError) as e:
            outcome = f"error: {e}"
            log_line(f"FATAL: {e}")
            self.trace.event("fatal", error=str(e))
        finally:
            # Scored provider/API errors are resumable, not terminal: leave the
            # Target session open so its durable reservation can continue it.
            if outcome in TERMINAL_OUTCOMES or self.scenario != "eval":
                try:
                    self.api.end_session(sid)
                except Exception as e:
                    log_line(f"end_session failed (non-fatal): {e}")

        result = {
            "session_id": sid,
            "target_id": self.target_id,
            "scenario": self.scenario,
            "run_id": run_id,
            "provenance": provenance,
            "outcome": outcome,
            "touches_used": self.state.touches_used,
            "budget": budget,
            "incident": self.state.incident,
            "final_suspicion": self.state.suspicion,
            "fallbacks": self.fallbacks,
        }
        if self.manifest is not None:
            if outcome in TERMINAL_OUTCOMES:
                self.manifest.complete(
                    self.target_id, outcome=outcome,
                    touches_used=self.state.touches_used,
                    final_suspicion=self.state.suspicion, incident=self.state.incident)
        else:
            update_playbook(self.cfg.playbook_path, self.state, outcome, notes=self.notes)
        self.trace.event("session_end", **result)
        log_line(f"session {sid} ended — outcome={outcome} "
                 f"touches={self.state.touches_used}/{budget} "
                 f"incident={bool(self.state.incident)}")
        return result

    # ------------------------------------------------------------------ #
    # setup
    # ------------------------------------------------------------------ #
    def _init_state(self, sid: str, budget: int, pb_hint: dict) -> SessionState:
        p = self.pretext
        persona = SenderIdentity(
            name=p["persona"]["name"], role=p["persona"]["role"],
            org=p["persona"]["org"], address=p["persona"]["address"],
            domain=p["persona"]["domain"], backstory_id=p["persona"]["org"],
        )
        topics = [TopicHypothesis(topic_id=t["topic_id"], label=t["label"],
                                  prior=t["prior"], confidence=t["prior"])
                  for t in p["topics"]]
        # D-O: seed from the playbook — a learned hook starts boosted
        hook = (pb_hint or {}).get("learned_hook")
        if hook:
            for t in topics:
                if t.topic_id == hook.get("topic_id"):
                    t.confidence = min(0.85, max(t.confidence, 0.6))
                    log_line(f"playbook: boosted learned hook {t.topic_id}")
        state = SessionState(
            session_id=sid, scenario_id=self.scenario, target_id=self.target_id,
            budget=budget, objective=p.get("objective", "credentials"),
            topics=topics, persona=persona, identities_used=[persona],
        )
        return state

    # ------------------------------------------------------------------ #
    # session acquisition — resume after a crash (02 §Sessions) or start fresh
    # ------------------------------------------------------------------ #
    def _acquire_session(self) -> tuple:
        """Return (session_id, budget, resumed_events).

        With --resume, reuse the newest open practice session (GET /sessions)
        and hand back its prior events so the loop continues instead of burning
        a fresh session's trust. resumed_events is None for a brand-new session.
        """
        def _cap(b: int) -> int:
            if self.scenario == "eval":
                cap = min(int(10 if b is None else b), SCORED_TOUCH_CAP)
                if self.max_touches is not None:
                    cap = min(cap, max(0, int(self.max_touches)))
                return max(0, cap)
            b = int(b or 30)
            return min(b, self.max_touches) if self.max_touches else b

        if self.scenario == "eval":
            record = self.manifest.reserve(self.target_id, self.target_metadata)
            sid = record.get("session_id")
            if sid:
                sess = self.api.get_session(sid)
                if sess.get("scenario_id") not in (None, "eval"):
                    raise EvalSessionError("manifest points to a non-eval session")
                status = str(sess.get("status", "")).lower()
                if status in ("ended", "closed", "complete", "completed",
                              "void", "voided", "expired"):
                    raise EvalSessionError("the eval session is already closed")
                events = self.api.get_events(sid).get("events") or []
                return sid, _cap(sess.get("touch_budget", SCORED_TOUCH_CAP)), events

            sess = self.api.create_session(
                "eval", idem_key=record["idempotency_key"])
            sid = sess.get("session_id")
            if not sid:
                raise TargetAPIError(0, f"create_session returned no id: {sess}",
                                     "POST", "/sessions")
            if sess.get("scenario_id") not in (None, "eval"):
                raise EvalSessionError("Target returned a non-eval session")
            budget = _cap(sess.get("touch_budget", SCORED_TOUCH_CAP))
            self.manifest.attach(self.target_id, sid, budget)
            return sid, budget, None

        if self.resume_session_id:
            sid = self.resume_session_id
            sess = self.api.get_session(sid)
            if sess.get("scenario_id") not in (None, self.scenario):
                raise TargetAPIError(0, "refusing to resume a non-practice session",
                                     "GET", f"/sessions/{sid}")
            events = self.api.get_events(sid).get("events") or []
            log_line(f"resume: reusing exact session {sid} ({len(events)} prior events)")
            return sid, _cap(sess.get("touch_budget", 30)), events

        if self.resume:
            found = self._find_resumable_session()
            if found:
                sid = found.get("session_id")
                try:
                    events = self.api.get_events(sid).get("events") or []
                except TargetAPIError as e:
                    log_line(f"resume: get_events failed ({e}); starting fresh")
                    events = None
                if sid and events is not None:
                    log_line(f"resume: reusing session {sid} "
                             f"({len(events)} prior events)")
                    return sid, _cap(found.get("touch_budget", 30)), events

        sess = self.api.create_session(self.scenario)
        sid = sess.get("session_id")
        if not sid:
            raise TargetAPIError(0, f"create_session returned no id: {sess}",
                                 "POST", "/sessions")
        return sid, _cap(sess.get("touch_budget", 30)), None

    def _find_resumable_session(self) -> Optional[dict]:
        try:
            sessions = self.api.list_sessions()
        except TargetAPIError as e:
            log_line(f"resume: list_sessions failed ({e})")
            return None
        for s in sessions:   # API returns newest first
            if not isinstance(s, dict):
                continue
            if s.get("scenario_id") not in (None, self.scenario):
                continue
            status = str(s.get("status", "")).lower()
            if status in ("ended", "closed", "complete", "completed",
                          "void", "voided", "expired"):
                continue
            used = int(s.get("touches_used", 0) or 0)
            budget = int(s.get("touch_budget", 30) or 30)
            if used >= budget:
                continue
            return s
        return None

    # ------------------------------------------------------------------ #
    # stopping (05 §6, D-N)
    # ------------------------------------------------------------------ #
    def _stop_reason(self) -> Optional[str]:
        s = self.state
        if s.incident:
            return "incident"
        if self._session_closed:        # upstream 409: session ended / budget used
            return "session_closed"
        if s.touches_left <= 0:
            return "budget_exhausted"
        if s.suspicion >= self.cfg.theta_hard:
            return "suspicion_stop"
        if s.consecutive_ignored >= self.cfg.dead_air_k:
            return "dead_air"
        return None

    # ------------------------------------------------------------------ #
    # one touch
    # ------------------------------------------------------------------ #
    def _run_touch(self, last_events: list) -> Optional[list]:
        s = self.state
        last_events = sanitize_target_payload(last_events)
        self._maybe_vouch_switch()
        # vouch probe measures memory, not conversion — no budget backstop strike
        vouch_mode = self.arms.get("f4") == "vouch_probe"
        forced_strike = not vouch_mode and (
            ((not s.struck) and s.touches_left <= math.ceil(s.budget / 2))
            or s.touches_left <= 2)

        # 1 — PLAN (one Planner call per touch, D-F)
        plan, plan_fallback = self._plan(last_events, forced_strike)
        self.fallbacks += plan_fallback
        decision = plan.get("decision") or {}
        action = str(decision.get("action", "probe")).lower()

        if action == "bail":
            self.trace.event("bail", reason=decision.get("reason", ""))
            return None

        action = self._sanitize_action(action, plan, forced_strike)
        topic_id = decision.get("topic_id") or (s.best_topic().topic_id if s.best_topic() else "")
        channel = str(decision.get("channel") or "email")
        if channel not in self.pretext["escalation_channels"] + self.pretext.get("live_channels", []):
            channel = "email"
        if s.consecutive_ignored and channel == "email":
            alternate = next((c for c in self.pretext["escalation_channels"] if c != "email"), None)
            if alternate:
                channel = alternate
                self.fallbacks.append(f"channel_switched_after_silence:{alternate}")
        action, channel = self._enforce_channel_policy(action, channel)

        log_line(f"touch {s.touches_used + 1}/{s.budget}: action={action} "
                 f"topic={topic_id} channel={channel} suspicion={s.suspicion:.2f}")

        # 2 — live conversation branch (F3)
        if action == "converse":
            return self._run_conversation(plan, channel)

        # 3 — message branch: DRAFT + GUARD + SEND
        include_link = action == "strike"
        brief = self._build_brief(plan, topic_id, include_link)
        draft, guard_info, draft_fallbacks = self._guarded_draft(brief, include_link)
        self.fallbacks += draft_fallbacks

        page_id = None
        if include_link:
            page_id = self._ensure_page()
            if page_id is None:
                # page path broken -> degrade strike to a build touch without link
                self.fallbacks.append("page_unavailable_strike_degraded")
                include_link = False
                draft, guard_info, fb = self._guarded_draft(brief, False)
                self.fallbacks += fb

        # F5 arm: Robert CV-attachment probe mid-funnel (action-incident probe)
        attachments = None
        if brief.get("include_attachment") and not include_link:
            attachments = [{"filename": self.pretext["attachment_probe"]["filename"]}]

        events = self._send(channel, draft["subject"], draft["body"], attachments,
                            action=action)
        send_receipt = getattr(self, "_last_send_receipt", None)

        # 4 — UPDATE belief + notecard
        reaction = self._classify(events)
        self._apply_plan_updates(plan, events, reaction)
        s.add_ledger_facts(brief.get("asserted_facts", []),
                           s.touches_used, about="us")
        if include_link:
            s.struck = True
        rec = TouchRecord(
            idx=s.touches_used, channel=channel, direction="message",
            sender=s.persona.name, topic_id=topic_id, objective_step=action,
            summary=(plan.get("analysis") or "")[:300], subject=draft["subject"],
            body=draft["body"], page_id=page_id, events=events, reaction=reaction,
            suspicion=s.suspicion, guard_issues=guard_info.get("issues", []),
            fallbacks=list(self.fallbacks), sent_at=s.last_sent_at,
        )
        s.history.append(rec)
        s.raw_event_log.append({"touch_idx": s.touches_used, "events": events})
        self.trace.touch(state=s, plan=plan, brief=brief, draft=draft,
                         guard=guard_info, events=events, reaction=reaction,
                         fallbacks=list(self.fallbacks), send_receipt=send_receipt)
        self.fallbacks = []
        return events

    # ------------------------------------------------------------------ #
    def _maybe_vouch_switch(self) -> None:
        """Ticket-13 cheap probe (F4 gate): after VOUCH_SWITCH_TOUCH touches from
        persona 1, hand the thread to the pretext's second persona (same
        org/domain) who references the first. The reply text answers whether
        the twin fuses two senders into one ongoing story."""
        s = self.state
        if self.arms.get("f4") != "vouch_probe":
            return
        second = self.pretext.get("second_persona")
        if not second or s.incident or s.touches_used != VOUCH_SWITCH_TOUCH:
            return
        if s.persona.name == second["name"]:
            return
        first_name = s.persona.name
        first_short = first_name.split()[0]
        s.persona = SenderIdentity(
            name=second["name"], role=second["role"], org=second["org"],
            address=second["address"], domain=second["domain"],
            backstory_id=second["org"])
        s.identities_used.append(s.persona)
        s.sender_note = (
            f"SENDER HANDOFF (one-time vouch probe): you now plan and write as "
            f"{second['name']} ({second['role']}, {second['org']}) — the senior "
            f"colleague of {first_name}, who sent every earlier touch in this "
            f"session. Open by explicitly referencing that ongoing thread "
            f"(e.g. '{first_short} handed me your exchange' / 'as discussed with "
            f"{first_short}') and answer anything still open from it. Do NOT "
            f"include a link this touch. Keep the ask light (e.g. confirm the "
            f"thread is with the right person / offer the next step).")
        self.trace.event("sender_switch", first=first_name,
                         second=s.persona.name, touch_idx=s.touches_used + 1)
        log_line(f"vouch probe: sender switch {first_name} -> {s.persona.name}")

    # ------------------------------------------------------------------ #
    @staticmethod
    def _request_plan(client, msgs: list, *, fallback: bool = False) -> dict:
        kwargs = {"temperature": 0.35, "max_tokens": 1800}
        if fallback:
            # The secondary gets exactly one HTTP attempt and no JSON-repair call.
            kwargs.update(repair=False, max_retries=0)
        plan, _ = client.chat_json(msgs, **kwargs)
        if not isinstance(plan, dict):
            raise LLMError("invalid structured output: non-dict plan")
        if not isinstance(plan.get("decision"), dict):
            raise LLMError("invalid structured output: missing/non-dict decision")
        for key in ("topic_updates", "writer_brief"):
            if key in plan and not isinstance(plan[key], dict):
                raise LLMError(f"invalid structured output: non-dict {key}")
        return plan

    def _plan(self, last_events: list, forced_strike: bool) -> tuple:
        """Plan with the primary, then one secondary attempt, then heuristics."""
        s = self.state
        last_events = sanitize_target_payload(last_events)
        pb_hint = {}
        if self.scenario == "practice":
            pb_hint = load_playbook(self.cfg.playbook_path).get("per_target", {}) \
                .get(self.target_id, {})
        msgs = prompts.build_plan_messages(s, self.pretext, self.arms, forced_strike,
                                           last_events, pb_hint)
        fallbacks = []
        try:
            plan = self._request_plan(self.planner, msgs)
        except LLMError as primary_error:
            fb = f"planner_primary_failed: {primary_error}"
            fallbacks.append(fb)
            log_line(fb)
            plan = None
            fallback_client = getattr(self, "planner_fallback", None)
            if fallback_client is None:
                fb = "planner_fallback_failed: no fallback client configured"
                fallbacks.append(fb)
                log_line(fb)
            else:
                try:
                    plan = self._request_plan(fallback_client, msgs, fallback=True)
                except LLMError as fallback_error:
                    fb = f"planner_fallback_failed: {fallback_error}"
                    fallbacks.append(fb)
                    log_line(fb)
                else:
                    model = getattr(fallback_client, "model", "configured secondary")
                    fb = f"planner_fallback_used: {model}"
                    fallbacks.append(fb)
                    log_line(fb)
            if plan is None:
                fb = "planner_fallback: both providers failed; using deterministic policy"
                fallbacks.append(fb)
                log_line(fb)
                return self._fallback_plan(forced_strike), fallbacks

        # apply belief updates now (D-F: read events -> update -> decide)
        s.apply_topic_updates(plan.get("topic_updates") or {}, s.touches_used + 1,
                              signal=str(plan.get("engagement", "")))
        if "suspicion" in plan:
            s.apply_suspicion(plan.get("suspicion"))
        # local signal reinforcement (sparse events need a floor)
        if last_events:
            self._reinforce_from_events(last_events)
        # disclosure win flagged by the planner
        if plan.get("disclosure_incident") and not s.incident:
            s.incident = {"objective": "disclosure", "via": "reply",
                          "touch_idx": s.touches_used,
                          "note": (plan.get("analysis") or "")[:200]}
        return plan, fallbacks

    def _reinforce_from_events(self, events: list) -> None:
        """Deterministic floor on top of the Planner's judgment (OD3 hybrid)."""
        s = self.state
        best = s.best_topic()
        for ev in events:
            et = ev.get("type") if isinstance(ev, dict) else None
            if et in ("link.opened", "attachment.opened") and best:
                best.confidence = min(1.0, best.confidence + 0.15)
                best.status = "engaged"
            elif et == "reply" and best:
                best.confidence = min(1.0, best.confidence + 0.10)
                if best.confidence >= 0.6:
                    best.status = "engaged"

    def _fallback_plan(self, forced_strike: bool) -> dict:
        """Deterministic policy when the Planner is unavailable/refuses (D-E)."""
        s = self.state
        engaged = s.engaged_topic()
        best = engaged or s.best_topic()
        tid = best.topic_id if best else self.pretext["topics"][0]["topic_id"]
        probes = sum(1 for h in s.history if h.objective_step == "probe")
        probe_cap = max(1, math.floor(self.cfg.probe_cap_frac * s.budget))
        if (engaged and s.suspicion < 0.75) or (forced_strike and s.suspicion < 0.85):
            action = "strike"
        elif probes < probe_cap and not s.history:
            action = "probe"
        elif s.history and s.consecutive_ignored == 0:
            action = "build"
        else:
            action = "probe"
        return {
            "analysis": "planner fallback policy",
            "engagement": "none",
            "decision": {"action": action, "topic_id": tid, "channel": "email",
                         "reason": "fallback policy"},
            "writer_brief": {
                "goal": "confirm interest and openness to the evaluation" if action != "strike"
                        else "get the scoping pack opened via the secure vendor workspace",
                "angle": self.pretext["angle"],
                "tone": "peer-to-peer, concise, warm-professional",
                "key_points": [],
                "asserted_facts": [],
                "cta": "short reply" if action != "strike" else "open the workspace link",
            },
        }

    def _sanitize_action(self, action: str, plan: dict, forced_strike: bool) -> str:
        s = self.state
        engaged = s.engaged_topic() is not None
        first_touch = len(s.history) == 0

        # F2 arm B is the treatment itself: touch 1 MUST carry the link,
        # otherwise the A/B measures the planner's mood, not the arm.
        if first_touch and self.arms.get("f2") == "link_in_touch_1" \
                and action not in ("strike", "bail") and s.suspicion < 0.85:
            if action != "strike":
                self.fallbacks.append("forced_first_touch_link_arm_f2B")
                action = "strike"
        if action == "converse":
            # F3: live = engaged-thread escalation only, never a cold open
            if not self.allow_live or not engaged or first_touch:
                self.fallbacks.append("converse_downgraded_not_engaged")
                action = "build"
        if action == "strike":
            f2b_first = first_touch and self.arms.get("f2") == "link_in_touch_1"
            if self.arms.get("f4") == "vouch_probe":
                # probe reads memory from reply text, not from a conversion
                self.fallbacks.append("strike_downgraded_vouch_probe")
                action = "build"
            elif first_touch and self.arms.get("f2") == "link_free":
                self.fallbacks.append("strike_downgraded_first_touch_link_free")
                action = "probe"
            elif s.suspicion >= self.cfg.theta_hard:
                return "bail"
            elif not engaged and not forced_strike and not f2b_first \
                    and s.suspicion < 0.75:
                # gate not met and no backstop — keep building instead
                self.fallbacks.append("strike_downgraded_gate_not_met")
                action = "build"
        # D-M hard backstop: force the first strike by ceil(B/2) touches_left;
        # with two touches left, also force a lower-friction repeat instead of
        # letting a weak Planner drift back to probes after a failed first strike.
        if forced_strike and action in ("probe", "build") \
                and s.suspicion < 0.85:
            self.fallbacks.append("forced_strike_backstop")
            return "strike"
        return action

    # ------------------------------------------------------------------ #
    # Channel policy is code, not a prompt promise. Every Planner decision and
    # both direct send boundaries pass through these checks.
    def _channel_policy_issue(self, action: str, channel: str) -> Optional[str]:
        s = self.state
        channel = str(channel or "").lower()
        if channel in FORBIDDEN_CHANNELS:
            return f"forbidden_channel:{channel}"
        if action == "strike" and channel != "email":
            return f"strike_requires_email:{channel}"
        if action == "converse":
            live = [c for c in (self.pretext.get("live_channels") or [])
                    if c not in FORBIDDEN_CHANNELS]
            if channel not in live:
                return f"unsupported_live_channel:{channel}"
            if (not self.allow_live or not s.engaged_topic()
                    or not s.history):
                return f"live_requires_engaged_thread:{channel}"
            return None
        if channel not in self.pretext["escalation_channels"]:
            return f"unsupported_message_channel:{channel}"
        if channel == "calendar_invite" and not s.calendar_slot_accepted:
            return "calendar_requires_target_slot_acceptance"
        return None

    def _enforce_channel_policy(self, action: str, channel: str) -> tuple:
        channel = str(channel or "email").lower()
        issue = self._channel_policy_issue(action, channel)
        if not issue:
            return action, channel
        self.fallbacks.append(f"channel_policy:{issue}")
        if action == "converse":
            action = "build"
        return action, "email"

    # ------------------------------------------------------------------ #
    def _push_or_stall_disclosure(self) -> Optional[dict]:
        disclosure = self.pretext.get("disclosure_alternative")
        push = 2 <= self.state.touches_left <= 3
        stalled = self.state.consecutive_ignored >= 2
        return disclosure if disclosure and (push or stalled) else None

    def _build_brief(self, plan: dict, topic_id: str, include_link: bool) -> dict:
        wb = plan.get("writer_brief") or {}
        topic = self.state.topic(topic_id)
        include_attachment = bool(
            self.arms.get("f5") == "attachment_probe"
            and self.target_id == "robert" and not include_link
            and self.pretext.get("attachment_probe") and self.state.touches_used >= 1)
        brief = {
            "goal": wb.get("goal") or "engage the target on our pretext",
            "angle": wb.get("angle") or self.pretext["angle"],
            "tone": wb.get("tone") or "peer-to-peer, concise, warm-professional",
            "key_points": wb.get("key_points") or [],
            "facts_to_use": self.pretext["facts_to_use"],
            "verified_facts": self.pretext.get(
                "verified_facts", self.pretext["facts_to_use"]),
            "wrong_fact_traps": self.pretext.get("wrong_fact_traps", []),
            "top_pick": self.pretext.get("top_pick", ""),
            "asserted_facts": wb.get("asserted_facts") or [],
            "cta": wb.get("cta") or ("open the workspace link" if include_link else "short reply"),
            "topic": topic.label if topic else topic_id,
            "include_link": include_link,
            "include_attachment": include_attachment,
            "attachment_filename": (self.pretext.get("attachment_probe") or {}).get("filename", ""),
        }

        # Credentials remain primary. In PUSH/stall states, replace planner-supplied
        # assertions with a story-native clarification path instead of a false premise.
        disclosure = self._push_or_stall_disclosure()
        if disclosure:
            question = disclosure["question"]
            instruction = (
                "SECONDARY DISCLOSURE ALTERNATIVE: ask for clarification of "
                "role-relevant internal details. Do not plant false facts, claim a "
                f"false premise, or invent prior contact. Question: {question}"
            )
            brief["disclosure_alternative"] = question
            brief["asserted_facts"] = []
            brief["key_points"] = [instruction]
            brief["angle"] = (
                f"{self.pretext['angle']}\n{instruction}" if include_link else instruction
            )
            if include_link:
                brief["goal"] = (
                    "advance the secure workspace step; keep the role-relevant "
                    "clarification strictly secondary"
                )
                brief["cta"] = "open the workspace link"
            else:
                brief["goal"] = disclosure["goal"]
                brief["cta"] = "a short clarification of the relevant internal role details"
        return brief

    # ------------------------------------------------------------------ #
    # DRAFT + GUARD (D-J/D-K/D-L)
    # ------------------------------------------------------------------ #
    def _active_persona_dict(self) -> dict:
        s = self.state
        return {"name": s.persona.name, "role": s.persona.role,
                "org": s.persona.org,
                "org_description": self.pretext["persona"].get("org_description", ""),
                "address": s.persona.address, "domain": s.persona.domain}

    def _safe_email_draft(self, include_link: bool) -> dict:
        s = self.state
        first_name = self.pretext["target_name"].split()[0]
        angle = self.pretext["angle"]
        disclosure = self._push_or_stall_disclosure()
        if disclosure and not include_link:
            angle = (
                f"{disclosure['question']} I would rather ask than assume any "
                "details about your role or organization."
            )
        body = (f"Hi {first_name},\n\n{angle}\n\n"
                f"Best regards,\n{s.persona.name}\n"
                f"{s.persona.role}, {s.persona.org}")
        if include_link:
            body += f"\n\nYou can open it here: {self.pretext['planned_link']['url']}"
        return {"subject": "Following up", "body": body}

    def _record_writer_fallback_use(self, guard_log: dict, fallbacks: list) -> None:
        model = getattr(self.writer_fallback, "model", "configured secondary")
        note = f"writer_fallback_used: {model}"
        if note not in fallbacks:
            fallbacks.append(note)
        guard_log["writer_fallback_used"] = model
        provenance = getattr(self, "_run_provenance", None)
        if isinstance(provenance, dict):
            provenance["writer_fallback_used"] = model

    def _supported_claim_evidence(self) -> set:
        """Routing/handoff/programme/access claim phrases backed by evidence.

        A completed-action claim is only legitimate when the ledger or the
        Target API confirms it happened. The simulator never delivers such
        actions, so this is empty today; it is the seam where a future ledger
        of acknowledged handoffs would feed confirmed phrases to the guard.
        """
        return set()

    def _guarded_draft(self, brief: dict, include_link: bool) -> tuple:
        s = self.state
        planned_url = self.pretext["planned_link"]["url"]
        allowed = list({self.pretext["persona"]["domain"], s.persona.domain})
        traps = self.pretext["trap_patterns"]
        first_name = self.pretext["target_name"].split()[0]
        persona_override = self._active_persona_dict()
        include_attachment = bool(brief.get("include_attachment"))
        supported_claims = self._supported_claim_evidence()

        best = None           # (score, draft, issues, stage, used_writer_fallback)
        feedback = ""
        guard_log = {"attempts": [], "issues": [], "readback_used": True}
        fallbacks = []

        def request_writer(msgs):
            """Return obj/raw/fallback-flag; None raw selects the safe floor."""
            try:
                obj, raw = self.writer.chat_json(
                    msgs, temperature=0.2, max_tokens=900)
                return obj, raw, False
            except LLMError as primary_error:
                failure = primary_error
                if not _writer_fallback_eligible(primary_error):
                    try:
                        raw = self.writer.chat(msgs, temperature=0.2, max_tokens=900)
                        return None, raw, False
                    except LLMError as raw_error:
                        if not _writer_fallback_eligible(raw_error):
                            raise
                        failure = raw_error

            fallbacks.append(f"writer_primary_failed: {failure}")
            # Strikes and pages never leave the abliterated primary. Benign copy
            # gets exactly one secondary call, without repair or HTTP retries.
            if include_link:
                return None, None, False
            fallback = getattr(self, "writer_fallback", None)
            if fallback is None:
                fallbacks.append("writer_fallback_failed: no fallback client configured")
                return None, None, False
            try:
                obj, raw = fallback.chat_json(
                    msgs, temperature=0.2, max_tokens=900,
                    repair=False, max_retries=0)
            except LLMError as fallback_error:
                fallbacks.append(f"writer_fallback_failed: {fallback_error}")
                return None, None, False
            return obj, raw, True

        for attempt in range(self.cfg.redo_cap + 1):
            msgs = prompts.build_email_writer_messages(
                self.pretext, brief, first_name, include_link,
                planned_url, brief.get("cta", ""), feedback=feedback,
                persona_override=persona_override)
            obj, raw, used_fallback = request_writer(msgs)
            if raw is None:
                note = ("writer strike failed; using deterministic safe template"
                        if include_link else
                        "Writer providers failed; using deterministic safe template")
                fallbacks.append(note)
                guard_log["issues"].append(note)
                return self._safe_email_draft(include_link), guard_log, fallbacks

            subject = str(obj.get("subject", "")).strip() if isinstance(obj, dict) else ""
            body = str(obj.get("body", "")).strip() if isinstance(obj, dict) else ""
            if not body:
                subject, body = prompts.parse_email_draft(raw)
            body = prompts._cut_cot_tail(body)
            if not subject or ("<" in subject and ">" in subject):
                subject = "Following up"
            if not body and used_fallback:
                fallbacks.append("writer_fallback_empty; using deterministic safe template")
                return self._safe_email_draft(include_link), guard_log, fallbacks
            if not body:
                body = (f"Hi {first_name},\n\n{brief.get('goal','')}\n\n"
                        f"Best regards,\n{s.persona.name}\n{s.persona.role}, {s.persona.org}")

            issues = run_programmatic_guard(
                subject, body, allowed_domains=allowed, trap_patterns=traps,
                include_link=include_link, planned_url=planned_url,
                required_sender=s.persona.name,
                include_attachment=include_attachment,
                supported_claims=supported_claims)
            stage = "programmatic"
            readback = {}
            if not issues:
                # D-J: Planner reads back every draft before it leaves
                try:
                    readback, _ = self.planner.chat_json(
                        prompts.build_guard_readback_messages(
                            s, self.pretext, subject, body, include_link, planned_url),
                        temperature=0.1, max_tokens=600)
                    stage = "planner_readback"
                    if isinstance(readback, list):
                        readback = next((x for x in readback if isinstance(x, dict)),
                                        {"pass": True})
                    if not isinstance(readback, dict):
                        fallbacks.append("readback_non_dict")
                        readback = {"pass": True}
                    if not readback.get("pass", False):
                        issues = readback.get("issues") or ["planner readback: fail"]
                        if readback.get("fix_hint"):
                            issues.append(f"fix: {readback['fix_hint']}")
                except LLMError as e:
                    fallbacks.append(f"readback_unavailable: {e}")
                    guard_log["readback_used"] = False

            guard_log["attempts"].append(
                {"attempt": attempt, "stage": stage, "subject": subject,
                 "issues": list(issues)})
            if not issues:
                if used_fallback:
                    self._record_writer_fallback_use(guard_log, fallbacks)
                return {"subject": subject, "body": body}, guard_log, fallbacks

            # prefer drafts that passed programmatic (stage=planner_readback)
            # over ones that failed deterministic checks
            score = len(issues) + (0 if stage == "planner_readback" else 50)
            if best is None or score < best[0]:
                best = (score, {"subject": subject, "body": body},
                        list(issues), stage, used_fallback)
            feedback = "Problems found:\n" + "\n".join(f"- {i}" for i in issues[:6])
            if used_fallback:
                # The secondary is a single guarded attempt, not another redo loop.
                break

        # D-K: redo cap hit -> send the best draft anyway, log it (D-L)
        if used_fallback:
            fallbacks.append(
                f"writer_fallback_guard_rejected: best draft has {best[0]} issue(s)")
        else:
            fallbacks.append(f"guard_redo_cap_hit: sent best draft with {best[0]} issue(s)")
        guard_log["issues"] = best[2]
        guard_log["override"] = True
        draft = best[1]
        used_fallback = best[4]
        # belt-and-braces: a strike must carry the planned URL to be a strike
        if include_link and planned_url not in draft["body"]:
            draft["body"] = draft["body"].rstrip() + \
                f"\n\nYou can open it here: {planned_url}"
            fallbacks.append("strike_url_appended_programmatically")

        # D-K permits sending the best *minor* failure, never a deterministic
        # voiding/wrong-sender failure. Fall back to known-safe copy instead.
        final_issues = run_programmatic_guard(
            draft["subject"], draft["body"], allowed_domains=allowed,
            trap_patterns=traps, include_link=include_link,
            planned_url=planned_url, required_sender=s.persona.name,
            include_attachment=include_attachment,
            supported_claims=supported_claims)
        if final_issues:
            fallbacks.append(
                "guard_fatal_fallback_template: " + "; ".join(final_issues[:4]))
            guard_log["fatal_fallback"] = final_issues
            draft = self._safe_email_draft(include_link)
            used_fallback = False
        if used_fallback:
            self._record_writer_fallback_use(guard_log, fallbacks)
        return draft, guard_log, fallbacks

    # ------------------------------------------------------------------ #
    # page register (07 flow: register BEFORE the linking touch)
    # ------------------------------------------------------------------ #
    def _ensure_page(self) -> Optional[str]:
        s = self.state
        link = self.pretext["planned_link"]
        url = link["url"]
        if url in s.pages:
            return s.pages[url]["page_id"]

        allowed = [self.pretext["persona"]["domain"]]
        html = ""
        feedback = ""
        for attempt in range(2):
            try:
                raw = self.writer.chat(
                    prompts.build_page_writer_messages(self.pretext, link)
                    + ([{"role": "user", "content":
                        "Reviewer feedback — fix these problems and output the full HTML again:\n"
                        + feedback}] if feedback else []),
                    temperature=0.5, max_tokens=2600)
            except LLMError as error:
                # Page HTML stays on the primary; its deterministic template is
                # the final floor rather than a second provider or a retry storm.
                self.fallbacks.append(f"page_writer_failed: {error}")
                html = ""
                break
            html = raw.strip()
            if html.startswith("```"):
                html = "\n".join(l for l in html.splitlines()
                                 if not l.strip().startswith("```")).strip()
            # Weak writers sometimes surround valid HTML with reasoning. The API
            # renders that prose as a broken/garbled page, so keep only the document.
            lower = html.lower()
            start = lower.find("<!doctype html")
            if start < 0:
                start = lower.find("<html")
            end = lower.rfind("</html>")
            if start >= 0 and end > start:
                html = html[start:end + len("</html>")].strip()
            issues = check_page_html(html, planned_url=url, fields=link["fields"],
                                     allowed_domains=allowed)
            if not issues:
                break
            feedback = "\n".join(f"- {i}" for i in issues)
            log_line(f"page draft issues (attempt {attempt}): {issues}")
        else:
            html = ""
        if not html:
            issues = check_page_html(html, planned_url=url, fields=link["fields"],
                                     allowed_domains=allowed)
            if issues:
                self.fallbacks.append("page_writer_failed_using_fallback_template")
                html = self._fallback_page_html()

        try:
            resp = self.api.register_page(s.session_id, url, link["page_title"],
                                          html, link["fields"])
            page_id = resp.get("page_id")
            s.pages[url] = {"page_id": page_id, "fields": link["fields"]}
            self.trace.event("page_registered", url=url, page_id=page_id,
                             html_len=len(html))
            log_line(f"page registered: {url} -> {page_id}")
            return page_id
        except TargetAPIError as e:
            self.fallbacks.append(f"page_register_failed: {e}")
            log_line(f"page registration failed: {e}")
            return None

    def _fallback_page_html(self) -> str:
        p = self.pretext["persona"]
        link = self.pretext["planned_link"]
        inputs = "\n".join(
            f'<label>{f.capitalize()}<input type="{"password" if f == "password" else "text"}" '
            f'name="{f}" required></label>' for f in link["fields"])
        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{link['page_title']}</title>
<style>
body {{ font-family: -apple-system, 'Segoe UI', Arial, sans-serif; background:#f4f6f8;
       display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }}
.card {{ background:#fff; padding:40px; border-radius:8px; width:360px;
        box-shadow:0 2px 12px rgba(0,0,0,.08); }}
h1 {{ font-size:20px; color:#1a2b4a; margin:0 0 6px; }}
p {{ font-size:13px; color:#5a6b80; margin:0 0 22px; }}
label {{ display:block; font-size:13px; color:#1a2b4a; margin-bottom:14px; }}
input {{ display:block; width:100%; padding:9px; margin-top:4px; border:1px solid #ccd4dd;
        border-radius:4px; box-sizing:border-box; }}
button {{ width:100%; padding:10px; background:#1a2b4a; color:#fff; border:0;
         border-radius:4px; font-size:14px; cursor:pointer; }}
footer {{ margin-top:22px; font-size:11px; color:#8a97a6; text-align:center; }}
</style></head>
<body><div class="card">
<h1>{p['org']}</h1>
<p>Secure workspace — sign in to access the materials shared with you.</p>
<form method="post">
{inputs}
<button type="submit">Sign in</button>
</form>
<footer>{p['org']} — confidential vendor evaluation. Hosted in the EU.</footer>
</div></body></html>"""

    # ------------------------------------------------------------------ #
    # monotonic story time + send/classify
    # ------------------------------------------------------------------ #
    def _next_sent_at(self, turn: bool = False) -> str:
        current = _parse_story_time(self.state.last_sent_at)
        if current is None:
            candidate = STORY_START
        else:
            if not turn and self.state.consecutive_ignored:
                candidate = (current + timedelta(days=1)).replace(hour=9, minute=0)
            else:
                candidate = current + (TURN_GAP if turn else MESSAGE_GAP)
            candidate = _business_hours(candidate)
            if candidate <= current:
                candidate = _business_hours(current + timedelta(minutes=1))
        return candidate.isoformat(timespec="seconds")

    def _observe_story_time(self, payload, minimum: Optional[str] = None) -> None:
        current = _parse_story_time(self.state.last_sent_at)
        latest = _latest_story_time(payload)
        floor = _parse_story_time(minimum)
        candidates = [value for value in (current, latest, floor) if value is not None]
        if candidates:
            self.state.last_sent_at = max(candidates).isoformat(timespec="seconds")

    def _server_story_time(self, sid: str) -> Optional[datetime]:
        try:
            status = self.api.get_session(sid)
        except TargetAPIError as error:
            self.fallbacks.append(f"story_time_resync_failed: {error}")
            return None
        return _latest_story_time(status)

    def _request_with_story_time(self, operation, sent_at: str, sid: str,
                                 turn: bool = False) -> dict:
        used = sent_at
        try:
            response = operation(used)
        except TargetAPIError as error:
            if not _is_backward_time_409(error):
                raise
            # A time 409 is not a closed session. Re-read server state, advance
            # beyond both server and attempted cursors, and retry once with the
            # same contact idempotency key but a corrected story timestamp.
            server_time = self._server_story_time(sid)
            attempted = _parse_story_time(used)
            current = _parse_story_time(self.state.last_sent_at)
            candidates = [value for value in (server_time, attempted, current)
                          if value is not None]
            if candidates:
                self.state.last_sent_at = max(candidates).isoformat(timespec="seconds")
            used = self._next_sent_at(turn=turn)
            self.fallbacks.append(f"story_time_409_advanced:{used}")
            response = operation(used)
        response = sanitize_target_payload(response)
        self._observe_story_time(response, minimum=used)
        return response

    def _send(self, channel: str, subject: str, body: str,
              attachments: Optional[list], action: str = "build") -> list:
        s = self.state
        self._last_send_receipt = None

        def _blocked_receipt(reason: str) -> None:
            self._last_send_receipt = build_send_receipt(
                target=self.target_id, channel=channel, sender=s.persona.name,
                address=s.persona.address, subject=subject,
                idempotency_key="", sent_at=s.last_sent_at,
                attachment_count=len(attachments or []),
                touches_used=s.touches_used, sent=False, reason=reason)

        if s.touches_left <= 0:
            self.fallbacks.append("touch_budget_send_blocked")
            _blocked_receipt("touch_budget_exhausted")
            return []
        issue = self._channel_policy_issue(action, channel)
        if issue:
            self.fallbacks.append(f"channel_policy_send_blocked:{issue}")
            _blocked_receipt(f"channel_policy:{issue}")
            return []
        msg = {
            "to": self.target_id,
            "channel": channel,
            "from": {"name": s.persona.name, "address": s.persona.address},
            "subject": subject,
            "body": body,
        }
        if attachments:
            msg["attachments"] = attachments
        idem = TargetClient.new_idem_key(f"t{s.touches_used + 1}")
        sent_at = self._next_sent_at()

        def send_at(story_time):
            return self.api.send_message(
                s.session_id, msg, idem_key=idem, sent_at=story_time)

        try:
            resp = self._request_with_story_time(send_at, sent_at, s.session_id)
        except TargetAPIError as e:
            if e.status in (400, 415) and attachments:
                # declared attachment shape rejected -> resend without it (logged)
                self.fallbacks.append(f"attachment_rejected: {e}")
                msg.pop("attachments", None)
                resp = self._request_with_story_time(send_at, sent_at, s.session_id)
            elif e.status == 422:
                self.fallbacks.append(f"message_422: {e}")
                s.touches_used += 0   # failed request spends no touch (02)
                _blocked_receipt(f"message_422:{e.status}")
                return []
            elif e.status == 409:
                # Non-time 409: ended / budget used upstream. Time 409 was
                # already corrected once by _request_with_story_time.
                self.fallbacks.append(f"session_closed_409: {e}")
                self._session_closed = True
                _blocked_receipt(f"session_closed_409:{e.status}")
                return []
            else:
                raise
        s.touches_used = int(resp.get("touches_used", s.touches_used + 1))
        events = sanitize_target_payload(resp.get("events") or [])
        # Redacted send receipt (D-Q companion): resolved outbound metadata only,
        # reflecting the payload actually accepted (attachments may have been
        # stripped on a 400/415 retry). Never contains target-submitted values.
        self._last_send_receipt = build_send_receipt(
            target=self.target_id, channel=channel, sender=s.persona.name,
            address=s.persona.address, subject=subject, idempotency_key=idem,
            sent_at=s.last_sent_at,
            api_message_id=(resp.get("message_id") or resp.get("id")),
            attachment_count=len(msg.get("attachments") or []),
            touches_used=s.touches_used, sent=True)
        log_line(f"touch {s.touches_used}: sent ({channel}) -> events: "
                 f"{[e.get('type') for e in events] or '[]'}")
        return events

    def _classify(self, events: list) -> str:
        s = self.state
        events = sanitize_target_payload(events)
        apply_calendar_slot_signal(s, events)
        types = [e.get("type") for e in events if isinstance(e, dict)]
        if "page.submitted" in types:
            for event in events:
                if not isinstance(event, dict) or event.get("type") != "page.submitted":
                    continue
                incident = incident_from_submission(event, s.touches_used)
                if incident and not s.incident:
                    s.incident = incident
                    s.objective_status = "achieved"
                    return "incident"
            # Basic-only/blank submission is a real engagement step, not a win
            # and not dead air.
            return "engaged"
        if "attachment.opened" in types:
            if self.arms.get("f5") == "attachment_probe" and not s.incident:
                s.raw_event_log.append({"note": "F5 probe: attachment.opened seen"})
            return "engaged"
        if "link.opened" in types:
            return "engaged"
        if "reply" in types:
            return "replied"
        return "ignored"

    def _apply_plan_updates(self, plan: dict, events: list, reaction: str) -> None:
        s = self.state
        if reaction == "ignored":
            s.consecutive_ignored += 1
            # silence decays the topic we just used (05 decision table)
            dec = plan.get("decision") or {}
            t = s.topic(dec.get("topic_id", ""))
            if t:
                t.confidence = max(0.0, t.confidence - 0.15)
                if t.confidence <= 0.15 and t.status != "engaged":
                    t.status = "cold"
        else:
            s.consecutive_ignored = 0

    # ------------------------------------------------------------------ #
    # live conversation (F3) — one touch, <=10 turns
    # ------------------------------------------------------------------ #
    def _conversation_draft_issues(self, say: str, channel: str,
                                   include_link: bool, planned_url: str) -> list:
        """Deterministic per-turn gate; never repair copy after this check."""
        if not isinstance(say, str) or not say.strip():
            return ["conversation utterance is empty"]
        say = say.strip()
        issues = []
        if len(say) > 600:
            issues.append("conversation utterance exceeds 600 characters")
        if len(re.findall(r"[.!?]+(?:\s|$)", say)) > 3:
            issues.append("conversation utterance exceeds three sentences")
        if re.search(r"(?:^|\n)\s*(?:subject|body):", say, re.IGNORECASE):
            issues.append("conversation utterance contains email formatting")
        if re.search(r"<[^>]+>|(?:^|\n)\s*(?:[-*]|\d+\.)\s+", say):
            issues.append("conversation utterance contains markup or bullets")
        if re.search(r"(?:^|\n)\s*(?:best regards?|kind regards?|sincerely),", say,
                     re.IGNORECASE):
            issues.append("conversation utterance contains an email sign-off")
        allowed = list({self.pretext["persona"]["domain"], self.state.persona.domain})
        issues += check_domains(say, allowed)
        issues += check_injection(say)
        issues += check_traps(say, self.pretext["trap_patterns"])
        issues += check_link_discipline(say, include_link, planned_url)
        return list(dict.fromkeys(issues))

    def _guarded_conversation_draft(self, plan: dict, convo_history: list,
                                    channel: str, include_link: bool,
                                    planned_url: str) -> tuple:
        """Return a Writer utterance only after deterministic + Planner approval."""
        guard = {"readback_used": True, "issues": []}
        writer = getattr(self, "writer", None)
        if writer is None:
            guard["issues"] = ["writer_unavailable: no Writer configured"]
            return None, guard
        if "writer_brief" in plan and not isinstance(plan.get("writer_brief"), dict):
            guard["issues"] = ["planner writer_brief is not an object"]
            return None, guard

        messages = prompts.build_conversation_writer_messages(
            self.state, self.pretext, plan, convo_history, channel,
            include_link, planned_url)
        used_fallback = False
        try:
            draft, _ = writer.chat_json(
                messages, temperature=0.2, max_tokens=350)
        except LLMError as error:
            fallback = getattr(self, "writer_fallback", None)
            if include_link or not _writer_fallback_eligible(error) or fallback is None:
                guard["issues"] = [f"writer_unavailable: {error}"]
                return None, guard
            self.fallbacks.append(f"writer_primary_failed: {error}")
            try:
                draft, _ = fallback.chat_json(
                    messages, temperature=0.2, max_tokens=350,
                    repair=False, max_retries=0)
                used_fallback = True
            except LLMError as fallback_error:
                self.fallbacks.append(f"writer_fallback_failed: {fallback_error}")
                guard["issues"] = [
                    f"writer_unavailable: {error}",
                    f"writer_fallback_failed: {fallback_error}",
                ]
                return None, guard
        if not isinstance(draft, dict) or not isinstance(draft.get("say"), str):
            guard["issues"] = ["writer returned no utterance"]
            return None, guard
        say = draft["say"].strip()
        issues = self._conversation_draft_issues(
            say, channel, include_link, planned_url)
        if issues:
            guard["issues"] = issues
            return None, guard

        try:
            readback, _ = self.planner.chat_json(
                prompts.build_conversation_guard_readback_messages(
                    self.state, self.pretext, convo_history, say, channel,
                    include_link, planned_url),
                temperature=0.1, max_tokens=500)
        except LLMError as error:
            guard["issues"] = [f"readback_unavailable: {error}"]
            guard["readback_used"] = False
            return None, guard
        if not isinstance(readback, dict) or readback.get("pass") is not True \
                or readback.get("severity") != "none":
            guard["issues"] = (readback.get("issues") or ["planner readback did not pass"]) \
                if isinstance(readback, dict) else ["planner readback returned a non-object"]
            return None, guard
        if used_fallback:
            self._record_writer_fallback_use(guard, self.fallbacks)
        return say, guard

    def _run_conversation(self, plan: dict, channel: str) -> list:
        s = self.state
        if s.touches_left <= 0:
            self.fallbacks.append("touch_budget_conversation_blocked")
            return []
        issue = self._channel_policy_issue("converse", channel)
        if issue:
            self.fallbacks.append(f"channel_policy_conversation_blocked:{issue}")
            return []
        planned_url = self.pretext["planned_link"]["url"]
        all_events: list = []
        convo_history: list = []
        turns_used = 0

        log_line(f"starting live conversation ({channel}) as engaged-thread escalation")
        sent_at = self._next_sent_at()
        start_idem = TargetClient.new_idem_key(f"t{s.touches_used + 1}-conv")

        def start_at(story_time):
            return self.api.start_conversation(
                s.session_id, self.target_id, channel,
                {"name": s.persona.name, "address": s.persona.address},
                sent_at=story_time, idem_key=start_idem)

        try:
            start = self._request_with_story_time(start_at, sent_at, s.session_id)
        except TargetAPIError as e:
            self.fallbacks.append(f"conversation_start_failed: {e}")
            if e.status == 409:
                self._session_closed = True
            return []
        try:
            s.touches_used = int(start.get("touches_used", s.touches_used + 1))
        except (TypeError, ValueError):
            s.touches_used += 1
        cid = start.get("conversation_id")
        if not isinstance(cid, str) or not cid.strip():
            self.fallbacks.append("conversation_start_failed: missing conversation_id")
            self.trace.event("conversation_start_failed", channel=channel,
                             reason="missing conversation_id")
            return []
        s.conversation_ids.append(cid)
        greeting = start.get("persona_says") or ""
        if not isinstance(greeting, str):
            greeting = ""
        if greeting:
            convo_history.append({"who": "target", "text": greeting})
        self.trace.event("conversation_start", cid=cid, channel=channel,
                         greeting=greeting, sent_at=s.last_sent_at)

        page_registered = False
        ended = False
        turn_guards = []
        try:
            for turn in range(10):
                turns_left = 10 - turn
                strike_ready = turn >= 1 and s.engaged_topic() is not None \
                    and s.suspicion < 0.75
                if strike_ready and not page_registered:
                    page_id = self._ensure_page()
                    page_registered = page_id is not None
                try:
                    out, _ = self.planner.chat_json(
                        prompts.build_turn_messages(
                            s, self.pretext, convo_history, turns_left,
                            strike_ready and page_registered, planned_url),
                        temperature=0.3, max_tokens=700)
                except LLMError as e:
                    self.fallbacks.append(f"turn_planner_fallback: {e}")
                    break
                if not isinstance(out, dict):
                    self.fallbacks.append("turn_planner_non_dict")
                    break

                include_link = bool(strike_ready and page_registered and turn >= 2
                                    and not out.get("end_call"))
                say, turn_guard = self._guarded_conversation_draft(
                    out, convo_history, channel, include_link, planned_url)
                turn_guards.append(turn_guard)
                if say is None:
                    issues = turn_guard.get("issues") or ["unknown guard failure"]
                    self.fallbacks.append(
                        "conversation_turn_blocked: " + "; ".join(issues[:4]))
                    self.trace.event("conversation_turn_blocked", cid=cid, turn=turn,
                                     channel=channel, guard=turn_guard)
                    break

                turn_sent_at = self._next_sent_at(turn=True)
                turn_idem = TargetClient.new_idem_key(
                    f"t{s.touches_used}-turn{turn + 1}")

                def turn_at(story_time):
                    return self.api.conversation_turn(
                        cid, say, idem_key=turn_idem, sent_at=story_time)

                try:
                    resp = self._request_with_story_time(
                        turn_at, turn_sent_at, s.session_id, turn=True)
                except TargetAPIError as e:
                    self.fallbacks.append(f"conversation_turn_failed: {e}")
                    if e.status == 409:
                        self._session_closed = True
                    ended = True
                    break
                turns_used = turn + 1
                convo_history.append({"who": "us", "text": say})
                events = sanitize_target_payload(resp.get("events") or [])
                all_events += events
                their = resp.get("persona_says") or ""
                if not isinstance(their, str):
                    their = ""
                if their:
                    convo_history.append({"who": "target", "text": their})
                self.trace.event("conversation_turn", cid=cid, turn=turn, say=say,
                                 persona_says=their, events=events,
                                 sent_at=s.last_sent_at, guard=turn_guard,
                                 planner_note=out.get("note", ""))
                if "suspicion" in out:
                    s.apply_suspicion(out.get("suspicion"))
                if out.get("disclosure_incident") and not s.incident:
                    s.incident = {"objective": "disclosure", "via": "conversation",
                                  "touch_idx": s.touches_used,
                                  "note": their[:200]}
                for event in events:
                    incident = incident_from_submission(event, s.touches_used)
                    if incident and not s.incident:
                        s.incident = incident
                        s.objective_status = "achieved"
                        break
                try:
                    server_turns = int(resp.get("turns_used", turns_used) or turns_used)
                except (TypeError, ValueError):
                    server_turns = turns_used
                if s.incident or resp.get("ended") or out.get("end_call") \
                        or s.suspicion >= self.cfg.theta_hard:
                    ended = True
                    break
                if server_turns >= 10:
                    # Local cap reached; close cleanly instead of treating the
                    # Target response as having already ended the conversation.
                    break
        finally:
            if not ended:
                try:
                    self.api.end_conversation(cid)
                except Exception:
                    pass

        reaction = self._classify(all_events)
        if reaction == "ignored" and convo_history:
            reaction = "replied"   # a held conversation is never 'dead air'
        s.consecutive_ignored = 0
        if s.incident:
            s.struck = True
            reaction = "incident"
        rec = TouchRecord(
            idx=s.touches_used, channel=channel, direction="conversation",
            sender=s.persona.name, topic_id=(plan.get("decision") or {}).get("topic_id", ""),
            objective_step="converse",
            summary=f"live call, {turns_used} turns; last: "
                    f"{(convo_history[-1]['text'][:120]) if convo_history else ''}",
            events=all_events, reaction=reaction, suspicion=s.suspicion,
            fallbacks=list(self.fallbacks), sent_at=s.last_sent_at)
        s.history.append(rec)
        s.raw_event_log.append({"touch_idx": s.touches_used, "conversation": cid,
                                "events": all_events})
        self.trace.touch(state=s, plan=plan,
                         brief={"mode": "conversation", "turns": turns_used},
                         draft={"transcript": convo_history[-6:]},
                         guard={"turns": turn_guards}, events=all_events,
                         reaction=reaction, fallbacks=list(self.fallbacks))
        self.fallbacks = []
        return all_events


# --------------------------------------------------------------------------- #
# Optional runtime OSINT enrichment (research/osint_tool.py, ticket 11) —
# for eval strangers; practice twins use the pretext priors instead.
# --------------------------------------------------------------------------- #

def _research_with_thin_footprint_fallback(metadata: dict) -> dict:
    """Degrade only the explicit no-accepted-evidence outcome, never providers."""
    try:
        return research_hidden_target(metadata)
    except ValueError as error:
        if str(error).strip().casefold() != (
                "no accepted identity evidence; planner was not called"):
            raise
        return thin_footprint_dossier(metadata)


def research_hidden_target(metadata: dict) -> dict:
    """Run identity-filtered research, then the fixed dossier prompt path."""
    if not isinstance(metadata, dict):
        raise ValueError("hidden target metadata must be an object")
    values = {}
    for key in ("name", "company", "role"):
        value = metadata.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"hidden target metadata requires {key}")
        values[key] = value.strip()
    from . import osint_tool
    profile = osint_tool.research(
        values["name"], values["company"], values["role"],
        location=metadata.get("location"), country=metadata.get("country"))
    dossier = osint_tool.discover_topics(profile)
    if not isinstance(dossier, dict):
        raise ValueError("research returned a non-object dossier")
    return dossier


def discover_stranger_topics(name: str, company: str, role: str = "") -> list:
    from . import osint_tool
    text = osint_tool.research(name, company, role or None)
    dossier = osint_tool.discover_topics(text)
    topics = []
    conf_map = {"high": 0.6, "medium": 0.4, "low": 0.25}
    for t in (dossier.get("ranked_topics") or []):
        topics.append({
            "topic_id": (t.get("topic") or "topic").lower().replace(" ", "_")[:40],
            "label": t.get("topic", ""),
            "prior": conf_map.get(str(t.get("confidence", "low")).lower(), 0.25),
        })
    return topics
