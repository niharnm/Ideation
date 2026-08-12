# Egoist Handshake presentation and video runbook

## Final position

Public product name: **Egoist Handshake**

Track and lane: **Identity, Build**

One-sentence entry:

> Egoist Handshake lets a diner disclose one credential-backed peanut avoidance requirement to one restaurant for one order, then see the restaurant's response and end access.

The restaurant example is the proof case. The product idea is the Handshake: a reusable, consented exchange between a person and a verifier. Identity is the primary track because the judged moment is minimum disclosure of a fact about a person. Agent-style scope, expiry, revocation, and receipts support that identity exchange, but they are not a second product.

Use **Egoist Handshake** in the recording. Do not call the submitted product Nimbus. Nimbus is the internal project folder.

## What the three pages are

These are not three competing websites. They are three roles in one local product flow:

1. `/chatgpt.html`, **NimGTP**: a ChatGPT-like local test client. It saves only private, self-reported notes and is not a credential source.
2. `/index.html`, **Handshake**: the diner reviews the issuer, exact fact, recipient, purpose, never-shared data, correction path, and end time, then approves, denies, or later revokes access.
3. `/recipient.html`, **Fieldline**: the restaurant sees only the approved fact and its demo issuer, records its kitchen response, and loses the scope after revocation or expiry.

The `/demo.html` page is a landing page and backup shortcut. It explains the idea and can issue a local peanut scope if the chat service is unavailable. The root route, `/`, opens Handshake. The landing page is not a fourth product and should not replace the judged three-page path.

## Verified participant-guide fit

No weighted scorecard is present in this repository, and the original participant PDF is not available on this computer. Do not invent judging weights. The participant-guide details recovered for this project give these judge-facing requirements:

| Guide requirement | What the submission should say or show |
| --- | --- |
| Choose one track and lane | Identity, Build, stated in the first 15 seconds and in the Devpost entry |
| Name the exact user | A diner with a serious dietary constraint |
| State the problem | The restaurant needs one fact for one order, while the diner should not expose a permanent profile |
| State the Passport claim | One credential-backed peanut avoidance requirement from a clearly labeled demo issuer |
| Explain how it works | The issuer attests one fact, the diner approves a scoped grant, the restaurant responds, and access ends |
| Show the AI Passport moment | Pause on Handshake before approval so the exact field, purpose, recipient, and expiry are readable |
| Address privacy and misuse | Minimum disclosure, purpose limits, time limits, revocation, local-demo limits, and no claim of food-safety certification |
| Provide supporting proof | Working video, repository link, live link only after its APIs pass, and current screenshots |
| Make the form stand alone | The Devpost text must explain the problem and system even if a judge watches no video |

The event description also stresses product thinking, clear communication, and a strong use case rather than code volume. The video should therefore spend more time on the disclosure decision and recipient response than on source files.

## Recording setup

### Use the public URLs for the final take

Open one browser window with these tabs in this order:

1. `https://ideation-handshake.vercel.app/demo.html`
2. `https://ideation-handshake.vercel.app/index.html`
3. `https://ideation-handshake.vercel.app/recipient.html`

The first tab is used only for the opening frame. Tabs 2 and 3 are the judged product demonstration. Keep `https://ideation-handshake.vercel.app/chatgpt.html` closed during the final take. NimGTP is an optional private-note surface, not the source of the credential shown in this Identity flow.

Do not keep Devpost, GitHub, the terminal, Vercel, email, or private API settings open in the recorded browser. If an architecture frame is needed, insert the diagram below during editing rather than changing to source code mid-demo.

### Hard preflight gates

The recording is ready only when all of these are true:

- The checkout is the current `develop` branch.
- `npm test` passes.
- `npm run build` passes.
- A rehearsal completes scope approval, kitchen response, revocation, and recipient lock.
- Only the peanut constraint is present and selected.
- Browser notifications, bookmarks, password prompts, and unrelated tabs are hidden.

Suggested local commands:

```sh
npm install
npm test
npm run build
lsof -i:4173
npm start
```

If port 4173 is occupied, stop only the known old demo process or use another explicit port. Restarting the local server clears its in-memory demo state. Reload all three tabs after the restart.

Verified state on 2026-08-12:

- Re-run the checks and public rehearsal after the final deployment before recording. Do not quote this file as live evidence.

## Final demonstration state

Use one fact, one order, one time window, and one restaurant response:

- Fact: Peanut avoidance requirement, issued by Cedar Health Clinic as a local demo credential.
- Order context: Pad Thai, order `#A1024`.
- Recipient: Fieldline restaurant operations.
- Purpose: prepare this restaurant order.
- Expiry: 15 minutes after approval.
- Restaurant outcome: request a preparation change.
- Preparation detail: `Use a dedicated surface and replace the peanut garnish.`

Do not add milk, vegetarian preference, or another allergy during the video. The code and tests cover multiple fields and scope isolation. The judged flow is clearer with one selected fact.

## Architecture frame

Use this as a simple inserted frame for about 15 seconds:

```text
Cedar Health Clinic demo issuer
      |
credential-backed peanut avoidance requirement
      |
Handshake consent and versioned /api/v1 service
      |
Fieldline restaurant verifier
```

The API implementation includes an authenticated `/api/v1` boundary for passports, handshakes, grants, decisions, acknowledgements, receipts, and revocations. The browser proof also has local demo routes. Production configuration is designed for Neon Postgres and AWS KMS through Vercel OIDC, and it fails closed when required production settings are absent.

Groq is configured only for the optional NimGTP private-note surface, and its key stays in Vercel's sensitive environment storage. Self-reported NimGTP notes are not accepted as the credential shown in the judged flow. No secret may appear in the browser, recording, repository, or Devpost text. Rotate the current key after recording because it was shared in chat during setup.

## Exact video plan

Target edited length: **2 minutes 25 seconds**. If the submission page states a shorter limit, cut the architecture frame first and keep the complete consent flow.

Record the screen demonstration once without talking. Then record Nihar and Vachan's voice lines separately in a quiet room and place them over the screen capture. This prevents clicks and page-loading time from forcing rushed speech.

### 0:00 to 0:16, problem and entry

**Screen:** Demo landing page. Keep the headline and Identity track label visible. Do not click yet.

**Nihar:**

> A restaurant needs to know about a serious dietary constraint, but it does not need a person's whole profile forever. Egoist Handshake lets a diner disclose one selected fact to one restaurant for one order, then take that access back.

### 0:16 to 0:38, credential source

**Screen:** Switch to Handshake. Pause on the credential-backed fact card, issuer, local demo status, and never-shared list.

**Nihar:**

> Cedar Health Clinic is a clearly labeled demo issuer. It provides one peanut avoidance requirement, not a medical record. The card also says what will never travel: diagnosis, medical records, chat history, and other dietary notes.

### 0:38 to 1:02, the judged AI Passport moment

**Screen:** Stay on Handshake. Set the expiry to 15 minutes from now. Pause so the issuer, recipient, purpose, exact field, and expiry can be read. Click **Approve this exact scope**.

**Nihar:**

> This is the AI Passport decision. Fieldline is asking for the peanut avoidance requirement only, for this order, until this exact time. A private NimGTP note cannot become a credential. I can deny the request, approve this scope, or revoke it later. I will approve it now.

### 1:02 to 1:31, recipient response

**Screen:** Switch to Fieldline. Pause on **Verified order fact active**, the one approved fact, and the demo issuer. Select **Request preparation change**. Enter `Use a dedicated surface and replace the peanut garnish.` Click **Record kitchen decision**.

**Vachan:**

> Fieldline now sees one verified order fact, not a permanent customer profile. The permission is tied to Pad Thai order A1024 and its remaining time. The kitchen cannot silently treat disclosure as a guarantee. It records a response, here a required preparation change, and the diner can see that response.

### 1:31 to 1:50, revocation has an effect

**Screen:** Return to Handshake. Show the recorded kitchen result, then click **Revoke access now** and confirm. Return to Fieldline and pause on **Access ended by customer** and **Scope removed**.

**Vachan:**

> The response closes the loop. Now the diner revokes the grant. Fieldline immediately loses the allergy detail, and future kitchen actions using that scope are locked. Revocation changes recipient behavior; it is not just a label in account settings.

### 1:50 to 2:13, API and integration boundary

**Screen:** Insert the architecture frame. Do not show `.env` or terminal output.

**Nihar:**

> The judged fact comes from our clearly labeled local demo issuer, not from chat memory. Our versioned Handshake API handles passports, scoped grants, decisions, acknowledgements, expiry, and revocation. We did not have access to a documented Egoist production API, so our local AI Passport adapter stands in for that connection. Groq powers only the optional private-note client through a server-side route, so its key never reaches the browser.

### 2:13 to 2:25, close

**Screen:** End on the Handshake result or the landing headline. Add a small caption: `Identity, Build | One fact. One order. Revocable access.`

**Vachan:**

> The restaurant is our proof case. The same Handshake pattern can connect a person-controlled passport fact to any verifier that must state what it did with temporary access.

## Presenter responsibilities

### Nihar

- Open with the user problem and track fit.
- Drive the Handshake consent screen.
- Explain minimum disclosure, purpose, expiry, and revocation choices.
- Give the honest API and Egoist-access explanation.
- Control the recorded browser so Vachan can focus on delivery.

### Vachan

- Explain the restaurant's verifier role.
- Drive or narrate the Fieldline decision and the effect of revocation.
- Explain why the system records a response instead of promising food safety.
- Deliver the final generalization beyond restaurants.

Both presenters should say **Fieldline**, **one order**, and **one approved constraint** consistently. Neither presenter should switch between Agents and Identity tracks.

## Exact language for the Egoist API limitation

Use this answer in the video or judge questions:

> We did not have access to a documented Egoist production API during the build. We therefore created the boundary we would need: a clearly labeled local demo issuer, a local AI Passport adapter, MCP tools for private notes, and a versioned Handshake API for grants and recipient responses. We are demonstrating that adapter in this browser-local proof, not claiming an Egoist-hosted connection. With production access, the hosted passport provider replaces the local adapter while the consent, scoping, decision, expiry, and revocation rules remain.

Do not say, `We could not finish because Egoist gave us no API.` The product is still a complete local Build-lane proof. The missing hosted connector is a named integration boundary, not a hidden failure.

## Claims to make and claims to avoid

| Say this | Do not say this |
| --- | --- |
| Local ChatGPT-like test client, with optional server-side Groq responses | This is ChatGPT or an official ChatGPT plugin |
| Local Egoist-style plugin and MCP adapter | This is connected to Egoist's production passport |
| Working browser-local proof with a versioned API | This is a production restaurant or Egoist integration |
| Restaurant records its response | The system certifies that food is safe |
| Unverified local receipt preview | Cryptographically signed production receipt |
| Restaurant or delivery-marketplace integration pattern | Live DoorDash or restaurant integration |
| Production design uses Neon and AWS KMS when configured | The local browser demo stores all data in production infrastructure |
| Revocation blocks future use in this proof | Revocation can erase information already observed by a real recipient |

## Likely judge questions

### Why Identity instead of Agents?

**Nihar:**

> The primary event is a person proving the minimum necessary fact about themselves to a verifier. Scope, expiry, revocation, and the recipient response are agent-style mechanics that make that identity disclosure accountable, but the entry itself is Identity.

### Why is this better than saving an allergy in a restaurant profile?

**Vachan:**

> A permanent profile gives the recipient continuing access and weak purpose boundaries. A Handshake makes the field, order, recipient, and end time explicit, and it records the recipient's response.

### Does this guarantee a safe meal?

**Vachan:**

> No. It prevents silent ambiguity in the information exchange. The kitchen can confirm, request a change, decline, or say it cannot determine. A production deployment would still require restaurant procedures and legal review.

### What is actually built?

**Nihar:**

> The three-role browser flow, local passport memory adapter, consent and revocation behavior, recipient decision and acknowledgement flow, versioned API, production storage and encryption boundary, and automated tests are built. The Egoist-hosted connector, authenticated restaurant identity, and production-signed receipt are not claimed.

### Can the restaurant keep the fact after seeing it?

**Nihar:**

> Software cannot make a human forget something already displayed. Revocation blocks future retrieval and actions through this grant. A production policy would also define retention and audit duties for the recipient.

### Why start with restaurants?

**Vachan:**

> It gives a concrete decision with real consequences, a clear minimum fact, a short purpose window, and an observable recipient response. That makes the broader Handshake rule easy to test.

## Editing and submission checklist

- Record at 1440p or higher with browser zoom between 100 and 110 percent.
- Keep the cursor still while text is being read.
- Leave about one second after every state change before switching tabs.
- Add captions for every spoken line.
- Keep background music absent or very low.
- Do not speed up the consent or revocation moment.
- Use the current screenshots in `photos/` as Devpost stills and the public video as the end-to-end proof.
- Keep the Devpost track, first sentence, video, repository description, and live-link description consistent.
- State `browser-local interactive proof` beside the live link so judges understand the integration boundary.
- Accept the event terms only after both team members review the final entry.
- Submit only after replaying the uploaded video from its public URL in a signed-out browser.

## Final readiness decision

The product links and script are ready for the judged recording after the hard preflight gates pass on the final deployment. Start the final take with cleared site data, reload all three tabs, and run one rehearsal immediately before recording. Rotate the Groq key after the final take.
