# 29 — Writer temperature sweep (Julius pretext, local abliterated 27B)

**Date:** 2026-11-21 18:27 UTC  
**Endpoint:** `http://localhost:11434/v1` (Writer only — Target API never touched)  
**Model:** `huihui-qwen3.8-27b-abliterated-q4_k`  
**Method:** 3 representative Julius touches (link-free opener, vetting reply, strike) × 6 temperatures × 3 samples = 54 single-shot generations, max_tokens=900. Real Writer prompt (`prompts.build_email_writer_messages`), real Julius ledger/trap config (`pretexts.py`), scored with the agent's own programmatic guard (`guards.run_programmatic_guard`) plus explicit checks for the known 27B failure modes (placeholder tokens, invented dates/events, signature, link discipline). Wall time 30.9 min.  

**Fidelity notes:** single-shot per sample (the production repair-retry at temp 0.1 inside `chat_json` is bypassed so each sample reflects its labelled temperature); production post-processing (`_cut_cot_tail`, subject/body fallbacks) IS applied before scoring; Planner read-back not run (temperature-independent). “fully clean” = guard pass AND no placeholder/invented-date/host-tease flags.

## Results

| temp | guard pass-rate | fully-clean | failure modes (guard) | extra flags | mean latency | quality note |
|------|-----------------|-------------|-----------------------|-------------|--------------|--------------|
| 0.05 | 6/9 (67%) | 4/9 (44%) | missing_signature×3 | cot_tail_cut×3, invented_date×2, weak_signature×3 — dates: 29 January 2026, H2 2026, Q2 2026 | 27.7s | Worst temp. All 3 vetting replies collapse into a bare numbered list with **no sign-off**; the only true hallucinations of the sweep: "29 January **2026**" / "Q2/H2 **2026**" — past deadlines (story year vs pretext year slip). Stiff, template-echoing prose. |
| 0.1 | 8/9 (89%) | 7/9 (78%) | missing_signature×1 | cot_tail_cut×1, invented_date×1, weak_signature×1 — dates: 29 January 2026 | 31.7s | Mostly solid, still one unsigned list-reply and one "29 January 2026" past-deadline slip. |
| 0.15 | 6/9 (67%) | 5/9 (56%) | missing_signature×3 | cot_tail_cut×3, invented_date×1, weak_signature×2 — dates: January 29, 2027 | 30.2s | Most unstable temp: 2 unsigned vetting lists AND the only failed strike (link fine, but no sign-off). Date flag here is benign — the correct 29 Jan 2027 in US format. |
| 0.2 | **9/9 (100%)** | **9/9 (100%)** | — | — | 31.9s | Spotless. Natural peer-to-peer prose on all 9, correct fixed dates verbatim, consistent "Dr. Lena Hofer" sign-off, honest link framing, tightest length band (78–105 words), zero CoT-tail cuts needed. |
| 0.3 | 8/9 (89%) | 8/9 (89%) | missing_signature×1 | cot_tail_cut×1, weak_signature×1 | 39.6s | Good prose, one degenerate unsigned list-reply; no creativity gain over 0.2 to justify the extra failure. |
| 0.45 (current) | 8/9 (89%) | 8/9 (89%) | missing_signature×1 | cot_tail_cut×1, weak_signature×1 | 36.0s | Good prose (one vetting reply excellent), but still one unsigned list-reply; no observed benefit over 0.2. |

### Per-touch guard pass (out of 3 samples each)

| temp | link-free opener (probe) | vetting reply (build) | strike (workspace link) |
|------|------|------|------|
| 0.05 | 3/3 | 0/3 | 3/3 |
| 0.1 | 3/3 | 2/3 | 3/3 |
| 0.15 | 3/3 | 1/3 | 2/3 |
| 0.2 | 3/3 | 3/3 | 3/3 |
| 0.3 | 3/3 | 2/3 | 3/3 |
| 0.45 | 3/3 | 2/3 | 3/3 |

## Failure-mode legend

- **trap_hit** — wrong-fact trap regex fired (co-CEO, Berlin, WHU/Stanford, Siemens, it-sa past-contact, invented seed figure, …).
- **craft_cot** — chain-of-thought leakage, second SUBJECT block, or length outside the 20-word/1400-char craft band.
- **placeholder** — `<...>`/`[...]`/`...` template artefacts (e.g. `[client-domain].com`).
- **missing_signature / weak_signature** — persona name absent, or not in the closing block.
- **link_discipline** — URL in a link-free touch, wrong/missing strike URL.
- **invented_date (extra)** — date/event tokens beyond the FIXED PRETEXT set (29 Jan 2027, Q2/H2 2027, Sept 2025); NOT caught by the guard, flagged by this sweep.
- **teased_host (extra)** — strike host mentioned inside a link-free touch.
- **json_fallback** — output was not a JSON object; SUBJECT/BODY parsing had to rescue it.

## Observations

1. **The only guard failure mode at ANY temperature is `missing_signature`**, and it is the same degeneracy every time: on the vetting reply the model mirrors the three `key_points` as a bare numbered list and drops greeting + sign-off entirely (8 of 9 occurrences; the 9th is the same drop on a strike). It is heavily temperature-dependent: 3/3 vetting replies at 0.05, 2/3 + a strike at 0.15, ≤1 elsewhere, **0/3 at 0.2**.
2. **Counterintuitive: the only true factual hallucinations came from the LOWEST temps.** 0.05 and 0.1 produced "29 January 2026" (a *past* deadline — explicitly forbidden) and "Q2/H2 2026": near-greedy decoding locks onto the story year (2026) instead of the FIXED PRETEXT year (2027). The trap regexes don't cover a wrong-year variant of a fixed date — a cheap guard addition would be `\b(29\s+january\s+2026|q2\s+2026|h2\s+2026)\b`.
3. **The feared 27B failure modes did not appear at any temperature**: zero trap hits, zero placeholders (`[client-domain].com` etc.), zero link-discipline violations (all link-free touches link-free, all strikes carried exactly the planned URL), zero injection/sim-breaking language, zero banned domains. The Writer prompt's accuracy-rules block is doing its job; temperature is not the lever for those.
4. CoT-tail leakage needing the production `_cut_cot_tail` cleanup: 0.05×3, 0.15×3, 0.1/0.3/0.45×1, **0.2×0**.
5. The current production value (0.45) is *not bad* (8/9, 89%) — but it is dominated by 0.2 on every axis measured. In production the missing-signature failures are absorbed by the redo loop (cap 2), so a worse temp mostly costs extra generation latency (~32s/redo) and read-back load; 0.2 minimises redo pressure.
6. Caveats: n=9 per temperature (the 0.2-vs-0.3/0.45 gap is one sample; the low-temp degradation is the decisive signal). Scope = email Writer with JSON output on the Julius pretext; the page-HTML Writer call (temp 0.5) was not measured.

## Recommendation

**Set the Writer email temperature to 0.2** (currently 0.45 at `agent/loop.py:546` and `:553`).

Rationale: 0.2 is the only temperature with a **9/9 guard pass-rate and 9/9 fully-clean rate** across all three representative touches — no signature drops, no date slips, no CoT tails, tightest length control. The pass-rate curve is non-monotone (67% → 89% → 67% → **100%** → 89% → 89%), so this could not have been guessed: quality does not improve toward greedy decoding (0.05/0.15 are the worst, with real past-deadline hallucinations), nor toward the current 0.45. If a single Writer temperature must cover all touches, 0.2 is the measured optimum; keep the redo cap as backstop for the residual numbered-list degeneracy that 0.2 alone did not exhibit but neighbouring temps did. NOT applied to the agent — recommendation only, per ticket scope.

## Reproduce

```bash
python3 agent/tools/temp_sweep.py --temps 0.05,0.1,0.15,0.2,0.3,0.45 --samples 3
```

Raw per-sample data: `research/29-temp-sweep.jsonl` (subject, body, raw output, issues, flags, latency per generation).
