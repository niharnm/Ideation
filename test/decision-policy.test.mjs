import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePolicy } from "../src/index.ts";

function sampleDataScope(fieldsOverriding) {
  return {
    purpose: "Prepare one restaurant order",
    fields: fieldsOverriding ?? [
      { id: "order.constraint.peanut", label: "Peanut constraint" },
      { id: "order.constraint.dairy", label: "Dairy constraint" },
    ],
    validFrom: "2026-08-12T00:00:00Z",
    validUntil: "2026-08-12T02:00:00Z",
  };
}

test("returns accept when all requested fields are confirmed and valid in recipientData", () => {
  const dataScope = sampleDataScope();
  const recipientData = {
    "order.constraint.peanut": true,
    "order.constraint.dairy": { confirmed: true, value: "no_dairy" },
  };

  const decision = evaluatePolicy({ dataScope, recipientData });

  assert.equal(decision.response, "accept");
  assert.ok(decision.rationale.length > 0);
  assert.equal(decision.requiredChanges, undefined);
});

test("returns cannot_determine when requested data fields are missing or incomplete", () => {
  const dataScope = sampleDataScope();
  
  // Missing order.constraint.dairy field
  const recipientDataPartial = {
    "order.constraint.peanut": true,
  };

  const decisionPartial = evaluatePolicy({
    dataScope,
    recipientData: recipientDataPartial,
  });

  assert.equal(decisionPartial.response, "cannot_determine");
  assert.match(decisionPartial.rationale, /Dairy constraint/);
  assert.equal(decisionPartial.requiredChanges, undefined);

  // Field present but status is missing / unconfirmed
  const recipientDataUnconfirmed = {
    "order.constraint.peanut": true,
    "order.constraint.dairy": { confirmed: false },
  };

  const decisionUnconfirmed = evaluatePolicy({
    dataScope,
    recipientData: recipientDataUnconfirmed,
  });

  assert.equal(decisionUnconfirmed.response, "cannot_determine");
  assert.equal(decisionUnconfirmed.requiredChanges, undefined);
});

test("returns decline when requested fields violate policy or time window is invalid", () => {
  const dataScope = sampleDataScope();
  const recipientDataDeclined = {
    "order.constraint.peanut": true,
    "order.constraint.dairy": { allowed: false, reason: "Ingredient unavailable" },
  };

  const decisionDeclined = evaluatePolicy({
    dataScope,
    recipientData: recipientDataDeclined,
  });

  assert.equal(decisionDeclined.response, "decline");
  assert.match(decisionDeclined.rationale, /Ingredient unavailable/);
  assert.equal(decisionDeclined.requiredChanges, undefined);

  // Invalid validity period
  const invalidScope = {
    ...dataScope,
    validFrom: "2026-08-12T02:00:00Z",
    validUntil: "2026-08-12T01:00:00Z",
  };

  const decisionInvalidWindow = evaluatePolicy({
    dataScope: invalidScope,
    recipientData: { "order.constraint.peanut": true, "order.constraint.dairy": true },
  });

  assert.equal(decisionInvalidWindow.response, "decline");
  assert.match(decisionInvalidWindow.rationale, /validUntil must be after validFrom/);
});

test("returns required_change when policy mandates modifications to requested fields", () => {
  const dataScope = sampleDataScope();
  const recipientDataChange = {
    "order.constraint.peanut": true,
    "order.constraint.dairy": {
      status: "required_change",
      requiredChange: "Specify threshold level for dairy sensitivity.",
    },
  };

  const decision = evaluatePolicy({
    dataScope,
    recipientData: recipientDataChange,
  });

  assert.equal(decision.response, "required_change");
  assert.ok(Array.isArray(decision.requiredChanges));
  assert.equal(decision.requiredChanges.length, 1);
  assert.equal(
    decision.requiredChanges[0],
    "Specify threshold level for dairy sensitivity.",
  );
});

test("strictly handles empty dataScope or missing inputs with cannot_determine", () => {
  const emptyScope = {
    purpose: "Empty scope",
    fields: [],
    validFrom: "2026-08-12T00:00:00Z",
    validUntil: "2026-08-12T02:00:00Z",
  };

  const decisionEmpty = evaluatePolicy({
    dataScope: emptyScope,
    recipientData: {},
  });

  assert.equal(decisionEmpty.response, "cannot_determine");

  const decisionNullInput = evaluatePolicy(null);
  assert.equal(decisionNullInput.response, "cannot_determine");
});
