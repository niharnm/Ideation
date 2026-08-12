# Claimant demo and Identity submission framing

## Track framing

Submit this as **Identity**. The central problem is claimant-controlled
disclosure, not restaurant ordering: a person selects the minimum fields for a
specific purpose, approves or denies access, sets a fixed end time, can revoke,
and can review a recorded recipient outcome. Restaurant allergy handling is one
proof case only.

## Live demo, 45 to 60 seconds

Prerequisite: Node.js 22.18 or newer.

```sh
npm test
npm start
```

1. Open the claimant view at `http://127.0.0.1:4173/` and the staff view at
   `http://127.0.0.1:4173/recipient.html` in separate tabs. Use a fresh local
   session.
2. In the claimant tab, keep the single default constraint, `Peanut
   constraint`, select `15 minutes`, and choose **Approve selected fields**.
   Point out the one shared field, stated purpose, and access end time.
3. In the staff tab, show that only the approved peanut constraint appears.
   Choose **Required change**, enter the preparation or substitution detail,
   enter a named acknowledgement role such as `Kitchen manager`, and submit.
4. Return to the claimant tab. Show the required change, named role, access
   end, and the labels **Unverified receipt preview** and **Delivery pending.
   No recipient delivery is confirmed.**
5. Select **Revoke access now** in the claimant tab. Return to the staff tab
   and show there is no active request. This demonstrates that later staff
   actions are blocked after claimant revocation.
6. Keep automated tests as fallback evidence, not the main demo:

   ```sh
   npm test
   ```

   The test suite covers selected-field minimization, denial, expiry,
   claimant-only revocation, all four recipient outcomes, required changes,
   acknowledgement, and the local receipt-preview boundary.

## What not to claim

The two-tab demo bridge is local demo input, not authenticated recipient action.
It does not confirm delivery to a recipient or establish a real acknowledgement.
Do not describe the preview as a signed receipt, recipient-authenticated
decision, delivered evidence, or a DoorDash integration. A production version
would require authenticated recipient identity and transport before making
those claims.

## 45 to 60 second pitch

“Food ordering often asks people to expose more health information than a
restaurant needs, and special-request boxes are inconsistent. Here, the
claimant shares one fact, a peanut constraint, for one order and 15 minutes.
The staff view receives only that field, records a required preparation change,
and adds a named acknowledgement role. Back on the claimant side, the person
can see that outcome and revoke access immediately. Restaurant ordering is the
proof case. The Identity idea is minimal, purpose-bound, time-bounded,
revocable disclosure with an auditable outcome. This two-tab bridge is an
explicitly unverified local preview, not recipient-authenticated delivery or a
DoorDash integration.”
