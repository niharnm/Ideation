import { buildDecisionEvent } from "./decision-event.ts";
import {
  HANDSHAKE_EVENT_SCHEMA_VERSION,
  type ConsentEvent,
  type DecisionEvent,
  type DecisionPayload,
  type HandshakeDataScope,
  type RequestEvent,
  type ScopeField,
} from "./handshake-event.ts";
import { validateHandshakeEvent } from "./validate-handshake-event.ts";
import {
  readHandshakeEventLedger,
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
  type StorageLike,
  type ScopedRequestDependencies,
} from "./passport-flow.ts";

export interface ScopedFieldResult {
  id: string;
  label: string;
  value: unknown;
}

export interface ProcessedRecipientRequest {
  handshakeId: string;
  recipientId: string;
  recipientDisplayName?: string;
  claimantId: string;
  purpose: string;
  validFrom: string;
  validUntil: string;
  consentChoice: "approve" | "deny";
  consentGranted: boolean;
  scopedFields: readonly ScopedFieldResult[];
  scopedData: Record<string, unknown>;
  dataScope: HandshakeDataScope;
  unrequestedFieldsFilteredOut: boolean;
}

export function getValueByPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  if (Object.hasOwn(obj, path)) {
    return obj[path];
  }
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current !== null &&
      typeof current === "object" &&
      Object.hasOwn(current as object, part)
    ) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Consumes a Handshake request & consent event pair along with raw recipient profile/database data,
 * and exposes ONLY the requested data scope fields while strictly hiding unrequested claimant fields.
 */
export function processRecipientRequest(
  requestEvent: RequestEvent,
  consentEvent: ConsentEvent,
  recipientData: Record<string, unknown> = {},
): ProcessedRecipientRequest {
  if (!requestEvent || requestEvent.type !== "request") {
    throw new Error("Invalid requestEvent provided to processRecipientRequest.");
  }
  if (!consentEvent || consentEvent.type !== "consent") {
    throw new Error("Invalid consentEvent provided to processRecipientRequest.");
  }
  if (requestEvent.handshakeId !== consentEvent.handshakeId) {
    throw new Error(
      `Handshake ID mismatch between requestEvent (${requestEvent.handshakeId}) and consentEvent (${consentEvent.handshakeId}).`,
    );
  }

  const consentChoice = consentEvent.payload.choice;
  const consentGranted = consentChoice === "approve";

  // Field isolation logic:
  // If consent choice is "approve", ONLY requested scope fields present in consentEvent.dataScope.fields are accessible.
  // If consent choice is "deny", no fields are exposed.
  const fieldsToExpose: readonly ScopeField[] = consentGranted
    ? consentEvent.dataScope.fields || []
    : [];

  const scopedFields: ScopedFieldResult[] = [];
  const scopedData: Record<string, unknown> = {};

  for (const field of fieldsToExpose) {
    const val = getValueByPath(recipientData, field.id);
    scopedFields.push({
      id: field.id,
      label: field.label,
      value: val,
    });
    scopedData[field.id] = val;
  }

  // Verify field isolation: detect if unrequested fields existed in recipientData and were filtered out
  const requestedFieldIds = new Set(fieldsToExpose.map((f) => f.id));
  let unrequestedFieldsFilteredOut = false;
  for (const key of Object.keys(recipientData)) {
    if (!requestedFieldIds.has(key) && !key.startsWith("_")) {
      unrequestedFieldsFilteredOut = true;
      break;
    }
  }

  return {
    handshakeId: requestEvent.handshakeId,
    recipientId: requestEvent.payload.recipient.id,
    recipientDisplayName: requestEvent.payload.recipient.displayName,
    claimantId: consentEvent.actor.id,
    purpose: consentEvent.dataScope.purpose,
    validFrom: consentEvent.dataScope.validFrom,
    validUntil: consentEvent.dataScope.validUntil,
    consentChoice,
    consentGranted,
    scopedFields,
    scopedData,
    dataScope: consentEvent.dataScope,
    unrequestedFieldsFilteredOut,
  };
}

// Decision Builders for the 4 outcomes: accept, required_change, decline, cannot_determine

export interface AcceptDecisionOptions {
  rationale?: string;
}

export function buildAcceptDecisionPayload(
  options: AcceptDecisionOptions = {},
): DecisionPayload {
  return {
    response: "accept",
    rationale: options.rationale || "Request accepted. All scoped fields satisfied.",
  };
}

export function createAcceptDecisionEvent(params: {
  handshakeId: string;
  recipientId: string;
  dataScope: HandshakeDataScope;
  rationale?: string;
  occurredAt?: string;
}): DecisionEvent {
  const payload = buildAcceptDecisionPayload({ rationale: params.rationale });
  return buildDecisionEvent({
    handshakeId: params.handshakeId,
    actorId: params.recipientId,
    dataScope: params.dataScope,
    decision: payload,
    occurredAt: params.occurredAt,
  });
}

export interface RequiredChangeDecisionOptions {
  requiredChanges: readonly string[];
  rationale?: string;
}

export function buildRequiredChangeDecisionPayload(
  options: RequiredChangeDecisionOptions,
): DecisionPayload {
  if (!Array.isArray(options.requiredChanges) || options.requiredChanges.length === 0) {
    throw new Error(
      "requiredChanges must be a non-empty array of strings for required_change decision.",
    );
  }
  return {
    response: "required_change",
    rationale:
      options.rationale ||
      "Recipient policy requires changes to requested fields before proceeding.",
    requiredChanges: options.requiredChanges,
  };
}

export function createRequiredChangeDecisionEvent(params: {
  handshakeId: string;
  recipientId: string;
  dataScope: HandshakeDataScope;
  requiredChanges: readonly string[];
  rationale?: string;
  occurredAt?: string;
}): DecisionEvent {
  const payload = buildRequiredChangeDecisionPayload({
    requiredChanges: params.requiredChanges,
    rationale: params.rationale,
  });
  return buildDecisionEvent({
    handshakeId: params.handshakeId,
    actorId: params.recipientId,
    dataScope: params.dataScope,
    decision: payload,
    occurredAt: params.occurredAt,
  });
}

export interface DeclineDecisionOptions {
  rationale: string;
}

export function buildDeclineDecisionPayload(
  options: DeclineDecisionOptions,
): DecisionPayload {
  if (
    !options ||
    typeof options.rationale !== "string" ||
    options.rationale.trim().length === 0
  ) {
    throw new Error("Rationale is required for decline decision.");
  }
  return {
    response: "decline",
    rationale: options.rationale,
  };
}

export function createDeclineDecisionEvent(params: {
  handshakeId: string;
  recipientId: string;
  dataScope: HandshakeDataScope;
  rationale: string;
  occurredAt?: string;
}): DecisionEvent {
  const payload = buildDeclineDecisionPayload({ rationale: params.rationale });
  return buildDecisionEvent({
    handshakeId: params.handshakeId,
    actorId: params.recipientId,
    dataScope: params.dataScope,
    decision: payload,
    occurredAt: params.occurredAt,
  });
}

export interface CannotDetermineDecisionOptions {
  reason: string;
}

export function buildCannotDetermineDecisionPayload(
  options: CannotDetermineDecisionOptions,
): DecisionPayload {
  if (
    !options ||
    typeof options.reason !== "string" ||
    options.reason.trim().length === 0
  ) {
    throw new Error("Reason (rationale) is required for cannot_determine decision.");
  }
  return {
    response: "cannot_determine",
    rationale: options.reason,
  };
}

export function createCannotDetermineDecisionEvent(params: {
  handshakeId: string;
  recipientId: string;
  dataScope: HandshakeDataScope;
  reason: string;
  occurredAt?: string;
}): DecisionEvent {
  const payload = buildCannotDetermineDecisionPayload({ reason: params.reason });
  return buildDecisionEvent({
    handshakeId: params.handshakeId,
    actorId: params.recipientId,
    dataScope: params.dataScope,
    decision: payload,
    occurredAt: params.occurredAt,
  });
}

export type RecipientDecisionInput =
  | { response: "accept"; rationale?: string }
  | {
      response: "required_change";
      requiredChanges: readonly string[];
      rationale?: string;
    }
  | { response: "decline"; rationale: string }
  | { response: "cannot_determine"; reason: string };

export function buildRecipientDecisionPayload(
  input: RecipientDecisionInput,
): DecisionPayload {
  switch (input.response) {
    case "accept":
      return buildAcceptDecisionPayload({ rationale: input.rationale });
    case "required_change":
      return buildRequiredChangeDecisionPayload({
        requiredChanges: input.requiredChanges,
        rationale: input.rationale,
      });
    case "decline":
      return buildDeclineDecisionPayload({ rationale: input.rationale });
    case "cannot_determine":
      return buildCannotDetermineDecisionPayload({ reason: input.reason });
    default:
      throw new Error(
        `Unsupported decision response: ${(input as { response: string }).response}`,
      );
  }
}

export function createRecipientDecisionEvent(params: {
  handshakeId: string;
  recipientId: string;
  dataScope: HandshakeDataScope;
  decisionInput: RecipientDecisionInput;
  occurredAt?: string;
}): DecisionEvent {
  const payload = buildRecipientDecisionPayload(params.decisionInput);
  const event = buildDecisionEvent({
    handshakeId: params.handshakeId,
    actorId: params.recipientId,
    dataScope: params.dataScope,
    decision: payload,
    occurredAt: params.occurredAt,
  });
  const validation = validateHandshakeEvent(event);
  if (!validation.success) {
    throw new Error(
      `Generated decision event failed validation: ${JSON.stringify(validation.issues)}`,
    );
  }
  return event;
}

export function recordRecipientDecision(
  decisionEvent: DecisionEvent,
  dependencies: ScopedRequestDependencies,
): DecisionEvent {
  const validation = validateHandshakeEvent(decisionEvent);
  if (!validation.success) {
    throw new Error("Decision event is invalid.");
  }
  const ledger = readHandshakeEventLedger(dependencies.storage);
  dependencies.storage.setItem(
    HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 1,
      events: [...ledger.events, decisionEvent],
    }),
  );
  dependencies.emit(decisionEvent);
  return decisionEvent;
}
