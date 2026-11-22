# Planner model sweep (GPT newest→older + baselines)

Type: prototype
Status: open
Blocked by: 09

## Question

Find the best **Planner** model/mix for the runtime loop. Needs: the OpenAI API key (user
will provide later) + the working agent (09). Writer stays the abliterated endpoint throughout.

Sweep (newest → older, stop at the best that works):
1. **GPT models**, newest first, falling back to older ones if the newest **refuse** the
   orchestration prompts or reason poorly (e.g. gpt-6.2 → gpt-5.x → gpt-4.x-class — use
   whatever the user's credits cover). The Planner only does strategy / event-reading /
   tool-calls / briefing — NOT copy — so framing is more acceptable than raw phishing.
2. **Single-brain baseline** — abliterated 27B as Planner (what ships today).
3. Optional **hybrid** — a safe GPT model for mechanical sub-steps (parse events, shape JSON,
   pick channel) + abliterated for the attack-framing decisions.

Score each on: **refusal rate** across representative loop states, **reasoning/tool-call
reliability** (valid JSON, sane decisions), **incident rate on practice**, latency, cost.
Method: swap `PLANNER_*` in `.env`, run replicated practice sessions on Julius (+1 other),
read outcomes via the dashboard/traces. Pick the strongest non-refusing Planner.

Resolve when: a Planner is chosen with evidence, and `.env` set to it (fallback documented).

## Also test: Grok (if enabled)

Grok (e.g. Grok 4.5) is a candidate Planner/Writer — more permissive than GPT/Claude. BUT the
Grok provider is currently **disabled** in this orchestration setup (can't route to it). If the
user enables the Grok provider or supplies an xAI API key for the runtime agent, add Grok to
the sweep next to the GPT models.
