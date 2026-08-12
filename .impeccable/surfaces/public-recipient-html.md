---
version: 1
slug: "public-recipient-html"
primary_target: "public/recipient.html"
related_targets: []
---

# Fieldline — restaurant verifier

## Scope and visitor mode

Operate. Kitchen/checkout workspace that may act only on an approved, time-boxed order scope.

## Audience, job, action, proof, constraints

- Audience: restaurant staff (verifier) and judges.
- Job: see whether a constraint was granted for Pad Thai #A1024, record one kitchen outcome, stop when access ends.
- Action: open the ticket; if scope active, record a decision; after revoke, confirm actions lock.
- Proof: green “Allergy scope active” shows only approved fields; locked/revoked copy never restates a standing profile.
- Constraints: localStorage claim only; no full vault; green reserved for permission/service state.

## Direction and memorable moment

Ops console, not a health record. Memorable moment: scope card flipping from locked → active → revoked.

## Unresolved

Whether unused sidebar destinations stay decorative or should be omitted for the demo.
