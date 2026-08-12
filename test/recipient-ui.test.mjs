import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/recipient.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/recipient.js", import.meta.url), "utf8");

test("recipient page has an honest empty state and named acknowledgement controls", () => {
  assert.match(html, /id="empty-state"/);
  assert.match(html, /id="acknowledgement-form"/);
  assert.match(html, /id="acknowledger-role"/);
  assert.match(html, /id="acknowledgement-outcome"/);
  assert.match(app, /unverified local preview/);
  assert.match(app, /delivery is pending authenticated recipient transport/);
});

test("recipient proof case defaults to one peanut constraint and no unrelated profile data", () => {
  assert.match(app, /"order\.constraint\.peanut"/);
  assert.doesNotMatch(app, /order\.constraint\.dairy/);
  assert.doesNotMatch(app, /user\.ssn|homeAddress|creditCard/i);
});

test("recipient page builds an acknowledgement only after a decision and marks its handoff as local", () => {
  assert.match(app, /if \(!activeRequest \|\| !activeDecision\)/);
  assert.match(app, /buildAcknowledgementEvent/);
  assert.match(app, /handshake:demo-linked-events/);
  assert.match(app, /delivery is pending authenticated recipient transport/);
  assert.match(app, /handshake:demo-linked-events:v1/);
});

test("recipient page ignores demo bridge storage changes after acknowledgement", () => {
  assert.match(app, /event\.key === HANDSHAKE_CLAIM_STORAGE_KEY/);
  assert.match(app, /event\.key === HANDSHAKE_EVENT_LEDGER_STORAGE_KEY/);
  assert.doesNotMatch(app, /if \(event\.key\) \{\s*renderRequest\(\)/);
});
