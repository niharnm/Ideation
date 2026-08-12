import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDSHAKE_EVENT_TYPES,
  validateHandshakeEvent,
} from "../src/index.ts";

const payloads = {
  request: {
    recipient: { id: "restaurant-42", displayName: "Example Restaurant" },
    summary: "Share the selected ordering constraint for this reservation.",
  },
  consent: { recipientId: "restaurant-42", choice: "approve" },
  decision: {
    response: "cannot_determine",
    rationale: "The recipient cannot confirm this request from available information.",
  },
  acknowledgement: {
    decisionEventId: "event-decision",
    outcome: "acknowledged",
  },
  receipt: {
    deliveredTo: [
      { id: "person-1", role: "claimant" },
      { id: "restaurant-42", role: "recipient" },
    ],
    eventIds: ["event-request", "event-decision"],
  },
  expiry: { reason: "duration_elapsed" },
  revocation: { reason: "The claimant ended access." },
};

const roles = {
  request: "claimant",
  consent: "claimant",
  decision: "recipient",
  acknowledgement: "acknowledger",
  receipt: "system",
  expiry: "system",
  revocation: "claimant",
};

function event(type) {
  const role = roles[type];
  return {
    schemaVersion: "1.0.0",
    eventId: `event-${type}`,
    handshakeId: "handshake-1",
    type,
    occurredAt: "2026-08-12T01:00:00Z",
    actor: {
      id: role === "system" ? "handshake-service" : `${role}-1`,
      role,
      ...(role === "acknowledger" ? { roleName: "shift manager" } : {}),
    },
    dataScope: {
      purpose: "Prepare one restaurant order",
      fields: [{ id: "order.constraint.peanut", label: "Peanut constraint" }],
      validFrom: "2026-08-12T00:00:00Z",
      validUntil: "2026-08-12T02:00:00Z",
    },
    result: { status: "succeeded", failureCondition: null },
    payload: structuredClone(payloads[type]),
  };
}

function invalidPaths(value) {
  const result = validateHandshakeEvent(value);
  assert.equal(result.success, false);
  return result.issues.map((issue) => issue.path);
}

test("accepts every version 1 event type", () => {
  for (const type of HANDSHAKE_EVENT_TYPES) {
    const result = validateHandshakeEvent(event(type));
    assert.equal(result.success, true, `${type} should validate`);
  }
});

test("requires actor, field-level scope, timestamp, and failure condition on every event", () => {
  for (const type of HANDSHAKE_EVENT_TYPES) {
    for (const field of ["actor", "dataScope", "occurredAt", "result"]) {
      const candidate = event(type);
      delete candidate[field];
      assert.ok(
        invalidPaths(candidate).some((path) => path === `$.${field}`),
        `${type} must require ${field}`,
      );
    }
  }
});

test("requires the actor that owns each event transition", () => {
  const candidate = event("decision");
  candidate.actor = { id: "person-1", role: "claimant" };
  assert.ok(invalidPaths(candidate).includes("$.actor.role"));
});

test("requires a named role for acknowledgement", () => {
  const candidate = event("acknowledgement");
  candidate.actor = { id: "manager-1", role: "acknowledger" };
  assert.ok(invalidPaths(candidate).includes("$.actor.roleName"));
});

test("rejects broad profile scope and invalid validity windows", () => {
  const broad = event("request");
  broad.dataScope = {
    purpose: "Share profile",
    fields: [{ id: "profile", label: "Profile" }],
    validFrom: "2026-08-12T02:00:00Z",
    validUntil: "2026-08-12T01:00:00Z",
  };
  const paths = invalidPaths(broad);
  assert.ok(paths.includes("$.dataScope.fields[0].id"));
  assert.ok(paths.includes("$.dataScope.validUntil"));
});

test("requires a structured failure condition only for failed events", () => {
  const failed = event("request");
  failed.result = {
    status: "failed",
    failureCondition: {
      code: "recipient_unreachable",
      message: "The named recipient could not be reached.",
      retryable: true,
    },
  };
  assert.equal(validateHandshakeEvent(failed).success, true);

  const incoherent = event("request");
  incoherent.result = {
    status: "succeeded",
    failureCondition: { code: "error", message: "Error", retryable: false },
  };
  assert.ok(invalidPaths(incoherent).includes("$.result.failureCondition"));
});

test("supports all four recipient decisions without inferring a result", () => {
  for (const response of [
    "accept",
    "decline",
    "cannot_determine",
  ]) {
    const candidate = event("decision");
    candidate.payload = { response, rationale: `Recipient chose ${response}.` };
    assert.equal(validateHandshakeEvent(candidate).success, true);
  }

  const change = event("decision");
  change.payload = {
    response: "required_change",
    rationale: "One field must change.",
    requiredChanges: ["Clarify the selected order constraint."],
  };
  assert.equal(validateHandshakeEvent(change).success, true);

  const missingChange = event("decision");
  missingChange.payload = {
    response: "required_change",
    rationale: "One field must change.",
  };
  assert.ok(invalidPaths(missingChange).includes("$.payload.requiredChanges"));
});

test("requires one receipt for the claimant and one for the recipient", () => {
  const candidate = event("receipt");
  candidate.payload = {
    deliveredTo: [
      { id: "person-1", role: "claimant" },
      { id: "person-2", role: "claimant" },
    ],
    eventIds: ["event-request"],
  };
  assert.ok(invalidPaths(candidate).includes("$.payload.deliveredTo"));
});

test("rejects unversioned extensions instead of accepting unknown data", () => {
  const candidate = event("request");
  candidate.inferredProfile = { allergies: ["unknown"] };
  assert.ok(invalidPaths(candidate).includes("$.inferredProfile"));
});
