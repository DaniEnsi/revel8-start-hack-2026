#!/usr/bin/env python3
"""Ticket 10 batch driver: run agent practice sessions with modest replication.

2 concurrent workers (target-API limit is 6; local LLM serialises anyway),
per-run log files, and a results.jsonl manifest parsed from each run's
RESULT block. Usage:

    python3 batch.py [--only A1,B1,...] [--workers 2]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

ROOT = "/Users/dan/Documents/Coding/Hackathons/START-Hack-Munich-2026/revel8"
HERE = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.join(HERE, "logs")
RESULTS = os.path.join(HERE, "results.jsonl")

# Sessions interrupted by the first batch attempt; explicit IDs allow safe parallel resume.
RESUME_IDS = {
    "A1": "s_dae75eda19",
    "B1": "s_5e473b95c8",
    "A2": "s_ecd61150d8",
    "C1": "s_c367a73c02",
}

# label, target, extra CLI args
QUEUE = [
    # A — Julius reliability, default arms (covers F2-A link_free + F6-A soft)
    ("A1", "julius", ["--max-touches", "8", "--notes", "t10-A1-julius-reliability"]),
    ("B1", "julius", ["--max-touches", "8", "--arm-f2", "link_in_touch_1",
                      "--notes", "t10-B1-f2-link-t1"]),
    ("A2", "julius", ["--max-touches", "8", "--notes", "t10-A2-julius-reliability"]),
    ("C1", "julius", ["--max-touches", "8", "--arm-f6", "named",
                      "--notes", "t10-C1-f6-named"]),
    ("D1", "robert", ["--max-touches", "10", "--arm-f5", "attachment_probe",
                      "--notes", "t10-D1-f5-attachment"]),
    ("T1", "tom",    ["--max-touches", "10", "--notes", "t10-T1-tom"]),
    ("B2", "julius", ["--max-touches", "8", "--arm-f2", "link_in_touch_1",
                      "--notes", "t10-B2-f2-link-t1"]),
    ("A3", "julius", ["--max-touches", "8", "--notes", "t10-A3-julius-reliability"]),
    ("C2", "julius", ["--max-touches", "8", "--arm-f6", "named",
                      "--notes", "t10-C2-f6-named"]),
    ("D2", "robert", ["--max-touches", "10", "--arm-f5", "attachment_probe",
                      "--notes", "t10-D2-f5-attachment"]),
    ("G1", "julius", ["--max-touches", "5", "--arm-f4", "vouch_probe",
                      "--notes", "t10-G1-vouch-probe"]),
    ("B3", "julius", ["--max-touches", "8", "--arm-f2", "link_in_touch_1",
                      "--notes", "t10-B3-f2-link-t1"]),
    ("C3", "julius", ["--max-touches", "8", "--arm-f6", "named",
                      "--notes", "t10-C3-f6-named"]),
    ("D3", "robert", ["--max-touches", "10", "--arm-f5", "attachment_probe",
                      "--notes", "t10-D3-f5-attachment"]),
    ("T2", "tom",    ["--max-touches", "10", "--notes", "t10-T2-tom"]),
]


def parse_result(log_text: str) -> dict:
    marker = "=== RESULT ==="
    i = log_text.rfind(marker)
    if i == -1:
        return {}
    blob = log_text[i + len(marker):].strip()
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        return {}


def run_one(label: str, target: str, extra: list) -> dict:
    os.makedirs(LOGS, exist_ok=True)
    log_path = os.path.join(LOGS, f"{label}.log")
    cmd = [sys.executable, "-m", "agent.run", "--target", target, *extra]
    t0 = time.time()
    with open(log_path, "w", encoding="utf-8") as fh:
        fh.write(f"$ {' '.join(cmd)}\n\n")
        fh.flush()
        proc = subprocess.Popen(cmd, cwd=ROOT, stdout=fh,
                                stderr=subprocess.STDOUT)
        rc = proc.wait()
    wall = time.time() - t0
    with open(log_path, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    res = parse_result(text)
    rec = {"label": label, "target": target, "args": extra, "rc": rc,
           "wall_s": round(wall, 1), **res}
    with open(RESULTS, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"[done] {label}: outcome={res.get('outcome')} "
          f"touches={res.get('touches_used')} incident={bool(res.get('incident'))} "
          f"wall={wall/60:.1f}m", flush=True)
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated labels to run")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--resume-interrupted", action="store_true",
                    help="resume the four sessions interrupted by the first attempt")
    args = ap.parse_args()

    only = {x.strip() for x in args.only.split(",") if x.strip()}
    queue = [q for q in QUEUE if not only or q[0] in only]
    if args.resume_interrupted:
        queue = [(label, target, extra + ["--resume-session", RESUME_IDS[label]])
                 for label, target, extra in queue if label in RESUME_IDS]
    print(f"running {len(queue)} sessions with {args.workers} workers", flush=True)

    pending = list(queue)
    running = []  # list of (label, thread)
    import threading

    lock = threading.Lock()

    def worker():
        while True:
            with lock:
                if not pending:
                    return
                label, target, extra = pending.pop(0)
            try:
                run_one(label, target, extra)
            except Exception as e:  # keep the batch alive
                print(f"[error] {label}: {e}", flush=True)
            time.sleep(5)  # gentle pacing between session starts

    threads = [threading.Thread(target=worker, daemon=True)
               for _ in range(args.workers)]
    for t in threads:
        t.start()
        time.sleep(8)  # stagger worker starts
    for t in threads:
        t.join()
    print("batch complete", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
