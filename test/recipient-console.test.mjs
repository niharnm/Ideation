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
  approveScopedRequest,
  denyScopedRequest,
  revokeScopedClaim,
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

function createApprovedRecipientContext(now = "2026-08-12T00:05:00Z") {
  const storage = createMockStorage();
  const emittedEvents = [];
  let id = 0;
  const deps = {
    storage,
    emit(event) {
      emittedEvents.push(event);
    },
    now: () => new Date(now),
    createId: () => `recipient-test-${++id}`,
  };
  const approval = approveScopedRequest(
    {
      claimantId: "claimant-42",
      recipient: { id: "recipient-99", displayName: "Fine Dining Restaurant" },
      summary: "Scoped order constraints",
      draft: {
        purpose: sampleDataScope.purpose,
        fields: sampleDataScope.fields.map((field) => ({ ...field, selected: true })),
        validFrom: sampleDataScope.validFrom,
        validUntil: sampleDataScope.validUntil,
        choice: null,
      },
    },
    deps,
  );
  assert.equal(approval.success, true);
  return { storage, emittedEvents, deps, approval: approval.value };
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

test("processRecipientRequest rejects denied consent before exposing any fields", () => {
  const deniedConsentEvent = {
    ...sampleConsentEvent,
    payload: { recipientId: "recipient-99", choice: "deny" },
  };

  const rawRecipientData = {
    "order.constraint.peanut": "Severe Peanut Allergy",
    "user.ssn": "999-00-1234",
  };

  assert.throws(
    () => processRecipientRequest(sampleRequestEvent, deniedConsentEvent, rawRecipientData),
    /without approved claimant consent/,
  );
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

  const invalidRequest = { ...sampleRequestEvent, unexpected: true };
  assert.throws(
    () => processRecipientRequest(invalidRequest, sampleConsentEvent, {}),
    /Invalid requestEvent/,
  );
});

test("processRecipientRequest rejects forged consent scope, actors, recipients, and expired events", () => {
  const substitutedScope = structuredClone(sampleConsentEvent);
  substitutedScope.dataScope.fields = [
    { id: "user.ssn", label: "Social Security number" },
  ];
  assert.throws(
    () => processRecipientRequest(sampleRequestEvent, substitutedScope, { "user.ssn": "999-00-1234" }),
    /exactly match the original request/,
  );

  const otherClaimant = structuredClone(sampleConsentEvent);
  otherClaimant.actor.id = "claimant-other";
  assert.throws(
    () => processRecipientRequest(sampleRequestEvent, otherClaimant, {}),
    /owned by the claimant/,
  );

  const otherRecipient = structuredClone(sampleConsentEvent);
  otherRecipient.payload.recipientId = "recipient-other";
  assert.throws(
    () => processRecipientRequest(sampleRequestEvent, otherRecipient, {}),
    /must match the requested recipient/,
  );

  const expiredRequest = structuredClone(sampleRequestEvent);
  const expiredConsent = structuredClone(sampleConsentEvent);
  expiredRequest.occurredAt = "2026-08-12T01:00:00Z";
  expiredConsent.occurredAt = "2026-08-12T01:00:00Z";
  assert.throws(
    () => processRecipientRequest(expiredRequest, expiredConsent, {}),
    /active validity range/,
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
    const context = createApprovedRecipientContext();
    const event = createRecipientDecisionEvent({
      handshakeId: context.approval.requestEvent.handshakeId,
      recipientId: "recipient-99",
      dataScope: context.approval.requestEvent.dataScope,
      decisionInput: input,
      occurredAt: "2026-08-12T00:10:00Z",
    });

    const recorded = recordRecipientDecision(event, context.deps);
    assert.equal(recorded.eventId, event.eventId);
    assert.deepEqual(
      readHandshakeEventLedger(context.storage).events.map((ledgerEvent) => ledgerEvent.type),
      ["request", "consent", "decision"],
    );
  }
});

test("recordRecipientDecision fails closed for denied, expired, revoked, duplicate, and conflicting writes", () => {
  const deniedStorage = createMockStorage();
  const deniedEvents = [];
  let deniedId = 0;
  const deniedDeps = {
    storage: deniedStorage,
    emit(event) {
      deniedEvents.push(event);
    },
    now: () => new Date("2026-08-12T00:05:00Z"),
    createId: () => `denied-${++deniedId}`,
  };
  const denied = denyScopedRequest(
    {
      claimantId: "claimant-42",
      recipient: { id: "recipient-99", displayName: "Fine Dining Restaurant" },
      summary: "Scoped order constraints",
      draft: {
        purpose: sampleDataScope.purpose,
        fields: sampleDataScope.fields.map((field) => ({ ...field, selected: true })),
        validFrom: sampleDataScope.validFrom,
        validUntil: sampleDataScope.validUntil,
        choice: null,
      },
    },
    deniedDeps,
  );
  assert.equal(denied.success, true);
  const deniedDecision = createRecipientDecisionEvent({
    handshakeId: denied.value.requestEvent.handshakeId,
    recipientId: "recipient-99",
    dataScope: denied.value.requestEvent.dataScope,
    decisionInput: { response: "accept" },
    occurredAt: "2026-08-12T00:10:00Z",
  });
  assert.throws(
    () => recordRecipientDecision(deniedDecision, deniedDeps),
    /active scoped grant/,
  );

  const expired = createApprovedRecipientContext("2026-08-12T01:01:00Z");
  const expiredDecision = createRecipientDecisionEvent({
    handshakeId: expired.approval.requestEvent.handshakeId,
    recipientId: "recipient-99",
    dataScope: expired.approval.requestEvent.dataScope,
    decisionInput: { response: "accept" },
    occurredAt: "2026-08-12T00:10:00Z",
  });
  assert.throws(
    () => recordRecipientDecision(expiredDecision, expired.deps),
    /active scoped grant/,
  );
  assert.ok(readHandshakeEventLedger(expired.storage).events.some((event) => event.type === "expiry"));

  const revoked = createApprovedRecipientContext();
  revokeScopedClaim("claimant-42", revoked.deps);
  const revokedDecision = createRecipientDecisionEvent({
    handshakeId: revoked.approval.requestEvent.handshakeId,
    recipientId: "recipient-99",
    dataScope: revoked.approval.requestEvent.dataScope,
    decisionInput: { response: "accept" },
    occurredAt: "2026-08-12T00:10:00Z",
  });
  assert.throws(
    () => recordRecipientDecision(revokedDecision, revoked.deps),
    /active scoped grant/,
  );

  const active = createApprovedRecipientContext();
  const firstDecision = createRecipientDecisionEvent({
    handshakeId: active.approval.requestEvent.handshakeId,
    recipientId: "recipient-99",
    dataScope: active.approval.requestEvent.dataScope,
    decisionInput: { response: "accept" },
    occurredAt: "2026-08-12T00:10:00Z",
  });
  recordRecipientDecision(firstDecision, active.deps);
  assert.throws(
    () => recordRecipientDecision(firstDecision, active.deps),
    /eventId is already recorded/,
  );
  const conflictingDecision = createRecipientDecisionEvent({
    handshakeId: active.approval.requestEvent.handshakeId,
    recipientId: "recipient-99",
    dataScope: active.approval.requestEvent.dataScope,
    decisionInput: { response: "decline", rationale: "Conflicting replay" },
    occurredAt: "2026-08-12T00:11:00Z",
  });
  assert.throws(
    () => recordRecipientDecision(conflictingDecision, active.deps),
    /decision is already recorded/,
  );
});
