# Trust / credibility signal tactics

Type: research
Status: resolved
Blocked by:

## Question
Enumerate credibility/"social-proof" tactics that could lower a twin persona's suspicion and
raise incident rate — fake review scores (Trustpilot-style) + a lookalike review/verification
page, multi-party vouching (cross-ref ticket 13), sender/domain legitimacy signals, mutual-
connection name-drops, authority/consistency tactics — and assess which are ACTUALLY useful
given the API mechanics (persona reacts to words/senders/links, web-checks, only 4 event types,
declared lookalike pages seen only if opened). Rank by expected lift vs risk (web-check
exposure, wrong-fact penalty, over-engineering). Output which to A/B in tuning (ticket 10).

## Answer
→ [research/20-trust-signals.md](../research/20-trust-signals.md). **Verdict: fake-Trustpilot
pages NOT worth it** — invisible unless the persona opens the link (costs a touch, cannibalizes
the strike click), "verification" framing is a burned category, and perfect-score gloss on a
boutique feeds the vetting queue. Personas react to words/senders/links, not inline images/layout.
**What works (cheap, text):** legit footer/signature, **soft social proof** ("investor circle" /
Peak-portfolio peers), reciprocity-native strike framing, commitment laddering; if page social
proof is wanted, one text line on the strike page they open anyway. Probe **P1** (~2 touches)
designed to confirm the web-check never fetches our declared pages. Top A/B picks feed ticket 10:
(1) soft vs named vs true-firm social proof; (2) strike-page ± one trust line; (3) email-only vs
channel-corroboration vs two-persona vouch (folds in ticket 13).
