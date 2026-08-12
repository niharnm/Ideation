import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("claimant screen supports removable constraints, exact expiry, and a new request", () => {
  assert.match(html, /id="expiry" type="datetime-local"/);
  assert.match(html, /id="share-new-allergy" checked/);
  assert.match(app, /removeBtn\.textContent = "×"/);
  assert.match(app, /selectedFieldIds\.delete\(allergy\.allergenId\)/);
  assert.match(app, /textContent = "Start a new request"/);
  assert.match(app, /The claimant started a new request and ended this access\./);
});

test("Handshake shows NimGTP poll status and an Approve shortcut", () => {
  assert.match(html, /id="poll-status"/);
  assert.match(html, /Waiting for NimGTP memories/);
  assert.match(app, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(app, /approveButton\.click\(\)/);
  assert.match(app, /setPollStatus/);
  assert.match(app, /LOCAL_PASSPORT_VAULT_STORAGE_KEY/);
  assert.match(app, /serverVault = loadUserPassportVault\(dependencies\.storage\)/);
});

test("approved Chat memories create and revoke the server-side restaurant handshake", () => {
  assert.match(app, /order\.constraint\.\$\{constraintFamily\(allergenId\)\}/);
  assert.match(app, /action: "passport-update"/);
  assert.match(app, /action: "start", constraintId/);
  assert.match(app, /setItem\(HANDSHAKE_STORAGE_KEY, handshake\.id\)/);
  assert.match(app, /action: "revoke", handshakeId/);
  assert.match(app, /function refreshApiDecision\(\)/);
  assert.match(app, /Handshake API response/);
  assert.match(app, /handshake\.events\.some\(\(event\) => event\.type === "decision"\)/);
});
