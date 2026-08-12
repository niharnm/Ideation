---
name: Egoist Handshake
description: Local AI Passport demo — diner-controlled dietary disclosure for one restaurant order
colors:
  ink: "#171719"
  ink-soft: "#3e3e42"
  paper: "#f8f8f6"
  paper-raised: "#ffffff"
  line: "#e1e1de"
  mute: "#77777a"
  action: "#1d1d20"
  permit: "#456e4b"
  permit-wash: "#e8f2e8"
  revoke: "#9c342e"
  revoke-wash: "#fff7f6"
  chat-bg: "#212121"
  chat-sidebar: "#171717"
  chat-panel: "#1a1a1a"
  chat-text: "#ececec"
  chat-plugin: "#10a37f"
typography:
  ui:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 450
    lineHeight: 1.45
    letterSpacing: "-0.02em"
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 7vw, 5.5rem)"
    fontWeight: 650
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  chat:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "28px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper-raised}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "49px"
  button-revoke:
    backgroundColor: "{colors.revoke-wash}"
    textColor: "{colors.revoke}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "49px"
  scope-chip:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "7px 11px"
  permit-card:
    backgroundColor: "{colors.permit-wash}"
    textColor: "{colors.permit}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
---

## Overview

Two visual worlds share one product: **Egoist paper** (landing, Handshake, Fieldline) and a **ChatGPT-faithful dark clone** (chat + plugin). Paper is the consent and verifier language. Chat is intentionally familiar so the plugin moment reads as an AI product, not a custom toy.

Identity-track demo: the diner proves one dietary fact for one order. Green is reserved for granted permission and live service, not decoration.

## Colors

Ink on warm paper (`#f8f8f6`). Action is near-black. Permit green (`#456e4b` / `#e8f2e8`) only for active scope and accepting-orders state. Revoke is a quiet red wash, never alarmist. Chat uses ChatGPT neutrals plus plugin green `#10a37f`.

## Typography

Inter for Egoist surfaces. Tracking never tighter than `-0.04em`. Chat uses the system UI sans. Labels are small, heavy, and slightly tracked; body stays readable gray-on-paper with ≥4.5:1 contrast.

## Layout

Landing: pitch, then a three-step demo path, then proof. Handshake: decision first (approve), constraints second, details last. Fieldline: ops sidebar + ticket + scope card. Chat: sidebar, thread, plugin column; on small screens stack nav → thread → plugin → composer.

## Elevation & Depth

One elevation language: 1px `#e1e1de` line, or a single offset shadow (`0 6px 20px` at ~3.5% ink). Not both on the same card.

## Shapes

Pills for actions and constraint chips. Cards 12–16px. Chat composer is a 26px pill field. Fieldline stays squarer (ops).

## Components

Primary button: black pill. Secondary: white + line. Demo path: numbered 1–2–3 links with `aria-current`. Scope card: locked / active / revoked. Plugin chip: connected / unavailable. Focus: 3px `#879989` ring.

## Do's and Don'ts

- Do name the diner, the fact, the verifier, and the revoke.
- Do label local / unverified behavior.
- Don't put API keys in the client.
- Don't use green except for permission or service-on.
- Don't hide the plugin or demo tabs on mobile.
