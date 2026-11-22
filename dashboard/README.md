# Run Replay dashboard

Turn-by-turn replay of revel8 agent runs ("Agentic Social Engineer", START Hack 2026).
Zero dependencies, fully static, **local files only — no network, no API calls**.

Audiences: (a) us, debugging/tuning the loop; (b) the jury, whose rubric says they
"replay your scoring runs rendered turn by turn"; (c) picking the pitch thread.

## Open it

- **Double-click `index.html`** (works from `file://`): use **Open trace…** /
  drag & drop a `.jsonl` trace anywhere on the page, or **Load sample**.
- **Served** (nicer): from the project root run `python3 -m http.server 8123`, open
  <http://localhost:8123/dashboard/>. The dashboard then auto-lists every file in
  `agent/traces/` as one-click buttons, and deep links work:
  `dashboard/?trace=../agent/traces/<session>.jsonl&playbook=../agent/playbook.json`.

Scrub a session: click the timeline, use ← / → (Home/End), the slider, or ▶ Play.

## What it renders

Per touch (from the trace): action badge (probe/build/strike/push/…), channel, topic,
the **message as it appears to the twin** (sender line, subject, body, link), any
**landing page** (sandboxed live render of the registered HTML), the **events returned**
(incl. the target's reply text), the **notecard delta** (suspicion gauge with the
θ_soft 0.55 / θ_hard 0.85 thresholds from `agent/config.py`, per-topic posterior
confidence with touch-over-touch deltas), the **guard result** (issues, redos, planner
read-back), **fallbacks/errors** (D-L), the **Writer brief** (D-C), and the raw record.

Session header: outcome (incident @ touch N / ended / in progress), touches used vs
budget, final suspicion + sparkline, channels, wall time. Marker rows: session start /
page registered / incident / session end and any other `kind` records.

**Playbook panel** (D-P): per-target learned hook, winning identity/channel, incident
history, safe facts, traps hit, burned senders, suspicion-triggering lines, plus the
sessions table. Load via **Open playbook…** (`agent/playbook.json`) or drop it in.

## Trace shape expected (D-Q)

One JSONL file per session, `agent/traces/<session_id>.jsonl`, as written by
[`agent/trace.py`](../agent/trace.py):

```jsonc
// one line per touch:
{"kind":"touch","touch_idx":1,"target_id":"julius","objective":"credentials",
 "suspicion":0.12,"touches_left":9,
 "topics":{"<topic_id>":{"confidence":0.65,"status":"untested|engaged|cold"}},
 "plan":{"action":"probe|build|strike|push|converse|bail","topic_id":"…","channel":"…",
         "reason":"…","include_link":false,"sender":{"name","role","org","address"}},
 "writer_brief":{"goal","angle","tone","key_points":[],"asserted_facts":[],"cta"},
 "draft":{"subject","body","page":{"url","title","fields":[],"html"}},
 "guard":{"passed":true,"issues":[],"redos":0,"readback":{"pass","severity","issues":[]}},
 "events":[{"type":"reply|link.opened|page.submitted|attachment.opened"}],
 "reaction":"engaged|wary|ignored|incident|mixed",
 "fallbacks":[],
 "ts":1795234886.4}

// plus marker records, any extra kinds are rendered generically:
{"kind":"session_start","session_id","scenario_id","target_id","budget","objective","persona",…}
{"kind":"page_registered","page_id","url","fields",…}
{"kind":"incident","objective","via","touch_idx","fields",…}
{"kind":"session_end","outcome","touches_used","final_suspicion","reason",…}
```

Playbook (`agent/playbook.json`, D-P, from [`agent/state.py`](../agent/state.py)):
`{"version", "per_target": {<tid>: {learned_hook, winning_identity, winning_channel,
reached_incident, safe_facts[], traps_hit[], burned_senders[], suspicion_triggering_lines[]}},
"sessions": [{session_id, target_id, outcome, touches_used, incident, final_suspicion, notes, ts}]}`.

The reader is deliberately tolerant (string or object events; plan/decision nesting;
page under `draft.page`, `record.page`, or bare `draft.html`). If ticket 09's loop
emits different field names, reconcile in **one place**: `getTouch()` / `normEvent()` /
`getPage()` in `app.js`.

## Sample data

`sample-trace.jsonl` (5-touch eval-shaped Julius run ending in a `page.submitted`
incident, incl. a guard redo and a logged fallback) and `sample-playbook.json` are
bundled so the dashboard renders before any real run exists. **Real-trace
reconciliation:** the reader accepts the current `session_start.target` marker,
nested planner decisions, and the observed compact `plan: {"<topic_id>": confidence}`
shape. For the compact shape it reads `writer_brief.topic` and reply-event channels;
when no planner action was recorded it uses the factual `message` label (or
`strike` when `writer_brief.include_link` is true) instead of inventing a
probe/build decision. Richer recorded actions and channels always take precedence.
