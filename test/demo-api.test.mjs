import assert from "node:assert/strict";
import test from "node:test";

process.env.API_KEY_PEPPER = "demo-api-test-pepper";

const handler = (await import("../api/demo.ts")).default;

function request(body) {
  return new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("website demo adapter persists its lifecycle through the API service", async () => {
  const started = await handler.fetch(request({ action: "start" }));
  assert.equal(started.status, 201);
  const { handshake } = await started.json();
  assert.equal(handshake.status, "active");
  assert.equal("sealedValues" in handshake, false);

  const updatedPassport = await handler.fetch(request({
    action: "passport-update",
    constraints: [{ id: "order.constraint.sesame", label: "Sesame allergy", severity: "severe", crossContaminationTolerance: false }],
  }));
  assert.equal(updatedPassport.status, 200);

  const recipient = await handler.fetch(request({ action: "recipient-status", handshakeId: handshake.id }));
  const recipientBody = await recipient.json();
  assert.equal(recipient.status, 200);
  assert.deepEqual(recipientBody.grant.values, { "order.constraint.peanut": "Peanut allergy" });

  const nextStarted = await handler.fetch(request({ action: "start" }));
  assert.equal(nextStarted.status, 201);
  const nextHandshake = (await nextStarted.json()).handshake;
  const nextRecipient = await handler.fetch(request({ action: "recipient-status", handshakeId: nextHandshake.id }));
  assert.deepEqual((await nextRecipient.json()).grant.values, { "order.constraint.sesame": "Sesame allergy" });

  const decision = await handler.fetch(request({ action: "record-decision", handshakeId: handshake.id, response: "accept", rationale: "Dedicated peanut-free prep surface confirmed." }));
  assert.equal(decision.status, 201);

  const revoked = await handler.fetch(request({ action: "revoke", handshakeId: handshake.id }));
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).handshake.status, "revoked");
});
