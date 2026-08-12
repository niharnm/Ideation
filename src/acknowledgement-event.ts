import {
  HANDSHAKE_EVENT_SCHEMA_VERSION,
  type AcknowledgementEvent,
  type HandshakeDataScope,
} from "./handshake-event.ts";

export interface BuildAcknowledgementEventParams {
  handshakeId: string;
  actorId: string;
  roleName: string;
  decisionEventId: string;
  outcome: "acknowledged" | "rejected";
  note?: string;
  dataScope: HandshakeDataScope;
  occurredAt?: string;
  eventId?: string;
}

export function buildAcknowledgementEvent(
  params: BuildAcknowledgementEventParams,
): AcknowledgementEvent {
  if (
    !params ||
    !params.roleName ||
    typeof params.roleName !== "string" ||
    params.roleName.trim() === ""
  ) {
    throw new Error("roleName is required for acknowledger actor");
  }

  if (
    !params.actorId ||
    typeof params.actorId !== "string" ||
    params.actorId.trim() === ""
  ) {
    throw new Error("actorId is required");
  }

  if (
    !params.handshakeId ||
    typeof params.handshakeId !== "string" ||
    params.handshakeId.trim() === ""
  ) {
    throw new Error("handshakeId is required");
  }

  if (
    !params.decisionEventId ||
    typeof params.decisionEventId !== "string" ||
    params.decisionEventId.trim() === ""
  ) {
    throw new Error("decisionEventId is required");
  }

  if (params.outcome !== "acknowledged" && params.outcome !== "rejected") {
    throw new Error("outcome must be 'acknowledged' or 'rejected'");
  }

  const payload: AcknowledgementEvent["payload"] = {
    decisionEventId: params.decisionEventId,
    outcome: params.outcome,
  };

  if (params.note !== undefined) {
    payload.note = params.note;
  }

  return {
    schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION,
    eventId: params.eventId ?? crypto.randomUUID(),
    handshakeId: params.handshakeId,
    type: "acknowledgement",
    occurredAt: params.occurredAt ?? new Date().toISOString(),
    actor: {
      id: params.actorId,
      role: "acknowledger",
      roleName: params.roleName,
    },
    dataScope: params.dataScope,
    result: {
      status: "succeeded",
      failureCondition: null,
    },
    payload,
  };
}
