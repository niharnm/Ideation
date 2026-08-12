import { randomUUID } from "node:crypto";
import type {
  DecisionEvent,
  DecisionPayload,
  HandshakeDataScope,
} from "./handshake-event.ts";
import { HANDSHAKE_EVENT_SCHEMA_VERSION } from "./handshake-event.ts";

export type PolicyDecision = DecisionPayload;

export interface BuildDecisionEventParams {
  handshakeId: string;
  actorId: string;
  dataScope: HandshakeDataScope;
  decision: PolicyDecision;
  occurredAt?: string;
}

export function buildDecisionEvent(
  params: BuildDecisionEventParams,
): DecisionEvent {
  const { handshakeId, actorId, dataScope, decision, occurredAt } = params;

  return {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: randomUUID(),
    handshakeId,
    type: "decision",
    occurredAt: occurredAt ?? new Date().toISOString(),
    actor: {
      id: actorId,
      role: "recipient",
    },
    dataScope,
    result: {
      status: "succeeded",
      failureCondition: null,
    },
    payload: decision,
  };
}
