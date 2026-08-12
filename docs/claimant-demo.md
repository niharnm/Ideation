# Claimant demo and Identity submission framing

## Track framing

Submit this as **Identity**. The central problem is claimant-controlled
disclosure, not restaurant ordering: a person selects the minimum fields for a
specific purpose, approves or denies access, sets a fixed end time, can revoke,
and can review a recorded recipient outcome. Restaurant allergy handling is one
proof case only.

## Live demo, 60 to 75 seconds

Prerequisite: Node.js 22.18 or newer. Copy `.env.example` to `.env` and set
`GROQ_API_KEY`.

```sh
npm test
npm start
```

1. Open three tabs: ChatGPT at `http://127.0.0.1:4173/chatgpt.html`, Handshake
   at `http://127.0.0.1:4173/index.html`, and checkout at
   `http://127.0.0.1:4173/recipient.html`. The numbered 1–2–3 path is on every page.
2. In ChatGPT, say you don't like milk and can't eat peanuts (or tap a suggestion).
   The Egoist AI Passport plugin saves those memories locally.
3. Return to Handshake. The new constraints appear within a few seconds, labeled
   From ChatGPT. Choose an end time and select **Approve this exact scope**.
4. In Fieldline checkout, open **Pad Thai · #A1024** and show the green
   **Allergy scope active** card. It contains only the approved constraints.
5. Record a kitchen decision, then return to Handshake and **Revoke access
   now**. Fieldline should lock future kitchen actions.
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
