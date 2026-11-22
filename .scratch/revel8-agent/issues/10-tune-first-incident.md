# Tune to first reliable incident on a practice twin

Type: task
Status: open
Blocked by: 08, 09

## Question

Run practice sessions against a twin, read the event traces, and tune prompts/strategy
until the agent reaches an incident reliably within budget. Capture one clean thread for
the pitch.

## Interrupted 2026-11-21
Stopped: was A/B-ing arms on a config we're changing (Writer temp 0.45 / Q4 / single-brain)
and saturating the single serialized 27B endpoint with concurrent runs (GPU0 90%, ~32 tok/s,
full-prompt re-eval each call; GPU1 idle). Re-tune AFTER the brain decision (K3.1 vs fixed 27B)
+ temp sweep. Raw traces retained in agent/traces/ (reliability ~25-40% on the bad config).
