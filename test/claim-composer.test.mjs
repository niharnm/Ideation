import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_COMPOSER_COPY,
  CLAIM_COMPOSER_COPY_CHECKLIST,
  MAX_CLAIM_DURATION_MS,
  composeClaim,
  minimizeClaimScope,
  validateClaimDraft,
} from "../src/index.ts";

function draft() {
  return {
    purpose: "Prepare one restaurant order",
    fields: [
      { id: "order.constraint.peanut", label: "Peanut constraint", selected: true },
      { id: "order.constraint.dairy", label: "Dairy constraint", selected: true },
      { id: "order.note", label: "Order note", selected: false },
    ],
    validFrom: "2026-08-12T00:00:00Z",
    validUntil: "2026-08-12T02:00:00Z",
    choice: "approve",
  };
}

function invalidPaths(value) {
  const result = validateClaimDraft(value);
  assert.equal(result.success, false);
  return result.issues.map((issue) => issue.path);
}

test("composes an explicit choice and exact selected fields into N1 dataScope", () => {
  const result = composeClaim(draft());

  assert.deepEqual(result, {
    success: true,
    value: {
      dataScope: {
        purpose: "Prepare one restaurant order",
        fields: [
          { id: "order.constraint.peanut", label: "Peanut constraint" },
          { id: "order.constraint.dairy", label: "Dairy constraint" },
        ],
        validFrom: "2026-08-12T00:00:00Z",
        validUntil: "2026-08-12T02:00:00Z",
      },
      choice: "approve",
    },
  });
});

test("requires an explicit approve or deny choice", () => {
  for (const choice of [null, undefined, "later"]) {
    const candidate = draft();
    candidate.choice = choice;
    assert.ok(invalidPaths(candidate).includes("$.choice"));
  }

  const denied = draft();
  denied.choice = "deny";
  assert.equal(validateClaimDraft(denied).success, true);
});

test("rejects empty purpose and empty field selection", () => {
  const candidate = draft();
  candidate.purpose = "  ";
  candidate.fields = candidate.fields.map((field) => ({
    ...field,
    selected: false,
  }));

  const paths = invalidPaths(candidate);
  assert.ok(paths.includes("$.purpose"));
  assert.ok(paths.includes("$.fields"));
});

test("rejects broad profile fields and duplicate field IDs", () => {
  for (const broadId of ["PROFILE", "profile.*", "user.profile", "user.*"]) {
    const broad = draft();
    broad.fields[0].id = broadId;
    assert.ok(invalidPaths(broad).includes("$.fields[0].id"));
  }

  const duplicate = draft();
  duplicate.fields[1].id = duplicate.fields[0].id;
  assert.ok(invalidPaths(duplicate).includes("$.fields[1].id"));
});

test("requires valid ordered bounds no longer than 24 hours", () => {
  const exactMaximum = draft();
  exactMaximum.validUntil = "2026-08-13T00:00:00Z";
  assert.equal(validateClaimDraft(exactMaximum).success, true);
  assert.equal(
    Date.parse(exactMaximum.validUntil) - Date.parse(exactMaximum.validFrom),
    MAX_CLAIM_DURATION_MS,
  );

  const tooLong = draft();
  tooLong.validUntil = "2026-08-13T00:00:01Z";
  assert.ok(invalidPaths(tooLong).includes("$.validUntil"));

  const reversed = draft();
  reversed.validUntil = reversed.validFrom;
  assert.ok(invalidPaths(reversed).includes("$.validUntil"));

  const invalid = draft();
  invalid.validFrom = "tomorrow";
  assert.ok(invalidPaths(invalid).includes("$.validFrom"));
});

test("minimizes only selected fields while preserving IDs, labels, and time bounds", () => {
  const original = draft();
  const minimized = minimizeClaimScope(original, [
    "order.constraint.peanut",
    "order.note",
  ]);

  assert.notEqual(minimized, original);
  assert.deepEqual(minimized.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint", selected: true },
    { id: "order.constraint.dairy", label: "Dairy constraint", selected: false },
    { id: "order.note", label: "Order note", selected: false },
  ]);
  assert.equal(minimized.validFrom, original.validFrom);
  assert.equal(minimized.validUntil, original.validUntil);
  assert.equal(minimized.choice, original.choice);

  const result = composeClaim(minimized);
  assert.equal(result.success, true);
  assert.deepEqual(result.value.dataScope.fields, [
    { id: "order.constraint.peanut", label: "Peanut constraint" },
  ]);

  assert.deepEqual(original, draft());
});

test("does not let minimization silently create an empty or standing grant", () => {
  const minimized = minimizeClaimScope(draft(), []);
  assert.ok(invalidPaths(minimized).includes("$.fields"));

  const unknownExtension = { ...draft(), standingAccess: true };
  assert.ok(invalidPaths(unknownExtension).includes("$.standingAccess"));
});

test("exports complete and distinct consent copy", () => {
  assert.match(CLAIM_COMPOSER_COPY.approveAction, /^Approve /);
  assert.match(CLAIM_COMPOSER_COPY.denyAction, /^Deny /);
  assert.notEqual(
    CLAIM_COMPOSER_COPY.approveAction,
    CLAIM_COMPOSER_COPY.denyAction,
  );
  assert.match(CLAIM_COMPOSER_COPY.approveAction, /Access ends at the stated time\./);
  assert.deepEqual(
    CLAIM_COMPOSER_COPY_CHECKLIST.map((item) => item.id),
    ["purpose", "scope", "duration", "approve", "deny"],
  );
  assert.ok(
    CLAIM_COMPOSER_COPY_CHECKLIST.every((item) => item.copy.trim().length > 0),
  );
});
