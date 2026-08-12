# Ideation prototype

Minimal TypeScript protocol workspace with no third-party dependencies.

Requires Node.js 22.18 or newer for built-in TypeScript type stripping.

## Run

```sh
npm test
npm start
```

Open `http://127.0.0.1:4173` to review a scoped request, approve or deny it,
and revoke an active claim. The prototype emits `handshake:event` browser
events. Recipient decisions remain outside this app.

`handshake:demo-linked-events` accepts local demo data only. The claimant view
labels it unverified, validates the linked chain, and renders a receipt preview
with delivery pending. Local browser events are not authenticated recipient
actions and are never persisted as recipient proof.
