import assert from "node:assert/strict";
import test from "node:test";

import {
  processRecipientRequest,
  buildAcceptDecisionPayload,
  createAcceptDecisionEvent,
  buildRequiredChangeDecisionPayload,
  createRequiredChangeDecisionEvent,
  buildDeclineDecisionPayload,
  createDeclineDecisionEvent,
  buildCannotDetermineDecisionPayload,
  createCannotDetermineDecisionEvent,
  createRecipientDecisionEvent,
  recordRecipientDecision,
  getValueByPath,
  validateHandshakeEvent,
  readHandshakeEventLedger,
} from "../src/index.ts";

const sampleDataScope = {
  purpose: "Prepare one restaurant order from requested dietary constraints",
  fields: [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
    { id: "order.constraint.dairy", label: "Dairy constraint" },
  ],
  validFrom: "2026-08-12T00:00:00Z",
  validUntil: "2026-08-12T01:00:00Z",
};

const sampleRequestEvent = {
  schemaVersion: "1.0.0",
  eventId: "event-req-001",
  handshakeId: "handshake-console-100",
  type: "request",
  occurredAt: "2026-08-12T00:00:00Z",
  actor: { id: "claimant-42", role: "claimant" },
  dataScope: sampleDataScope,
  result: { status: "succeeded", failureCondition: null },
  payload: {
    recipient: { id: "recipient-99", displayName: "Fine Dining Restaurant" },
    summary: "Scoped order constraints",
  },
};

const sampleConsentEvent = {
  schemaVersion: "1.0.0",
  eventId: "event-cons-001",
  handshakeId: "handshake-console-100",
  type: "consent",
  occurredAt: "2026-08-12T00:01:00Z",
  actor: { id: "claimant-42", role: "claimant" },
  dataScope: sampleDataScope,
  result: { status: "succeeded", failureCondition: null },
  payload: { recipientId: "recipient-99", choice: "approve" },
};

function createMockStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

test("getValueByPath retrieves direct and nested object values accurately", () => {
  const data = {
    simpleKey: "hello",
    nested: { path: { value: 123 } },
    "dot.separated.key": "directValue",
  };

  assert.equal(getValueByPath(data, "simpleKey"), "hello");
  assert.equal(getValueByPath(data, "nested.path.value"), 123);
  assert.equal(getValueByPath(data, "dot.separated.key"), "directValue");
  assert.equal(getValueByPath(data, "missing.key"), undefined);
});

test("processRecipientRequest enforces field isolation and hides unrequested claimant data", () => {
  const rawRecipientData = {
    "order.constraint.peanut": "Severe Peanut Allergy",
    "order.constraint.dairy": "No Lactose",
    "user.ssn": "999-00-1234",
    "user.homeAddress": "123 Private St",
    "user.creditCard": "4111-XXXX-XXXX-1111",
    "unrequested.medicalHistory": "Secret Medical Record",
  };

  const processed = processRecipientRequest(
    sampleRequestEvent,
    sampleConsentEvent,
    rawRecipientData,
  );

  assert.equal(processed.handshakeId, "handshake-console-100");
  assert.equal(processed.recipientId, "recipient-99");
  assert.equal(processed.claimantId, "claimant-42");
  assert.equal(processed.consentGranted, true);
  assert.equal(processed.consentChoice, "approve");
  assert.equal(processed.unrequestedFieldsFilteredOut, true);

  // Exposes ONLY requested fields
  assert.equal(processed.scopedFields.length, 2);
  assert.deepEqual(processed.scopedFields, [
    {
      id: "order.constraint.peanut",
      label: "Peanut constraint",
      value: "Severe Peanut Allergy",
    },
    {
      id: "order.constraint.dairy",
      label: "Dairy constraint",
      value: "No Lactose",
    },
  ]);

  // scopedData must contain ONLY requested field keys
  assert.deepEqual(Object.keys(processed.scopedData).sort(), [
    "order.constraint.dairy",
    "order.constraint.peanut",
  ]);

  // Unrequested fields MUST NOT leak
  assert.equal(processed.scopedData["user.ssn"], undefined);
  assert.equal(processed.scopedData["user.homeAddress"], undefined);
  assert.equal(processed.scopedData["user.creditCard"], undefined);
  assert.equal(processed.scopedData["unrequested.medicalHistory"], undefined);
});

test("processRecipientRequest handles denied consent by exposing no fields", () => {
  const deniedConsentEvent = {
    ...sampleConsentEvent,
    payload: { recipientId: "recipient-99", choice: "deny" },
  };

  const rawRecipientData = {
    "order.constraint.peanut": "Severe Peanut Allergy",
    "user.ssn": "999-00-1234",
  };

  const processed = processRecipientRequest(
    sampleRequestEvent,
    deniedConsentEvent,
    rawRecipientData,
  );

  assert.equal(processed.consentGranted, false);
  assert.equal(processed.consentChoice, "deny");
  assert.equal(processed.scopedFields.length, 0);
  assert.deepEqual(processed.scopedData, {});
});

test("processRecipientRequest validates event types and handshake ID matching", () => {
  const mismatchedConsent = {
    ...sampleConsentEvent,
    handshakeId: "handshake-DIFFERENT",
  };

  assert.throws(
    () => processRecipientRequest(sampleRequestEvent, mismatchedConsent, {}),
    /Handshake ID mismatch/,
  );

  assert.throws(
    () => processRecipientRequest(sampleConsentEvent, sampleConsentEvent, {}),
    /Invalid requestEvent/,
  );
});

test("Decision Response Path 1: accept", () => {
  const payload = buildAcceptDecisionPayload({
    rationale: "All requested constraints verified by kitchen staff.",
  });

  assert.equal(payload.response, "accept");
  assert.equal(
    payload.rationale,
    "All requested constraints verified by kitchen staff.",
  );
  assert.equal(payload.requiredChanges, undefined);

  const event = createAcceptDecisionEvent({
    handshakeId: "handshake-console-100",
    recipientId: "recipient-99",
    dataScope: sampleDataScope,
    rationale: "All requested constraints verified by kitchen staff.",
  });

  assert.equal(event.type, "decision");
  assert.equal(event.actor.role, "recipient");
  assert.equal(event.payload.response, "accept");

  const validation = validateHandshakeEvent(event);
  assert.equal(validation.success, true);
});

test("Decision Response Path 2: required_change", () => {
  const requiredChanges = [
    "Specify threshold for peanut cross-contamination",
    "Confirm substitution preferences",
  ];

  const payload = buildRequiredChangeDecisionPayload({
    requiredChanges,
    rationale: "Kitchen requires constraint clarification.",
  });

  assert.equal(payload.response, "required_change");
  assert.equal(
    payload.rationale,
    "Kitchen requires constraint clarification.",
  );
  assert.deepEqual(payload.requiredChanges, requiredChanges);

  const event = createRequiredChangeDecisionEvent({
    handshakeId: "handshake-console-100",
    recipientId: "recipient-99",
    dataScope: sampleDataScope,
    requiredChanges,
    rationale: "Kitchen requires constraint clarification.",
  });

  assert.equal(event.type, "decision");
  assert.equal(event.payload.response, "required_change");
  assert.deepEqual(event.payload.requiredChanges, requiredChanges);

  const validation = validateHandshakeEvent(event);
  assert.equal(validation.success, true);

  // Requires non-empty array of changes
  assert.throws(
    () => buildRequiredChangeDecisionPayload({ requiredChanges: [] }),
    /requiredChanges must be a non-empty array/,
  );
});

test("Decision Response Path 3: decline", () => {
  const payload = buildDeclineDecisionPayload({
    rationale: "Kitchen cannot guarantee nut-free environment.",
  });

  assert.equal(payload.response, "decline");
  assert.equal(
    payload.rationale,
    "Kitchen cannot guarantee nut-free environment.",
  );

  const event = createDeclineDecisionEvent({
    handshakeId: "handshake-console-100",
    recipientId: "recipient-99",
    dataScope: sampleDataScope,
    rationale: "Kitchen cannot guarantee nut-free environment.",
  });

  assert.equal(event.type, "decision");
  assert.equal(event.payload.response, "decline");

  const validation = validateHandshakeEvent(event);
  assert.equal(validation.success, true);

  // Requires rationale
  assert.throws(
    () => buildDeclineDecisionPayload({ rationale: "" }),
    /Rationale is required/,
  );
});

test("Decision Response Path 4: cannot_determine", () => {
  const payload = buildCannotDetermineDecisionPayload({
    reason: "Supplier ingredient certification currently unavailable.",
  });

  assert.equal(payload.response, "cannot_determine");
  assert.equal(
    payload.rationale,
    "Supplier ingredient certification currently unavailable.",
  );

  const event = createCannotDetermineDecisionEvent({
    handshakeId: "handshake-console-100",
    recipientId: "recipient-99",
    dataScope: sampleDataScope,
    reason: "Supplier ingredient certification currently unavailable.",
  });

  assert.equal(event.type, "decision");
  assert.equal(event.payload.response, "cannot_determine");

  const validation = validateHandshakeEvent(event);
  assert.equal(validation.success, true);

  // Requires reason/rationale
  assert.throws(
    () => buildCannotDetermineDecisionPayload({ reason: " " }),
    /Reason \(rationale\) is required/,
  );
});

test("unified createRecipientDecisionEvent and recordRecipientDecision ledger integration", () => {
  const storage = createMockStorage();
  const emittedEvents = [];
  const deps = {
    storage,
    emit(event) {
      emittedEvents.push(event);
    },
  };

  const decisionInputs = [
    { response: "accept", rationale: "Accepted" },
    {
      response: "required_change",
      requiredChanges: ["Change A"],
      rationale: "Needs change",
    },
    { response: "decline", rationale: "Declined" },
    { response: "cannot_determine", reason: "Unknown status" },
  ];

  for (const input of decisionInputs) {
    const event = createRecipientDecisionEvent({
      handshakeId: "handshake-unified",
      recipientId: "recipient-99",
      dataScope: sampleDataScope,
      decisionInput: input,
    });

    const recorded = recordRecipientDecision(event, deps);
    assert.equal(recorded.eventId, event.eventId);
  }

  assert.equal(emittedEvents.length, 4);
  const ledger = readHandshakeEventLedger(storage);
  assert.equal(ledger.events.length, 4);
  assert.equal(ledger.events[0].payload.response, "accept");
  assert.equal(ledger.events[1].payload.response, "required_change");
  assert.equal(ledger.events[2].payload.response, "decline");
  assert.equal(ledger.events[3].payload.response, "cannot_determine");
});
