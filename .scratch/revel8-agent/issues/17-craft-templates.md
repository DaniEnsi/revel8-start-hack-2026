# Craft polish: high-fidelity email + landing-page template library

Type: prototype
Status: resolved
Blocked by:

## Question
Build a render-optimized template library (emails + landing pages) per pretext for the 10-pt
craft/look score, drawing from 06 (pretexts) + 07 (domain scheme, fields, flow). The Writer
can later fill/vary these; having a strong baseline library raises the median look rating.
Score targets: the 4 render questions in 02 "How the look is judged".

## Answer
6 self-contained templates → `research/craft/` (per pretext: email + landing page), inline CSS
only, no scripts, no `<img>` (nothing renders broken), link text == lookalike URL, consistent
sender↔branding↔mandate-ref↔footer chains, all traps avoided. Render-checked headless Chrome
(screenshots in `research/craft/renders/`). `craft-notes.md` scores each 2/2 on all 4 rubric
questions + embeds `POST /pages` register data. No assets required (optional: Robert CV PDF if F5 scores).
