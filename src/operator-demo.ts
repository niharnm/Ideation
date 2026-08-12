import {
  buildAcknowledgementEvent,
} from "./acknowledgement-event.ts";
import {
  previewClaimantReceipt,
  type ClaimantReceiptPreviewResult,
} from "./claimant-receipt.ts";
import { buildDecisionEvent } from "./decision-event.ts";
import {
  assertAcknowledgementCanBeRecorded,
  assertRecipientDecisionCanBeRecorded,
} from "./recipient-console.ts";
import type { PolicyDecision } from "./decision-policy.ts";
import type {
  AcknowledgementEvent,
  DecisionEvent,
  HandshakeDataScope,
  HandshakeEvent,
} from "./handshake-event.ts";
import {
  approveScopedRequest,
  appendHandshakeEvents,
  readHandshakeEventLedger,
  type ScopedRequestDependencies,
  type StorageLike,
} from "./passport-flow.ts";

export class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

export interface RecordStaffAcknowledgementParams {
  handshakeId: string;
  actorId: string;
  roleName?: string;
  decision: PolicyDecision;
  dataScope: HandshakeDataScope;
  recipientId: string;
  note?: string;
  occurredAt?: string;
}

export function recordStaffAcknowledgement(
  params: RecordStaffAcknowledgementParams,
  dependencies: ScopedRequestDependencies,
): {
  decisionEvent: DecisionEvent;
  acknowledgementEvent: AcknowledgementEvent;
} {
  const roleName = params.roleName ?? "Shift Manager";
  const nowStr = (dependencies.now?.() ?? new Date()).toISOString();
  const decisionOccurredAt = params.occurredAt ?? nowStr;
  const ackOccurredAt = new Date(Date.parse(decisionOccurredAt) + 1000).toISOString();

  const decisionEvent = buildDecisionEvent({
    handshakeId: params.handshakeId,
    actorId: params.recipientId,
    dataScope: params.dataScope,
    decision: params.decision,
    occurredAt: decisionOccurredAt,
  });

  const acknowledgementEvent = buildAcknowledgementEvent({
    handshakeId: params.handshakeId,
    actorId: params.actorId,
    roleName,
    decisionEventId: decisionEvent.eventId,
    outcome: "acknowledged",
    note: params.note,
    dataScope: params.dataScope,
    occurredAt: ackOccurredAt,
  });

  assertRecipientDecisionCanBeRecorded(decisionEvent, dependencies);
  assertAcknowledgementCanBeRecorded(
    acknowledgementEvent,
    decisionEvent,
    params.recipientId,
    dependencies,
  );
  appendHandshakeEvents(dependencies.storage, [decisionEvent, acknowledgementEvent]);
  dependencies.emit(decisionEvent);
  dependencies.emit(acknowledgementEvent);

  return { decisionEvent, acknowledgementEvent };
}

export type OperatorDemoScenario =
  | "accept"
  | "required_change"
  | "cannot_determine";

export interface RunOperatorDemoOptions {
  handshakeId?: string;
  claimantId?: string;
  recipientId?: string;
  recipientName?: string;
  actorId?: string;
  roleName?: string;
  storage?: StorageLike;
  dependencies?: ScopedRequestDependencies;
  now?: Date | string;
}

export interface OperatorDemoResult {
  scenario: OperatorDemoScenario;
  handshakeId: string;
  dataScope: HandshakeDataScope;
  events: readonly HandshakeEvent[];
  receiptPreview: ClaimantReceiptPreviewResult;
  summary: string;
}

export function runOperatorDemo(
  scenario: OperatorDemoScenario,
  options: RunOperatorDemoOptions = {},
): OperatorDemoResult {
  const storage = options.storage ?? new MemoryStorage();
  const emittedEvents: HandshakeEvent[] = [];

  const nowFn = () =>
    options.now
      ? typeof options.now === "string"
        ? new Date(options.now)
        : options.now
      : new Date("2026-08-12T18:00:00Z");

  let idCounter = 0;
  const customHandshakeId = options.handshakeId?.startsWith("handshake-")
    ? options.handshakeId.slice(10)
    : options.handshakeId;
  const defaultCreateId = () => {
    idCounter += 1;
    if (customHandshakeId) {
      return idCounter === 1
        ? customHandshakeId
        : `${customHandshakeId}-${idCounter}`;
    }
    return `operator-${scenario}-${idCounter}`;
  };

  const deps: ScopedRequestDependencies = options.dependencies ?? {
    storage,
    emit: (evt) => emittedEvents.push(evt),
    now: nowFn,
    createId: defaultCreateId,
  };

  const claimantId = options.claimantId ?? "diner-101";
  const recipientId = options.recipientId ?? "bistro-789";
  const recipientName = options.recipientName ?? "Bistro Allegro";
  const actorId = options.actorId ?? "staff-42";
  const roleName = options.roleName ?? "Shift Manager";

  let purpose = "";
  let fields: { id: string; label: string; selected: boolean }[] = [];
  let decision: PolicyDecision;
  let summaryText = "";

  switch (scenario) {
    case "accept": {
      purpose = "Verify peanut allergy constraint for Pad Thai order";
      fields = [
        {
          id: "order.constraint.peanut",
          label: "Peanut constraint (Pad Thai)",
          selected: true,
        },
      ];
      decision = {
        response: "accept",
        rationale: "Peanut constraint verified on Pad Thai.",
      };
      summaryText = `Scenario 'accept': Peanut constraint verified on Pad Thai order by Shift Manager (${actorId}).`;
      break;
    }
    case "required_change": {
      purpose = "Verify allergen constraints for dish with soy sauce";
      fields = [
        {
          id: "order.constraint.soy",
          label: "Soy sauce constraint",
          selected: true,
        },
      ];
      decision = {
        response: "required_change",
        rationale:
          "Standard soy sauce contains gluten. Tamari GF Soy sauce substitution required.",
        requiredChanges: ["Tamari GF Soy sauce substitution required"],
      };
      summaryText = `Scenario 'required_change': Tamari GF Soy sauce substitution required by Shift Manager (${actorId}).`;
      break;
    }
    case "cannot_determine": {
      purpose = "Verify allergen constraints for dish with curry paste";
      fields = [
        {
          id: "order.constraint.curry_paste",
          label: "Curry paste allergen verification",
          selected: true,
        },
      ];
      decision = {
        response: "cannot_determine",
        rationale: "Unverified curry paste ingredients in kitchen inventory.",
      };
      summaryText = `Scenario 'cannot_determine': Unverified curry paste ingredients reported by Shift Manager (${actorId}).`;
      break;
    }
    default: {
      const invalidScenario: never = scenario;
      throw new Error(`Unsupported scenario: ${invalidScenario}`);
    }
  }

  const approveResult = approveScopedRequest(
    {
      claimantId,
      recipient: { id: recipientId, displayName: recipientName },
      summary: purpose,
      draft: {
        purpose,
        fields,
        validFrom: "2026-08-12T18:00:00Z",
        validUntil: "2026-08-12T18:30:00Z",
        choice: null,
      },
    },
    deps,
  );

  if (!approveResult.success) {
    throw new Error(
      `Failed to approve scoped request for scenario ${scenario}: ${approveResult.issues.map((i) => `${i.path}: ${i.message}`).join(", ")}`,
    );
  }

  const actualHandshakeId = approveResult.value.requestEvent.handshakeId;
  const dataScope = approveResult.value.requestEvent.dataScope;

  recordStaffAcknowledgement(
    {
      handshakeId: actualHandshakeId,
      actorId,
      roleName,
      decision,
      dataScope,
      recipientId,
      occurredAt: new Date(Date.parse("2026-08-12T18:05:00Z")).toISOString(),
    },
    deps,
  );

  const receiptPreview = previewClaimantReceipt(
    actualHandshakeId,
    deps,
  );

  const allEvents = readHandshakeEventLedger(storage).events.filter(
    (e) => e.handshakeId === actualHandshakeId,
  );

  return {
    scenario,
    handshakeId: actualHandshakeId,
    dataScope,
    events: allEvents,
    receiptPreview,
    summary: summaryText,
  };
}
