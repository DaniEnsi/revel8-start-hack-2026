"""
config.py — environment + constants for the revel8 agent.

Loads the project-root .env (no third-party deps) and exposes one Config object.
Planner and its optional fallback default to the Writer endpoint when their
PLANNER_* / PLANNER_FALLBACK_* settings are unset (single-brain). Writer's
optional fallback defaults to the explicitly configured Planner fallback, then
the Planner. Set the corresponding BASE_URL/MODEL/API_KEY variables to use
separate brains.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
EVAL_ENABLE_ENV = "REVEL8_ENABLE_EVAL"
SCORED_TOUCH_CAP = 10


def load_dotenv(path: str = os.path.join(PROJECT_ROOT, ".env")) -> dict:
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip('"').strip("'")
    return env


_DOTENV = load_dotenv()


def _get(key: str, default: str = "") -> str:
    return os.environ.get(key) or _DOTENV.get(key) or default


@dataclass
class Config:
    # Target API
    revel8_api_base: str = field(default_factory=lambda: _get("REVEL8_API_BASE").rstrip("/"))
    revel8_team_key: str = field(default_factory=lambda: _get("REVEL8_TEAM_KEY"))

    # Writer = abliterated copy model (OpenAI-compatible)
    writer_base_url: str = field(default_factory=lambda: _get("WRITER_BASE_URL").rstrip("/"))
    writer_model: str = field(default_factory=lambda: _get("WRITER_MODEL"))
    writer_api_key: str = field(default_factory=lambda: _get("WRITER_API_KEY", "sk-noauth"))

    # Optional Writer secondary; prefer an explicit Planner secondary, then Planner.
    writer_fallback_base_url: str = field(
        default_factory=lambda: (
            _get("WRITER_FALLBACK_BASE_URL")
            or _get("PLANNER_FALLBACK_BASE_URL")
            or _get("PLANNER_BASE_URL")
            or _get("WRITER_BASE_URL")
        ).rstrip("/")
    )
    writer_fallback_model: str = field(
        default_factory=lambda: (
            _get("WRITER_FALLBACK_MODEL")
            or _get("PLANNER_FALLBACK_MODEL")
            or _get("PLANNER_MODEL")
            or _get("WRITER_MODEL")
        )
    )
    writer_fallback_api_key: str = field(
        default_factory=lambda: (
            _get("WRITER_FALLBACK_API_KEY")
            or _get("PLANNER_FALLBACK_API_KEY")
            or _get("PLANNER_API_KEY")
            or _get("WRITER_API_KEY", "sk-noauth")
        )
    )

    # Planner = organiser brain; defaults to the Writer endpoint (single-brain)
    planner_base_url: str = field(
        default_factory=lambda: (_get("PLANNER_BASE_URL") or _get("WRITER_BASE_URL")).rstrip("/")
    )
    planner_model: str = field(
        default_factory=lambda: _get("PLANNER_MODEL") or _get("WRITER_MODEL")
    )
    planner_api_key: str = field(
        default_factory=lambda: _get("PLANNER_API_KEY") or _get("WRITER_API_KEY", "sk-noauth")
    )

    # Optional secondary Planner; defaults to the Writer endpoint (single-brain)
    planner_fallback_base_url: str = field(
        default_factory=lambda: (
            _get("PLANNER_FALLBACK_BASE_URL") or _get("WRITER_BASE_URL")
        ).rstrip("/")
    )
    planner_fallback_model: str = field(
        default_factory=lambda: _get("PLANNER_FALLBACK_MODEL") or _get("WRITER_MODEL")
    )
    planner_fallback_api_key: str = field(
        default_factory=lambda: (
            _get("PLANNER_FALLBACK_API_KEY") or _get("WRITER_API_KEY", "sk-noauth")
        )
    )

    # OSINT
    osint_backend: str = field(default_factory=lambda: _get("OSINT_BACKEND", "firecrawl"))
    firecrawl_api_key: str = field(default_factory=lambda: _get("FIRECRAWL_API_KEY"))

    # Runtime dirs
    traces_dir: str = field(default_factory=lambda: os.path.join(AGENT_DIR, "traces"))
    playbook_path: str = field(default_factory=lambda: os.path.join(AGENT_DIR, "playbook.json"))
    eval_manifest_path: str = field(
        default_factory=lambda: os.path.join(AGENT_DIR, "eval_sessions.json"))
    eval_enabled: bool = field(
        default_factory=lambda: _get(EVAL_ENABLE_ENV).strip().lower() == "1")

    # Policy constants (from research/05-control-loop.md)
    theta_soft: float = 0.55   # soften asks above this suspicion
    theta_hard: float = 0.85   # stop the session above this suspicion
    dead_air_k: int = 3        # consecutive ignored touches before abandoning
    probe_cap_frac: float = 0.3
    redo_cap: int = 2          # D-K: max Writer redos per touch

    def ensure_dirs(self) -> None:
        os.makedirs(self.traces_dir, exist_ok=True)

    def validate(self) -> list:
        problems = []
        if not self.revel8_api_base:
            problems.append("REVEL8_API_BASE missing")
        if not self.revel8_team_key:
            problems.append("REVEL8_TEAM_KEY missing")
        if not self.writer_base_url or not self.writer_model:
            problems.append("WRITER_BASE_URL/WRITER_MODEL missing")
        return problems
