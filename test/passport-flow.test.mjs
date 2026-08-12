import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDSHAKE_CLAIM_STORAGE_KEY,
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
  ScopedRequestError,
  approveScopedRequest,
  canUseScopedClaim,
  denyScopedRequest,
  expireScopedClaimIfNeeded,
  readScopedGrantForRecipient,
  readScopedClaim,
  readHandshakeEventLedger,
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

function requestInput() {
  return {
    claimantId: "person-1",
    recipient: { id: "recipient-1", displayName: "Recipient" },
    summary: "Use the selected fields for one restaurant order.",
    draft: {
      purpose: "Prepare one restaurant order",
      fields: [
        {
          id: "order.constraint.peanut",
          label: "Peanut constraint",
          selected: true,
        },
        {
          id: "order.constraint.dairy",
          label: "Dairy constraint",
          selected: false,
        },
      ],
      validFrom: "2026-08-12T18:00:00Z",
      validUntil: "2026-08-12T18:30:00Z",
      choice: null,
    },
  };
}

function dependencies(storage = new MemoryStorage()) {
  let nextId = 0;
  const events = [];
  return {
    events,
    storage,
    value: {
      storage,
      emit: (event) => events.push(event),
      now: () => new Date("2026-08-12T18:00:00Z"),
      createId: () => String(++nextId),
    },
  };
}

test("approval validates the N2 draft and emits valid N1 request and consent events", () => {
  const context = dependencies();
  const result = approveScopedRequest(requestInput(), context.value);

  assert.equal(result.success, true);
  assert.deepEqual(context.events.map((event) => event.type), ["request", "consent"]);
  assert.ok(context.events.every((event) => validateHandshakeEvent(event).success));
  assert.equal(context.events[0].handshakeId, context.events[1].handshakeId);
  assert.deepEqual(context.events[0].dataScope.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
  ]);
  assert.deepEqual(context.events[0].payload.recipient, {
    id: "recipient-1",
    displayName: "Recipient",
  });
  assert.deepEqual(context.events[1].payload, {
    recipientId: "recipient-1",
    choice: "approve",
  });
});

test("approval persists one active claim and rejects an invalid N2 draft without side effects", () => {
  const context = dependencies();
  const approved = approveScopedRequest(requestInput(), context.value);
  assert.equal(approved.success, true);

  const stored = readScopedClaim(context.storage);
  assert.equal(stored.status, "active");
  assert.equal(stored.handshakeId, context.events[0].handshakeId);
  assert.deepEqual(stored.dataScope.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
  ]);
  assert.equal(
    canUseScopedClaim(context.storage, new Date("2026-08-12T18:15:00Z")),
    true,
  );
  assert.equal(
    canUseScopedClaim(context.storage, new Date("2026-08-12T18:30:00Z")),
    false,
  );

  const invalidContext = dependencies();
  const invalidInput = requestInput();
  invalidInput.draft.fields[0].selected = false;
  const invalid = approveScopedRequest(invalidInput, invalidContext.value);
  assert.equal(invalid.success, false);
  assert.deepEqual(invalidContext.events, []);
  assert.equal(invalidContext.storage.getItem(HANDSHAKE_CLAIM_STORAGE_KEY), null);
});

test("denial emits a valid request and denied consent pair and stores no active claim", () => {
  const context = dependencies();
  const deniedInput = requestInput();
  deniedInput.draft.fields.forEach((field) => {
    field.selected = false;
  });
  const result = denyScopedRequest(deniedInput, context.value);

  assert.equal(result.success, true);
  assert.deepEqual(context.events.map((event) => event.type), ["request", "consent"]);
  assert.equal(context.events[0].handshakeId, context.events[1].handshakeId);
  assert.equal(context.events[1].payload.choice, "deny");
  assert.equal(context.events[1].dataScope.fields.length, 2);
  assert.ok(context.events.every((event) => validateHandshakeEvent(event).success));
  assert.equal(context.storage.getItem(HANDSHAKE_CLAIM_STORAGE_KEY), null);
});

test("revocation emits a valid N1 event and leaves a tombstone that blocks future use", () => {
  const context = dependencies();
  const approved = approveScopedRequest(requestInput(), context.value);
  assert.equal(approved.success, true);

  assert.throws(
    () => revokeScopedClaim("person-2", context.value),
    /Only the claimant/,
  );
  assert.equal(context.events.length, 2);

  const revocation = revokeScopedClaim("person-1", context.value);
  assert.equal(revocation.type, "revocation");
  assert.equal(revocation.handshakeId, approved.value.claim.handshakeId);
  assert.equal(validateHandshakeEvent(revocation).success, true);
  assert.deepEqual(context.events.map((event) => event.type), [
    "request",
    "consent",
    "revocation",
  ]);

  const stored = readScopedClaim(context.storage);
  assert.equal(stored.status, "revoked");
  assert.equal(stored.revocationEventId, revocation.eventId);
  assert.equal(
    canUseScopedClaim(context.storage, new Date("2026-08-12T18:15:00Z")),
    false,
  );
  assert.throws(
    () => revokeScopedClaim("person-1", context.value),
    ScopedRequestError,
  );
});

test("event ledger recovers request, consent, and revocation after reload", () => {
  const storage = new MemoryStorage();
  const firstPage = dependencies(storage);
  const approved = approveScopedRequest(requestInput(), firstPage.value);
  assert.equal(approved.success, true);
  revokeScopedClaim("person-1", firstPage.value);

  const reloadedPage = dependencies(storage);
  const ledger = readHandshakeEventLedger(reloadedPage.storage);
  assert.deepEqual(ledger.events.map((event) => event.type), [
    "request",
    "consent",
    "revocation",
  ]);
  assert.ok(ledger.events.every((event) => validateHandshakeEvent(event).success));
});

test("malformed stored recipient and data scope always fail closed", () => {
  for (const change of [
    (claim) => { claim.recipient = { id: "recipient-1" }; },
    (claim) => { claim.dataScope.fields = [{ id: "profile", label: "Profile" }]; },
    (claim) => { claim.dataScope.validUntil = "not-a-time"; },
  ]) {
    const context = dependencies();
    const approved = approveScopedRequest(requestInput(), context.value);
    assert.equal(approved.success, true);
    const malformed = JSON.parse(
      context.storage.getItem(HANDSHAKE_CLAIM_STORAGE_KEY),
    );
    change(malformed);
    context.storage.setItem(
      HANDSHAKE_CLAIM_STORAGE_KEY,
      JSON.stringify(malformed),
    );
    assert.equal(
      canUseScopedClaim(context.storage, new Date("2026-08-12T18:15:00Z")),
      false,
    );
    assert.throws(() => readScopedClaim(context.storage), ScopedRequestError);
  }
});

test("rejects a malformed persisted event ledger on reload", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 1, events: [{ type: "request" }] }),
  );
  assert.throws(() => readHandshakeEventLedger(storage), ScopedRequestError);
});

test("the named recipient can read only the active scoped grant", () => {
  const context = dependencies();
  const approved = approveScopedRequest(requestInput(), context.value);
  assert.equal(approved.success, true);

  const wrongRecipient = readScopedGrantForRecipient(
    "recipient-2",
    context.value,
    new Date("2026-08-12T18:15:00Z"),
  );
  assert.deepEqual(wrongRecipient, {
    allowed: false,
    reason: "recipient_mismatch",
  });

  const read = readScopedGrantForRecipient(
    "recipient-1",
    context.value,
    new Date("2026-08-12T18:15:00Z"),
  );
  assert.equal(read.allowed, true);
  assert.equal(read.grant.handshakeId, approved.value.claim.handshakeId);
  assert.deepEqual(read.grant.dataScope.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
  ]);
  assert.deepEqual(context.events.map((event) => event.type), [
    "request",
    "consent",
  ]);
});

test("expiry emits once, persists through reload, and blocks recipient reads", () => {
  const storage = new MemoryStorage();
  const firstPage = dependencies(storage);
  const approved = approveScopedRequest(requestInput(), firstPage.value);
  assert.equal(approved.success, true);

  const expired = expireScopedClaimIfNeeded(
    firstPage.value,
    new Date("2026-08-12T18:30:00Z"),
  );
  assert.equal(expired.status, "expired");
  assert.deepEqual(firstPage.events.map((event) => event.type), [
    "request",
    "consent",
    "expiry",
  ]);
  assert.equal(validateHandshakeEvent(firstPage.events[2]).success, true);

  const reloadedPage = dependencies(storage);
  const blocked = readScopedGrantForRecipient(
    "recipient-1",
    reloadedPage.value,
    new Date("2026-08-12T18:45:00Z"),
  );
  assert.deepEqual(blocked, { allowed: false, reason: "expired" });
  assert.deepEqual(reloadedPage.events, []);

  const recoveredClaim = readScopedClaim(storage);
  assert.equal(recoveredClaim.status, "expired");
  assert.equal(recoveredClaim.expiryEventId, firstPage.events[2].eventId);
  assert.deepEqual(
    readHandshakeEventLedger(storage).events.map((event) => event.type),
    ["request", "consent", "expiry"],
  );
});

test("revocation blocks later recipient reads", () => {
  const context = dependencies();
  const approved = approveScopedRequest(requestInput(), context.value);
  assert.equal(approved.success, true);
  revokeScopedClaim("person-1", context.value);

  assert.deepEqual(
    readScopedGrantForRecipient(
      "recipient-1",
      context.value,
      new Date("2026-08-12T18:15:00Z"),
    ),
    { allowed: false, reason: "revoked" },
  );
});
