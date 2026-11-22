# Eval-day operational runbook

Type: task
Status: resolved
Blocked by:

## Question
Draft the eval-day runbook for the 3×10-touch median-scored window: per-session pacing,
opening from the cross-session playbook (D-O), strike timing (⌈B/2⌉), the eval-start detector
(ticket 14 global event IDs), crash-resume + idempotency, and the hidden-stranger approach
(Firecrawl OSINT → topic discovery → pretext). A per-session decision checklist the operator
(or agent) follows.

## Answer
Written → [docs/eval-runbook.md](../docs/eval-runbook.md): pre-window health-check + eval-start
detector (poll /scenarios 403→open + global-event-ID surge, never probe by opening an eval
session); per-session Phase A (zero-touch OSINT→archetype pretext) + Phase B (budget-phased loop,
forced strike ⌈B/2⌉=5, live-call escalation); abandon-vs-push; cross-session playbook seeding;
crash-resume + idempotency + 429 backoff + client-side lookalike/asset self-enforcement; and a
per-session laminated-card checklist.
