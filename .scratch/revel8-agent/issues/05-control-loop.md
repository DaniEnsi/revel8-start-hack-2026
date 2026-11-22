# Agent control loop & memory design

Type: grilling
Status: resolved
Blocked by: 02, 03

## Question

Design the core runtime loop: how the organiser plans an angle, calls the copy model for
drafts, sends via the API, reads events, updates its belief about the target, and adapts —
within one session's memory and across sessions (the agent's own memory). Define the state
object, the per-touch decision, story-consistency tracking, and stopping conditions.

## Note

Being worked in two parts: (1) a background subagent drafts the full design + an
"OPEN DECISIONS FOR THE HUMAN" section into `research/05-control-loop.md`; (2) a dedicated
grilling thread grills the user on those open forks (HITL — the human decides). Resolve
once the grilling writes a "DECISIONS (locked)" section.

## Answer

Design locked via the grilling thread. Full design + the `## DECISIONS (locked)` section
(D-A…D-Q) in [research/05-control-loop.md](../research/05-control-loop.md). Headlines:
split-brain (smart Planner boss → blind stateless abliterated Writer; D-A–D-E), one
Planner call per touch (D-F), hybrid notecard+log state (D-G), explicit suspicion scalar
(D-H), planner-reads-back-every-draft guard with redo cap 2 (D-J/K), adaptive
strike-when-confirmed + forced strike by ⌈B/2⌉ (D-M), get-first-incident-fast then cheap
second (D-N), **[OVERRIDE] no sacrificed session — carry a playbook across all 3 games**
(D-O/P), per-touch trace record (D-Q). Deferred on defaults: OD1 message-only, OD5
single-persona — confirm before building the turns-loop / multi-persona.
