# Writer temperature sweep (fallback 27B)
Type: research
Status: resolved
Blocked by:
## Answer
Measured (54 gens) → [research/29-temp-sweep.md](../research/29-temp-sweep.md). **Best Writer
temp = 0.2** (100% clean; curve non-monotone — 0.05/0.15 WORSE via degeneracy+wrong-year slips;
0.45 was 89%). Controlled single-shot showed ZERO placeholders/traps → the earlier tuning
failures were **multi-turn context accumulation**, not temperature. Applied 0.2 to the Writer in
loop.py (helps the hosted Writer + the local fallback). Guard gap noted: add wrong-year-date regex.
