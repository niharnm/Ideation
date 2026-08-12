# Claimant demo and Identity submission framing

## Track framing

Submit this as **Identity**. The central problem is claimant-controlled
disclosure, not restaurant ordering: a person selects the minimum fields for a
specific purpose, approves or denies access, sets a fixed end time, can revoke,
and can review a recorded recipient outcome. Restaurant allergy handling is one
proof case only.

## Live demo

Prerequisite: Node.js 22.18 or newer.

```sh
npm test
npm start
```

1. Open `http://127.0.0.1:4173` in a fresh prototype session. Select only
   `Peanut constraint`, choose `15 minutes`, and select **Approve selected
   fields**.
2. Point out the exact shared field and stated access end time. The page then
   shows **Receipt pending**, because authenticated recipient decision and
   acknowledgement transport is not implemented in this claimant app.
3. Select **Revoke access now**. The page reports that future recipient use is
   blocked. This demonstrates claimant control after approval.
4. Run the test-backed receipt proof:

   ```sh
   node --test test/claimant-receipt.test.mjs test/initiator-e2e.test.mjs
   ```

   These tests cover selected-field minimization, denial, expiry, claimant-only
   revocation, all four recipient outcomes, required changes, and the local
   receipt-preview boundary.
5. To render the local `required_change` preview in a browser, use a fresh
   browser profile or a local origin with no existing prototype events. With
   the app open, run this in that page's developer console:

   ```js
   const { runAllergyOrderingFlow } = await import("/src/index.ts");
   const validFrom = new Date().toISOString();
   const validUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
   const { events } = runAllergyOrderingFlow({
     handshakeId: "local-required-change-demo",
     restaurantName: "Demo recipient",
     validFrom,
     validUntil,
     decisionResponse: "required_change",
     decisionRationale: "A separate preparation surface must be confirmed.",
     requiredChanges: ["Confirm a separate preparation surface."],
     acknowledgerRoleName: "Kitchen manager",
   });
   window.dispatchEvent(
     new CustomEvent("handshake:demo-linked-events", { detail: events }),
   );
   ```

   Show the exact shared fields, recipient outcome, required change, reported
   acknowledgement role, timestamps, current access state, and intended receipt
   recipients. The page must say **Unverified receipt preview** and **Delivery
   pending. No recipient delivery is confirmed.**

## What not to claim

The console event in step 5 is local demo input, not authenticated recipient
action. It is not persisted as recipient proof, does not confirm delivery to a
recipient, and cannot establish a real acknowledgement. Do not describe the
preview as a signed receipt, a recipient-authenticated decision, or delivered
evidence. A production version would require authenticated recipient identity
and transport before making those claims.

## 45 to 60 second pitch

“Identity data is often shared as a standing profile, even when someone only
needs one fact for one moment. This prototype makes disclosure claimant-led:
you choose the exact fields, why they are needed, and when access ends. You can
approve or deny the request, and you can revoke it after approval. The
recipient's decision is recorded as an outcome such as accept, required change,
decline, or cannot determine, with the named acknowledgement role shown in a
claimant preview. The restaurant flow is only a proof case. The underlying idea
is identity that is minimal, purpose-bound, time-bounded, revocable, and
auditable. We are also explicit about the current boundary: local browser demo
events are not recipient-authenticated proof and delivery remains pending.”
