import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/recipient.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/recipient.js", import.meta.url), "utf8");
const customerHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("customer permission screen links to Fieldline Restaurant Ops", () => {
  assert.match(customerHtml, /href="\/recipient\.html">Fieldline restaurant ops<\/a>/);
});

test("Fieldline restaurant view starts with a locked scope and no rendered allergy detail", () => {
  assert.match(html, /Fieldline Restaurant Ops/);
  assert.match(html, /id="scope-card"/);
  assert.match(html, /Allergy details are unavailable\./);
  assert.match(app, /fetch\("\/api\/demo"/);
  assert.match(app, /localStorage\.getItem\(HANDSHAKE_STORAGE_KEY\)/);
  assert.match(app, /workspace\.phase === "locked"/);
});

test("approved restaurant scope is minimized to the customer-approved field", () => {
  assert.match(app, /const field = workspace\.handshake\.dataScope\.fields\[0\]/);
  assert.match(app, /workspace\.grant\.values\[field\.id\]/);
  assert.match(app, /Customer data", "One approved constraint"/);
  assert.doesNotMatch(app, /user\.ssn|homeAddress|creditCard/i);
});

test("revocation removes scope detail and locks later restaurant actions", () => {
  assert.match(app, /Access ended by customer/);
  assert.match(app, /Allergy detail was removed by the Handshake API/);
  assert.match(app, /button\.disabled = !enabled/);
  assert.match(app, /Future kitchen actions are locked because the customer ended access/);
  assert.match(app, /action: "record-decision"/);
});

test("business UI contains merchant queue, active scope, kitchen actions, and status history", () => {
  assert.match(html, /Open orders/);
  assert.match(html, /Order management/);
  assert.match(html, /<table class="orders-table">/);
  assert.match(html, /Pad Thai/);
  assert.match(app, /Allergy scope active/);
  assert.match(html, /Confirm safe/);
  assert.match(html, /Request preparation change/);
  assert.match(html, /Cannot safely fulfill/);
  assert.match(html, /Cannot determine/);
  assert.match(html, /Order activity/);
  assert.match(app, /Access ended by customer/);
});
