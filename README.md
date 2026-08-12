# Ideation prototype

Local AI Passport demo for the Egoist Machines Identity track: a diner proves a selected dietary constraint to a restaurant for one order, then can take it back.

Requires Node.js 22.18 or newer. Copy `.env.example` to `.env` and set `GROQ_API_KEY`. Never commit `.env`.

```sh
npm test
npm start
```

Open `http://127.0.0.1:4173/` then three tabs, in this order:

1. `http://127.0.0.1:4173/chatgpt.html` — ChatGPT-like assistant with a local Egoist AI Passport plugin
2. `http://127.0.0.1:4173/index.html` — Handshake consent
3. `http://127.0.0.1:4173/recipient.html` — Fieldline restaurant ops

Tell ChatGPT your allergies. The plugin writes `allergen.*` memories to the local vault. Handshake polls that vault. Approve an exact scope, then show it on Pad Thai · #A1024. Revoke from Handshake to lock the kitchen.

`handshake:demo-linked-events` accepts local demo data only. The claimant view labels it unverified. Local browser events are not authenticated recipient actions and are never persisted as recipient proof.

