import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDSHAKE_CLAIM_STORAGE_KEY,
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
  ScopedRequestError,
  approveScopedRequest,
  buildAcknowledgementEvent,
  buildDecisionEvent,
  canUseScopedClaim,
  composeClaimantReceipt,
  denyScopedRequest,
  evaluatePolicy,
  expireScopedClaimIfNeeded,
  previewClaimantReceipt,
  previewDemoLinkedEvents,
  readHandshakeEventLedger,
  readScopedClaim,
  readScopedGrantForRecipient,
  revokeScopedClaim,
  validateHandshakeEvent,
} from "../src/index.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

function createTestInput(overrides = {}) {
  return {
    claimantId: "claimant-user-100",
    recipient: { id: "recipient-bistro-500", displayName: "Gourmet Bistro" },
    summary: "Requesting dietary constraint authorization for order #5001",
    draft: {
      purpose: "Fulfill restaurant order #5001 with allergen safety",
      fields: [
        { id: "order.constraint.gluten", label: "Gluten-Free", selected: true },
        { id: "order.constraint.nut", label: "Nut-Free", selected: true },
        { id: "order.constraint.dairy", label: "Dairy-Free", selected: false },
      ],
      validFrom: "2026-08-12T18:00:00Z",
      validUntil: "2026-08-12T19:00:00Z",
      choice: null,
    },
    ...overrides,
  };
}

function createDependencies(
  storage = new MemoryStorage(),
  currentTimeStr = "2026-08-12T18:00:00Z",
) {
  let nextId = 0;
  let current = currentTimeStr;
  const events = [];
  return {
    events,
    storage,
    setNow: (newTimeStr) => { current = newTimeStr; },
    value: {
      storage,
      emit: (event) => events.push(event),
      now: () => new Date(current),
      createId: () => `test-id-${++nextId}`,
    },
  };
}

function buildRecipientChain(requestEvent, decisionParams = {}, ackParams = {}) {
  const decision = buildDecisionEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: requestEvent.payload.recipient.id,
    dataScope: requestEvent.dataScope,
    occurredAt: "2026-08-12T18:05:00Z",
    decision: {
      response: "accept",
      rationale: "Recipient policy accepted all requested constraints.",
      ...decisionParams,
    },
  });

  const acknowledgement = buildAcknowledgementEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: "manager-404",
    roleName: "Kitchen Supervisor",
    decisionEventId: decision.eventId,
    outcome: "acknowledged",
    note: "Order constraints received and acknowledged by staff.",
    dataScope: requestEvent.dataScope,
    occurredAt: "2026-08-12T18:06:00Z",
    ...ackParams,
  });

  return { decision, acknowledgement };
}

// -----------------------------------------------------------------------------
// 1. Full E2E Tracing: request -> consent -> decision -> acknowledgement -> claimant receipt preview
// -----------------------------------------------------------------------------

test("full lifecycle: traces request -> consent -> decision -> acknowledgement -> claimant receipt preview", () => {
  const context = createDependencies();
  const input = createTestInput();

  // 1. Claimant creates request and gives consent (approve) at 18:00:00Z
  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent, consentEvent, claim } = approved.value;

  assert.equal(requestEvent.type, "request");
  assert.equal(consentEvent.type, "consent");
  assert.equal(requestEvent.handshakeId, consentEvent.handshakeId);
  assert.equal(claim.status, "active");
  assert.ok(validateHandshakeEvent(requestEvent).success);
  assert.ok(validateHandshakeEvent(consentEvent).success);

  // 2. Recipient surface reads the active grant
  const recipientRead = readScopedGrantForRecipient(
    input.recipient.id,
    context.value,
    new Date("2026-08-12T18:02:00Z"),
  );
  assert.equal(recipientRead.allowed, true);
  if (recipientRead.allowed) {
    assert.equal(recipientRead.grant.handshakeId, claim.handshakeId);
    assert.equal(recipientRead.grant.recipient.id, input.recipient.id);
    assert.deepEqual(recipientRead.grant.dataScope.fields, [
      { id: "order.constraint.gluten", label: "Gluten-Free" },
      { id: "order.constraint.nut", label: "Nut-Free" },
    ]);
  }

  // 3. Recipient evaluates decision (18:05:00Z) and creates decision & acknowledgement (18:06:00Z) events
  const { decision, acknowledgement } = buildRecipientChain(requestEvent);
  assert.ok(validateHandshakeEvent(decision).success);
  assert.ok(validateHandshakeEvent(acknowledgement).success);

  // 4. Compose claimant receipt preview covering the full traced chain
  const previewResult = composeClaimantReceipt(
    [requestEvent, consentEvent, decision, acknowledgement],
    { now: new Date("2026-08-12T18:10:00Z") },
  );

  assert.equal(previewResult.success, true);
  if (previewResult.success) {
    const receipt = previewResult.value.receipt;
    assert.equal(receipt.handshakeId, requestEvent.handshakeId);
    assert.equal(receipt.authenticity.status, "unverified");
    assert.deepEqual(receipt.fields, [
      { id: "order.constraint.gluten", label: "Gluten-Free" },
      { id: "order.constraint.nut", label: "Nut-Free" },
    ]);
    assert.deepEqual(receipt.recipient, input.recipient);
    assert.equal(receipt.decision.outcome, "accept");
    assert.equal(
      receipt.decision.rationale,
      "Recipient policy accepted all requested constraints.",
    );
    assert.equal(receipt.acknowledgement.roleName, "Kitchen Supervisor");
    assert.equal(receipt.acknowledgement.outcome, "acknowledged");
    assert.equal(receipt.acknowledgement.note, "Order constraints received and acknowledged by staff.");

    // Verify accurate timestamps tracing
    assert.equal(receipt.timestamps.requestedAt, "2026-08-12T18:00:00.000Z");
    assert.equal(receipt.timestamps.consentedAt, "2026-08-12T18:00:00.000Z");
    assert.equal(receipt.timestamps.decidedAt, "2026-08-12T18:05:00Z");
    assert.equal(receipt.timestamps.acknowledgedAt, "2026-08-12T18:06:00Z");
    assert.equal(receipt.timestamps.preparedAt, "2026-08-12T18:10:00.000Z");

    assert.equal(receipt.access.status, "active");
    assert.equal(receipt.access.validUntil, "2026-08-12T19:00:00Z");

    assert.equal(receipt.delivery.status, "pending");
    assert.deepEqual(receipt.delivery.intendedRecipients, [
      { id: input.claimantId, role: "claimant", displayName: "Claimant" },
      {
        id: input.recipient.id,
        role: "recipient",
        displayName: input.recipient.displayName,
      },
    ]);
  }
});

// -----------------------------------------------------------------------------
// 2. Revocation Checks
// -----------------------------------------------------------------------------

test("revocation: claimant revocation emits revocation event and blocks recipient reads", () => {
  const context = createDependencies();
  const input = createTestInput();

  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent, consentEvent } = approved.value;

  // Confirm recipient can read active grant before revocation
  const activeRead = readScopedGrantForRecipient(
    input.recipient.id,
    context.value,
    new Date("2026-08-12T18:02:00Z"),
  );
  assert.equal(activeRead.allowed, true);

  // Set time for revocation after decision & acknowledgement
  context.setNow("2026-08-12T18:10:00Z");

  // Claimant revokes the claim
  const revocationReason = "Claimant updated order and cancelled access.";
  const revocation = revokeScopedClaim(
    input.claimantId,
    context.value,
    revocationReason,
  );

  // Verify revocation event structure and validation
  assert.equal(revocation.type, "revocation");
  assert.equal(revocation.actor.id, input.claimantId);
  assert.equal(revocation.actor.role, "claimant");
  assert.equal(revocation.payload.reason, revocationReason);
  assert.ok(validateHandshakeEvent(revocation).success);

  // Verify ledger reflects request -> consent -> revocation
  const ledger = readHandshakeEventLedger(context.storage);
  assert.deepEqual(
    ledger.events.map((evt) => evt.type),
    ["request", "consent", "revocation"],
  );

  // Verify stored claim status updated to revoked
  const storedClaim = readScopedClaim(context.storage);
  assert.equal(storedClaim?.status, "revoked");
  assert.equal(storedClaim?.revocationEventId, revocation.eventId);

  // Verify canUseScopedClaim returns false
  assert.equal(
    canUseScopedClaim(context.storage, new Date("2026-08-12T18:20:00Z")),
    false,
  );

  // Verify future recipient reads are blocked
  const revokedRead = readScopedGrantForRecipient(
    input.recipient.id,
    context.value,
    new Date("2026-08-12T18:20:00Z"),
  );
  assert.deepEqual(revokedRead, { allowed: false, reason: "revoked" });

  // Verify claimant receipt preview reflects revoked access status and includes terminalAt
  const { decision, acknowledgement } = buildRecipientChain(requestEvent);
  const preview = composeClaimantReceipt(
    [requestEvent, consentEvent, decision, acknowledgement, revocation],
    { now: new Date("2026-08-12T18:25:00Z") },
  );

  assert.equal(preview.success, true);
  if (preview.success) {
    assert.equal(preview.value.receipt.access.status, "revoked");
    assert.equal(
      preview.value.receipt.timestamps.terminalAt,
      revocation.occurredAt,
    );
  }
});

test("revocation: non-claimants cannot revoke active grant", () => {
  const context = createDependencies();
  const input = createTestInput();
  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);

  assert.throws(
    () => revokeScopedClaim("unauthorized-actor", context.value),
    (err) => {
      assert.ok(err instanceof ScopedRequestError);
      assert.match(
        err.message,
        /Only the claimant who approved this scoped claim can revoke it/,
      );
      return true;
    },
  );
});

// -----------------------------------------------------------------------------
// 3. Expiry Checks
// -----------------------------------------------------------------------------

test("expiry: expired claims block recipient reads and emit expiry event", () => {
  const context = createDependencies();
  const input = createTestInput({
    draft: {
      purpose: "Time-limited preparation window",
      fields: [
        { id: "order.constraint.gluten", label: "Gluten-Free", selected: true },
      ],
      validFrom: "2026-08-12T18:00:00Z",
      validUntil: "2026-08-12T18:30:00Z",
      choice: null,
    },
  });

  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent, consentEvent } = approved.value;

  // Read prior to expiry
  const validRead = readScopedGrantForRecipient(
    input.recipient.id,
    context.value,
    new Date("2026-08-12T18:15:00Z"),
  );
  assert.equal(validRead.allowed, true);

  // Read after validity window (18:30:01Z)
  const expiredTime = new Date("2026-08-12T18:30:01Z");
  const expiredRead = readScopedGrantForRecipient(
    input.recipient.id,
    context.value,
    expiredTime,
  );

  // Verify recipient read is blocked
  assert.deepEqual(expiredRead, { allowed: false, reason: "expired" });

  // Verify expiry event was emitted
  const expiryEvent = context.events.find((evt) => evt.type === "expiry");
  assert.ok(expiryEvent, "Expiry event should be emitted");
  if (expiryEvent) {
    assert.equal(expiryEvent.type, "expiry");
    assert.equal(expiryEvent.actor.id, "claim-ledger");
    assert.equal(expiryEvent.actor.role, "system");
    assert.equal(expiryEvent.payload.reason, "duration_elapsed");
    assert.ok(validateHandshakeEvent(expiryEvent).success);
  }

  // Verify stored claim status updated to expired
  const storedClaim = readScopedClaim(context.storage);
  assert.equal(storedClaim?.status, "expired");
  assert.equal(storedClaim?.expiryEventId, expiryEvent?.eventId);

  // Verify canUseScopedClaim returns false
  assert.equal(canUseScopedClaim(context.storage, expiredTime), false);

  // Verify claimant receipt preview reflects expired access status and terminalAt timestamp
  const { decision, acknowledgement } = buildRecipientChain(requestEvent);
  const preview = composeClaimantReceipt(
    [requestEvent, consentEvent, decision, acknowledgement, expiryEvent],
    { now: new Date("2026-08-12T18:35:00Z") },
  );

  assert.equal(preview.success, true);
  if (preview.success) {
    assert.equal(preview.value.receipt.access.status, "expired");
    assert.equal(
      preview.value.receipt.timestamps.terminalAt,
      expiryEvent.occurredAt,
    );
  }
});

// -----------------------------------------------------------------------------
// 4. Decision Outcomes (accept, required_change, decline, cannot_determine)
// -----------------------------------------------------------------------------

test("decision outcomes: evaluates 'accept' across policy, recipient view, and claimant receipt preview", () => {
  const context = createDependencies();
  const input = createTestInput();
  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent, consentEvent } = approved.value;

  // 1. Recipient policy evaluation
  const recipientData = {
    "order.constraint.gluten": true,
    "order.constraint.nut": true,
  };
  const policyResult = evaluatePolicy({
    dataScope: requestEvent.dataScope,
    recipientData,
  });
  assert.equal(policyResult.response, "accept");
  assert.match(policyResult.rationale, /All requested fields are satisfied/);

  // 2. Build decision and acknowledgement events matching policy outcome
  const decision = buildDecisionEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: input.recipient.id,
    dataScope: requestEvent.dataScope,
    decision: policyResult,
    occurredAt: "2026-08-12T18:05:00Z",
  });
  const acknowledgement = buildAcknowledgementEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: "staff-1",
    roleName: "Head Chef",
    decisionEventId: decision.eventId,
    outcome: "acknowledged",
    dataScope: requestEvent.dataScope,
    occurredAt: "2026-08-12T18:06:00Z",
  });

  // 3. Verify claimant receipt preview
  const preview = composeClaimantReceipt(
    [requestEvent, consentEvent, decision, acknowledgement],
    { now: new Date("2026-08-12T18:10:00Z") },
  );

  assert.equal(preview.success, true);
  if (preview.success) {
    assert.equal(preview.value.receipt.decision.outcome, "accept");
    assert.equal(preview.value.receipt.decision.rationale, policyResult.rationale);
    assert.equal("requiredChanges" in preview.value.receipt.decision, false);
  }
});

test("decision outcomes: evaluates 'required_change' across policy, recipient view, and claimant receipt preview", () => {
  const context = createDependencies();
  const input = createTestInput();
  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent, consentEvent } = approved.value;

  // 1. Recipient policy evaluation requires modifications
  const recipientData = {
    "order.constraint.gluten": {
      status: "required_change",
      requiredChange: "Prepare order in dedicated gluten-free kitchen station.",
    },
    "order.constraint.nut": true,
  };
  const policyResult = evaluatePolicy({
    dataScope: requestEvent.dataScope,
    recipientData,
  });

  assert.equal(policyResult.response, "required_change");
  assert.deepEqual(policyResult.requiredChanges, [
    "Prepare order in dedicated gluten-free kitchen station.",
  ]);

  // 2. Build decision and acknowledgement events
  const decision = buildDecisionEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: input.recipient.id,
    dataScope: requestEvent.dataScope,
    decision: policyResult,
    occurredAt: "2026-08-12T18:05:00Z",
  });
  const acknowledgement = buildAcknowledgementEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: "staff-1",
    roleName: "Station Manager",
    decisionEventId: decision.eventId,
    outcome: "acknowledged",
    note: "Customer notified of kitchen station requirement.",
    dataScope: requestEvent.dataScope,
    occurredAt: "2026-08-12T18:06:00Z",
  });

  // 3. Verify claimant receipt preview retains required changes
  const preview = composeClaimantReceipt(
    [requestEvent, consentEvent, decision, acknowledgement],
    { now: new Date("2026-08-12T18:10:00Z") },
  );

  assert.equal(preview.success, true);
  if (preview.success) {
    assert.equal(preview.value.receipt.decision.outcome, "required_change");
    assert.deepEqual(preview.value.receipt.decision.requiredChanges, [
      "Prepare order in dedicated gluten-free kitchen station.",
    ]);
    assert.equal(
      preview.value.receipt.acknowledgement.note,
      "Customer notified of kitchen station requirement.",
    );
  }
});

test("decision outcomes: evaluates 'decline' across policy, recipient view, and claimant receipt preview", () => {
  const context = createDependencies();
  const input = createTestInput();
  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent, consentEvent } = approved.value;

  // 1. Recipient policy evaluation declines due to restricted field constraint
  const recipientData = {
    "order.constraint.gluten": true,
    "order.constraint.nut": {
      status: "declined",
      reason: "Facility processes tree nuts and cannot prevent cross-contamination.",
    },
  };
  const policyResult = evaluatePolicy({
    dataScope: requestEvent.dataScope,
    recipientData,
  });

  assert.equal(policyResult.response, "decline");
  assert.match(policyResult.rationale, /declines request due to field constraints/);

  // 2. Build decision and acknowledgement events
  const decision = buildDecisionEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: input.recipient.id,
    dataScope: requestEvent.dataScope,
    decision: policyResult,
    occurredAt: "2026-08-12T18:05:00Z",
  });
  const acknowledgement = buildAcknowledgementEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: "staff-1",
    roleName: "Order Registrar",
    decisionEventId: decision.eventId,
    outcome: "rejected",
    note: "Declined order safety parameters.",
    dataScope: requestEvent.dataScope,
    occurredAt: "2026-08-12T18:06:00Z",
  });

  // 3. Verify claimant receipt preview reflects decline outcome and rejected acknowledgement
  const preview = composeClaimantReceipt(
    [requestEvent, consentEvent, decision, acknowledgement],
    { now: new Date("2026-08-12T18:10:00Z") },
  );

  assert.equal(preview.success, true);
  if (preview.success) {
    assert.equal(preview.value.receipt.decision.outcome, "decline");
    assert.equal(preview.value.receipt.acknowledgement.outcome, "rejected");
    assert.equal("requiredChanges" in preview.value.receipt.decision, false);
  }
});

test("decision outcomes: evaluates 'cannot_determine' across policy, recipient view, and claimant receipt preview", () => {
  const context = createDependencies();
  const input = createTestInput();
  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent, consentEvent } = approved.value;

  // 1. Recipient policy evaluation missing data for requested field
  const recipientData = {
    "order.constraint.gluten": true,
    // "order.constraint.nut" is omitted/unconfirmed
  };
  const policyResult = evaluatePolicy({
    dataScope: requestEvent.dataScope,
    recipientData,
  });

  assert.equal(policyResult.response, "cannot_determine");
  assert.match(policyResult.rationale, /Missing or unconfirmed recipient data/);

  // 2. Build decision and acknowledgement events
  const decision = buildDecisionEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: input.recipient.id,
    dataScope: requestEvent.dataScope,
    decision: policyResult,
    occurredAt: "2026-08-12T18:05:00Z",
  });
  const acknowledgement = buildAcknowledgementEvent({
    handshakeId: requestEvent.handshakeId,
    actorId: "staff-1",
    roleName: "Front Desk Host",
    decisionEventId: decision.eventId,
    outcome: "acknowledged",
    note: "Pending verification with head chef.",
    dataScope: requestEvent.dataScope,
    occurredAt: "2026-08-12T18:06:00Z",
  });

  // 3. Verify claimant receipt preview reflects cannot_determine outcome
  const preview = composeClaimantReceipt(
    [requestEvent, consentEvent, decision, acknowledgement],
    { now: new Date("2026-08-12T18:10:00Z") },
  );

  assert.equal(preview.success, true);
  if (preview.success) {
    assert.equal(preview.value.receipt.decision.outcome, "cannot_determine");
    assert.equal(
      preview.value.receipt.acknowledgement.note,
      "Pending verification with head chef.",
    );
  }
});

// -----------------------------------------------------------------------------
// 5. Flow Variations & Integration Helpers
// -----------------------------------------------------------------------------

test("denial flow: denyScopedRequest emits request/consent pair without active claim", () => {
  const context = createDependencies();
  const input = createTestInput();

  const denied = denyScopedRequest(input, context.value);
  assert.equal(denied.success, true);
  const { requestEvent, consentEvent } = denied.value;

  assert.equal(requestEvent.type, "request");
  assert.equal(consentEvent.type, "consent");
  assert.equal(consentEvent.payload.choice, "deny");

  // Verify no active claim was stored
  assert.equal(context.storage.getItem(HANDSHAKE_CLAIM_STORAGE_KEY), null);

  // Recipient read returns not_found
  const read = readScopedGrantForRecipient(
    input.recipient.id,
    context.value,
    new Date("2026-08-12T18:05:00Z"),
  );
  assert.deepEqual(read, { allowed: false, reason: "not_found" });
});

test("transient preview: previewDemoLinkedEvents previews recipient events without persisting them to storage", () => {
  const context = createDependencies();
  const input = createTestInput();

  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);
  const { requestEvent } = approved.value;

  const { decision, acknowledgement } = buildRecipientChain(requestEvent);

  // Pass recipient events through previewDemoLinkedEvents
  const demoPreview = previewDemoLinkedEvents(
    requestEvent.handshakeId,
    [decision, acknowledgement],
    context.value,
  );

  assert.equal(demoPreview.success, true);
  if (demoPreview.success) {
    assert.equal(demoPreview.value.receipt.decision.outcome, "accept");
  }

  // Storage should ONLY contain request and consent events (never recipient decision/ack)
  const ledger = readHandshakeEventLedger(context.storage);
  assert.deepEqual(
    ledger.events.map((evt) => evt.type),
    ["request", "consent"],
  );
});

test("preview helper: previewClaimantReceipt fails when recipient decision events are absent from ledger", () => {
  const context = createDependencies();
  const input = createTestInput();

  const approved = approveScopedRequest(input, context.value);
  assert.equal(approved.success, true);

  // previewClaimantReceipt reads only ledger events, which currently lack decision & acknowledgement
  const preview = previewClaimantReceipt(
    approved.value.requestEvent.handshakeId,
    context.value,
  );

  assert.equal(preview.success, false);
  if (!preview.success) {
    assert.ok(
      preview.issues.some((issue) => issue.message.includes("must contain exactly one event")),
    );
  }
});
