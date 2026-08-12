import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
  approveScopedRequest,
  buildAcknowledgementEvent,
  buildDecisionEvent,
  canUseScopedClaim,
  composeClaimantReceipt,
  denyScopedRequest,
  expireScopedClaimIfNeeded,
  readHandshakeEventLedger,
  readScopedGrantForRecipient,
  revokeScopedClaim,
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

function requestInput() {
  return {
    claimantId: "claimant-17",
    recipient: { id: "kitchen-17", displayName: "Harbor Kitchen" },
    summary: "Use the selected dietary constraint for this order only.",
    draft: {
      purpose: "Prepare this restaurant order",
      fields: [
        { id: "order.constraint.peanut", label: "Peanut constraint", selected: true },
        { id: "order.constraint.dairy", label: "Dairy constraint", selected: false },
      ],
      validFrom: "2026-08-12T18:00:00Z",
      validUntil: "2026-08-12T18:30:00Z",
      choice: null,
    },
  };
}

function dependencies(storage = new MemoryStorage(), now = "2026-08-12T18:00:00Z") {
  let nextId = 0;
  const events = [];
  return {
    events,
    storage,
    value: {
      storage,
      emit: (event) => events.push(event),
      now: () => new Date(now),
      createId: () => `local-${++nextId}`,
    },
  };
}

function recipientResponse(request, response) {
  const decision = buildDecisionEvent({
    handshakeId: request.handshakeId,
    actorId: request.payload.recipient.id,
    dataScope: request.dataScope,
    occurredAt: "2026-08-12T18:05:00Z",
    decision: {
      response,
      rationale: `Recipient response: ${response}.`,
      ...(response === "required_change"
        ? { requiredChanges: ["Confirm a separate preparation surface."] }
        : {}),
    },
  });
  const acknowledgement = buildAcknowledgementEvent({
    handshakeId: request.handshakeId,
    actorId: "kitchen-manager-17",
    roleName: "kitchen manager",
    decisionEventId: decision.eventId,
    outcome: "acknowledged",
    note: "The recipient response was acknowledged.",
    dataScope: request.dataScope,
    occurredAt: "2026-08-12T18:06:00Z",
  });
  return { decision, acknowledgement };
}

test("initiator denial records the requested scope but creates no usable grant", () => {
  const context = dependencies();
  const denied = denyScopedRequest(requestInput(), context.value);

  assert.equal(denied.success, true);
  assert.deepEqual(context.events.map((event) => event.type), ["request", "consent"]);
  assert.deepEqual(denied.value.requestEvent.dataScope.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
    { id: "order.constraint.dairy", label: "Dairy constraint" },
  ]);
  assert.equal(denied.value.consentEvent.payload.choice, "deny");
  assert.equal(canUseScopedClaim(context.storage, new Date("2026-08-12T18:15:00Z")), false);
  assert.deepEqual(
    readHandshakeEventLedger(context.storage).events.map((event) => event.type),
    ["request", "consent"],
  );
});

test("initiator approval limits the grant to selected scope, then expires it", () => {
  const context = dependencies();
  const approved = approveScopedRequest(requestInput(), context.value);

  assert.equal(approved.success, true);
  assert.deepEqual(approved.value.claim.dataScope.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
  ]);
  assert.equal(
    readScopedGrantForRecipient("kitchen-17", context.value, new Date("2026-08-12T18:15:00Z")).allowed,
    true,
  );

  const expired = expireScopedClaimIfNeeded(
    context.value,
    new Date("2026-08-12T18:30:00Z"),
  );
  assert.equal(expired.status, "expired");
  assert.deepEqual(
    readScopedGrantForRecipient("kitchen-17", context.value, new Date("2026-08-12T18:30:00Z")),
    { allowed: false, reason: "expired" },
  );
  assert.deepEqual(context.events.map((event) => event.type), [
    "request",
    "consent",
    "expiry",
  ]);
});

test("only the claimant can revoke an approved grant", () => {
  const context = dependencies();
  const approved = approveScopedRequest(requestInput(), context.value);
  assert.equal(approved.success, true);

  assert.throws(
    () => revokeScopedClaim("kitchen-17", context.value),
    /Only the claimant/,
  );
  const revocation = revokeScopedClaim("claimant-17", context.value);

  assert.equal(revocation.actor.id, "claimant-17");
  assert.deepEqual(
    readScopedGrantForRecipient("kitchen-17", context.value, new Date("2026-08-12T18:15:00Z")),
    { allowed: false, reason: "revoked" },
  );
});

test("claimant receipt previews retain each recipient outcome and required changes", () => {
  for (const response of ["accept", "required_change", "decline", "cannot_determine"]) {
    const context = dependencies();
    const approved = approveScopedRequest(requestInput(), context.value);
    assert.equal(approved.success, true);
    const { decision, acknowledgement } = recipientResponse(
      approved.value.requestEvent,
      response,
    );

    const preview = composeClaimantReceipt(
      [
        approved.value.requestEvent,
        approved.value.consentEvent,
        decision,
        acknowledgement,
      ],
      { now: new Date("2026-08-12T18:07:00Z") },
    );

    assert.equal(preview.success, true, response);
    assert.equal(preview.value.receipt.decision.outcome, response);
    assert.equal(
      preview.value.receipt.decision.rationale,
      `Recipient response: ${response}.`,
    );
    if (response === "required_change") {
      assert.deepEqual(preview.value.receipt.decision.requiredChanges, [
        "Confirm a separate preparation surface.",
      ]);
    } else {
      assert.equal("requiredChanges" in preview.value.receipt.decision, false);
    }
  }
});

test("initiator events remain the only persisted events in a claimant receipt preview", () => {
  const context = dependencies();
  const approved = approveScopedRequest(requestInput(), context.value);
  assert.equal(approved.success, true);
  const { decision, acknowledgement } = recipientResponse(
    approved.value.requestEvent,
    "accept",
  );
  const preview = composeClaimantReceipt(
    [approved.value.requestEvent, approved.value.consentEvent, decision, acknowledgement],
    { now: new Date("2026-08-12T18:07:00Z") },
  );

  assert.equal(preview.success, true);
  assert.equal(preview.value.receipt.authenticity.status, "unverified");
  assert.equal(
    context.storage.getItem(HANDSHAKE_EVENT_LEDGER_STORAGE_KEY) !== null,
    true,
  );
  assert.deepEqual(
    readHandshakeEventLedger(context.storage).events.map((event) => event.type),
    ["request", "consent"],
  );
});
