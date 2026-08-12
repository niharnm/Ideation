import type {
  AcknowledgementEvent,
  ConsentEvent,
  DecisionEvent,
  ExpiryEvent,
  HandshakeDataScope,
  HandshakeEvent,
  PartyReference,
  ReceiptEvent,
  RequestEvent,
  RevocationEvent,
  ScopeField,
} from "./handshake-event.ts";
import {
  readHandshakeEventLedger,
  type ScopedRequestDependencies,
} from "./passport-flow.ts";
import { validateHandshakeEvent } from "./validate-handshake-event.ts";

export interface ClaimantReceiptPreview {
  handshakeId: string;
  authenticity: {
    status: "unverified";
    message: string;
  };
  fields: readonly ScopeField[];
  recipient: PartyReference;
  decision: {
    outcome: DecisionEvent["payload"]["response"];
    rationale: string;
    requiredChanges?: readonly string[];
  };
  acknowledgement: {
    roleName: string;
    outcome: AcknowledgementEvent["payload"]["outcome"];
    note?: string;
  };
  timestamps: {
    requestedAt: string;
    consentedAt: string;
    decidedAt: string;
    acknowledgedAt: string;
    preparedAt: string;
    terminalAt?: string;
  };
  access: {
    status: "not_started" | "active" | "expired" | "revoked";
    validUntil: string;
  };
  delivery: {
    status: "pending";
    intendedRecipients: readonly [
      { id: string; role: "claimant"; displayName: "Claimant" },
      { id: string; role: "recipient"; displayName: string },
    ];
  };
}

export type ClaimantReceiptPreviewResult =
  | { success: true; value: { receipt: ClaimantReceiptPreview } }
  | {
      success: false;
      issues: readonly { path: string; message: string }[];
    };

export interface ComposeClaimantReceiptOptions {
  now?: Date;
}

const RECEIPT_SOURCE_TYPES = new Set([
  "request",
  "consent",
  "decision",
  "acknowledgement",
  "expiry",
  "revocation",
  "receipt",
]);

export function composeClaimantReceipt(
  events: readonly HandshakeEvent[],
  options: ComposeClaimantReceiptOptions = {},
): ClaimantReceiptPreviewResult {
  const issues: { path: string; message: string }[] = [];
  if (!Array.isArray(events) || events.length === 0) {
    return failure("$.events", "must contain one linked handshake");
  }

  events.forEach((event, index) => {
    const validation = validateHandshakeEvent(event);
    if (!validation.success) {
      issues.push({
        path: `$.events[${index}]`,
        message: "must be a valid N1 event",
      });
    } else if (!RECEIPT_SOURCE_TYPES.has(event.type)) {
      issues.push({
        path: `$.events[${index}].type`,
        message: "is not part of a claimant receipt preview",
      });
    }
  });
  if (issues.length > 0) {
    return { success: false, issues };
  }

  const handshakeIds = new Set(events.map((event) => event.handshakeId));
  if (handshakeIds.size !== 1) {
    return failure("$.events", "must share one handshakeId");
  }
  const handshakeId = events[0].handshakeId;
  const request = single<RequestEvent>(events, "request", true, issues);
  const consent = single<ConsentEvent>(events, "consent", true, issues);
  const decision = single<DecisionEvent>(events, "decision", true, issues);
  const acknowledgement = single<AcknowledgementEvent>(
    events,
    "acknowledgement",
    true,
    issues,
  );
  const expiry = single<ExpiryEvent>(events, "expiry", false, issues);
  const revocation = single<RevocationEvent>(
    events,
    "revocation",
    false,
    issues,
  );
  const sourceReceipt = single<ReceiptEvent>(events, "receipt", false, issues);

  if (expiry && revocation) {
    issues.push({
      path: "$.events",
      message: "cannot contain both expiry and revocation for one grant",
    });
  }
  if (issues.length > 0 || !request || !consent || !decision || !acknowledgement) {
    return { success: false, issues };
  }

  if (
    [request, consent, decision, acknowledgement].some(
      (event) => event.result.status !== "succeeded",
    )
  ) {
    issues.push({
      path: "$.events",
      message: "request, consent, decision, and acknowledgement must succeed",
    });
  }
  if (consent.payload.choice !== "approve") {
    issues.push({ path: "$.consent.payload.choice", message: "must be approve" });
  }
  if (consent.payload.recipientId !== request.payload.recipient.id) {
    issues.push({
      path: "$.consent.payload.recipientId",
      message: "must match the requested recipient",
    });
  }
  if (decision.actor.id !== request.payload.recipient.id) {
    issues.push({
      path: "$.decision.actor.id",
      message: "must match the requested recipient",
    });
  }
  if (acknowledgement.payload.decisionEventId !== decision.eventId) {
    issues.push({
      path: "$.acknowledgement.payload.decisionEventId",
      message: "must reference the linked decision event",
    });
  }

  for (const [name, event] of [
    ["consent", consent],
    ["decision", decision],
    ["acknowledgement", acknowledgement],
    ["expiry", expiry],
    ["revocation", revocation],
    ["receipt", sourceReceipt],
  ] as const) {
    if (event && !sameDataScope(request.dataScope, event.dataScope)) {
      issues.push({
        path: `$.${name}.dataScope`,
        message: "must match the request dataScope",
      });
    }
  }

  if (
    Date.parse(consent.occurredAt) < Date.parse(request.occurredAt) ||
    Date.parse(decision.occurredAt) < Date.parse(consent.occurredAt) ||
    Date.parse(acknowledgement.occurredAt) < Date.parse(decision.occurredAt)
  ) {
    issues.push({ path: "$.events", message: "must follow handshake order" });
  }

  const terminal = revocation ?? expiry;
  if (terminal) {
    if (Date.parse(decision.occurredAt) > Date.parse(terminal.occurredAt)) {
      issues.push({
        path: "$.decision.occurredAt",
        message: "must not occur after access ended",
      });
    }
    if (
      Date.parse(acknowledgement.occurredAt) > Date.parse(terminal.occurredAt)
    ) {
      issues.push({
        path: "$.acknowledgement.occurredAt",
        message: "must not occur after access ended",
      });
    }
  }

  if (sourceReceipt) {
    validateSourceReceipt(
      sourceReceipt,
      request,
      [request, consent, decision, acknowledgement, ...(terminal ? [terminal] : [])],
      issues,
    );
    if (
      Date.parse(sourceReceipt.occurredAt) <
      Date.parse(acknowledgement.occurredAt)
    ) {
      issues.push({
        path: "$.receipt.occurredAt",
        message: "must be at or after the reported acknowledgement",
      });
    }
  }
  if (issues.length > 0) {
    return { success: false, issues };
  }

  const now = options.now ?? new Date();
  const preparedAt = sourceReceipt?.occurredAt ?? now.toISOString();
  const receipt: ClaimantReceiptPreview = {
    handshakeId,
    authenticity: {
      status: "unverified",
      message:
        "Local browser data is not authenticated proof of recipient action.",
    },
    fields: request.dataScope.fields,
    recipient: request.payload.recipient,
    decision: {
      outcome: decision.payload.response,
      rationale: decision.payload.rationale,
      ...(decision.payload.requiredChanges
        ? { requiredChanges: decision.payload.requiredChanges }
        : {}),
    },
    acknowledgement: {
      roleName: acknowledgement.actor.roleName as string,
      outcome: acknowledgement.payload.outcome,
      ...(acknowledgement.payload.note
        ? { note: acknowledgement.payload.note }
        : {}),
    },
    timestamps: {
      requestedAt: request.occurredAt,
      consentedAt: consent.occurredAt,
      decidedAt: decision.occurredAt,
      acknowledgedAt: acknowledgement.occurredAt,
      preparedAt,
      ...(terminal ? { terminalAt: terminal.occurredAt } : {}),
    },
    access: {
      status: accessStatus(request.dataScope, now, expiry, revocation),
      validUntil: request.dataScope.validUntil,
    },
    delivery: {
      status: "pending",
      intendedRecipients: [
        { id: request.actor.id, role: "claimant", displayName: "Claimant" },
        {
          id: request.payload.recipient.id,
          role: "recipient",
          displayName: request.payload.recipient.displayName,
        },
      ],
    },
  };

  return { success: true, value: { receipt } };
}

export function previewClaimantReceipt(
  handshakeId: string,
  dependencies: ScopedRequestDependencies,
): ClaimantReceiptPreviewResult {
  const events = readHandshakeEventLedger(dependencies.storage).events.filter(
    (event) => event.handshakeId === handshakeId,
  );
  return composeClaimantReceipt(events, {
    now: dependencies.now?.() ?? new Date(),
  });
}

export function previewDemoLinkedEvents(
  handshakeId: string,
  incomingEvents: readonly HandshakeEvent[],
  dependencies: ScopedRequestDependencies,
): ClaimantReceiptPreviewResult {
  if (!Array.isArray(incomingEvents) || incomingEvents.length === 0) {
    return failure("$.incomingEvents", "must contain linked demo events");
  }
  const incomingIds = incomingEvents.map((event) => event.eventId);
  if (new Set(incomingIds).size !== incomingIds.length) {
    return failure("$.incomingEvents", "must not contain duplicate eventIds");
  }
  const invalidIncoming = incomingEvents.find(
    (event) =>
      event.handshakeId !== handshakeId || !validateHandshakeEvent(event).success,
  );
  if (invalidIncoming) {
    return failure("$.incomingEvents", "must be valid events for the handshake");
  }

  const existingEvents = readHandshakeEventLedger(dependencies.storage).events;
  const existingById = new Map(
    existingEvents.map((event) => [event.eventId, event] as const),
  );
  for (const event of incomingEvents) {
    const existing = existingById.get(event.eventId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
      return failure("$.incomingEvents", "cannot replace an existing eventId");
    }
  }

  const combined = [
    ...existingEvents,
    ...incomingEvents.filter((event) => !existingById.has(event.eventId)),
  ].filter((event) => event.handshakeId === handshakeId);
  return composeClaimantReceipt(combined, {
    now: dependencies.now?.() ?? new Date(),
  });
}

function validateSourceReceipt(
  receipt: ReceiptEvent,
  request: RequestEvent,
  sourceEvents: readonly HandshakeEvent[],
  issues: { path: string; message: string }[],
): void {
  const parties = new Map(
    receipt.payload.deliveredTo.map((party) => [party.role, party.id]),
  );
  if (
    parties.get("claimant") !== request.actor.id ||
    parties.get("recipient") !== request.payload.recipient.id
  ) {
    issues.push({
      path: "$.receipt.payload.deliveredTo",
      message: "must identify the linked claimant and recipient",
    });
  }
  const sourceIds = sourceEvents
    .filter(
      (event) => Date.parse(event.occurredAt) <= Date.parse(receipt.occurredAt),
    )
    .map((event) => event.eventId);
  if (!sameStrings(receipt.payload.eventIds, sourceIds)) {
    issues.push({
      path: "$.receipt.payload.eventIds",
      message: "must reference every earlier linked source event exactly once",
    });
  }
}

function single<Event extends HandshakeEvent>(
  events: readonly HandshakeEvent[],
  type: Event["type"],
  required: boolean,
  issues: { path: string; message: string }[],
): Event | undefined {
  const matching = events.filter((event) => event.type === type) as Event[];
  if ((required && matching.length !== 1) || (!required && matching.length > 1)) {
    issues.push({
      path: `$.${type}`,
      message: required ? "must contain exactly one event" : "must contain at most one event",
    });
  }
  return matching.length === 1 ? matching[0] : undefined;
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
        field.id === right.fields[index].id &&
        field.label === right.fields[index].label,
    )
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function accessStatus(
  scope: HandshakeDataScope,
  now: Date,
  expiry: ExpiryEvent | undefined,
  revocation: RevocationEvent | undefined,
): ClaimantReceiptPreview["access"]["status"] {
  if (revocation) {
    return "revoked";
  }
  if (expiry || now.getTime() >= Date.parse(scope.validUntil)) {
    return "expired";
  }
  return now.getTime() < Date.parse(scope.validFrom) ? "not_started" : "active";
}

function failure(path: string, message: string): ClaimantReceiptPreviewResult {
  return { success: false, issues: [{ path, message }] };
}
