import { composeClaim } from "../claim-composer.ts";
import type {
  AcknowledgementEvent,
  ConsentEvent,
  DecisionEvent,
  HandshakeDataScope,
  HandshakeEvent,
  ReceiptEvent,
  RequestEvent,
} from "../handshake-event.ts";
import { HANDSHAKE_EVENT_SCHEMA_VERSION } from "../handshake-event.ts";
import { validateHandshakeEvent } from "../validate-handshake-event.ts";

export interface AllergyOrderingConstraint {
  id: string;
  label: string;
}

export interface AllergyOrderingParams {
  handshakeId?: string;
  claimantId?: string;
  claimantName?: string;
  restaurantId?: string;
  restaurantName?: string;
  acknowledgerId?: string;
  acknowledgerName?: string;
  acknowledgerRoleName?: string;
  allergies?: readonly AllergyOrderingConstraint[];
  purpose?: string;
  validFrom?: string;
  validUntil?: string;
  consentChoice?: "approve" | "deny";
  decisionResponse?:
    | "accept"
    | "required_change"
    | "decline"
    | "cannot_determine";
  decisionRationale?: string;
  requiredChanges?: readonly string[];
  acknowledgementOutcome?: "acknowledged" | "rejected";
  acknowledgementNote?: string;
}

export interface AllergyOrderingResult {
  events: readonly HandshakeEvent[];
  standingProfileCreated: false;
  dataScope: HandshakeDataScope;
  summary: string;
}

export function runAllergyOrderingFlow(
  params: AllergyOrderingParams = {},
): AllergyOrderingResult {
  const handshakeId = params.handshakeId ?? "handshake-allergy-ordering-1";
  const claimantId = params.claimantId ?? "diner-101";
  const restaurantId = params.restaurantId ?? "restaurant-789";
  const restaurantName = params.restaurantName ?? "Bistro Allegro";
  const acknowledgerId = params.acknowledgerId ?? "staff-42";
  const acknowledgerRoleName =
    params.acknowledgerRoleName ?? "Kitchen Supervisor";

  const allergies = params.allergies ?? [
    { id: "order.constraint.peanut", label: "Peanut Allergy" },
    { id: "order.constraint.dairy", label: "Dairy Intolerance" },
  ];

  const purpose =
    params.purpose ??
    "Safely process restaurant order allergy constraints for order #1001";
  const validFrom = params.validFrom ?? "2026-08-12T18:00:00Z";
  const validUntil = params.validUntil ?? "2026-08-12T20:00:00Z";

  const consentChoice = params.consentChoice ?? "approve";
  const decisionResponse = params.decisionResponse ?? "accept";
  const decisionRationale =
    params.decisionRationale ??
    "Kitchen confirmed ability to accommodate specified peanut and dairy constraints.";
  const acknowledgementOutcome = params.acknowledgementOutcome ?? "acknowledged";

  // Compose and validate data scope using fine-grained field constraints (N1 principle).
  // Scope is bound to a single ordering window without creating standing profile access.
  const claimDraft = {
    purpose,
    fields: allergies.map((a) => ({
      id: a.id,
      label: a.label,
      selected: true,
    })),
    validFrom,
    validUntil,
    choice: consentChoice,
  };

  const composedClaim = composeClaim(claimDraft);
  if (!composedClaim.success) {
    throw new Error(
      `Failed to compose claim scope for allergy ordering flow: ${composedClaim.issues.map((i) => `${i.path}: ${i.message}`).join(", ")}`,
    );
  }

  const dataScope = composedClaim.value.dataScope;

  const t0 = validFrom;
  const t1 = new Date(Date.parse(validFrom) + 60_000).toISOString();
  const t2 = new Date(Date.parse(validFrom) + 120_000).toISOString();
  const t3 = new Date(Date.parse(validFrom) + 180_000).toISOString();
  const t4 = new Date(Date.parse(validFrom) + 240_000).toISOString();

  // 1. Request Event
  const requestEvent: RequestEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `${handshakeId}-evt-1-request`,
    handshakeId,
    type: "request",
    occurredAt: t0,
    actor: {
      id: claimantId,
      role: "claimant",
    },
    dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload: {
      recipient: {
        id: restaurantId,
        displayName: restaurantName,
      },
      summary: "Share allergy constraints for immediate meal preparation",
    },
  };

  // 2. Consent Event
  const consentEvent: ConsentEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `${handshakeId}-evt-2-consent`,
    handshakeId,
    type: "consent",
    occurredAt: t1,
    actor: {
      id: claimantId,
      role: "claimant",
    },
    dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload: {
      recipientId: restaurantId,
      choice: consentChoice,
    },
  };

  // 3. Decision Event
  const decisionEvent: DecisionEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `${handshakeId}-evt-3-decision`,
    handshakeId,
    type: "decision",
    occurredAt: t2,
    actor: {
      id: restaurantId,
      role: "recipient",
    },
    dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload: {
      response: decisionResponse,
      rationale: decisionRationale,
      ...(params.requiredChanges ? { requiredChanges: params.requiredChanges } : {}),
    },
  };

  // 4. Acknowledgement Event
  const acknowledgementEvent: AcknowledgementEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `${handshakeId}-evt-4-acknowledgement`,
    handshakeId,
    type: "acknowledgement",
    occurredAt: t3,
    actor: {
      id: acknowledgerId,
      role: "acknowledger",
      roleName: acknowledgerRoleName,
    },
    dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload: {
      decisionEventId: decisionEvent.eventId,
      outcome: acknowledgementOutcome,
      ...(params.acknowledgementNote ? { note: params.acknowledgementNote } : {}),
    },
  };

  // 5. Receipt Event
  const receiptEvent: ReceiptEvent = {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: `${handshakeId}-evt-5-receipt`,
    handshakeId,
    type: "receipt",
    occurredAt: t4,
    actor: {
      id: "handshake-service",
      role: "system",
    },
    dataScope,
    result: { status: "succeeded", failureCondition: null },
    payload: {
      deliveredTo: [
        { id: claimantId, role: "claimant" },
        { id: restaurantId, role: "recipient" },
      ],
      eventIds: [
        requestEvent.eventId,
        consentEvent.eventId,
        decisionEvent.eventId,
        acknowledgementEvent.eventId,
      ],
    },
  };

  const events: readonly HandshakeEvent[] = [
    requestEvent,
    consentEvent,
    decisionEvent,
    acknowledgementEvent,
    receiptEvent,
  ];

  // Validate every event against strict protocol rules
  for (const evt of events) {
    const validation = validateHandshakeEvent(evt);
    if (!validation.success) {
      throw new Error(
        `Event validation failed for ${evt.type} (${evt.eventId}): ${validation.issues.map((i) => `${i.path}: ${i.message}`).join(", ")}`,
      );
    }
  }

  return {
    events,
    standingProfileCreated: false,
    dataScope,
    summary: `Completed allergy ordering handshake ${handshakeId} with response '${decisionResponse}' and outcome '${acknowledgementOutcome}'. Consent remains single-use without creating standing profile grants.`,
  };
}
