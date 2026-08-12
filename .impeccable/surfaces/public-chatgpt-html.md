---
version: 1
slug: "public-chatgpt-html"
primary_target: "public/chatgpt.html"
related_targets: []
---

# ChatGPT clone — Egoist plugin

## Scope and visitor mode

Operate. Local ChatGPT-like chat where a diner states dietary facts and a fake Egoist AI Passport plugin writes them to the local vault.

## Audience, job, action, proof, constraints

- Audience: diner (demo) and Ideathon judges walking the Identity entry.
- Job: say allergies in natural language; see them saved as passport memories.
- Action: send a message; confirm the plugin list updated; open Handshake next.
- Proof: plugin panel lists `allergen.*` constraints; no API keys in the page.
- Constraints: Groq proxy; 503 if `GROQ_API_KEY` missing; mobile must still show plugin and demo tabs.

## Direction and memorable moment

ChatGPT-familiar dark chrome. The memorable moment is the plugin chip + saved memories updating after “I can’t eat peanuts.”

## Unresolved

Whether a real Egoist OAuth connect belongs on this tab (server supports it; this surface uses the local plugin).
