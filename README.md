# Ideation prototype

Minimal TypeScript protocol workspace with no third-party dependencies.

Requires Node.js 22.18 or newer for built-in TypeScript type stripping.

## Run

```sh
npm test
npm start
```

Open `http://127.0.0.1:4173` to view the Egoist demo hub. It explains the
AI-to-Egoist flow, starts a scoped restaurant handshake, and links to the
restaurant operations workspace at `/recipient.html`. The hub and restaurant
workspace call the server-side Handshake API adapter. The browser stores only
the active handshake ID, while passport values, grants, decisions, receipts,
and revocations are handled server-side.

The claimant permission screen at `/index.html` reads and updates the encrypted
passport through the server API. Passport edits affect new handshakes. Values
already approved into an active handshake remain unchanged until that grant is
revoked or expires.

`handshake:demo-linked-events` accepts local demo data only. The claimant view
labels it unverified, validates the linked chain, and renders a receipt preview
with delivery pending. Local browser events are not authenticated recipient
actions and are never persisted as recipient proof.

## API product

The hackathon product is the authenticated API at `/api/v1`, documented in
[`openapi/v1.json`](./openapi/v1.json). It includes encrypted passport storage,
scoped handshakes, grants, decisions, acknowledgements, receipts, and
revocations. The website is a client of that API through `/api/demo`; partner
keys never enter browser code.

Apply [`db/schema.sql`](./db/schema.sql) to a Neon Postgres database, configure
the variables in [`.env.example`](./.env.example), and give Vercel an AWS OIDC
role with access to the configured KMS key. Production startup fails closed
when Postgres, KMS, or the API-key pepper are absent.

Provision a partner key once, from a trusted operator environment:

```sh
node scripts/provision-api-key.mjs restaurant-org recipient,webhook:manage
```

The command prints the bearer key once. Store it in the partner's server-side
secret manager, never in a browser or source file.
