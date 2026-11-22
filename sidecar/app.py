"""
revel8 dashboard sidecar — FastAPI.

Tails agent/traces/*.jsonl and pushes new touch records to subscribed browsers
over a WebSocket, so a run is watched live as it unfolds. Also starts/stops
`python -m agent.run` for the control panel.

PRACTICE SCENARIO ONLY. The eval scenario is refused here and by the runner.
This is authorized local tooling for the revel8 security-awareness CTF: it runs
open on localhost, spawns a local process with a validated argument vector (never
a shell string), and never containerizes or proxies the remote writer model.

Run:
    pip install -r requirements.txt
    uvicorn app:app --host 127.0.0.1 --port 8787    # from this directory
    # or: python -m sidecar.app   (uses __main__ below)

Direct startup binds loopback unless HOST is set. REVEL8_CORS_ORIGINS accepts a
comma-separated list of explicit local dashboard origins.
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

if __package__:
    from .sanitization import SanitizeJSONMiddleware, sanitize_payload
else:
    from sanitization import SanitizeJSONMiddleware, sanitize_payload

# --------------------------------------------------------------------- config

SIDECAR_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = Path(os.environ.get("REVEL8_PROJECT_ROOT", SIDECAR_DIR.parent)).resolve()
TRACES_DIR = Path(os.environ.get("REVEL8_TRACES_DIR", PROJECT_ROOT / "agent" / "traces")).resolve()
PLAYBOOK_PATH = Path(
    os.environ.get("REVEL8_PLAYBOOK", PROJECT_ROOT / "agent" / "playbook.json")
).resolve()
PYTHON = os.environ.get("REVEL8_PYTHON", sys.executable)

VALID_TARGETS = {"julius", "robert", "tom"}
ARM_CHOICES = {
    "f2": {"link_free", "link_in_touch_1"},
    "f4": {"single", "vouch_probe"},
    "f5": {"credentials", "attachment_probe"},
    "f6": {"soft", "named"},
}
POLL_INTERVAL = 0.5  # seconds between trace-file size checks for the WS tail

DEFAULT_CORS_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")
_LOCAL_DASHBOARD_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def _cors_origins(raw: Optional[str] = None) -> list[str]:
    configured = os.environ.get("REVEL8_CORS_ORIGINS") if raw is None else raw
    candidates = DEFAULT_CORS_ORIGINS if not configured else configured.split(",")
    origins = []
    for candidate in candidates:
        candidate = candidate.strip().rstrip("/")
        if not candidate:
            continue
        try:
            parsed = urlsplit(candidate)
            port = parsed.port
        except ValueError as error:
            raise ValueError(f"Invalid local dashboard origin: {candidate}") from error
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in _LOCAL_DASHBOARD_HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(f"CORS origin must be an explicit loopback dashboard origin: {candidate}")
        host = f"[{parsed.hostname}]" if parsed.hostname == "::1" else parsed.hostname
        origin = f"{parsed.scheme}://{host}"
        if port is not None:
            origin = f"{origin}:{port}"
        if origin not in origins:
            origins.append(origin)
    if not origins:
        raise ValueError("REVEL8_CORS_ORIGINS must contain at least one local dashboard origin")
    return origins


app = FastAPI(title="revel8 sidecar", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)
# Outermost application middleware: even errors and future routes stay value-free.
app.add_middleware(SanitizeJSONMiddleware)

# --------------------------------------------------------------- process table

class RunProc:
    def __init__(self, proc: subprocess.Popen, args: list[str], target: str):
        self.proc = proc
        self.args = args
        self.target = target
        self.started = time.time()
        self.session_id: Optional[str] = None

    @property
    def running(self) -> bool:
        return self.proc.poll() is None


# keyed by session_id once detected; pre-detection procs live in _pending
_runs: dict[str, RunProc] = {}
_pending: list[RunProc] = []


def _reap() -> None:
    """Drop finished procs from the live view (keep the trace files)."""
    for sid in [s for s, r in _runs.items() if not r.running]:
        _runs.pop(sid, None)
    _pending[:] = [r for r in _pending if r.running or r.session_id is None]


def is_running(session_id: str) -> bool:
    r = _runs.get(session_id)
    return bool(r and r.running)


# ------------------------------------------------------------------ trace io

def read_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(sanitize_payload(json.loads(line)))
                except json.JSONDecodeError:
                    # tolerate a half-written trailing line (atomic-append race)
                    continue
    except FileNotFoundError:
        pass
    return records


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
        return f if f == f else None  # drop NaN
    except (TypeError, ValueError):
        return None


def derive_meta(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Python mirror of the UI's deriveMeta — enough for the run list card."""
    def first(kind: str) -> Optional[dict]:
        return next((r for r in records if r.get("kind") == kind), None)

    start = first("session_start") or {}
    end = first("session_end")
    incident = first("incident")
    touches = [r for r in records if r.get("kind") == "touch"]
    last = touches[-1] if touches else {}
    inc_touch = next((t for t in touches if t.get("reaction") == "incident"), None)

    budget = start.get("budget")
    if budget is None and touches:
        budget = max((t.get("touch_idx", 0) + (t.get("touches_left") or 0)) for t in touches)

    channels = []
    for t in touches:
        plan = t.get("plan") or {}
        ch = plan.get("channel") or (plan.get("decision") or {}).get("channel")
        if ch and ch not in channels:
            channels.append(ch)

    outcome = (end or {}).get("outcome") or ("incident" if (incident or inc_touch) else "in progress")
    final_susp = _num((end or {}).get("final_suspicion"))
    if final_susp is None and last:
        final_susp = _num(last.get("suspicion"))

    return {
        "target": start.get("target_id") or start.get("target") or last.get("target_id") or "",
        "scenario": start.get("scenario_id") or start.get("scenario") or "",
        "arms": start.get("arms"),
        "objective": start.get("objective") or last.get("objective") or "",
        "budget": budget,
        "outcome": outcome,
        "incidentTouch": (incident or {}).get("touch_idx")
        if incident
        else (inc_touch or {}).get("touch_idx"),
        "incidentVia": (incident or {}).get("via"),
        "touchesUsed": (end or {}).get("touches_used", len(touches)),
        "finalSuspicion": final_susp,
        "channels": channels,
        "startTs": start.get("ts") or (touches[0].get("ts") if touches else None),
        "endTs": (end or {}).get("ts") or (last.get("ts") if last else None),
    }


def list_trace_files() -> list[Path]:
    if not TRACES_DIR.exists():
        return []
    return sorted(TRACES_DIR.glob("*.jsonl"))


# -------------------------------------------------------------------- models

class StartBody(BaseModel):
    target: str
    arm_f2: str = "link_free"
    arm_f4: str = "single"
    arm_f5: str = "credentials"
    arm_f6: str = "soft"
    max_touches: Optional[int] = None
    no_live: bool = False
    notes: str = ""


# ------------------------------------------------------------------- routes

@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "agent_dir": str(PROJECT_ROOT / "agent"),
        "traces_dir": str(TRACES_DIR),
        "traces_exist": TRACES_DIR.exists(),
    }


@app.get("/api/runs")
def api_runs() -> dict[str, Any]:
    _reap()
    runs = []
    for path in list_trace_files():
        records = read_records(path)
        if not records:
            continue
        sid = path.stem
        stat = path.stat()
        runs.append(
            {
                "session_id": sid,
                "file": path.name,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
                "running": is_running(sid),
                "meta": derive_meta(records),
            }
        )
    return {"runs": runs}


@app.get("/api/runs/{session}")
def api_run(session: str) -> dict[str, Any]:
    path = TRACES_DIR / f"{session}.jsonl"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"no trace for session {session}")
    return {"session_id": session, "records": read_records(path), "running": is_running(session)}


@app.get("/api/playbook")
def api_playbook() -> dict[str, Any]:
    if not PLAYBOOK_PATH.exists():
        raise HTTPException(status_code=404, detail="no playbook yet")
    try:
        return sanitize_payload(json.loads(PLAYBOOK_PATH.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/running")
def api_running() -> dict[str, Any]:
    _reap()
    out = []
    seen: set[int] = set()
    for r in list(_runs.values()) + _pending:
        if not r.running or r.proc.pid in seen:
            continue
        seen.add(r.proc.pid)
        out.append(
            {
                "session_id": r.session_id,
                "pid": r.proc.pid,
                "started": r.started,
                "args": r.args,
                "target": r.target,
            }
        )
    return {"running": out}


@app.post("/api/runs")
def api_start(body: StartBody) -> dict[str, Any]:
    # ---- validation (practice only; argv never a shell string) ----
    if body.target not in VALID_TARGETS:
        raise HTTPException(status_code=400, detail=f"target must be one of {sorted(VALID_TARGETS)}")
    arms = {"f2": body.arm_f2, "f4": body.arm_f4, "f5": body.arm_f5, "f6": body.arm_f6}
    for arm, val in arms.items():
        if val not in ARM_CHOICES[arm]:
            raise HTTPException(status_code=400, detail=f"arm {arm} must be one of {sorted(ARM_CHOICES[arm])}")
    if body.max_touches is not None and not (1 <= body.max_touches <= 30):
        raise HTTPException(status_code=400, detail="max_touches must be between 1 and 30")

    argv = [
        PYTHON, "-m", "agent.run",
        "--target", body.target,
        "--scenario", "practice",  # hard-locked; eval is refused by construction
        "--arm-f2", body.arm_f2,
        "--arm-f4", body.arm_f4,
        "--arm-f5", body.arm_f5,
        "--arm-f6", body.arm_f6,
    ]
    if body.max_touches is not None:
        argv += ["--max-touches", str(body.max_touches)]
    if body.no_live:
        argv += ["--no-live"]
    if body.notes:
        argv += ["--notes", body.notes]

    before = {p.stem for p in list_trace_files()}
    try:
        proc = subprocess.Popen(
            argv,
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,  # own process group so stop kills children too
        )
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"failed to spawn: {e}")

    run = RunProc(proc, argv, body.target)
    _pending.append(run)

    # The agent names the session itself; detect the new trace file it creates.
    session_id: Optional[str] = None
    deadline = time.time() + 8.0
    while time.time() < deadline:
        new = {p.stem for p in list_trace_files()} - before
        if new:
            session_id = sorted(new)[0]
            break
        if proc.poll() is not None:  # died early (e.g. config error)
            break
        time.sleep(0.2)

    if session_id:
        run.session_id = session_id
        _runs[session_id] = run
        if run in _pending:
            _pending.remove(run)  # promoted — avoid double-listing in /api/running

    if proc.poll() is not None and proc.returncode not in (0, None):
        # process exited immediately — most likely a config/env problem
        detail = "run exited immediately (check .env: REVEL8_*/WRITER_* and the agent logs)"
        if session_id:
            # a trace was still created; let the UI show it
            return {"session_id": session_id, "pid": proc.pid, "started": run.started, "args": argv}
        raise HTTPException(status_code=500, detail=detail)

    return {"session_id": session_id, "pid": proc.pid, "started": run.started, "args": argv}


@app.post("/api/runs/{session}/stop")
def api_stop(session: str) -> dict[str, Any]:
    run = _runs.get(session)
    if not run or not run.running:
        return {"stopped": False, "detail": "not running"}
    try:
        os.killpg(os.getpgid(run.proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            run.proc.terminate()
        except Exception:
            pass
    return {"stopped": True}


# ---------------------------------------------------------------- websocket

async def _send_ws_json(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_json(sanitize_payload(payload))


@app.websocket("/ws/runs/{session}")
async def ws_run(ws: WebSocket, session: str) -> None:
    await ws.accept()
    path = TRACES_DIR / f"{session}.jsonl"

    # initial snapshot
    records = read_records(path)
    await _send_ws_json(ws, {"type": "snapshot", "records": records, "running": is_running(session)})

    offset = path.stat().st_size if path.exists() else 0
    last_running = is_running(session)

    try:
        while True:
            await asyncio.sleep(POLL_INTERVAL)

            if path.exists():
                size = path.stat().st_size
                if size > offset:
                    new_text = await asyncio.to_thread(_read_from, path, offset)
                    offset = size
                    for line in new_text.splitlines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        await _send_ws_json(ws, {"type": "record", "record": rec})

            running_now = is_running(session)
            if running_now != last_running:
                last_running = running_now
                await _send_ws_json(ws, {"type": "status", "running": running_now})
    except WebSocketDisconnect:
        return
    except Exception:
        # keep the sidecar alive even if a single socket misbehaves
        try:
            await ws.close()
        except Exception:
            pass


def _read_from(path: Path, offset: int) -> str:
    with path.open("r", encoding="utf-8") as fh:
        fh.seek(offset)
        return fh.read()


def main() -> None:
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("HOST") or "127.0.0.1",
        port=int(os.environ.get("PORT", "8787")),
    )


if __name__ == "__main__":
    main()
