#!/usr/bin/env python3
"""
temp_sweep.py — empirical Writer-temperature sweep (research ticket 29).

READ-ONLY w.r.t. the agent: imports the REAL Writer prompt (prompts.py), the
REAL pretext/trap config (pretexts.py) and the REAL programmatic guard
(guards.py); reconstructs three representative Julius writer briefs exactly as
loop.py::_build_brief would emit them, and measures the guard pass-rate of the
local abliterated 27B Writer at several temperatures.

Hits ONLY the Writer endpoint (WRITER_BASE_URL from the project .env). It never
touches the Target API and never calls the Planner.

Fidelity notes / deliberate deviations from loop.py::_guarded_draft:
- Single-shot generation per (temperature, touch, sample): the production
  repair-retry inside ChatClient.chat_json (which re-asks at temperature 0.1)
  is bypassed so every sample really reflects the labelled temperature. We call
  ChatClient.chat(..., want_json=True) once, then parse exactly as the loop
  does (extract_json -> parse_email_draft fallback when the JSON is unusable).
- Production post-processing IS applied before scoring (prompts._cut_cot_tail,
  "Following up" subject fallback, empty-body template) because the measured
  quantity is the pass-rate of the agent's guard on what the agent would gate.
- The Planner read-back guard is NOT run: it is temperature-independent and
  would double endpoint load. pass-rate = deterministic programmatic guard.
- Extra failure-mode checks (not in guards.py) are recorded separately:
  bracket/angle placeholder tokens ([client-domain].com style), invented
  dates/events vs the FIXED PRETEXT dates, signature placement, and the strike
  host being teased inside a link-free touch.

Usage:
    python3 agent/tools/temp_sweep.py [--temps 0.05,0.1,0.15,0.2,0.3,0.45]
                                      [--samples 3] [--touch t1_opener_linkfree]
                                      [--sleep 1.5] [--max-tokens 900]
                                      [--out research/29-temp-sweep.md]
                                      [--jsonl research/29-temp-sweep.jsonl]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from agent.config import Config                              # noqa: E402
from agent.llm import writer_client, extract_json, LLMError  # noqa: E402
from agent import prompts                                    # noqa: E402
from agent.guards import run_programmatic_guard              # noqa: E402
from agent.pretexts import get_pretext                       # noqa: E402

TARGET_ID = "julius"
DEFAULT_TEMPS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.45]
DEFAULT_MAX_TOKENS = 900        # identical to loop.py::_guarded_draft
HARD_ERROR_ABORT = 3            # consecutive endpoint failures before aborting
ERROR_BACKOFF_S = 20.0

# --------------------------------------------------------------------------- #
# Representative Julius writer briefs (Planner writer_brief schema, 05 D-C)
# --------------------------------------------------------------------------- #

def build_touches(pretext: dict) -> list:
    facts = pretext["facts_to_use"]
    topic_label = "Confidential DAX40 enterprise evaluation via boutique advisory"
    return [
        {
            "touch_id": "t1_opener_linkfree",
            "label": "link-free opener (probe)",
            "include_link": False,
            "brief": {
                "goal": ("confirm Julius is the right person for enterprise evaluations "
                         "and that he is open to receiving our scoping pack"),
                "angle": ("Cold open, peer-to-peer: we advise the CISO office of a DAX40 "
                          "industrial client (under NDA) that is shortlisting human-risk / "
                          "security-awareness platforms for a 2027 rollout; revel8 came up "
                          "via the investor circle. No link, no attachment, no ask beyond a "
                          "short reply."),
                "tone": "peer-to-peer, concise, warm-professional",
                "key_points": [
                    "Boutique Munich advisory acting for the CISO office of a DAX40 client under NDA",
                    "Shortlist for a 2027 rollout; revel8 came up through the investor circle",
                    "Ask only whether he is the right contact and open to the scoping pack",
                ],
                "facts_to_use": facts,
                "asserted_facts": [
                    "We advise the CISO office of a DAX40 industrial client under NDA",
                    "revel8 came up through the investor circle",
                ],
                "cta": "a short reply confirming he is the right contact",
                "topic": topic_label,
                "include_link": False,
                "include_attachment": False,
                "attachment_filename": "",
            },
        },
        {
            "touch_id": "t2_vetting_reply",
            "label": "vetting reply (build)",
            "include_link": False,
            "brief": {
                "goal": ("answer his three vetting questions (client identity, referrer, "
                         "pack contents) concisely and keep the evaluation credible"),
                "angle": ("Vetting round 1 — he asked who the client is, which investor "
                          "referred us, and what the scoping pack involves. The client name "
                          "stays under NDA (sector, size, regions and timeline are shareable "
                          "now; the name after the NDA is countersigned). The intro came "
                          "through the investor circle — no single named person. The pack is "
                          "the evaluation criteria, a short scoping questionnaire and the "
                          "pilot timeline. Still no link."),
                "tone": "peer-to-peer, concise, warm-professional",
                "key_points": [
                    "Client: DAX40 discrete manufacturer, 4,200 employees in DE/AT — name only after the NDA is countersigned",
                    "Referrer: revel8 came up through the investor circle, no single named angel",
                    "Pack: evaluation criteria, a 20-minute scoping questionnaire, pilot timeline (shortlist 29 January 2027, pilot Q2 2027)",
                ],
                "facts_to_use": facts,
                "asserted_facts": [
                    "The client name is disclosed only after the NDA is countersigned",
                    "No single named referrer — the investor circle",
                ],
                "cta": "a short reply confirming he is happy to receive the pack",
                "topic": topic_label,
                "include_link": False,
                "include_attachment": False,
                "attachment_filename": "",
            },
        },
        {
            "touch_id": "t3_strike_workspace",
            "label": "strike (workspace link)",
            "include_link": True,
            "brief": {
                "goal": "get him to open the secure vendor workspace and review the scoping pack",
                "angle": ("He is engaged and the vetting is answered — deliver the promised "
                          "scoping pack. It is staged in our secure vendor workspace; he "
                          "signs in with his work email. Frame it as the natural next step "
                          "of the evaluation, with the shortlist date as gentle urgency."),
                "tone": "peer-to-peer, concise, warm-professional",
                "key_points": [
                    "The scoping pack is staged in our secure vendor workspace",
                    "Sign in with his work email — the NDA cover note is inside",
                    "Shortlist decision is 29 January 2027, pilot Q2 2027 — an early look helps",
                ],
                "facts_to_use": facts,
                "asserted_facts": [
                    "The scoping pack is staged in our secure vendor workspace",
                    "The shortlist decision is 29 January 2027",
                ],
                "cta": "open the workspace link",
                "topic": topic_label,
                "include_link": True,
                "include_attachment": False,
                "attachment_filename": "",
            },
        },
    ]


# --------------------------------------------------------------------------- #
# Extra failure-mode checks (beyond guards.py)
# --------------------------------------------------------------------------- #

MONTHS = (r"January|February|March|April|May|June|July|August|September|Sept|"
          r"October|November|December")
DATE_RES = [
    re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?(?:\s+of)?\s+(?:{MONTHS})(?:\s+20\d\d)?\b", re.I),
    re.compile(rf"\b(?:{MONTHS})\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?\b", re.I),
    re.compile(r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b", re.I),
    re.compile(r"\b(?:next|this|coming)\s+(?:week|month|Monday|Tuesday|Wednesday|"
               r"Thursday|Friday|Saturday|Sunday)\b", re.I),
    re.compile(r"\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b"),
    re.compile(r"\bQ[1-4][ -]?20\d\d\b", re.I),
    re.compile(r"\bH[12][ -]?20\d\d\b", re.I),
    re.compile(r"\b20\d\d\b"),
    re.compile(r"\b(?:tomorrow|tonight|yesterday)\b", re.I),
]
# Dates that are legitimate per the FIXED PRETEXT facts (normalised lowercase).
ALLOWED_DATE_TOKENS = {
    "2026", "2027", "29 january 2027", "29 january", "january 2027",
    "q2 2027", "h2 2027", "september 2025", "sept 2025",
}
PLACEHOLDER_RE = re.compile(
    r"\[[^\]\n]{1,60}\]|<[^>\n]{1,50}>|\bTBD\b|\bXXX+\b|_{3,}", re.IGNORECASE)


def _norm_tok(tok: str) -> str:
    tok = re.sub(r"\s+", " ", tok).strip().lower().rstrip(",.;")
    return re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", tok)


def find_invented_dates(text: str) -> list:
    """Date/event tokens not sanctioned by the FIXED PRETEXT facts."""
    hits = []
    for rx in DATE_RES:
        for m in rx.finditer(text or ""):
            if _norm_tok(m.group(0)) in ALLOWED_DATE_TOKENS:
                continue
            hits.append(m.group(0).strip())
    return sorted(set(hits))


def classify_modes(issues: list) -> list:
    """Map guard issue strings to failure-mode buckets."""
    modes = []
    for i in issues:
        il = i.lower()
        if "active sender name" in il:
            modes.append("missing_signature")
        elif ("link-free touch contains url" in il or "unexpected url" in il
              or "planned url missing" in il or "must contain the planned url" in il):
            modes.append("link_discipline")
        elif "wrong-fact trap" in il:
            modes.append("trap_hit")
        elif "banned domain" in il:
            modes.append("banned_domain")
        elif "non-lookalike url" in il or "unrecognised domain" in il:
            modes.append("domain_foreign")
        elif "injection" in il or "sim-breaking" in il:
            modes.append("injection")
        elif "placeholder" in il or "ellipsis" in il:
            modes.append("placeholder")
        elif ("chain-of-thought" in il or "second subject" in il
              or "too long" in il or "too short" in il):
            modes.append("craft_cot")
        else:
            modes.append("other")
    return sorted(set(modes))


# --------------------------------------------------------------------------- #
# One measured sample
# --------------------------------------------------------------------------- #

def generate_once(client, pretext: dict, touch: dict, temp: float,
                  max_tokens: int) -> dict:
    """Single-shot Writer generation at `temp`, parsed + post-processed exactly
    as loop.py::_guarded_draft does, then scored by the real programmatic
    guard plus the ticket-29 extra checks."""
    planned_url = pretext["planned_link"]["url"]
    planned_host = (urlparse(planned_url).hostname or "").lower()
    first_name = pretext["target_name"].split()[0]
    persona = dict(pretext["persona"])
    brief = touch["brief"]
    allowed = sorted({persona["domain"]})
    traps = pretext["trap_patterns"]

    msgs = prompts.build_email_writer_messages(
        pretext, brief, first_name, touch["include_link"], planned_url,
        brief.get("cta", ""), feedback="", persona_override=persona)

    t0 = time.time()
    raw = client.chat(msgs, temperature=temp, max_tokens=max_tokens, want_json=True)
    latency = time.time() - t0

    # --- parse like the loop: JSON object first, SUBJECT/BODY fallback -------
    json_ok, subject, body = True, "", ""
    try:
        obj = extract_json(raw)
        if isinstance(obj, list) and len(obj) == 1 and isinstance(obj[0], dict):
            obj = obj[0]
        if isinstance(obj, dict):
            subject = str(obj.get("subject", "")).strip()
            body = str(obj.get("body", "")).strip()
        else:
            json_ok = False
    except LLMError:
        json_ok = False
    if not body:
        subject, body = prompts.parse_email_draft(raw)

    # --- production post-processing (loop.py::_guarded_draft) ----------------
    body_pp = prompts._cut_cot_tail(body)
    cot_cut = body_pp != body
    subject_pp = subject
    if not subject_pp or ("<" in subject_pp and ">" in subject_pp):
        subject_pp = "Following up"
    used_fallback_body = False
    if not body_pp:
        used_fallback_body = True
        body_pp = (f"Hi {first_name},\n\n{brief.get('goal', '')}\n\n"
                   f"Best regards,\n{persona['name']}\n"
                   f"{persona['role']}, {persona['org']}")

    # --- the agent's own deterministic guard ---------------------------------
    issues = run_programmatic_guard(
        subject_pp, body_pp, allowed_domains=allowed, trap_patterns=traps,
        include_link=touch["include_link"], planned_url=planned_url,
        required_sender=persona["name"])
    modes = classify_modes(issues)

    # --- ticket-29 extra failure-mode checks ----------------------------------
    text_pp = f"{subject_pp}\n{body_pp}"
    placeholders = sorted(set(PLACEHOLDER_RE.findall(text_pp)))
    invented_dates = find_invented_dates(text_pp)
    weak_signature = (persona["name"].split()[-1].lower()
                      not in body_pp[-160:].lower())
    teased_host = (not touch["include_link"]
                   and planned_host in text_pp.lower())

    extra = {
        "placeholder_tokens": placeholders,
        "invented_dates": invented_dates,
        "weak_signature": weak_signature,
        "teased_strike_host_in_linkfree": teased_host,
    }
    clean = not issues and not placeholders and not invented_dates and not teased_host

    return {
        "temperature": temp,
        "touch_id": touch["touch_id"],
        "latency_s": round(latency, 1),
        "json_ok": json_ok,
        "cot_tail_cut": cot_cut,
        "used_fallback_body": used_fallback_body,
        "guard_pass": not issues,
        "fully_clean": clean,
        "issues": issues,
        "modes": modes,
        "extra": extra,
        "subject": subject_pp,
        "body": body_pp,
        "raw": raw,
    }


# --------------------------------------------------------------------------- #
# Stats + report
# --------------------------------------------------------------------------- #

def summarise(results: list, temps: list, touches: list) -> dict:
    scored = [r for r in results if not r.get("endpoint_error")]
    per_temp = {}
    for t in temps:
        rows = [r for r in scored if r["temperature"] == t]
        n = len(rows)
        npass = sum(1 for r in rows if r["guard_pass"])
        nclean = sum(1 for r in rows if r["fully_clean"])
        mode_counts = {}
        extra_counts = {}
        invented_toks, placeholder_toks = set(), set()
        for r in rows:
            for m in r["modes"]:
                mode_counts[m] = mode_counts.get(m, 0) + 1
            ex = r["extra"]
            if ex["placeholder_tokens"]:
                extra_counts["placeholder"] = extra_counts.get("placeholder", 0) + 1
                placeholder_toks.update(ex["placeholder_tokens"])
            if ex["invented_dates"]:
                extra_counts["invented_date"] = extra_counts.get("invented_date", 0) + 1
                invented_toks.update(ex["invented_dates"])
            if ex["weak_signature"]:
                extra_counts["weak_signature"] = extra_counts.get("weak_signature", 0) + 1
            if ex["teased_strike_host_in_linkfree"]:
                extra_counts["teased_host"] = extra_counts.get("teased_host", 0) + 1
            if not r["json_ok"]:
                extra_counts["json_fallback"] = extra_counts.get("json_fallback", 0) + 1
            if r["cot_tail_cut"]:
                extra_counts["cot_tail_cut"] = extra_counts.get("cot_tail_cut", 0) + 1
        per_touch = {}
        for touch in touches:
            trows = [r for r in rows if r["touch_id"] == touch["touch_id"]]
            per_touch[touch["touch_id"]] = (
                sum(1 for r in trows if r["guard_pass"]), len(trows))
        lat = [r["latency_s"] for r in rows]
        per_temp[t] = {
            "n": n, "guard_pass": npass, "fully_clean": nclean,
            "pass_rate": (npass / n) if n else None,
            "clean_rate": (nclean / n) if n else None,
            "per_touch": per_touch,
            "mode_counts": mode_counts, "extra_counts": extra_counts,
            "invented_tokens": sorted(invented_toks),
            "placeholder_tokens": sorted(placeholder_toks),
            "mean_latency_s": round(sum(lat) / len(lat), 1) if lat else None,
        }
    errors = [r for r in results if r.get("endpoint_error")]
    return {"per_temp": per_temp, "endpoint_errors": len(errors)}


def _fmtdetail(d: dict) -> str:
    return ", ".join(f"{k}×{v}" for k, v in sorted(d.items())) or "—"


def write_report(path: str, results: list, stats: dict, temps: list,
                 touches: list, cfg: Config, args, started: str, wall_s: float) -> None:
    pt = stats["per_temp"]
    lines = []
    lines.append("# 29 — Writer temperature sweep (Julius pretext, local abliterated 27B)")
    lines.append("")
    lines.append(f"**Date:** {started}  ")
    lines.append(f"**Endpoint:** `{cfg.writer_base_url}` (Writer only — Target API never touched)  ")
    lines.append(f"**Model:** `{cfg.writer_model}`  ")
    lines.append(f"**Method:** 3 representative Julius touches (link-free opener, vetting "
                 f"reply, strike) × {len(temps)} temperatures × {args.samples} samples "
                 f"= {len(results)} single-shot generations, max_tokens={args.max_tokens}. "
                 f"Real Writer prompt (`prompts.build_email_writer_messages`), real Julius "
                 f"ledger/trap config (`pretexts.py`), scored with the agent's own "
                 f"programmatic guard (`guards.run_programmatic_guard`) plus explicit "
                 f"checks for the known 27B failure modes (placeholder tokens, invented "
                 f"dates/events, signature, link discipline). "
                 f"Wall time {wall_s/60:.1f} min.  ")
    lines.append("")
    lines.append("**Fidelity notes:** single-shot per sample (the production repair-retry at "
                 "temp 0.1 inside `chat_json` is bypassed so each sample reflects its labelled "
                 "temperature); production post-processing (`_cut_cot_tail`, subject/body "
                 "fallbacks) IS applied before scoring; Planner read-back not run "
                 "(temperature-independent). "
                 "“fully clean” = guard pass AND no placeholder/invented-date/host-tease flags.")
    lines.append("")
    lines.append("## Results")
    lines.append("")
    lines.append("| temp | guard pass-rate | fully-clean | failure modes (guard) | extra flags | mean latency | quality note |")
    lines.append("|------|-----------------|-------------|-----------------------|-------------|--------------|--------------|")
    for t in temps:
        s = pt[t]
        if not s["n"]:
            lines.append(f"| {t} | n/a | n/a | endpoint errors | — | — | — |")
            continue
        guard_cell = f"{s['guard_pass']}/{s['n']} ({s['pass_rate']*100:.0f}%)"
        clean_cell = f"{s['fully_clean']}/{s['n']} ({s['clean_rate']*100:.0f}%)"
        modes = _fmtdetail(s["mode_counts"])
        extras = _fmtdetail(s["extra_counts"])
        if s["invented_tokens"]:
            extras += f" — dates: {', '.join(s['invented_tokens'][:8])}"
        if s["placeholder_tokens"]:
            extras += f" — placeholders: {', '.join(s['placeholder_tokens'][:5])}"
        lines.append(f"| {t} | {guard_cell} | {clean_cell} | {modes} | {extras} "
                     f"| {s['mean_latency_s']}s | QUALITY_NOTE |")
    lines.append("")
    lines.append("### Per-touch guard pass (out of " + str(args.samples) + " samples each)")
    lines.append("")
    header = "| temp | " + " | ".join(t["label"] for t in touches) + " |"
    lines.append(header)
    lines.append("|" + "------|" * (len(touches) + 1))
    for t in temps:
        s = pt[t]
        cells = []
        for touch in touches:
            p, n = s["per_touch"].get(touch["touch_id"], (0, 0))
            cells.append(f"{p}/{n}" if n else "n/a")
        lines.append(f"| {t} | " + " | ".join(cells) + " |")
    lines.append("")
    lines.append("## Failure-mode legend")
    lines.append("")
    lines.append("- **trap_hit** — wrong-fact trap regex fired (co-CEO, Berlin, WHU/Stanford, "
                 "Siemens, it-sa past-contact, invented seed figure, …).")
    lines.append("- **craft_cot** — chain-of-thought leakage, second SUBJECT block, or "
                 "length outside the 20-word/1400-char craft band.")
    lines.append("- **placeholder** — `<...>`/`[...]`/`...` template artefacts "
                 "(e.g. `[client-domain].com`).")
    lines.append("- **missing_signature / weak_signature** — persona name absent, or not in "
                 "the closing block.")
    lines.append("- **link_discipline** — URL in a link-free touch, wrong/missing strike URL.")
    lines.append("- **invented_date (extra)** — date/event tokens beyond the FIXED PRETEXT "
                 "set (29 Jan 2027, Q2/H2 2027, Sept 2025); NOT caught by the guard, flagged "
                 "by this sweep.")
    lines.append("- **teased_host (extra)** — strike host mentioned inside a link-free touch.")
    lines.append("- **json_fallback** — output was not a JSON object; SUBJECT/BODY parsing "
                 "had to rescue it.")
    lines.append("")
    lines.append("## Recommendation")
    lines.append("")
    lines.append("RECOMMENDATION_PLACEHOLDER")
    lines.append("")
    lines.append("## Reproduce")
    lines.append("")
    lines.append("```bash")
    lines.append(f"python3 agent/tools/temp_sweep.py --temps {','.join(str(t) for t in temps)} "
                 f"--samples {args.samples}")
    lines.append("```")
    lines.append("")
    lines.append(f"Raw per-sample data: `{os.path.relpath(args.jsonl, PROJECT_ROOT)}` "
                 f"(subject, body, raw output, issues, flags, latency per generation).")
    if stats["endpoint_errors"]:
        lines.append("")
        lines.append(f"**Endpoint errors:** {stats['endpoint_errors']} sample(s) failed at "
                     f"the transport level (excluded from rates).")
    lines.append("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(description="Writer temperature sweep (ticket 29)")
    ap.add_argument("--temps", default=",".join(str(t) for t in DEFAULT_TEMPS))
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--touch", default="", help="restrict to one touch_id")
    ap.add_argument("--sleep", type=float, default=1.5, help="spacing between calls (s)")
    ap.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    ap.add_argument("--out", default=os.path.join(PROJECT_ROOT, "research", "29-temp-sweep.md"))
    ap.add_argument("--jsonl", default=os.path.join(PROJECT_ROOT, "research", "29-temp-sweep.jsonl"))
    args = ap.parse_args()

    temps = [float(x) for x in args.temps.split(",") if x.strip()]
    cfg = Config()
    problems = [p for p in cfg.validate() if "WRITER" not in p or not cfg.writer_base_url]
    if not cfg.writer_base_url or not cfg.writer_model:
        print("FATAL: WRITER_BASE_URL/WRITER_MODEL missing from .env", flush=True)
        return 2
    _ = problems  # Target-API problems are irrelevant for this sweep

    pretext = get_pretext(TARGET_ID)
    touches = build_touches(pretext)
    if args.touch:
        touches = [t for t in touches if t["touch_id"] == args.touch]
        if not touches:
            print(f"FATAL: unknown touch {args.touch!r}", flush=True)
            return 2

    client = writer_client(cfg)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    os.makedirs(os.path.dirname(args.jsonl), exist_ok=True)

    started = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total = len(temps) * len(touches) * args.samples
    print(f"[temp_sweep] model={cfg.writer_model} endpoint={cfg.writer_base_url}", flush=True)
    print(f"[temp_sweep] temps={temps} touches={[t['touch_id'] for t in touches]} "
          f"samples={args.samples} -> {total} generations", flush=True)

    results = []
    consec_errors = 0
    t_start = time.time()
    done = 0
    try:
        # interleaved order (round -> touch -> temp) so slow endpoint drift
        # over the sweep is spread evenly across temperatures
        for round_idx in range(args.samples):
            for touch in touches:
                for temp in temps:
                    done += 1
                    tag = f"[{done}/{total}] t={temp:<5} {touch['touch_id']} r{round_idx+1}"
                    rec = None
                    for attempt in range(3):   # transport-level retries with spacing
                        try:
                            rec = generate_once(client, pretext, touch, temp,
                                                args.max_tokens)
                            consec_errors = 0
                            break
                        except LLMError as e:
                            print(f"{tag} ENDPOINT ERROR ({e}); backing off "
                                  f"{ERROR_BACKOFF_S:.0f}s (attempt {attempt+1}/3)",
                                  flush=True)
                            time.sleep(ERROR_BACKOFF_S)
                    if rec is None:
                        consec_errors += 1
                        rec = {"temperature": temp, "touch_id": touch["touch_id"],
                               "endpoint_error": True}
                        if consec_errors >= HARD_ERROR_ABORT:
                            print("[temp_sweep] FATAL: endpoint unreachable/saturated "
                                  "after repeated spaced retries — aborting. "
                                  "Partial results still written.", flush=True)
                            raise SystemExit(3)
                    rec["sample_idx"] = round_idx
                    results.append(rec)
                    if rec.get("endpoint_error"):
                        print(f"{tag} SKIPPED (endpoint error)", flush=True)
                    else:
                        state = "PASS" if rec["guard_pass"] else "FAIL"
                        clean = "clean" if rec["fully_clean"] else "flags:" + \
                            ",".join(k for k, v in rec["extra"].items()
                                     if v and k != "weak_signature") or "sig-only"
                        print(f"{tag} {state} ({clean}) {rec['latency_s']}s"
                              + ("" if rec["guard_pass"]
                                 else f" issues={len(rec['issues'])}"), flush=True)
                    time.sleep(args.sleep)
    except KeyboardInterrupt:
        print("\n[temp_sweep] interrupted — writing partial results", flush=True)

    wall = time.time() - t_start
    stats = summarise(results, temps, touches)
    write_report(args.out, results, stats, temps, touches, cfg, args, started, wall)
    with open(args.jsonl, "w", encoding="utf-8") as fh:
        for r in results:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    print("\n[temp_sweep] summary (guard pass / fully clean):", flush=True)
    for t in temps:
        s = stats["per_temp"][t]
        if s["n"]:
            print(f"  t={t:<5} {s['guard_pass']}/{s['n']} pass, "
                  f"{s['fully_clean']}/{s['n']} clean, "
                  f"modes={_fmtdetail(s['mode_counts'])}, "
                  f"extras={_fmtdetail(s['extra_counts'])}", flush=True)
        else:
            print(f"  t={t:<5} n/a (endpoint errors)", flush=True)
    print(f"[temp_sweep] report -> {args.out}", flush=True)
    print(f"[temp_sweep] samples -> {args.jsonl}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
