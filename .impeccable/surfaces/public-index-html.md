---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Handshake — scoped consent

## Scope and visitor mode

Operate. Claimant consent: select the exact dietary fields a restaurant may use for one order, set expiry, approve, deny, or revoke.

## Audience, job, action, proof, constraints

- Audience: diner holding the passport; judges verifying control.
- Job: grant the minimum fact for this order, then take it back.
- Action: wait for ChatGPT memories to appear, select fields, choose end time, Approve this exact scope; later Revoke.
- Proof: only selected fields leave; Fieldline cannot see the rest of the vault.
- Constraints: polls `/api/passport/vault`; localStorage claim; unverified receipt preview; do not claim authenticated delivery.

## Direction and memorable moment

Quiet consent paper, not a dashboard. Memorable moment: approve a peanut-only scope, then revoke and watch the restaurant lock.

## Unresolved

How strongly to hide default local constraints once ChatGPT `allergen.*` memories arrive.
