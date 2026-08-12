# Claimant demo and Identity submission framing

## Track framing

Submit this as **Identity**. The central problem is claimant-controlled
disclosure, not restaurant ordering: a person selects the minimum fields for a
specific purpose, approves or denies access, sets a fixed end time, can revoke,
and can review a recorded recipient outcome. Restaurant allergy handling is one
proof case only.

## Live demo, 60 to 75 seconds

Prerequisite: Node.js 22.18 or newer.

```sh
npm test
npm start
```

1. Open the customer permission screen at `http://127.0.0.1:4173/`. Explain
   that the customer talks to an AI, and Egoist asks for a narrow permission
   for one restaurant order.
2. Keep the default **Peanut constraint**, choose the displayed end time, and
   select **Approve this exact scope**. Point out that the permission is
   temporary and limited to the selected field.
3. Select **Fieldline restaurant ops** in the header. In the Fieldline order
   queue, open **Pad Thai · #A1024** and show the green **Allergy scope active**
   card. It contains only the approved constraint, the order purpose, context,
   and remaining access time.
4. In **Kitchen decision**, choose **Request preparation change** and record
   the prefilled peanut-free preparation surface and substitution detail. This
   is a local proof-case decision for the active order scope only.
5. Return to the customer screen with **View customer permission**, select
   **Revoke access now**, then return to Fieldline. Show the red **Access ended
   by customer** state: the allergy detail is gone and future kitchen actions
   are locked.
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

“Today, people have to repeat sensitive context whenever they order food. With
Egoist, they simply ask their AI to order Thai food and mention a peanut
allergy. The AI asks Egoist for a narrow, fifteen-minute permission, and the
restaurant receives only the one constraint needed for this order. The kitchen
can record a preparation change, and the customer can revoke future access at
any time. Restaurants are the proof case. The bigger idea is AI-mediated,
purpose-bound, revocable permission for any context a person chooses to share.
This is an explicitly local proof case, not an authenticated delivery-platform
integration.”
