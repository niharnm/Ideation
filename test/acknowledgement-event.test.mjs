import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcknowledgementEvent,
  validateHandshakeEvent,
} from "../src/index.ts";

function sampleDataScope() {
  return {
    purpose: "Prepare one restaurant order",
    fields: [{ id: "order.constraint.peanut", label: "Peanut constraint" }],
    validFrom: "2026-08-12T00:00:00Z",
    validUntil: "2026-08-12T02:00:00Z",
  };
}

test("builds a valid acknowledgement event with outcome 'acknowledged' and validates", () => {
  const dataScope = sampleDataScope();
  const event = buildAcknowledgementEvent({
    handshakeId: "handshake-100",
    actorId: "manager-42",
    roleName: "shift manager",
    decisionEventId: "event-decision-1",
    outcome: "acknowledged",
    note: "Confirmed by kitchen staff",
    dataScope,
  });

  assert.equal(event.type, "acknowledgement");
  assert.equal(event.handshakeId, "handshake-100");
  assert.equal(event.actor.id, "manager-42");
  assert.equal(event.actor.role, "acknowledger");
  assert.equal(event.actor.roleName, "shift manager");
  assert.equal(event.payload.decisionEventId, "event-decision-1");
  assert.equal(event.payload.outcome, "acknowledged");
  assert.equal(event.payload.note, "Confirmed by kitchen staff");
  assert.equal(event.result.status, "succeeded");
  assert.equal(event.result.failureCondition, null);

  const validation = validateHandshakeEvent(event);
  assert.equal(validation.success, true);
});

test("builds a valid acknowledgement event with outcome 'rejected' and no note", () => {
  const dataScope = sampleDataScope();
  const event = buildAcknowledgementEvent({
    handshakeId: "handshake-101",
    actorId: "manager-42",
    roleName: "shift manager",
    decisionEventId: "event-decision-2",
    outcome: "rejected",
    dataScope,
  });

  assert.equal(event.type, "acknowledgement");
  assert.equal(event.payload.outcome, "rejected");
  assert.equal(event.payload.note, undefined);
  assert.ok(!("note" in event.payload));

  const validation = validateHandshakeEvent(event);
  assert.equal(validation.success, true);
});

test("supports explicit eventId and occurredAt parameters", () => {
  const dataScope = sampleDataScope();
  const customTime = "2026-08-12T01:30:00Z";
  const customId = "ack-evt-999";

  const event = buildAcknowledgementEvent({
    handshakeId: "handshake-102",
    actorId: "manager-1",
    roleName: "head chef",
    decisionEventId: "event-decision-3",
    outcome: "acknowledged",
    dataScope,
    occurredAt: customTime,
    eventId: customId,
  });

  assert.equal(event.eventId, customId);
  assert.equal(event.occurredAt, customTime);

  const validation = validateHandshakeEvent(event);
  assert.equal(validation.success, true);
});

test("enforces mandatory roleName for acknowledger actor", () => {
  const dataScope = sampleDataScope();

  for (const emptyRoleName of ["", "   ", null, undefined]) {
    assert.throws(
      () =>
        buildAcknowledgementEvent({
          handshakeId: "handshake-103",
          actorId: "manager-1",
          roleName: emptyRoleName,
          decisionEventId: "event-decision-4",
          outcome: "acknowledged",
          dataScope,
        }),
      /roleName is required for acknowledger actor/,
    );
  }
});

test("validates mandatory fields (actorId, handshakeId, decisionEventId, outcome)", () => {
  const dataScope = sampleDataScope();

  assert.throws(
    () =>
      buildAcknowledgementEvent({
        handshakeId: "handshake-104",
        actorId: "",
        roleName: "shift manager",
        decisionEventId: "event-decision-5",
        outcome: "acknowledged",
        dataScope,
      }),
    /actorId is required/,
  );

  assert.throws(
    () =>
      buildAcknowledgementEvent({
        handshakeId: "",
        actorId: "manager-1",
        roleName: "shift manager",
        decisionEventId: "event-decision-5",
        outcome: "acknowledged",
        dataScope,
      }),
    /handshakeId is required/,
  );

  assert.throws(
    () =>
      buildAcknowledgementEvent({
        handshakeId: "handshake-104",
        actorId: "manager-1",
        roleName: "shift manager",
        decisionEventId: "",
        outcome: "acknowledged",
        dataScope,
      }),
    /decisionEventId is required/,
  );

  assert.throws(
    () =>
      buildAcknowledgementEvent({
        handshakeId: "handshake-104",
        actorId: "manager-1",
        roleName: "shift manager",
        decisionEventId: "event-decision-5",
        outcome: "invalid_outcome",
        dataScope,
      }),
    /outcome must be 'acknowledged' or 'rejected'/,
  );
});
