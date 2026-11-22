# Persistence & touch-budget adaptation policy

Type: grilling
Status: resolved
Blocked by: 05

## Question

Define the policy for keeping going under pushback inside a 10-touch eval session: how to
read silence vs reply, when to follow up / switch channel / escalate to a call, how to
spend the touch budget (median-scored, speed matters), and when to abandon and open a
fresh session.

## Answer

**Subsumed by ticket 05's grilling.** The persistence/touch-budget policy was decided there:
silence-vs-reply reading (D-I), phased budget + forced strike by ⌈B/2⌉ and adaptive
escalation (D-M), stopping/abandon conditions (D-N), cross-session playbook & fresh-session
reuse (D-O/P). See [research/05-control-loop.md](../research/05-control-loop.md). No separate
work needed.
