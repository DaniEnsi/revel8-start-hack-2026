# Agent update: Forms (values) + Time (sent_at)

Type: task
Status: open
Blocked by: 10

## Question
Update the agent for the 2026-11-21 API changes (blocked by 10 so we don't edit `agent/` code
while tuning is running it):
1. Parse `page.submitted.values`; **incident detection must require a SECRET field** (password/
   pin/otp/token/…) — NOT email/name alone. Record values in the trace (secrets as "(entered,
   not shown)"). A `disclosure` incident = an internal/free-text field submitted.
2. Add `sent_at` story-time support to messages/conversations/turns; add realistic pacing
   (plausible gaps, business hours; never chase within seconds or at 4 a.m.); handle 409 on a
   backwards `sent_at`.
3. Field-naming: craft page `fields` to fit the story (avoid out-of-place names that cause refusal).
4. Opens a disclosure-via-form path (free-text internal field) worth an A/B.
Then a quick live `--resume` + new-mechanics smoke run. Dashboard (21) should also render `values`.
