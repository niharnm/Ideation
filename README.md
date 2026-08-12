# Ideation prototype

Minimal TypeScript protocol workspace with no third-party dependencies.

Requires Node.js 22.18 or newer for built-in TypeScript type stripping.

## Run

Copy `.env.example` to `.env` and set `GROQ_API_KEY`. Never commit `.env`.

```sh
npm test
npm start
```

Open three tabs:

- `http://127.0.0.1:4173/chatgpt.html` — ChatGPT-like assistant with a local Egoist AI Passport plugin
- `http://127.0.0.1:4173/index.html` — Handshake consent
- `http://127.0.0.1:4173/recipient.html` — restaurant checkout

Tell ChatGPT your allergies. The plugin writes them to the local vault.
Handshake polls that vault, and an approved scope appears at checkout.

`handshake:demo-linked-events` accepts local demo data only. The claimant view
labels it unverified, validates the linked chain, and renders a receipt preview
with delivery pending. Local browser events are not authenticated recipient
actions and are never persisted as recipient proof.
