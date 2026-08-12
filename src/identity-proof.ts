export const CREDENTIAL_BACKED_FIELD_ID = "order.constraint.peanut";

export const DEMO_DIETARY_CREDENTIAL = {
  issuer: "Cedar Health Clinic",
  issuerType: "demo issuer",
  subjectId: "claimant-1",
  fieldId: CREDENTIAL_BACKED_FIELD_ID,
  label: "Peanut avoidance requirement",
  status: "valid",
  verification: "Locally verified for this demo",
  neverShared: ["diagnosis", "medical records", "chat history", "other dietary notes"],
  correction: "Ask the issuer to correct and reissue the credential.",
} as const;

export function isCredentialBackedField(fieldId: string): boolean {
  return fieldId === CREDENTIAL_BACKED_FIELD_ID;
}
