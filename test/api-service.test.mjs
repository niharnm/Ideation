import assert from "node:assert/strict";
import test from "node:test";

process.env.API_KEY_PEPPER = "test-api-key-pepper";

const {
  ApiError,
  HandshakeService,
  LocalEnvelopeCipher,
  MemoryHandshakeStore,
  hashApiKey,
} = await import("../src/api/service.ts");

function setup() {
  const store = new MemoryHandshakeStore();
  store.keys.set("claimant", { id: "claimant", organizationId: "claimant-org", roles: ["claimant"], secretHash: hashApiKey("claimant-secret") });
  store.keys.set("recipient", { id: "recipient", organizationId: "recipient-org", roles: ["recipient"], secretHash: hashApiKey("recipient-secret") });
  let now = new Date("2026-08-12T18:00:00.000Z");
  return { store, service: new HandshakeService(store, new LocalEnvelopeCipher("test"), () => now), claimant: { organizationId: "claimant-org", roles: ["claimant"], keyId: "claimant" }, recipient: { organizationId: "recipient-org", roles: ["recipient"], keyId: "recipient" }, advance(value) { now = new Date(value); } };
}

const request = {
  claimantId: "diner-101",
  recipientOrganizationId: "recipient-org",
  recipient: { id: "bistro-789", displayName: "Bistro Allegro" },
  summary: "Prepare one allergy-safe order.",
  dataScope: { purpose: "Prepare one Pad Thai order with a peanut constraint.", fields: [{ id: "order.constraint.peanut", label: "Peanut allergy" }], validFrom: "2026-08-12T18:00:00.000Z", validUntil: "2026-08-12T18:30:00.000Z" },
};

test("API service persists an encrypted approved grant and never exposes it in metadata", async () => {
  const context = setup();
  const created = await context.service.create(context.claimant, request);
  const approved = await context.service.consent(context.claimant, created.id, { choice: "approve", values: { "order.constraint.peanut": "Severe peanut allergy" } });
  assert.equal(approved.status, "active");
  assert.equal("sealedValues" in approved, false);
  const metadata = await context.service.get(context.recipient, created.id);
  assert.equal(JSON.stringify(metadata).includes("Severe peanut allergy"), false);
  const grant = await context.service.grant(context.recipient, created.id);
  assert.deepEqual(grant.values, { "order.constraint.peanut": "Severe peanut allergy" });
});

test("API service enforces organization ownership and cryptographically erases values on revoke", async () => {
  const context = setup();
  const created = await context.service.create(context.claimant, request);
  await context.service.consent(context.claimant, created.id, { choice: "approve", values: { "order.constraint.peanut": "Severe peanut allergy" } });
  await assert.rejects(() => context.service.revoke(context.recipient, created.id, { reason: "no" }), (error) => error instanceof ApiError && error.status === 403);
  await context.service.revoke(context.claimant, created.id, { reason: "Customer removed access." });
  const stored = await context.store.read(created.id);
  assert.deepEqual(stored.sealedValues, {});
  await assert.rejects(() => context.service.grant(context.recipient, created.id), (error) => error instanceof ApiError && error.code === "grant_inactive");
});

test("API service creates one authenticated receipt after recipient acknowledgement", async () => {
  const context = setup();
  const created = await context.service.create(context.claimant, request);
  await context.service.consent(context.claimant, created.id, { choice: "approve", values: { "order.constraint.peanut": "Severe peanut allergy" } });
  const decision = await context.service.decision(context.recipient, created.id, { actorId: "staff-42", response: "accept", rationale: "Peanut constraint confirmed." });
  assert.equal(decision.event.type, "decision");
  const result = await context.service.acknowledge(context.recipient, created.id, { actorId: "staff-42", roleName: "Shift Manager", outcome: "acknowledged" });
  assert.equal(result.receipt.type, "receipt");
  const metadata = await context.service.get(context.claimant, created.id);
  assert.deepEqual(metadata.events.map((event) => event.type), ["request", "consent", "decision", "acknowledgement", "receipt"]);
});

test("passport updates are encrypted and only affect future handshake inputs", async () => {
  const context = setup();
  const profile = await context.service.putPassport(context.claimant, {
    claimantId: "diner-101",
    constraints: [{ id: "order.constraint.sesame", label: "Sesame allergy", severity: "severe", crossContaminationTolerance: false }],
  });
  assert.equal(profile.version, 1);
  assert.deepEqual((await context.service.getPassport(context.claimant, "diner-101")).constraints, profile.constraints);
  assert.equal(JSON.stringify([...context.store.passports.values()]).includes("Sesame allergy"), false);
  await assert.rejects(() => context.service.getPassport(context.recipient, "diner-101"), (error) => error instanceof ApiError && error.status === 403);
});
