# Target API client contract

Type: research
Status: resolved
Blocked by:

## Question

Produce a precise internal contract for the revel8 Target API that the agent code depends
on: every endpoint, request/response shapes, event types, session & touch semantics,
conversations (turns), assets, landing pages, idempotency, rate limits, error codes, and
the voiding constraints (lookalike domains, no persona injection).

Source: the agent-facing docs at `/docs.md` (already fetched: `/tmp/revel8_docs.md`).
Output: `.scratch/revel8-agent/research/02-api-contract.md`.

## Answer

Resolved from the live `/docs.md`. Full client contract written to
[research/02-api-contract.md](../research/02-api-contract.md): endpoints, message &
conversation shapes, the 4 event types, session/touch/memory semantics, landing pages,
assets, idempotency, rate limits, error codes, and the voiding rules (lookalike domains,
no persona injection). Base `…stackit.cloud/v1`, Bearer team key, 90s/request.
