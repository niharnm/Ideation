import {
  HANDSHAKE_EVENT_SCHEMA_VERSION,
  HANDSHAKE_EVENT_TYPES,
  type HandshakeActorRole,
  type HandshakeEvent,
  type HandshakeEventType,
} from "./handshake-event.ts";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: readonly ValidationIssue[] };

type JsonRecord = Record<string, unknown>;

const ACTOR_ROLES: readonly HandshakeActorRole[] = [
  "claimant",
  "recipient",
  "acknowledger",
  "system",
];

const EXPECTED_ROLE: Record<HandshakeEventType, HandshakeActorRole> = {
  request: "claimant",
  consent: "claimant",
  decision: "recipient",
  acknowledgement: "acknowledger",
  receipt: "system",
  expiry: "system",
  revocation: "claimant",
};

const BROAD_SCOPE_IDS = new Set(["*", "all", "profile", "user_profile"]);
const RFC_3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateHandshakeEvent(
  input: unknown,
): ValidationResult<HandshakeEvent> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return failure("$", "must be an object");
  }

  exactKeys(
    input,
    [
      "schemaVersion",
      "eventId",
      "handshakeId",
      "type",
      "occurredAt",
      "actor",
      "dataScope",
      "result",
      "payload",
    ],
    "$",
    issues,
  );

  if (input.schemaVersion !== HANDSHAKE_EVENT_SCHEMA_VERSION) {
    add(issues, "$.schemaVersion", `must equal ${HANDSHAKE_EVENT_SCHEMA_VERSION}`);
  }
  nonEmptyString(input.eventId, "$.eventId", issues);
  nonEmptyString(input.handshakeId, "$.handshakeId", issues);
  timestamp(input.occurredAt, "$.occurredAt", issues);

  const type = isOneOf(input.type, HANDSHAKE_EVENT_TYPES)
    ? input.type
    : undefined;
  if (!type) {
    add(issues, "$.type", "must be a supported handshake event type");
  }

  validateActor(input.actor, type, issues);
  validateDataScope(input.dataScope, issues);
  validateResult(input.result, issues);

  if (type) {
    validatePayload(type, input.payload, issues);
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return { success: true, value: input as unknown as HandshakeEvent };
}

function validateActor(
  value: unknown,
  type: HandshakeEventType | undefined,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    add(issues, "$.actor", "must be an object");
    return;
  }

  exactKeys(value, ["id", "role", "roleName"], "$.actor", issues);
  nonEmptyString(value.id, "$.actor.id", issues);

  if (!isOneOf(value.role, ACTOR_ROLES)) {
    add(issues, "$.actor.role", "must be a supported actor role");
  } else if (type && value.role !== EXPECTED_ROLE[type]) {
    add(issues, "$.actor.role", `must be ${EXPECTED_ROLE[type]} for ${type}`);
  }

  if (value.role === "acknowledger") {
    nonEmptyString(value.roleName, "$.actor.roleName", issues);
  } else if (value.roleName !== undefined) {
    add(issues, "$.actor.roleName", "is only allowed for an acknowledger");
  }
}

function validateDataScope(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, "$.dataScope", "must be an object");
    return;
  }

  exactKeys(
    value,
    ["purpose", "fields", "validFrom", "validUntil"],
    "$.dataScope",
    issues,
  );
  nonEmptyString(value.purpose, "$.dataScope.purpose", issues);
  timestamp(value.validFrom, "$.dataScope.validFrom", issues);
  timestamp(value.validUntil, "$.dataScope.validUntil", issues);

  if (
    typeof value.validFrom === "string" &&
    typeof value.validUntil === "string" &&
    RFC_3339.test(value.validFrom) &&
    RFC_3339.test(value.validUntil) &&
    Date.parse(value.validUntil) <= Date.parse(value.validFrom)
  ) {
    add(issues, "$.dataScope.validUntil", "must be after validFrom");
  }

  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    add(issues, "$.dataScope.fields", "must contain at least one exact field");
    return;
  }

  const seenIds = new Set<string>();
  value.fields.forEach((field, index) => {
    const path = `$.dataScope.fields[${index}]`;
    if (!isRecord(field)) {
      add(issues, path, "must be an object");
      return;
    }
    exactKeys(field, ["id", "label"], path, issues);
    nonEmptyString(field.id, `${path}.id`, issues);
    nonEmptyString(field.label, `${path}.label`, issues);
    if (typeof field.id !== "string") {
      return;
    }
    if (BROAD_SCOPE_IDS.has(field.id.trim().toLowerCase())) {
      add(issues, `${path}.id`, "must identify one claim field, not a broad profile");
    }
    if (seenIds.has(field.id)) {
      add(issues, `${path}.id`, "must be unique within the scope");
    }
    seenIds.add(field.id);
  });
}

function validateResult(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, "$.result", "must be an object");
    return;
  }
  exactKeys(value, ["status", "failureCondition"], "$.result", issues);

  if (value.status === "succeeded") {
    if (value.failureCondition !== null) {
      add(issues, "$.result.failureCondition", "must be null when succeeded");
    }
    return;
  }
  if (value.status !== "failed") {
    add(issues, "$.result.status", "must be succeeded or failed");
    return;
  }
  if (!isRecord(value.failureCondition)) {
    add(issues, "$.result.failureCondition", "must describe a failed event");
    return;
  }
  exactKeys(
    value.failureCondition,
    ["code", "message", "retryable"],
    "$.result.failureCondition",
    issues,
  );
  nonEmptyString(value.failureCondition.code, "$.result.failureCondition.code", issues);
  nonEmptyString(
    value.failureCondition.message,
    "$.result.failureCondition.message",
    issues,
  );
  if (typeof value.failureCondition.retryable !== "boolean") {
    add(issues, "$.result.failureCondition.retryable", "must be a boolean");
  }
}

function validatePayload(
  type: HandshakeEventType,
  value: unknown,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    add(issues, "$.payload", "must be an object");
    return;
  }

  switch (type) {
    case "request":
      exactKeys(value, ["recipient", "summary"], "$.payload", issues);
      party(value.recipient, "$.payload.recipient", issues);
      nonEmptyString(value.summary, "$.payload.summary", issues);
      return;
    case "consent":
      exactKeys(value, ["recipientId", "choice"], "$.payload", issues);
      nonEmptyString(value.recipientId, "$.payload.recipientId", issues);
      oneOf(value.choice, ["approve", "deny"], "$.payload.choice", issues);
      return;
    case "decision":
      exactKeys(
        value,
        ["response", "rationale", "requiredChanges"],
        "$.payload",
        issues,
      );
      oneOf(
        value.response,
        ["accept", "required_change", "decline", "cannot_determine"],
        "$.payload.response",
        issues,
      );
      nonEmptyString(value.rationale, "$.payload.rationale", issues);
      if (value.response === "required_change") {
        stringArray(
          value.requiredChanges,
          "$.payload.requiredChanges",
          issues,
          true,
        );
      } else if (value.requiredChanges !== undefined) {
        add(
          issues,
          "$.payload.requiredChanges",
          "is only allowed for a required_change response",
        );
      }
      return;
    case "acknowledgement":
      exactKeys(
        value,
        ["decisionEventId", "outcome", "note"],
        "$.payload",
        issues,
      );
      nonEmptyString(value.decisionEventId, "$.payload.decisionEventId", issues);
      oneOf(
        value.outcome,
        ["acknowledged", "rejected"],
        "$.payload.outcome",
        issues,
      );
      optionalNonEmptyString(value.note, "$.payload.note", issues);
      return;
    case "receipt":
      exactKeys(value, ["deliveredTo", "eventIds"], "$.payload", issues);
      receiptParties(value.deliveredTo, issues);
      stringArray(value.eventIds, "$.payload.eventIds", issues, true);
      return;
    case "expiry":
      exactKeys(value, ["reason"], "$.payload", issues);
      oneOf(value.reason, ["duration_elapsed"], "$.payload.reason", issues);
      return;
    case "revocation":
      exactKeys(value, ["reason"], "$.payload", issues);
      nonEmptyString(value.reason, "$.payload.reason", issues);
  }
}

function party(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, "must be an object");
    return;
  }
  exactKeys(value, ["id", "displayName"], path, issues);
  nonEmptyString(value.id, `${path}.id`, issues);
  nonEmptyString(value.displayName, `${path}.displayName`, issues);
}

function receiptParties(value: unknown, issues: ValidationIssue[]): void {
  const path = "$.payload.deliveredTo";
  if (!Array.isArray(value) || value.length !== 2) {
    add(issues, path, "must contain exactly the claimant and recipient");
    return;
  }
  const roles = new Set<string>();
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      add(issues, entryPath, "must be an object");
      return;
    }
    exactKeys(entry, ["id", "role"], entryPath, issues);
    nonEmptyString(entry.id, `${entryPath}.id`, issues);
    oneOf(entry.role, ["claimant", "recipient"], `${entryPath}.role`, issues);
    if (typeof entry.role === "string") {
      roles.add(entry.role);
    }
  });
  if (!roles.has("claimant") || !roles.has("recipient")) {
    add(issues, path, "must include one claimant and one recipient");
  }
}

function stringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  requireItem: boolean,
): void {
  if (!Array.isArray(value) || (requireItem && value.length === 0)) {
    add(issues, path, "must be a non-empty array of strings");
    return;
  }
  value.forEach((item, index) => nonEmptyString(item, `${path}[${index}]`, issues));
}

function timestamp(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (
    typeof value !== "string" ||
    !RFC_3339.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    add(issues, path, "must be an RFC 3339 timestamp with a timezone");
  }
}

function nonEmptyString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    add(issues, path, "must be a non-empty string");
  }
}

function optionalNonEmptyString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value !== undefined) {
    nonEmptyString(value, path, issues);
  }
}

function oneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isOneOf(value, allowed)) {
    add(issues, path, `must be one of: ${allowed.join(", ")}`);
  }
}

function isOneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): value is Value {
  return typeof value === "string" && allowed.includes(value as Value);
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      add(issues, `${path}.${key}`, "is not allowed");
    }
  }
  for (const key of allowed) {
    if (key !== "roleName" && key !== "requiredChanges" && key !== "note") {
      if (!Object.hasOwn(value, key)) {
        add(issues, `${path}.${key}`, "is required");
      }
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function failure(path: string, message: string): ValidationResult<never> {
  return { success: false, issues: [{ path, message }] };
}
