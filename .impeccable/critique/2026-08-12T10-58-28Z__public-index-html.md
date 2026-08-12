---
target: index.html Handshake
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-08-12T10-58-28Z
slug: public-index-html
---
# Critique — Egoist Identity demo (post-fix)

Operate: ChatGPT, Handshake, Fieldline. Persuade: landing.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Plugin chip and vault hint exist; Handshake still polls silently until memories arrive |
| 2 | Match System / Real World | 3 | Identity diner/verifier language is in place; receipt preview still uses protocol jargon |
| 3 | User Control and Freedom | 3 | Deny, revoke, new request, modal cancel; no undo on vault remove besides re-add |
| 4 | Consistency and Standards | 3 | Shared 1–2–3 path; ChatGPT dark clone vs paper worlds are intentional |
| 5 | Error Prevention | 3 | Expiry required, 503 without key, duplicate constraint; empty approve still possible until protocol rejects |
| 6 | Recognition Rather Than Recall | 3 | Suggestion chips, From ChatGPT badges, numbered demo path |
| 7 | Flexibility and Efficiency | 2 | Enter-to-send and suggestions; no keyboard shortcut for Approve |
| 8 | Aesthetic and Minimalist Design | 3 | Cleaner hierarchy; Handshake still carries a decorative ingredient strip |
| 9 | Error Recovery | 3 | 503 and offline copy name the fix; receipt errors are still technical |
| 10 | Help and Documentation | 3 | Landing one-minute sentence and next-step after save; no in-page judge script beyond the path |
| **Total** | | **29/40** | **Good** |

## Design Specificity Verdict

**LLM assessment**: Two authored worlds — ChatGPT-faithful plugin chrome and Egoist paper consent/ops. The Identity claim (one fact, one order, revocable) is now the landing sentence. Not category-interchangeable once the three-tab path is visible.

**Deterministic scan**: Detector exit 2 on all four HTML files. Almost all findings are `design-system-*` advisories (inline literals vs a compact DESIGN.md) plus Inter `overused-font` / `single-font` on Operate paper surfaces. False positives for this demo: Inter is the committed Operate face; ChatGPT system stack is intentional clone fidelity. One real warning: Roboto in the ChatGPT stack (now declared in DESIGN.md).

**Visual overlays**: No reliable user-visible overlay. Browser visualization skipped (no browser tool in this nested run). Fallback: CLI `detect.mjs --json` on the four HTML files.

## Overall Impression

The demo can be walked without a narrator. Biggest remaining gap is Handshake density versus the single decision (approve this scope).

## What's Working

- Numbered Chat → Handshake → Fieldline path on every surface
- Plugin memories labeled and de-duplicated against default peanut/dairy chips
- Fieldline locked / active / revoked as the verifier moment

## Priority Issues

- **[P1] Handshake still asks for a decision above a long decorative stage** — Why: judges may miss expiry and field selection. Fix: keep approve first, collapse the ingredient strip on small screens (already hidden at 520px). Suggested: `$impeccable distill`
- **[P2] Receipt preview is protocol-heavy** — Why: unverified delivery language is honest but slow. Fix: lead with outcome + revoke. Suggested: `$impeccable clarify`
- **[P2] Fieldline sidebar destinations are inert** — Why: looks broken to Riley. Fix: keep as ops chrome or mark demo-only. Suggested: `$impeccable distill`
- **[P3] Inter on paper surfaces** — Detector slop warning; Operate permission to keep a workhorse sans. Suggested: none

## Persona Red Flags

**Jordan (judge, first-timer)**: Mitigated by 1–2–3 path and landing sentence. Still must discover that Handshake polls every 3s.

**Casey (mobile)**: ChatGPT plugin now stacks above the composer; landing nav no longer hides. Handshake header wraps.

**Sam (keyboard)**: Focus rings added; modal Esc already existed. Approve is a large button, not a default form submit.

**Diner-claimant**: Remove still has no confirm; low risk because re-add exists.

## Minor Observations

- Landing shortcut handshake can still skip ChatGPT (intentional if Groq is down)
- Chat suggestion chips fill the composer rather than auto-send (safer)

## Questions to Consider

- Should the judged path disable the landing shortcut entirely?
- Should Handshake hide default local constraints until ChatGPT has spoken?

## Cognitive load

Failed: progressive disclosure on Handshake (details + vault editor + deny all visible). 1 failure = low-moderate.
