export const HANDSHAKE_EVENT_SCHEMA_VERSION = "1.0.0" as const;

export const HANDSHAKE_EVENT_TYPES = [
  "request",
  "consent",
  "decision",
  "acknowledgement",
  "receipt",
  "expiry",
  "revocation",
] as const;

export type HandshakeEventType = (typeof HANDSHAKE_EVENT_TYPES)[number];

export type HandshakeActorRole =
  | "claimant"
  | "recipient"
  | "acknowledger"
  | "system";

export interface HandshakeActor {
  id: string;
  role: HandshakeActorRole;
  roleName?: string;
}

export interface ScopeField {
  id: string;
  label: string;
}

export interface HandshakeDataScope {
  purpose: string;
  fields: readonly ScopeField[];
  validFrom: string;
  validUntil: string;
}

export interface FailureCondition {
  code: string;
  message: string;
  retryable: boolean;
}

export type HandshakeEventResult =
  | { status: "succeeded"; failureCondition: null }
  | { status: "failed"; failureCondition: FailureCondition };

export interface PartyReference {
  id: string;
  displayName: string;
}

export interface RequestPayload {
  recipient: PartyReference;
  summary: string;
}

export interface ConsentPayload {
  recipientId: string;
  choice: "approve" | "deny";
}

export interface DecisionPayload {
  response:
    | "accept"
    | "required_change"
    | "decline"
    | "cannot_determine";
  rationale: string;
  requiredChanges?: readonly string[];
}

export interface AcknowledgementPayload {
  decisionEventId: string;
  outcome: "acknowledged" | "rejected";
  note?: string;
}

export interface ReceiptParty {
  id: string;
  role: "claimant" | "recipient";
}

export interface ReceiptPayload {
  deliveredTo: readonly ReceiptParty[];
  eventIds: readonly string[];
}

export interface ExpiryPayload {
  reason: "duration_elapsed";
}

export interface RevocationPayload {
  reason: string;
}

interface HandshakeEventBase<
  Type extends HandshakeEventType,
  Payload,
> {
  schemaVersion: typeof HANDSHAKE_EVENT_SCHEMA_VERSION;
  eventId: string;
  handshakeId: string;
  type: Type;
  occurredAt: string;
  actor: HandshakeActor;
  dataScope: HandshakeDataScope;
  result: HandshakeEventResult;
  payload: Payload;
}

export type RequestEvent = HandshakeEventBase<"request", RequestPayload>;
export type ConsentEvent = HandshakeEventBase<"consent", ConsentPayload>;
export type DecisionEvent = HandshakeEventBase<"decision", DecisionPayload>;
export type AcknowledgementEvent = HandshakeEventBase<
  "acknowledgement",
  AcknowledgementPayload
>;
export type ReceiptEvent = HandshakeEventBase<"receipt", ReceiptPayload>;
export type ExpiryEvent = HandshakeEventBase<"expiry", ExpiryPayload>;
export type RevocationEvent = HandshakeEventBase<
  "revocation",
  RevocationPayload
>;

export type HandshakeEvent =
  | RequestEvent
  | ConsentEvent
  | DecisionEvent
  | AcknowledgementEvent
  | ReceiptEvent
  | ExpiryEvent
  | RevocationEvent;
