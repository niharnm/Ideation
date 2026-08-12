import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/demo.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/demo.js", import.meta.url), "utf8");

test("demo hub explains AI mediation and exposes restaurant grant and revocation states", () => {
  assert.match(html, /AI asks Egoist/);
  assert.match(html, /id="restaurant"/);
  assert.match(html, /id="revoke-handshake"/);
  assert.match(html, /Fieldline.*restaurant ops/);
  assert.match(html, /live Handshake API proof case/);
  assert.match(app, /fetch\("\/api\/demo"/);
  assert.match(app, /action: "start"/);
  assert.match(app, /action: "revoke"/);
  assert.match(app, /Scoped detail removed/);
});

test("claimant permission screen supports removable constraints, precise expiry, and a new request", () => {
  const claimantHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const claimantApp = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(claimantHtml, /id="expiry" type="datetime-local"/);
  assert.match(claimantHtml, /id="share-new-allergy" checked/);
  assert.match(claimantApp, /selectedFieldIds\.delete\(allergy\.allergenId\)/);
  assert.match(claimantApp, /textContent = "Start a new request"/);
  assert.match(claimantApp, /The claimant started a new request and ended this access\./);
});
