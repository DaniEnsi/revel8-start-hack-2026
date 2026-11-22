#!/usr/bin/env python3
"""Fetch reply texts for a session from the Target API (post-hoc reading).

Usage: python3 replies.py <session_id> [--full]
"""
from __future__ import annotations

import json
import sys
import urllib.request

BASE = "https://target-api.apps.01.cf.eu01.stackit.cloud/v1"
KEY = "rv8_lv8i3dIqtLkmIzF48B0Fu5RX"


def get(path: str):
    req = urllib.request.Request(BASE + path)
    req.add_header("Authorization", f"Bearer {KEY}")
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def main() -> int:
    sid = sys.argv[1]
    full = "--full" in sys.argv
    ev = get(f"/sessions/{sid}/events")["events"]
    for e in ev:
        t = e.get("type")
        if t == "reply":
            body = e.get("body", "")
            print(f"--- reply ({e.get('channel')}) subj={e.get('subject')!r}")
            print(body if full else body[:600])
            print()
        elif t == "persona_says":
            print(f"--- persona_says: {str(e)[:400]}\n")
        else:
            print(f"[{t}] {json.dumps({k: v for k, v in e.items() if k in ('url', 'fields', 'filename', 'page_id')})}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
