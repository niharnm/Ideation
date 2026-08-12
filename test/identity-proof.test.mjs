import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDENTIAL_BACKED_FIELD_ID,
  DEMO_DIETARY_CREDENTIAL,
  isCredentialBackedField,
} from "../src/identity-proof.ts";

test("only the demo issuer's minimum fact is eligible for the Identity presentation", () => {
  assert.equal(DEMO_DIETARY_CREDENTIAL.issuer, "Cedar Health Clinic");
  assert.equal(DEMO_DIETARY_CREDENTIAL.fieldId, CREDENTIAL_BACKED_FIELD_ID);
  assert.equal(DEMO_DIETARY_CREDENTIAL.status, "valid");
  assert.equal(isCredentialBackedField(CREDENTIAL_BACKED_FIELD_ID), true);
  assert.equal(isCredentialBackedField("allergen.shellfish"), false);
});
