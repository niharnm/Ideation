# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary (claimant):** A diner who already knows their dietary constraints and is about to order food through an AI assistant. They do not want to paste a full health profile into a restaurant, delivery app, or chat history that outlives the meal.

**Verifier (restaurant staff):** A kitchen or checkout operator who needs only the constraint required to prepare one ticket, then must lose access when the order ends or the diner revokes.

**Evaluator (hackathon judges):** Reviewers of the Egoist Machines AI Passport Ideathon (7–12 August 2026). They need to understand the problem, the person, the passport claim, the check moment, and the first version in about one minute, then walk a live three-tab demo.

*Inferred from the Ideathon participant guide and existing demo copy; not a live customer interview.*

## Product Purpose

Egoist Handshake is a local proof case for **AI Passport**: a person carries verified dietary context, grants a restaurant access on purpose for one order, and can take it back.

Success for this entry is that a stranger can name:

1. the diner,
2. the minimum fact being proved (selected dietary constraints),
3. the moment it is checked (consent, then kitchen review),
4. what is never revealed,
5. how access expires or is revoked.

Restaurant allergy handling is the proof case, not the product ceiling. The durable job is claimant-controlled, purpose-bound, revocable disclosure that can travel between an AI chat, a consent surface, and a verifier workspace.

## Positioning

Neighboring products store allergies inside one restaurant profile, one delivery account, or the chat vendor’s memory. This product’s claim is different: **the diner holds the passport; the AI may propose a memory; only an explicit, time-boxed Handshake scope travels to the verifier; the kitchen never receives a standing health record.**

Track for the Ideathon form: **Identity** (minimum necessary fact). Lane: **Build**. Agents-track mechanics (plugin, receipts, expiry) support the identity claim; they are not a second product.

One-sentence entry: *This entry is for a diner, who needs to prove a selected dietary constraint to a restaurant so they can safely fulfill one order without giving away more context than necessary.*

## Operating Context

Judges and builders run a local Node server (`npm start`, port 4173) with three browser tabs:

1. `/chatgpt.html` — ChatGPT-like Groq chat with a fake Egoist AI Passport plugin. Dietary talk is saved to a local vault (`allergen.*`).
2. `/index.html` — Handshake consent. Polls `/api/passport/vault`, lets the diner select fields, set an end time, approve, deny, or revoke.
3. `/recipient.html` — Fieldline restaurant ops. Reads the approved localStorage claim, shows only that scope, records a kitchen decision, locks after revoke/expiry.

Landing `/` (`demo.html`) is the pitch and optional shortcut handshake. Demo data is local and unlabeled as a live delivery-platform integration. `GROQ_API_KEY` lives in gitignored `.env`; the client must never see it.

## Capabilities and Constraints

Confirmed in this repo:

- Chat `POST /api/chat` proxies Groq; missing key returns 503 with a setup message.
- Plugin memories replace the vault’s `allergen.*` set (empty list clears them). Handshake merges those into the claimant vault and auto-selects them.
- Approve writes a scoped claim to localStorage; Fieldline reads that claim, not the full vault.
- Deny shares nothing. Expiry and claimant revoke block later kitchen actions.
- Kitchen can record one of four local outcomes; Handshake can preview an **unverified** receipt. Local events are not authenticated recipient proof.
- MCP parse/sync endpoints exist for the same vault. The ChatGPT tab uses the local plugin path.

Undecided / out of scope for this demo:

- Real Egoist-hosted passport as the source of truth in the ChatGPT clone.
- Authenticated restaurant identity, signed receipts, or DoorDash-class transport.
- Production accounts, billing, or multi-merchant networks.

Terminology to preserve: **AI Passport**, **Handshake**, **claimant**, **recipient**, **scope**, **revoke**, **Fieldline**, **unverified receipt preview**.

## Brand Commitments

- Product family: **Egoist** / **Egoist Machines** / **AI Passport**.
- Consent surface name: **Handshake**.
- Restaurant verifier name: **Fieldline**.
- Voice: plain, specific, no hype. Explain the problem without claiming a live platform integration.
- Binding Ideathon constraints: name one track (Identity) and one lane (Build); show who controls access and what can be revoked; do not treat people as a content database.

## Evidence on Hand

- Ideathon brief: `/Users/vachanbhogi/Desktop/ideathon-information.pdf`
- Demo framing: `docs/claimant-demo.md`, `README.md`
- Live surfaces: `public/chatgpt.html`, `public/index.html`, `public/recipient.html`, `public/demo.html`
- Protocol and vault: `src/` plus `test/*.test.mjs`

Do not fabricate testimonials, customers, benchmarks, or a shipped Egoist production integration.

## Product Principles

1. **Minimum fact, named purpose.** Share only the fields the diner selects, for one order, until a stated end time.
2. **The person stays in control.** Approve, deny, expire, and revoke are first-class; the restaurant cannot keep a standing profile from this flow.
3. **Travel is the point.** Context moves from chat memory → passport vault → Handshake scope → verifier ticket, instead of living inside one app.
4. **Honest demo.** Label local, unverified, and non-integrated behavior. Never put API keys in the client or in git.
5. **Judges can follow it in one minute.** The three-tab path and the passport claim must be obvious without a narrator.

## Accessibility & Inclusion

No product-specific legal standard was contracted. The demo must remain usable with keyboard, visible focus, and `prefers-reduced-motion`, because consent and revocation are high-stakes and judges will use mixed devices.
