import { buildDecisionEvent } from "./decision-event.ts";
import {
  HANDSHAKE_EVENT_SCHEMA_VERSION,
  type AcknowledgementEvent,
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
  readScopedGrantForRecipient,
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
  const requestValidation = validateHandshakeEvent(requestEvent);
  if (!requestValidation.success || requestEvent.type !== "request") {
    throw new Error("Invalid requestEvent provided to processRecipientRequest.");
  }
  const consentValidation = validateHandshakeEvent(consentEvent);
  if (!consentValidation.success || consentEvent.type !== "consent") {
    throw new Error("Invalid consentEvent provided to processRecipientRequest.");
  }
  if (requestEvent.handshakeId !== consentEvent.handshakeId) {
    throw new Error(
      `Handshake ID mismatch between requestEvent (${requestEvent.handshakeId}) and consentEvent (${consentEvent.handshakeId}).`,
    );
  }
  if (requestEvent.actor.id !== consentEvent.actor.id) {
    throw new Error("Consent must be owned by the claimant who made the request.");
  }
  if (consentEvent.payload.recipientId !== requestEvent.payload.recipient.id) {
    throw new Error("Consent recipient must match the requested recipient.");
  }
  if (consentEvent.result.status !== "succeeded" || consentEvent.payload.choice !== "approve") {
    throw new Error("Recipient data is unavailable without approved claimant consent.");
  }
  if (!sameDataScope(requestEvent.dataScope, consentEvent.dataScope)) {
    throw new Error("Consent dataScope must exactly match the original request.");
  }
  if (
    !occursWithinScope(requestEvent.occurredAt, requestEvent.dataScope) ||
    !occursWithinScope(consentEvent.occurredAt, requestEvent.dataScope) ||
    Date.parse(consentEvent.occurredAt) < Date.parse(requestEvent.occurredAt)
  ) {
    throw new Error("Request and consent must occur in the active validity range and order.");
  }

  const consentChoice = consentEvent.payload.choice;
  const consentGranted = true;

  const fieldsToExpose: readonly ScopeField[] = requestEvent.dataScope.fields;

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
    dataScope: requestEvent.dataScope,
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
  assertRecipientDecisionCanBeRecorded(decisionEvent, dependencies);
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

import {
  evaluateUniversalAllergyPolicy,
  type KitchenCapabilities,
  type UniversalPolicyEvaluationResult,
} from "./universal-policy-engine.ts";
import {
  getAllergenMetadata,
  normalizeAllergenUri,
  type DishIngredientProfile,
} from "./universal-taxonomy.ts";

export {
  evaluateUniversalAllergyPolicy,
  getAllergenMetadata,
  normalizeAllergenUri,
};
export type {
  DishIngredientProfile,
  KitchenCapabilities,
  UniversalPolicyEvaluationResult,
};

export function evaluateRecipientUniversalPolicy(params: {
  request: ProcessedRecipientRequest;
  dish: DishIngredientProfile;
  kitchenCapabilities?: KitchenCapabilities;
}): UniversalPolicyEvaluationResult {
  const requestedAllergies = params.request.dataScope.fields.map((f) => ({
    id: f.id,
    label: f.label,
  }));
  return evaluateUniversalAllergyPolicy(
    params.dish,
    requestedAllergies,
    params.kitchenCapabilities,
  );
}

export function assertRecipientDecisionCanBeRecorded(
  decisionEvent: DecisionEvent,
  dependencies: ScopedRequestDependencies,
): void {
  const validation = validateHandshakeEvent(decisionEvent);
  if (!validation.success || decisionEvent.type !== "decision") {
    throw new Error("Decision event is invalid.");
  }

  const ledger = readHandshakeEventLedger(dependencies.storage);
  assertUniqueEventId(decisionEvent.eventId, ledger.events);
  const { request, consent } = requireApprovedHandshake(
    decisionEvent.handshakeId,
    decisionEvent.actor.id,
    dependencies,
  );

  if (
    !sameDataScope(decisionEvent.dataScope, request.dataScope) ||
    !sameDataScope(decisionEvent.dataScope, consent.dataScope) ||
    !occursWithinScope(decisionEvent.occurredAt, request.dataScope) ||
    Date.parse(decisionEvent.occurredAt) < Date.parse(consent.occurredAt)
  ) {
    throw new Error("Decision must use the active request and consent scope in handshake order.");
  }
  if (
    ledger.events.some(
      (event) =>
        event.handshakeId === decisionEvent.handshakeId &&
        event.type === "decision",
    )
  ) {
    throw new Error("A recipient decision is already recorded for this handshake.");
  }
}

export function assertAcknowledgementCanBeRecorded(
  acknowledgementEvent: AcknowledgementEvent,
  decisionEvent: DecisionEvent,
  recipientId: string,
  dependencies: ScopedRequestDependencies,
): void {
  const validation = validateHandshakeEvent(acknowledgementEvent);
  if (!validation.success || acknowledgementEvent.type !== "acknowledgement") {
    throw new Error("Acknowledgement event is invalid.");
  }
  if (
    acknowledgementEvent.handshakeId !== decisionEvent.handshakeId ||
    acknowledgementEvent.payload.decisionEventId !== decisionEvent.eventId ||
    decisionEvent.actor.id !== recipientId
  ) {
    throw new Error("Acknowledgement must reference the active recipient decision.");
  }

  const ledger = readHandshakeEventLedger(dependencies.storage);
  assertUniqueEventId(acknowledgementEvent.eventId, ledger.events);
  const { request, consent } = requireApprovedHandshake(
    acknowledgementEvent.handshakeId,
    recipientId,
    dependencies,
  );
  if (
    !sameDataScope(acknowledgementEvent.dataScope, request.dataScope) ||
    !sameDataScope(acknowledgementEvent.dataScope, consent.dataScope) ||
    !sameDataScope(acknowledgementEvent.dataScope, decisionEvent.dataScope) ||
    !occursWithinScope(acknowledgementEvent.occurredAt, request.dataScope) ||
    Date.parse(acknowledgementEvent.occurredAt) < Date.parse(decisionEvent.occurredAt)
  ) {
    throw new Error("Acknowledgement must use the active request and consent scope in handshake order.");
  }
  if (
    ledger.events.some(
      (event) =>
        event.handshakeId === acknowledgementEvent.handshakeId &&
        event.type === "acknowledgement",
    )
  ) {
    throw new Error("A staff acknowledgement is already recorded for this handshake.");
  }
}

function requireApprovedHandshake(
  handshakeId: string,
  recipientId: string,
  dependencies: ScopedRequestDependencies,
): { request: RequestEvent; consent: ConsentEvent } {
  const grant = readScopedGrantForRecipient(recipientId, dependencies);
  if (!grant.allowed || grant.grant.handshakeId !== handshakeId) {
    throw new Error("Recipient does not have an active scoped grant for this handshake.");
  }

  const events = readHandshakeEventLedger(dependencies.storage).events.filter(
    (event) => event.handshakeId === handshakeId,
  );
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("Recipient events require unique handshake eventIds.");
  }
  if (events.some((event) => event.type === "expiry" || event.type === "revocation")) {
    throw new Error("Recipient events cannot be recorded after access ends.");
  }
  const requests = events.filter((event): event is RequestEvent => event.type === "request");
  const consents = events.filter((event): event is ConsentEvent => event.type === "consent");
  if (requests.length !== 1 || consents.length !== 1) {
    throw new Error("Recipient events require one linked request and consent.");
  }

  const [request] = requests;
  const [consent] = consents;
  if (
    request.result.status !== "succeeded" ||
    consent.result.status !== "succeeded" ||
    request.actor.id !== consent.actor.id ||
    consent.payload.choice !== "approve" ||
    request.payload.recipient.id !== recipientId ||
    consent.payload.recipientId !== recipientId ||
    !sameDataScope(request.dataScope, consent.dataScope) ||
    !sameDataScope(request.dataScope, grant.grant.dataScope)
  ) {
    throw new Error("Recipient events require matching claimant-approved request and consent.");
  }
  return { request, consent };
}

function assertUniqueEventId(
  eventId: string,
  events: readonly { eventId: string }[],
): void {
  if (events.some((event) => event.eventId === eventId)) {
    throw new Error("Handshake eventId is already recorded.");
  }
}

function sameDataScope(
  left: HandshakeDataScope,
  right: HandshakeDataScope,
): boolean {
  return (
    left.purpose === right.purpose &&
    left.validFrom === right.validFrom &&
    left.validUntil === right.validUntil &&
    left.fields.length === right.fields.length &&
    left.fields.every(
      (field, index) =>
        field.id === right.fields[index]?.id &&
        field.label === right.fields[index]?.label,
    )
  );
}

function occursWithinScope(occurredAt: string, scope: HandshakeDataScope): boolean {
  const occurred = Date.parse(occurredAt);
  return (
    occurred >= Date.parse(scope.validFrom) &&
    occurred < Date.parse(scope.validUntil)
  );
}
