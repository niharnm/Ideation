import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDecisionEvent,
  validateHandshakeEvent,
} from "../src/index.ts";

const sampleDataScope = {
  purpose: "Prepare one restaurant order",
  fields: [{ id: "order.constraint.peanut", label: "Peanut constraint" }],
  validFrom: "2026-08-12T00:00:00Z",
  validUntil: "2026-08-12T02:00:00Z",
};

test("builds a valid decision event with default timestamp and succeeded status", () => {
  const decision = {
    response: "accept",
    rationale: "Constraint accepted.",
  };

  const event = buildDecisionEvent({
    handshakeId: "handshake-123",
    actorId: "restaurant-42",
    dataScope: sampleDataScope,
    decision,
  });

  assert.equal(event.schemaVersion, "1.0.0");
  assert.equal(event.type, "decision");
  assert.equal(event.handshakeId, "handshake-123");
  assert.deepEqual(event.actor, {
    id: "restaurant-42",
    role: "recipient",
  });
  assert.deepEqual(event.dataScope, sampleDataScope);
  assert.deepEqual(event.result, {
    status: "succeeded",
    failureCondition: null,
  });
  assert.deepEqual(event.payload, decision);
  assert.ok(typeof event.eventId === "string" && event.eventId.length > 0);
  assert.ok(typeof event.occurredAt === "string" && event.occurredAt.length > 0);

  const validationResult = validateHandshakeEvent(event);
  assert.equal(validationResult.success, true);
});

test("supports explicit occurredAt timestamp", () => {
  const occurredAt = "2026-08-12T01:30:00.000Z";
  const event = buildDecisionEvent({
    handshakeId: "handshake-123",
    actorId: "restaurant-42",
    dataScope: sampleDataScope,
    decision: {
      response: "decline",
      rationale: "Constraint cannot be satisfied.",
    },
    occurredAt,
  });

  assert.equal(event.occurredAt, occurredAt);
  const validationResult = validateHandshakeEvent(event);
  assert.equal(validationResult.success, true);
});

test("validates decision events across all response types including required_change", () => {
  const responses = [
    { response: "accept", rationale: "Accepted" },
    { response: "decline", rationale: "Declined" },
    { response: "cannot_determine", rationale: "Unable to verify" },
    {
      response: "required_change",
      rationale: "Modification required",
      requiredChanges: ["Remove peanut constraint"],
    },
  ];

  for (const decision of responses) {
    const event = buildDecisionEvent({
      handshakeId: "handshake-999",
      actorId: "actor-recipient",
      dataScope: sampleDataScope,
      decision,
    });

    const validationResult = validateHandshakeEvent(event);
    assert.equal(
      validationResult.success,
      true,
      `Decision response ${decision.response} should validate`,
    );
  }
});
