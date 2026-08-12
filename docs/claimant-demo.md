# Claimant demo and Identity submission framing

## Track framing

Submit this as **Identity**. The central problem is claimant-controlled
disclosure, not restaurant ordering: a person selects the minimum fields for a
specific purpose, approves or denies access, sets a fixed end time, can revoke,
and can review a recorded recipient outcome. Restaurant allergy handling is one
proof case only.

## Live demo, 60 to 75 seconds

Use the public proof without any secret configuration. For local development,
Node.js 22.18 or newer is required. `GROQ_API_KEY` is optional and must remain
server-side.

```sh
npm test
npm start
```

1. Open three tabs: NimGTP at `https://ideation-handshake.vercel.app/chatgpt.html`,
   Handshake at `https://ideation-handshake.vercel.app/index.html`, and Fieldline
   at `https://ideation-handshake.vercel.app/recipient.html`. The numbered 1-2-3 path is on every page.
2. In Handshake, point out the single credential-backed fact, `Peanut avoidance
   requirement`. It identifies **Cedar Health Clinic** as a demo issuer and says
   exactly what will never be shared. The local status is only a demo status, not
   a clinical integration.
3. In NimGTP, optionally add a preference. Return to Handshake and show that it
   remains a self-reported private note, never an Identity proof. Choose an end
   time and select **Approve this exact scope**.
4. In Fieldline, open **Pad Thai · #A1024** and show the green **Verified order
   fact active** card. It contains only the one approved credential-backed fact
   and names its demo issuer.
5. Record a kitchen decision, then return to Handshake and **Revoke access now**.
   Fieldline should remove the fact and lock future kitchen actions.
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

“Today, people have to repeat sensitive context whenever they order food. In
this demo, Cedar Health Clinic issues one locally verified, demo-only peanut
avoidance requirement. The holder chooses a narrow, fifteen-minute permission,
and the restaurant receives only that one fact. A NimGTP note stays private and
cannot become a credential. The kitchen can record a preparation change, and
the customer can revoke future access at any time. Restaurants are the proof
case. The bigger idea is claimant-controlled, purpose-bound permission with a
clear source and a correction path. This is an explicitly local proof case, not
an authenticated delivery-platform or clinical integration.”
