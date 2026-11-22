# Reliability & crash-resume hardening (infra)

Type: task
Status: resolved
Blocked by:

## Question
Harden the agent's PLUMBING so an eval session never crashes or double-spends touches:
Target API client (retries/idempotency/backoff/timeouts/parsing), trace writer (append
safety), session resume (GET /sessions + events rebuild), config loading. Benign infra only —
no change to Planner/Writer/pretext logic. Run on Fable (saves Kimi); fall back to Kimi if
refused. No live API calls (mock in tests).

## Answer (ran on Opus 4.8 — benign infra, no refusal)
Hardened API client (retry/backoff, idempotency-key reuse across retries, 120s timeout,
defensive JSON/shape parsing), crash-resume (`--resume`: reuse newest open session via GET
/sessions, authoritative touches_used, `rebuild_state_from_events` restores struck/belief/
incident, never re-sends), append-safe trace writer (O_APPEND+fsync), 409/budget handled
cleanly. `agent/tests/test_reliability.py` 22/22 pass (urllib mocked, no live calls).
**Residual risks:** in-flight-touch idem-key is in-memory (budget never exceeded on resume, but
one touch could be re-worded/wasted — could persist to disk if wanted); resume trusts server
status; **worth ONE live practice smoke-run of --resume before eval.**
