import assert from "node:assert/strict";
import test from "node:test";

import {
  runAllergyOrderingFlow,
  validateHandshakeEvent,
} from "../src/index.ts";

test("runs full restaurant allergy ordering handshake event chain in sequence", () => {
  const result = runAllergyOrderingFlow({
    handshakeId: "handshake-order-888",
    claimantId: "customer-12",
    restaurantId: "bistro-99",
    restaurantName: "The Daily Bistro",
    acknowledgerId: "chef-3",
    acknowledgerRoleName: "Head Chef",
    allergies: [
      { id: "order.constraint.peanut", label: "Peanut Allergy" },
      { id: "order.constraint.gluten", label: "Gluten Sensitivity" },
    ],
    purpose: "Process allergy safety requirements for table 5 order",
    validFrom: "2026-08-12T19:00:00Z",
    validUntil: "2026-08-12T21:00:00Z",
  });

  assert.equal(result.events.length, 5);
  const [requestEvt, consentEvt, decisionEvt, ackEvt, receiptEvt] = result.events;

  // 1. Request
  assert.equal(requestEvt.type, "request");
  assert.equal(requestEvt.handshakeId, "handshake-order-888");
  assert.equal(requestEvt.actor.role, "claimant");
  assert.equal(requestEvt.actor.id, "customer-12");
  assert.equal(requestEvt.payload.recipient.id, "bistro-99");
  assert.equal(requestEvt.payload.recipient.displayName, "The Daily Bistro");

  // 2. Consent
  assert.equal(consentEvt.type, "consent");
  assert.equal(consentEvt.actor.role, "claimant");
  assert.equal(consentEvt.payload.recipientId, "bistro-99");
  assert.equal(consentEvt.payload.choice, "approve");

  // 3. Decision
  assert.equal(decisionEvt.type, "decision");
  assert.equal(decisionEvt.actor.role, "recipient");
  assert.equal(decisionEvt.actor.id, "bistro-99");
  assert.equal(decisionEvt.payload.response, "accept");

  // 4. Acknowledgement
  assert.equal(ackEvt.type, "acknowledgement");
  assert.equal(ackEvt.actor.role, "acknowledger");
  assert.equal(ackEvt.actor.id, "chef-3");
  assert.equal(ackEvt.actor.roleName, "Head Chef");
  assert.equal(ackEvt.payload.decisionEventId, decisionEvt.eventId);
  assert.equal(ackEvt.payload.outcome, "acknowledged");

  // 5. Receipt
  assert.equal(receiptEvt.type, "receipt");
  assert.equal(receiptEvt.actor.role, "system");
  assert.deepEqual(receiptEvt.payload.deliveredTo, [
    { id: "customer-12", role: "claimant" },
    { id: "bistro-99", role: "recipient" },
  ]);
  assert.deepEqual(receiptEvt.payload.eventIds, [
    requestEvt.eventId,
    consentEvt.eventId,
    decisionEvt.eventId,
    ackEvt.eventId,
  ]);

  // Validate every event with validateHandshakeEvent
  for (const evt of result.events) {
    const val = validateHandshakeEvent(evt);
    assert.equal(val.success, true, `Event ${evt.type} should be valid`);
  }
});

test("demonstrates allergy safety handling without creating standing profile grants", () => {
  const result = runAllergyOrderingFlow();

  // Guarantees standingProfileCreated is strictly false
  assert.equal(result.standingProfileCreated, false);

  // Scoped strictly to exact constraint fields
  assert.deepEqual(result.dataScope.fields, [
    { id: "order.constraint.peanut", label: "Peanut Allergy" },
    { id: "order.constraint.dairy", label: "Dairy Intolerance" },
  ]);

  // Ensure no broad profile fields exist in dataScope
  const fieldIds = result.dataScope.fields.map((f) => f.id);
  assert.ok(!fieldIds.includes("*"));
  assert.ok(!fieldIds.includes("profile"));
  assert.ok(!fieldIds.includes("user_profile"));

  // Ensure validity window is within 24-hour limit
  const durationMs =
    Date.parse(result.dataScope.validUntil) - Date.parse(result.dataScope.validFrom);
  assert.ok(durationMs > 0);
  assert.ok(durationMs <= 24 * 60 * 60 * 1000);
});

test("supports decision required changes and custom acknowledgement notes", () => {
  const result = runAllergyOrderingFlow({
    decisionResponse: "required_change",
    decisionRationale: "Kitchen needs kitchen modification approval",
    requiredChanges: ["Confirm fryer isolation preference"],
    acknowledgementOutcome: "acknowledged",
    acknowledgementNote: "Customer confirmed fryer isolation is required",
  });

  const decisionEvt = result.events.find((e) => e.type === "decision");
  const ackEvt = result.events.find((e) => e.type === "acknowledgement");

  assert.equal(decisionEvt.payload.response, "required_change");
  assert.deepEqual(decisionEvt.payload.requiredChanges, [
    "Confirm fryer isolation preference",
  ]);
  assert.equal(ackEvt.payload.note, "Customer confirmed fryer isolation is required");
});

test("throws an error when invalid broad scope or improper parameters are passed", () => {
  assert.throws(
    () =>
      runAllergyOrderingFlow({
        allergies: [{ id: "profile", label: "Broad User Profile" }],
      }),
    /Failed to compose claim scope/,
  );

  assert.throws(
    () =>
      runAllergyOrderingFlow({
        validFrom: "invalid-date",
      }),
    /Failed to compose claim scope/,
  );
});
