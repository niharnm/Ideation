import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HANDSHAKE_EVENT_SCHEMA_VERSION,
  approveScopedRequest,
  buildAcknowledgementEvent,
  buildDecisionEvent,
  composeClaimantReceipt,
  previewClaimantReceipt,
  previewDemoLinkedEvents,
  readHandshakeEventLedger,
  runAllergyOrderingFlow,
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

function dependencies(storage = new MemoryStorage(), now = "2026-08-12T18:07:00Z") {
  const events = [];
  return {
    events,
    storage,
    value: {
      storage,
      emit: (event) => events.push(event),
      now: () => new Date(now),
      createId: () => "unused-id",
    },
  };
}

function approvedEvents(context) {
  const result = approveScopedRequest(
    {
      claimantId: "claimant-1",
      recipient: { id: "recipient-1", displayName: "Recipient" },
      summary: "Use selected fields for one order.",
      draft: {
        purpose: "Prepare one restaurant order",
        fields: [
          { id: "order.constraint.peanut", label: "Peanut constraint", selected: true },
          { id: "order.constraint.dairy", label: "Dairy constraint", selected: false },
        ],
        validFrom: "2026-08-12T18:00:00Z",
        validUntil: "2026-08-12T18:30:00Z",
        choice: null,
      },
    },
    {
      ...context.value,
      now: () => new Date("2026-08-12T18:00:00Z"),
    },
  );
  assert.equal(result.success, true);
  return {
    request: result.value.requestEvent,
    consent: result.value.consentEvent,
  };
}

function recipientEvents(request, decision = {}) {
  const decisionEvent = buildDecisionEvent({
    handshakeId: request.handshakeId,
    actorId: request.payload.recipient.id,
    dataScope: request.dataScope,
    decision: {
      response: "accept",
      rationale: "The selected constraint can be followed for this order.",
      ...decision,
    },
    occurredAt: "2026-08-12T18:05:00Z",
  });
  const acknowledgement = buildAcknowledgementEvent({
    handshakeId: request.handshakeId,
    actorId: "acknowledger-1",
    roleName: "shift manager",
    decisionEventId: decisionEvent.eventId,
    outcome: "acknowledged",
    note: "The recipient team received the decision.",
    dataScope: request.dataScope,
    occurredAt: "2026-08-12T18:06:00Z",
  });
  return { decision: decisionEvent, acknowledgement };
}

function completeChain(decision = {}) {
  const context = dependencies();
  const { request, consent } = approvedEvents(context);
  const recipient = recipientEvents(request, decision);
  return { context, request, consent, ...recipient };
}

function terminalEvent(chain, type, occurredAt) {
  return {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `event-${type}`,
    handshakeId: chain.request.handshakeId,
    type,
    occurredAt,
    actor:
      type === "expiry"
        ? { id: "claim-ledger", role: "system" }
        : { id: chain.request.actor.id, role: "claimant" },
    dataScope: chain.request.dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload:
      type === "expiry"
        ? { reason: "duration_elapsed" }
        : { reason: "The claimant ended access." },
  };
}

function issuePaths(events) {
  const result = composeClaimantReceipt(events, {
    now: new Date("2026-08-12T18:07:00Z"),
  });
  assert.equal(result.success, false);
  return result.issues.map((issue) => issue.path);
}

test("builds an unverified preview with pending intended delivery", () => {
  const chain = completeChain();
  const result = composeClaimantReceipt(
    [chain.request, chain.consent, chain.decision, chain.acknowledgement],
    { now: new Date("2026-08-12T18:07:00Z") },
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.value.receipt.authenticity, {
    status: "unverified",
    message: "Local browser data is not authenticated proof of recipient action.",
  });
  assert.deepEqual(result.value.receipt.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
  ]);
  assert.deepEqual(result.value.receipt.decision, {
    outcome: "accept",
    rationale: "The selected constraint can be followed for this order.",
  });
  assert.equal(result.value.receipt.acknowledgement.roleName, "shift manager");
  assert.deepEqual(result.value.receipt.delivery, {
    status: "pending",
    intendedRecipients: [
      { id: "claimant-1", role: "claimant", displayName: "Claimant" },
      { id: "recipient-1", role: "recipient", displayName: "Recipient" },
    ],
  });
  assert.equal("receiptEvent" in result.value, false);
});

test("refuses mixed handshakes, changed scopes, and an unlinked acknowledgement", () => {
  const chain = completeChain();
  const wrongHandshake = structuredClone(chain.decision);
  wrongHandshake.handshakeId = "handshake-other";
  assert.ok(
    issuePaths([
      chain.request,
      chain.consent,
      wrongHandshake,
      chain.acknowledgement,
    ]).includes("$.events"),
  );

  const changedScope = structuredClone(chain.decision);
  changedScope.dataScope.fields[0].label = "Changed field";
  assert.ok(
    issuePaths([
      chain.request,
      chain.consent,
      changedScope,
      chain.acknowledgement,
    ]).includes("$.decision.dataScope"),
  );

  const wrongReference = structuredClone(chain.acknowledgement);
  wrongReference.payload.decisionEventId = "event-other";
  assert.ok(
    issuePaths([
      chain.request,
      chain.consent,
      chain.decision,
      wrongReference,
    ]).includes("$.acknowledgement.payload.decisionEventId"),
  );
});

test("demo intake rejects duplicate event IDs and never persists recipient events", () => {
  const context = dependencies();
  const { request } = approvedEvents(context);
  const incoming = recipientEvents(request);
  const duplicate = structuredClone(incoming.acknowledgement);
  duplicate.eventId = incoming.decision.eventId;

  const rejected = previewDemoLinkedEvents(
    request.handshakeId,
    [incoming.decision, duplicate],
    context.value,
  );
  assert.equal(rejected.success, false);
  assert.match(rejected.issues[0].message, /duplicate eventIds/);

  const preview = previewDemoLinkedEvents(
    request.handshakeId,
    [incoming.decision, incoming.acknowledgement],
    context.value,
  );
  assert.equal(preview.success, true);
  assert.deepEqual(
    readHandshakeEventLedger(context.storage).events.map((event) => event.type),
    ["request", "consent"],
  );
  assert.deepEqual(context.events.map((event) => event.type), ["request", "consent"]);
  assert.equal(previewClaimantReceipt(request.handshakeId, context.value).success, false);
});

test("rejects decisions or acknowledgements after access ended", () => {
  const chain = completeChain();
  const expiryBeforeDecision = terminalEvent(
    chain,
    "expiry",
    "2026-08-12T18:04:00Z",
  );
  assert.ok(
    issuePaths([
      chain.request,
      chain.consent,
      chain.decision,
      chain.acknowledgement,
      expiryBeforeDecision,
    ]).includes("$.decision.occurredAt"),
  );

  const revocationBeforeAcknowledgement = terminalEvent(
    chain,
    "revocation",
    "2026-08-12T18:05:30Z",
  );
  assert.ok(
    issuePaths([
      chain.request,
      chain.consent,
      chain.decision,
      chain.acknowledgement,
      revocationBeforeAcknowledgement,
    ]).includes("$.acknowledgement.occurredAt"),
  );
});

test("preserves a valid pre-terminal decision and reports ended access", () => {
  const chain = completeChain();
  const expiry = terminalEvent(chain, "expiry", "2026-08-12T18:10:00Z");
  const result = composeClaimantReceipt(
    [chain.request, chain.consent, chain.decision, chain.acknowledgement, expiry],
    { now: new Date("2026-08-12T18:11:00Z") },
  );

  assert.equal(result.success, true);
  assert.equal(result.value.receipt.decision.outcome, "accept");
  assert.equal(result.value.receipt.access.status, "expired");
  assert.equal(result.value.receipt.timestamps.terminalAt, expiry.occurredAt);
});

test("keeps required changes in the preview and accepts the merged proof case", () => {
  const required = completeChain({
    response: "required_change",
    rationale: "One change is required.",
    requiredChanges: ["Confirm separate preparation equipment."],
  });
  const requiredResult = composeClaimantReceipt(
    [required.request, required.consent, required.decision, required.acknowledgement],
    { now: new Date("2026-08-12T18:07:00Z") },
  );
  assert.equal(requiredResult.success, true);
  assert.deepEqual(requiredResult.value.receipt.decision.requiredChanges, [
    "Confirm separate preparation equipment.",
  ]);

  const proof = runAllergyOrderingFlow({
    handshakeId: "handshake-proof-receipt",
    claimantId: "claimant-proof",
    restaurantId: "recipient-proof",
    restaurantName: "Recipient proof case",
    acknowledgerRoleName: "Head Chef",
  });
  const proofResult = composeClaimantReceipt(proof.events, {
    now: new Date("2026-08-12T18:05:00Z"),
  });
  assert.equal(proofResult.success, true);
  assert.equal(proofResult.value.receipt.authenticity.status, "unverified");
  assert.equal(proofResult.value.receipt.delivery.status, "pending");
  assert.equal(proofResult.value.receipt.acknowledgement.roleName, "Head Chef");
});

test("renders required changes and pending delivery wording in the claimant view", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(app, /receipt\.decision\.requiredChanges/);
  assert.match(app, /changesLabel\.textContent = "Required changes"/);
  assert.match(
    app,
    /Delivery pending\. No recipient delivery is confirmed\./,
  );
});
