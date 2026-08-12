import assert from "node:assert/strict";
import test from "node:test";

process.env.API_KEY_PEPPER = "http-test-pepper";

const { getService } = await import("../api/_lib/runtime.ts");
const { hashApiKey } = await import("../src/api/service.ts");
const handshakesHandler = (await import("../api/v1/handshakes.ts")).default;
const handshakeHandler = (await import("../api/v1/handshakes/[id].ts")).default;
const consentHandler = (await import("../api/v1/handshakes/[id]/consent.ts")).default;
const grantHandler = (await import("../api/v1/handshakes/[id]/grant.ts")).default;
const passportHandler = (await import("../api/v1/passport.ts")).default;
const service = getService();
service.store.keys.set("claimant", { id: "claimant", organizationId: "claimant-org", roles: ["claimant"], secretHash: hashApiKey("claimant-secret") });
service.store.keys.set("recipient", { id: "recipient", organizationId: "recipient-org", roles: ["recipient"], secretHash: hashApiKey("recipient-secret") });

function request(path, key, method = "GET", body) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("v1 API authenticates callers and exposes scoped values only through the recipient grant endpoint", async () => {
  const unauthorized = await handshakesHandler.fetch(request("/api/v1/handshakes", "not-a-key"));
  assert.equal(unauthorized.status, 401);

  const validFrom = new Date(Date.now() - 60_000).toISOString();
  const validUntil = new Date(Date.now() + 15 * 60_000).toISOString();
  const createdResponse = await handshakesHandler.fetch(request("/api/v1/handshakes", "hsk_claimant_claimant-secret", "POST", {
    claimantId: "diner-101",
    recipientOrganizationId: "recipient-org",
    recipient: { id: "bistro-789", displayName: "Bistro Allegro" },
    summary: "Prepare one allergy-safe order.",
    dataScope: { purpose: "Prepare one Pad Thai order with a peanut constraint.", fields: [{ id: "order.constraint.peanut", label: "Peanut allergy" }], validFrom, validUntil },
  }));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.status, "pending");

  const approved = await consentHandler.fetch(request(`/api/v1/handshakes/${created.id}/consent`, "hsk_claimant_claimant-secret", "POST", { choice: "approve", values: { "order.constraint.peanut": "Severe peanut allergy" } }));
  assert.equal(approved.status, 200);

  const metadata = await handshakeHandler.fetch(request(`/api/v1/handshakes/${created.id}`, "hsk_recipient_recipient-secret"));
  assert.equal((await metadata.text()).includes("Severe peanut allergy"), false);
  const grant = await grantHandler.fetch(request(`/api/v1/handshakes/${created.id}/grant`, "hsk_recipient_recipient-secret"));
  assert.equal(grant.status, 200);
  assert.deepEqual((await grant.json()).values, { "order.constraint.peanut": "Severe peanut allergy" });
});

test("v1 passport endpoint persists claimant-only encrypted constraints", async () => {
  const input = {
    claimantId: "diner-101",
    constraints: [{ id: "order.constraint.sesame", label: "Sesame allergy", severity: "severe", crossContaminationTolerance: false }],
  };
  const updated = await passportHandler.fetch(request("/api/v1/passport", "hsk_claimant_claimant-secret", "PUT", input));
  assert.equal(updated.status, 200);

  const read = await passportHandler.fetch(request("/api/v1/passport?claimantId=diner-101", "hsk_claimant_claimant-secret"));
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).constraints, input.constraints);

  const recipientRead = await passportHandler.fetch(request("/api/v1/passport?claimantId=diner-101", "hsk_recipient_recipient-secret"));
  assert.equal(recipientRead.status, 403);
});
