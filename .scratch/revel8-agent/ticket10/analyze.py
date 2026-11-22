#!/usr/bin/env python3
"""Ticket 10 analysis: fold traces + results.jsonl into per-arm tables.

Prints per-run lines and per-arm aggregates: incident rate, touches-to-
incident, suspicion curve, fallback histogram, F5 attachment observation,
and the vouch-probe reply classification (manual read via events API).
"""
from __future__ import annotations

import glob
import json
import os
import sys

ROOT = "/Users/dan/Documents/Coding/Hackathons/START-Hack-Munich-2026/revel8"
HERE = os.path.dirname(os.path.abspath(__file__))
TRACES = os.path.join(ROOT, "agent", "traces")
RESULTS = os.path.join(HERE, "results.jsonl")


def load_results() -> dict:
    out = {}
    if os.path.exists(RESULTS):
        with open(RESULTS) as fh:
            for line in fh:
                line = line.strip()
                if line:
                    d = json.loads(line)
                    if d.get("session_id"):
                        out[d["session_id"]] = d
    return out


def load_trace(sid: str) -> list:
    path = os.path.join(TRACES, f"{sid}.jsonl")
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return [json.loads(l) for l in fh if l.strip()]


def summarize_run(rec: dict, trace: list) -> dict:
    touches = [r for r in trace if r.get("kind") == "touch"]
    susp_curve = [t.get("suspicion") for t in touches]
    events = [(t.get("touch_idx"), [e.get("type") for e in t.get("events", [])])
              for t in touches]
    fb = {}
    for t in touches:
        for f in t.get("fallbacks", []):
            key = f.split(":")[0]
            fb[key] = fb.get(key, 0) + 1
    attach = any("attachment.opened" in evs for _, evs in events)
    link = any("link.opened" in evs for _, evs in events)
    submitted = any("page.submitted" in evs for _, evs in events)
    replies = sum(1 for _, evs in events if "reply" in evs)
    return {
        "label": rec.get("label"), "target": rec.get("target_id"),
        "outcome": rec.get("outcome"), "touches": rec.get("touches_used"),
        "incident_touch": (rec.get("incident") or {}).get("touch_idx"),
        "incident_via": (rec.get("incident") or {}).get("via"),
        "final_suspicion": rec.get("final_suspicion"),
        "susp_curve": susp_curve, "events": events, "fallbacks": fb,
        "attachment_opened": attach, "link_opened": link,
        "page_submitted": submitted, "replies": replies,
        "wall_m": round((rec.get("wall_s") or 0) / 60, 1),
    }


def arm_of(label: str) -> str:
    return label[0] if label else "?"


def main() -> int:
    results = load_results()
    rows = []
    for sid, rec in sorted(results.items(),
                           key=lambda kv: kv[1].get("label", "")):
        trace = load_trace(sid)
        rows.append(summarize_run(rec, trace))

    print(f"{'lbl':4} {'tgt':7} {'outcome':18} {'tch':>3} {'inc@':>4} "
          f"{'susp':>5} {'att':>3} {'lnk':>3} {'sub':>3} {'rep':>3} {'min':>5}  fallbacks")
    for r in rows:
        print(f"{r['label']:4} {str(r['target']):7} {str(r['outcome']):18} "
              f"{r['touches'] or 0:>3} {str(r['incident_touch'] or '-'):>4} "
              f"{r['final_suspicion'] if r['final_suspicion'] is not None else '-':>5} "
              f"{'Y' if r['attachment_opened'] else '.':>3} "
              f"{'Y' if r['link_opened'] else '.':>3} "
              f"{'Y' if r['page_submitted'] else '.':>3} "
              f"{r['replies']:>3} {r['wall_m']:>5}  "
              f"{json.dumps(r['fallbacks'])[:70]}")

    print("\nPer-arm aggregates:")
    arms = {}
    for r in rows:
        arms.setdefault(arm_of(r["label"]), []).append(r)
    for arm, rs in sorted(arms.items()):
        inc = [r for r in rs if r["incident_touch"]]
        tti = [r["incident_touch"] for r in inc]
        print(f"  {arm}: n={len(rs)} incidents={len(inc)} "
              f"rate={len(inc)/max(1,len(rs)):.0%} "
              f"touches_to_incident={tti} "
              f"avg_final_susp={sum((r['final_suspicion'] or 0) for r in rs)/max(1,len(rs)):.2f}")
    if "--curves" in sys.argv:
        print("\nSuspicion curves:")
        for r in rows:
            print(f"  {r['label']}: {r['susp_curve']}")
        print("\nEvent chains:")
        for r in rows:
            print(f"  {r['label']}: {r['events']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
