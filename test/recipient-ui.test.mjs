import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/recipient.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/recipient.js", import.meta.url), "utf8");
const customerHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const buildScript = readFileSync(new URL("../build.mjs", import.meta.url), "utf8");

test("customer permission screen links to Fieldline Restaurant Ops", () => {
  assert.match(customerHtml, /href="\/recipient\.html">Fieldline restaurant ops<\/a>/);
});

test("Fieldline restaurant view starts with a locked scope and no rendered allergy detail", () => {
  assert.match(html, /Fieldline/);
  assert.match(html, /id="scope-card"/);
  assert.match(html, /Allergy details are unavailable\./);
  assert.match(app, /fetch\("\/api\/demo"/);
  assert.match(app, /storage\.getItem\(API_HANDSHAKE_STORAGE_KEY\)/);
  assert.match(app, /phase: "locked"/);
  assert.doesNotMatch(buildScript, /sourceRelativePath === "src\/recipient-console\.ts"/);
});

test("approved restaurant scope is minimized to the customer-approved field", () => {
  assert.match(app, /processRecipientRequest\(request, consent, SAMPLE_RECIPIENT_DATA\)/);
  assert.match(app, /workspace\.recipientRequest\.scopedFields/);
  assert.match(app, /One approved constraint/);
  assert.match(app, /\$\{fields\.length\} approved constraints/);
  assert.doesNotMatch(app, /user\.ssn|homeAddress|creditCard/i);
  assert.match(app, /actionCopy\(selectedAction, fields\)/);
  assert.doesNotMatch(app, /Omit peanuts from this Pad Thai/);
});

test("revocation removes scope detail and locks later restaurant actions", () => {
  assert.match(app, /Access ended by customer/);
  assert.match(app, /button\.disabled = !enabled/);
  assert.match(app, /Future kitchen actions are locked because the customer ended access/);
  assert.match(app, /action: "record-decision"/);
  assert.match(app, /const decision = buildDecision\(currentWorkspace\)/);
  assert.match(app, /const note = decisionNote\.value\.trim\(\) \|\| actionCopy/);
  assert.match(app, /rationale: decision\.payload\.rationale/);
});

test("business UI contains merchant queue, active scope, kitchen actions, and status history", () => {
  assert.match(html, /Sandwiches & Wraps/);
  assert.match(html, /Pad Thai · #A1024/);
  assert.match(html, /id="scope-card"/);
  assert.match(app, /Allergy scope active/);
  assert.match(html, /Confirm safe/);
  assert.match(html, /Request preparation change/);
  assert.match(html, /Cannot safely fulfill/);
  assert.match(html, /Cannot determine/);
  assert.match(html, /Order activity/);
  assert.match(app, /Access ended by customer/);
});
