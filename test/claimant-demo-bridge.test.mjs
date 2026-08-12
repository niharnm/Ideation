import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("claimant demo bridge accepts only named local preview payloads and consumes them", () => {
  assert.match(app, /handshake:demo-linked-events:v1/);
  assert.match(app, /function readLocalDemoLinkedEvents\(value\)/);
  assert.match(app, /payload\.handshakeId/);
  assert.match(app, /payload\.events/);
  assert.match(app, /event\.handshakeId !== payload\.handshakeId/);
  assert.match(app, /window\.localStorage\.removeItem\(LOCAL_DEMO_LINKED_EVENTS_STORAGE_KEY\)/);
  assert.match(app, /showLocalDemoPreview\(preview\.handshakeId, preview\.events\)/);
});

test("claimant live demo defaults to one peanut constraint", () => {
  assert.match(
    app,
    /id: "order\.constraint\.peanut", label: "Peanut constraint", selected: true/,
  );
  assert.match(
    app,
    /id: "order\.constraint\.dairy", label: "Dairy constraint", selected: false/,
  );
  assert.match(app, /Prepare one restaurant order from the constraint you choose\./);
  assert.match(app, /pollEgoistPassportVault/);
});

test("revoking a local preview retains its unverified detail but updates access to revoked", () => {
  assert.match(app, /const revocation = revokeScopedClaim\(localClaim\.claimantId, dependencies\)/);
  assert.match(app, /access: \{ \.\.\.receipt\.access, status: "revoked" \}/);
  assert.match(app, /terminalAt: revocation\.occurredAt/);
  assert.match(app, /showReceipt\(\{[\s\S]*status: "revoked"[\s\S]*terminalAt: revocation\.occurredAt[\s\S]*\}\)/);
});
