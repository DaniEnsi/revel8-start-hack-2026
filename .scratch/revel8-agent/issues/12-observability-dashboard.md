# Observability dashboard (turn-by-turn run viewer)

Type: prototype
Status: resolved
Blocked by:

## Question

Build a dashboard that renders each run **turn by turn** from the loop's per-touch trace
(05 decision D-Q) + the cross-session playbook (D-P). Two audiences: us (debugging during
practice) and the jury/pitch (the rubric says they "replay your scoring runs rendered turn
by turn"; the pitch needs one clean thread).

Per touch show: channel, angle/topic, sender identity, the message body, the landing
page/asset if any, events returned, how the notecard (belief + suspicion) changed, and any
fallback/error. Reads the trace + memory files the loop writes; does not drive the agent.
Not on the critical path to the first incident — parallelizable, most useful once the loop
(09) runs.

## Answer

Built → `dashboard/` (zero-dep static viewer: `index.html`+`app.js`+`styles.css`, double-click
or serve-root). Renders per touch: message-as-seen, landing page in sandboxed iframe, events
(incl. `page.submitted` fields), suspicion gauge (θ_soft/θ_hard), per-topic posterior deltas,
guard result, Writer brief, raw JSON; session-level outcome banner + playbook panel. Reads the
agent's JSONL trace (pinned to `agent/trace.py` `TraceWriter.touch` / `agent/state.py` playbook);
tolerant readers, drift reconciles in `getTouch()/normEvent()/getPage()`. Sample 5-touch Julius
run renders the full UI. One reconcile pass remains once a full real run with `touch` records lands.
