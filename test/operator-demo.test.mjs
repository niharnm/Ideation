import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryStorage,
  approveScopedRequest,
  denyScopedRequest,
  previewClaimantReceipt,
  recordStaffAcknowledgement,
  revokeScopedClaim,
  runOperatorDemo,
  validateHandshakeEvent,
} from "../src/index.ts";

function createTestDependencies(storage = new MemoryStorage(), now = "2026-08-12T18:00:00Z") {
  const events = [];
  let id = 0;
  return {
    events,
    storage,
    deps: {
      storage,
      emit: (evt) => events.push(evt),
      now: () => new Date(now),
      createId: () => `staff-ack-test-${++id}`,
    },
  };
}

test("recordStaffAcknowledgement creates valid events with named role and ingests into claimant receipt preview", () => {
  const { deps } = createTestDependencies();
  const claimantId = "diner-1";
  const recipientId = "restaurant-1";

  // Step 1: Initiator approves scoped request
  const approveRes = approveScopedRequest(
    {
      claimantId,
      recipient: { id: recipientId, displayName: "Bistro Allegro" },
      summary: "Verify peanut allergy constraint for Pad Thai",
      draft: {
        purpose: "Verify peanut allergy constraint for Pad Thai",
        fields: [{ id: "order.constraint.peanut", label: "Peanut constraint", selected: true }],
        validFrom: "2026-08-12T18:00:00Z",
        validUntil: "2026-08-12T18:30:00Z",
        choice: null,
      },
    },
    deps,
  );
  assert.equal(approveRes.success, true);
  const handshakeId = approveRes.value.requestEvent.handshakeId;
  const dataScope = approveRes.value.requestEvent.dataScope;

  // Step 2: Record staff decision and named-role acknowledgement
  const { decisionEvent, acknowledgementEvent } = recordStaffAcknowledgement(
    {
      handshakeId,
      actorId: "staff-mgr-99",
      roleName: "Shift Manager",
      decision: {
        response: "accept",
        rationale: "Peanut constraint verified on Pad Thai.",
      },
      dataScope,
      recipientId,
      note: "Kitchen team verified peanut-free prep line",
    },
    deps,
  );

  assert.equal(decisionEvent.type, "decision");
  assert.equal(decisionEvent.payload.response, "accept");
  assert.equal(validateHandshakeEvent(decisionEvent).success, true);

  assert.equal(acknowledgementEvent.type, "acknowledgement");
  assert.equal(acknowledgementEvent.actor.id, "staff-mgr-99");
  assert.equal(acknowledgementEvent.actor.roleName, "Shift Manager");
  assert.equal(acknowledgementEvent.payload.decisionEventId, decisionEvent.eventId);
  assert.equal(acknowledgementEvent.payload.outcome, "acknowledged");
  assert.equal(acknowledgementEvent.payload.note, "Kitchen team verified peanut-free prep line");
  assert.equal(validateHandshakeEvent(acknowledgementEvent).success, true);

  // Step 3: Ingest into claimant receipt preview
  const previewRes = previewClaimantReceipt(handshakeId, deps);
  assert.equal(previewRes.success, true);
  const receipt = previewRes.value.receipt;
  assert.equal(receipt.handshakeId, handshakeId);
  assert.equal(receipt.decision.outcome, "accept");
  assert.equal(receipt.decision.rationale, "Peanut constraint verified on Pad Thai.");
  assert.equal(receipt.acknowledgement.roleName, "Shift Manager");
  assert.equal(receipt.acknowledgement.outcome, "acknowledged");
  assert.equal(receipt.acknowledgement.note, "Kitchen team verified peanut-free prep line");
});

test("runOperatorDemo handles 'accept' scenario for Peanut constraint on Pad Thai", () => {
  const result = runOperatorDemo("accept");

  assert.equal(result.scenario, "accept");
  assert.ok(result.handshakeId.length > 0);
  assert.equal(result.events.length, 4);

  const eventTypes = result.events.map((e) => e.type);
  assert.deepEqual(eventTypes, ["request", "consent", "decision", "acknowledgement"]);

  assert.equal(result.receiptPreview.success, true);
  const receipt = result.receiptPreview.value.receipt;

  assert.equal(receipt.decision.outcome, "accept");
  assert.match(receipt.decision.rationale, /Peanut constraint verified on Pad Thai/);
  assert.equal(receipt.acknowledgement.roleName, "Shift Manager");
  assert.equal(receipt.acknowledgement.outcome, "acknowledged");
  assert.match(result.summary, /Peanut constraint verified on Pad Thai/);
});

test("runOperatorDemo handles 'required_change' scenario for Tamari GF Soy sauce substitution", () => {
  const result = runOperatorDemo("required_change");

  assert.equal(result.scenario, "required_change");
  assert.equal(result.events.length, 4);

  assert.equal(result.receiptPreview.success, true);
  const receipt = result.receiptPreview.value.receipt;

  assert.equal(receipt.decision.outcome, "required_change");
  assert.match(receipt.decision.rationale, /Tamari GF Soy sauce substitution required/);
  assert.deepEqual(receipt.decision.requiredChanges, [
    "Tamari GF Soy sauce substitution required",
  ]);
  assert.equal(receipt.acknowledgement.roleName, "Shift Manager");
  assert.equal(receipt.acknowledgement.outcome, "acknowledged");
  assert.match(result.summary, /Tamari GF Soy sauce substitution required/);
});

test("runOperatorDemo handles 'cannot_determine' scenario for Unverified curry paste", () => {
  const result = runOperatorDemo("cannot_determine");

  assert.equal(result.scenario, "cannot_determine");
  assert.equal(result.events.length, 4);

  assert.equal(result.receiptPreview.success, true);
  const receipt = result.receiptPreview.value.receipt;

  assert.equal(receipt.decision.outcome, "cannot_determine");
  assert.match(receipt.decision.rationale, /Unverified curry paste/);
  assert.equal(receipt.acknowledgement.roleName, "Shift Manager");
  assert.equal(receipt.acknowledgement.outcome, "acknowledged");
  assert.match(result.summary, /Unverified curry paste/);
});

test("runOperatorDemo accepts custom options for actorId, roleName, and handshakeId", () => {
  const customStorage = new MemoryStorage();
  const result = runOperatorDemo("accept", {
    handshakeId: "handshake-custom-007",
    actorId: "staff-lead-07",
    roleName: "Head Supervisor",
    storage: customStorage,
  });

  assert.equal(result.handshakeId, "handshake-custom-007");
  assert.equal(result.receiptPreview.success, true);
  const receipt = result.receiptPreview.value.receipt;

  assert.equal(receipt.acknowledgement.roleName, "Head Supervisor");
  assert.equal(
    new Set(result.events.map((event) => event.eventId)).size,
    result.events.length,
  );
});

test("recordStaffAcknowledgement blocks denied, expired, and revoked grants", () => {
  const input = {
    claimantId: "diner-1",
    recipient: { id: "restaurant-1", displayName: "Bistro Allegro" },
    summary: "Verify peanut allergy constraint for Pad Thai",
    draft: {
      purpose: "Verify peanut allergy constraint for Pad Thai",
      fields: [{ id: "order.constraint.peanut", label: "Peanut constraint", selected: true }],
      validFrom: "2026-08-12T18:00:00Z",
      validUntil: "2026-08-12T18:30:00Z",
      choice: null,
    },
  };
  const attempt = (result, deps) =>
    recordStaffAcknowledgement(
      {
        handshakeId: result.value.requestEvent.handshakeId,
        actorId: "staff-mgr-99",
        decision: { response: "accept", rationale: "Verified" },
        dataScope: result.value.requestEvent.dataScope,
        recipientId: "restaurant-1",
        occurredAt: "2026-08-12T18:05:00Z",
      },
      deps,
    );

  const denied = createTestDependencies();
  const deniedResult = denyScopedRequest(input, denied.deps);
  assert.equal(deniedResult.success, true);
  assert.throws(() => attempt(deniedResult, denied.deps), /active scoped grant/);

  const expired = createTestDependencies(new MemoryStorage(), "2026-08-12T18:31:00Z");
  const expiredResult = approveScopedRequest(input, expired.deps);
  assert.equal(expiredResult.success, true);
  assert.throws(() => attempt(expiredResult, expired.deps), /active scoped grant/);

  const revoked = createTestDependencies();
  const revokedResult = approveScopedRequest(input, revoked.deps);
  assert.equal(revokedResult.success, true);
  revokeScopedClaim("diner-1", revoked.deps);
  assert.throws(() => attempt(revokedResult, revoked.deps), /active scoped grant/);
});
