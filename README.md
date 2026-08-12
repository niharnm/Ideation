# Ideation prototype

Local AI Passport demo for the Egoist Machines Identity track: a diner presents one credential-backed peanut avoidance requirement to a restaurant for one order, then can take it back.

The public proof is at `https://ideation-handshake.vercel.app/demo.html`. Its judged path is:

1. `https://ideation-handshake.vercel.app/chatgpt.html`, NimGTP with a local Egoist-style passport adapter
2. `https://ideation-handshake.vercel.app/index.html`, Handshake consent
3. `https://ideation-handshake.vercel.app/recipient.html`, Fieldline restaurant ops

For local development, use Node.js 22.18 or newer. A server-side Groq response is optional. Copy `.env.example` to `.env` and set `GROQ_API_KEY` to use it. Without that key, dietary prompts use the browser-local demo adapter. Never commit `.env`.

```sh
npm test
npm run typecheck
npm start
```

Open `http://127.0.0.1:4173/demo.html` for the demo hub, then use these three tabs:

1. `http://127.0.0.1:4173/chatgpt.html`, ChatGPT-like assistant with a local Egoist AI Passport plugin
2. `http://127.0.0.1:4173/index.html`, Handshake consent
3. `http://127.0.0.1:4173/recipient.html`, Fieldline restaurant ops

NimGTP can save private, self-reported dietary notes. The judged Identity flow
does not treat those notes as proof. Handshake presents a locally verified demo
credential from Cedar Health Clinic for one peanut avoidance requirement,
creates an order-scoped grant only after explicit approval, and Fieldline
retrieves only that fact for Pad Thai · #A1024. Revoke from Handshake to lock
later kitchen actions.

`handshake:demo-linked-events` accepts local demo data only. The claimant view labels it unverified. Local browser events are not authenticated recipient actions and are never persisted as recipient proof.

The hub, claimant screen, and restaurant workspace call the Handshake demo API
adapter. The browser-local passport supplies new request fields. The API adapter
handles the scoped grant, decision, acknowledgement, and revocation shown in the
proof. Passport edits affect new handshakes. Values already approved into an
active handshake remain unchanged until that grant is revoked or expires.

## API product

The hackathon product is the authenticated API at `/api/v1`, documented in
[`openapi/v1.json`](./openapi/v1.json). It includes encrypted passport storage,
scoped handshakes, grants, decisions, acknowledgements, receipts, and
revocations. The website is a client of that API through `/api/demo`; partner
keys never enter browser code.

Apply [`db/schema.sql`](./db/schema.sql) to a Neon Postgres database, configure
the variables in [`.env.example`](./.env.example), and give Vercel an AWS OIDC
role with access to the configured KMS key. Production startup fails closed
for `/api/v1` when Postgres, KMS, or the API-key pepper are absent. The explicitly
local website proof uses a separate in-memory demo service.

Provision a partner key once, from a trusted operator environment:

```sh
node scripts/provision-api-key.mjs restaurant-org recipient,webhook:manage
```

The command prints the bearer key once. Store it in the partner's server-side
secret manager, never in a browser or source file.
