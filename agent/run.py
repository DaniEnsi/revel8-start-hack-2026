"""
run.py — CLI entry point.

Usage (from the project root):
    python3 -m agent.run --target julius --max-touches 8
    python3 -m agent.run --target robert --arm-f5 attachment_probe --max-touches 10
    python3 -m agent.run --target julius --arm-f2 link_in_touch_1 --arm-f6 named

Practice is always available. Hidden-target eval additionally requires
REVEL8_ENABLE_EVAL=1 and consumes the durable one-session-per-target manifest.
"""
from __future__ import annotations

import argparse
import json
import sys

from .config import Config
from .loop import SessionRunner
from .pretexts import PRETEXTS
from .state import EvalSessionError
from .trace import log_line


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="agent.run")
    ap.add_argument("--target", required=True,
                    help="practice twin id, or hidden target id for eval")
    ap.add_argument("--scenario", choices=["practice", "eval"], default="practice")
    ap.add_argument("--max-touches", type=int, default=None,
                    help="cap touches below the session budget (eval is always <=10)")
    ap.add_argument("--name", "--target-name", dest="target_name",
                    help="eval target's full name (from hidden-target metadata)")
    ap.add_argument("--company", help="eval target's company")
    ap.add_argument("--role", help="eval target's role")
    ap.add_argument("--location", help="optional research location, e.g. Munich,Bavaria,Germany")
    ap.add_argument("--country", help="optional two-letter research country, e.g. DE")
    ap.add_argument("--arm-f2", choices=["link_free", "link_in_touch_1"],
                    default="link_free", help="F2: opener aggressiveness")
    ap.add_argument("--arm-f4", choices=["single", "vouch_probe"],
                    default="single", help="F4/ticket-13: second-sender memory probe")
    ap.add_argument("--arm-f5", choices=["credentials", "attachment_probe"],
                    default="credentials", help="F5: Robert objective arm")
    ap.add_argument("--arm-f6", choices=["soft", "named"], default="soft",
                    help="F6: Julius referrer framing")
    ap.add_argument("--no-live", action="store_true",
                    help="disable live-conversation escalation (message-only)")
    ap.add_argument("--resume", action="store_true",
                    help="reuse the newest open practice session (crash recovery) "
                         "instead of starting a fresh one")
    ap.add_argument("--resume-session", metavar="SESSION_ID",
                    help="resume one exact open practice session (safe for parallel workers)")
    ap.add_argument("--notes", default="", help="free-text run note for the playbook")
    args = ap.parse_args(argv)

    metadata_supplied = any((args.target_name, args.company, args.role,
                             args.location, args.country))
    if args.scenario == "practice":
        if args.target not in PRETEXTS:
            log_line(f"REFUSED: unknown practice target {args.target!r}.")
            return 2
        if metadata_supplied:
            log_line("REFUSED: hidden-target metadata is eval-only.")
            return 2
    else:
        if not (args.target_name and args.target_name.strip()
                and args.company and args.company.strip()
                and args.role and args.role.strip()):
            log_line("REFUSED: eval requires --name, --company and --role metadata.")
            return 2
        if args.resume or args.resume_session:
            log_line("REFUSED: eval resume is driven by its durable manifest.")
            return 2

    cfg = Config()
    if args.scenario == "eval" and not cfg.eval_enabled:
        log_line("REFUSED: eval is disabled; explicitly set REVEL8_ENABLE_EVAL=1.")
        return 2
    problems = cfg.validate()
    if problems:
        for p in problems:
            log_line(f"config error: {p}")
        return 2

    target_metadata = None
    if args.scenario == "eval":
        target_metadata = {
            "name": args.target_name.strip(),
            "company": args.company.strip(),
            "role": args.role.strip(),
            "location": args.location,
            "country": args.country,
        }
    try:
        runner = SessionRunner(
            cfg, args.target, scenario=args.scenario,
            arms={"f2": args.arm_f2, "f4": args.arm_f4,
                  "f5": args.arm_f5, "f6": args.arm_f6},
            max_touches=args.max_touches, allow_live=not args.no_live,
            notes=args.notes, resume=args.resume,
            resume_session_id=args.resume_session,
            target_metadata=target_metadata,
        )
        result = runner.run()
    except (EvalSessionError, ValueError) as error:
        log_line(f"REFUSED: {error}")
        return 2
    print("\n=== RESULT ===")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if not result["outcome"].startswith("error") else 1


if __name__ == "__main__":
    sys.exit(main())
