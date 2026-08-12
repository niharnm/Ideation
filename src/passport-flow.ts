import {
  composeClaim,
  type ClaimComposerDraft,
  type ClaimConsentChoice,
  type ComposedClaim,
} from "./claim-composer.ts";
import {
  HANDSHAKE_EVENT_SCHEMA_VERSION,
  type ConsentEvent,
  type ExpiryEvent,
  type HandshakeDataScope,
  type HandshakeEvent,
  type PartyReference,
  type RequestEvent,
  type RevocationEvent,
} from "./handshake-event.ts";
import { validateHandshakeEvent } from "./validate-handshake-event.ts";

export const HANDSHAKE_CLAIM_STORAGE_KEY = "handshake.prototype.claim.v1";
export const HANDSHAKE_EVENT_LEDGER_STORAGE_KEY =
  "handshake.prototype.event-ledger.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ScopedRequestDependencies {
  storage: StorageLike;
  emit: (event: HandshakeEvent) => void;
  now?: () => Date;
  createId?: () => string;
}

export interface ScopedRequestInput {
  claimantId: string;
  recipient: PartyReference;
  summary: string;
  draft: ClaimComposerDraft;
}

export interface StoredScopedClaim {
  schemaVersion: 1;
  status: "active" | "expired" | "revoked";
  handshakeId: string;
  claimantId: string;
  recipient: PartyReference;
  dataScope: HandshakeDataScope;
  requestEventId: string;
  consentEventId: string;
  createdAt: string;
  expiryEventId?: string;
  expiredAt?: string;
  revocationEventId?: string;
  revokedAt?: string;
}

export interface StoredHandshakeEventLedger {
  schemaVersion: 1;
  events: readonly HandshakeEvent[];
}

export type ScopedRequestResult<T> =
  | { success: true; value: T }
  | { success: false; issues: readonly { path: string; message: string }[] };

export class ScopedRequestError extends Error {}

export type ScopedGrantReadResult =
  | {
      allowed: true;
      grant: {
        handshakeId: string;
        recipient: PartyReference;
        dataScope: HandshakeDataScope;
      };
    }
  | {
      allowed: false;
      reason:
        | "not_found"
        | "recipient_mismatch"
        | "not_started"
        | "expired"
        | "revoked";
    };

export function approveScopedRequest(
  input: ScopedRequestInput,
  dependencies: ScopedRequestDependencies,
): ScopedRequestResult<{
  requestEvent: RequestEvent;
  consentEvent: ConsentEvent;
  claim: StoredScopedClaim;
}> {
  const composed = composeRequestEvents(input, "approve", dependencies);
  if (!composed.success) {
    return composed;
  }
  const { requestEvent, consentEvent } = composed.value;

  const claim: StoredScopedClaim = {
    schemaVersion: 1,
    status: "active",
    handshakeId: requestEvent.handshakeId,
    claimantId: input.claimantId,
    recipient: input.recipient,
    dataScope: requestEvent.dataScope,
    requestEventId: requestEvent.eventId,
    consentEventId: consentEvent.eventId,
    createdAt: requestEvent.occurredAt,
  };

  dependencies.storage.setItem(
    HANDSHAKE_CLAIM_STORAGE_KEY,
    JSON.stringify(claim),
  );
  appendHandshakeEvents(dependencies.storage, [requestEvent, consentEvent]);
  dependencies.emit(requestEvent);
  dependencies.emit(consentEvent);

  return { success: true, value: { requestEvent, consentEvent, claim } };
}

export function denyScopedRequest(
  input: ScopedRequestInput,
  dependencies: ScopedRequestDependencies,
): ScopedRequestResult<{
  requestEvent: RequestEvent;
  consentEvent: ConsentEvent;
}> {
  const composed = composeRequestEvents(
    {
      ...input,
      draft: {
    ...input.draft,
    fields: input.draft.fields.map((field) => ({ ...field, selected: true })),
      },
    },
    "deny",
    dependencies,
  );
  if (!composed.success) {
    return composed;
  }
  const { requestEvent, consentEvent } = composed.value;
  appendHandshakeEvents(dependencies.storage, [requestEvent, consentEvent]);
  dependencies.emit(requestEvent);
  dependencies.emit(consentEvent);

  return { success: true, value: { requestEvent, consentEvent } };
}

export function revokeScopedClaim(
  claimantId: string,
  dependencies: ScopedRequestDependencies,
  reason = "The claimant ended access.",
): RevocationEvent {
  const claim = readScopedClaim(dependencies.storage);
  if (!claim || claim.status !== "active") {
    throw new ScopedRequestError("No active scoped claim can be revoked.");
  }
  if (claimantId.trim().length === 0 || claimantId !== claim.claimantId) {
    throw new ScopedRequestError(
      "Only the claimant who approved this scoped claim can revoke it.",
    );
  }

  const id = dependencies.createId ?? defaultId;
  const occurredAt = (dependencies.now?.() ?? new Date()).toISOString();
  const revocationEvent: RevocationEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `event-${id()}`,
    handshakeId: claim.handshakeId,
    type: "revocation",
    occurredAt,
    actor: { id: claim.claimantId, role: "claimant" },
    dataScope: claim.dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload: { reason },
  };

  assertValidEvent(revocationEvent);

  const revokedClaim: StoredScopedClaim = {
    ...claim,
    status: "revoked",
    revocationEventId: revocationEvent.eventId,
    revokedAt: occurredAt,
  };
  dependencies.storage.setItem(
    HANDSHAKE_CLAIM_STORAGE_KEY,
    JSON.stringify(revokedClaim),
  );
  appendHandshakeEvents(dependencies.storage, [revocationEvent]);
  dependencies.emit(revocationEvent);

  return revocationEvent;
}

export function expireScopedClaimIfNeeded(
  dependencies: ScopedRequestDependencies,
  at = dependencies.now?.() ?? new Date(),
): StoredScopedClaim | null {
  const claim = readScopedClaim(dependencies.storage);
  if (
    !claim ||
    claim.status !== "active" ||
    at.getTime() < Date.parse(claim.dataScope.validUntil)
  ) {
    return claim;
  }

  const id = dependencies.createId ?? defaultId;
  const occurredAt = at.toISOString();
  const expiryEvent: ExpiryEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `event-${id()}`,
    handshakeId: claim.handshakeId,
    type: "expiry",
    occurredAt,
    actor: { id: "claim-ledger", role: "system" },
    dataScope: claim.dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload: { reason: "duration_elapsed" },
  };
  assertValidEvent(expiryEvent);

  const expiredClaim: StoredScopedClaim = {
    ...claim,
    status: "expired",
    expiryEventId: expiryEvent.eventId,
    expiredAt: occurredAt,
  };
  dependencies.storage.setItem(
    HANDSHAKE_CLAIM_STORAGE_KEY,
    JSON.stringify(expiredClaim),
  );
  appendHandshakeEvents(dependencies.storage, [expiryEvent]);
  dependencies.emit(expiryEvent);

  return expiredClaim;
}

export function readScopedGrantForRecipient(
  recipientId: string,
  dependencies: ScopedRequestDependencies,
  at = dependencies.now?.() ?? new Date(),
): ScopedGrantReadResult {
  const claim = expireScopedClaimIfNeeded(dependencies, at);
  if (!claim) {
    return { allowed: false, reason: "not_found" };
  }
  if (recipientId !== claim.recipient.id) {
    return { allowed: false, reason: "recipient_mismatch" };
  }
  if (claim.status === "expired") {
    return { allowed: false, reason: "expired" };
  }
  if (claim.status === "revoked") {
    return { allowed: false, reason: "revoked" };
  }
  if (at.getTime() < Date.parse(claim.dataScope.validFrom)) {
    return { allowed: false, reason: "not_started" };
  }

  return {
    allowed: true,
    grant: {
      handshakeId: claim.handshakeId,
      recipient: claim.recipient,
      dataScope: claim.dataScope,
    },
  };
}

export function readHandshakeEventLedger(
  storage: StorageLike,
): StoredHandshakeEventLedger {
  const serialized = storage.getItem(HANDSHAKE_EVENT_LEDGER_STORAGE_KEY);
  if (serialized === null) {
    return { schemaVersion: 1, events: [] };
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new ScopedRequestError(
      `Stored handshake event ledger is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.events)) {
    throw new ScopedRequestError("Stored handshake event ledger has an invalid shape.");
  }
  for (const event of value.events) {
    const validation = validateHandshakeEvent(event);
    if (!validation.success) {
      throw new ScopedRequestError("Stored handshake event ledger contains an invalid N1 event.");
    }
  }

  return value as unknown as StoredHandshakeEventLedger;
}

export function readScopedClaim(
  storage: StorageLike,
): StoredScopedClaim | null {
  const serialized = storage.getItem(HANDSHAKE_CLAIM_STORAGE_KEY);
  if (serialized === null) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new ScopedRequestError(
      `Stored scoped claim is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isStoredClaim(value)) {
    throw new ScopedRequestError("Stored scoped claim has an invalid shape.");
  }
  return value;
}

export function canUseScopedClaim(
  storage: StorageLike,
  at = new Date(),
): boolean {
  try {
    const claim = readScopedClaim(storage);
    return (
      claim?.status === "active" &&
      Date.parse(claim.dataScope.validFrom) <= at.getTime() &&
      at.getTime() < Date.parse(claim.dataScope.validUntil)
    );
  } catch (error) {
    if (error instanceof ScopedRequestError) {
      return false;
    }
    throw error;
  }
}

function composeRequestEvents(
  input: ScopedRequestInput,
  choice: ClaimConsentChoice,
  dependencies: ScopedRequestDependencies,
): ScopedRequestResult<{
  requestEvent: RequestEvent;
  consentEvent: ConsentEvent;
  claim: ComposedClaim;
}> {
  const claim = composeClaim({ ...input.draft, choice });
  if (!claim.success) {
    return claim;
  }

  const occurredAt = (dependencies.now?.() ?? new Date()).toISOString();
  const id = dependencies.createId ?? defaultId;
  const handshakeId = `handshake-${id()}`;
  const actor = { id: input.claimantId, role: "claimant" as const };
  const result = { status: "succeeded" as const, failureCondition: null };
  const requestEvent: RequestEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `event-${id()}`,
    handshakeId,
    type: "request",
    occurredAt,
    actor,
    dataScope: claim.value.dataScope,
    result,
    payload: { recipient: input.recipient, summary: input.summary },
  };
  const consentEvent: ConsentEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `event-${id()}`,
    handshakeId,
    type: "consent",
    occurredAt,
    actor,
    dataScope: claim.value.dataScope,
    result,
    payload: { recipientId: input.recipient.id, choice },
  };
  assertValidEvent(requestEvent);
  assertValidEvent(consentEvent);

  return {
    success: true,
    value: { requestEvent, consentEvent, claim: claim.value },
  };
}

function appendHandshakeEvents(
  storage: StorageLike,
  events: readonly HandshakeEvent[],
): void {
  const ledger = readHandshakeEventLedger(storage);
  storage.setItem(
    HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 1, events: [...ledger.events, ...events] }),
  );
}

function assertValidEvent(event: HandshakeEvent): void {
  const validation = validateHandshakeEvent(event);
  if (!validation.success) {
    throw new ScopedRequestError(
      `Scoped request produced an invalid N1 event: ${validation.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join(", ")}`,
    );
  }
}

function isStoredClaim(value: unknown): value is StoredScopedClaim {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.schemaVersion !== 1 ||
    (value.status !== "active" &&
      value.status !== "expired" &&
      value.status !== "revoked") ||
    !nonEmpty(value.handshakeId) ||
    !nonEmpty(value.claimantId) ||
    !nonEmpty(value.requestEventId) ||
    !nonEmpty(value.consentEventId) ||
    !isTimestamp(value.createdAt) ||
    !isRecord(value.recipient) ||
    !nonEmpty(value.recipient.id) ||
    !nonEmpty(value.recipient.displayName) ||
    !isRecord(value.dataScope) ||
    !Array.isArray(value.dataScope.fields)
  ) {
    return false;
  }

  const composed = composeClaim({
    purpose: value.dataScope.purpose,
    fields: value.dataScope.fields.map((field) =>
      isRecord(field)
        ? { id: field.id, label: field.label, selected: true }
        : field,
    ),
    validFrom: value.dataScope.validFrom,
    validUntil: value.dataScope.validUntil,
    choice: "approve",
  });
  if (!composed.success) {
    return false;
  }

  if (value.status === "active") {
    return (
      value.expiryEventId === undefined &&
      value.expiredAt === undefined &&
      value.revocationEventId === undefined &&
      value.revokedAt === undefined
    );
  }
  if (value.status === "expired") {
    return (
      nonEmpty(value.expiryEventId) &&
      isTimestamp(value.expiredAt) &&
      value.revocationEventId === undefined &&
      value.revokedAt === undefined
    );
  }
  return (
    nonEmpty(value.revocationEventId) &&
    isTimestamp(value.revokedAt) &&
    value.expiryEventId === undefined &&
    value.expiredAt === undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function defaultId(): string {
  return crypto.randomUUID();
}
