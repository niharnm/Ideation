import type { HandshakeDataScope } from "./handshake-event.ts";

export interface PolicyInput {
  dataScope: HandshakeDataScope;
  recipientData: Record<string, unknown>;
}

export type PolicyDecisionResponse =
  | "accept"
  | "required_change"
  | "decline"
  | "cannot_determine";

export interface PolicyDecision {
  response: PolicyDecisionResponse;
  rationale: string;
  requiredChanges?: readonly string[];
}

function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
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

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  if (!input || !input.dataScope || !input.recipientData) {
    return {
      response: "cannot_determine",
      rationale: "Missing dataScope or recipientData in policy input.",
    };
  }

  const { dataScope, recipientData } = input;

  if (!Array.isArray(dataScope.fields) || dataScope.fields.length === 0) {
    return {
      response: "cannot_determine",
      rationale: "Data scope contains no fields to evaluate.",
    };
  }

  if (
    typeof dataScope.validFrom === "string" &&
    typeof dataScope.validUntil === "string" &&
    Date.parse(dataScope.validUntil) <= Date.parse(dataScope.validFrom)
  ) {
    return {
      response: "decline",
      rationale:
        "Data scope validity period is invalid: validUntil must be after validFrom.",
    };
  }

  // Check global directives in recipientData
  const globalStatus = recipientData.status || recipientData._status;
  const globalRationale = (recipientData.rationale ||
    recipientData._rationale) as string | undefined;

  if (globalStatus === "decline") {
    return {
      response: "decline",
      rationale:
        globalRationale || "Recipient policy explicitly declines the request.",
    };
  }

  if (globalStatus === "cannot_determine") {
    return {
      response: "cannot_determine",
      rationale:
        globalRationale || "Recipient policy cannot determine outcome.",
    };
  }

  if (globalStatus === "required_change") {
    const rawChanges =
      recipientData.requiredChanges || recipientData._requiredChanges;
    const requiredChanges =
      Array.isArray(rawChanges) && rawChanges.length > 0
        ? (rawChanges as string[])
        : ["Requested data scope requires modification."];
    return {
      response: "required_change",
      rationale:
        globalRationale ||
        "Recipient policy requires changes before proceeding.",
      requiredChanges,
    };
  }

  const missingFields: string[] = [];
  const declinedFields: string[] = [];
  const requiredChangesList: string[] = [];

  for (const field of dataScope.fields) {
    const val = getValueByPath(recipientData, field.id);

    if (val === undefined || val === null) {
      missingFields.push(field.label || field.id);
      continue;
    }

    if (typeof val === "boolean") {
      if (!val) {
        declinedFields.push(`Field '${field.label || field.id}' is set to false`);
      }
      continue;
    }

    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (
        obj.status === "missing" ||
        obj.confirmed === false ||
        obj.available === false ||
        obj.status === "cannot_determine"
      ) {
        missingFields.push(field.label || field.id);
      } else if (
        obj.status === "required_change" ||
        typeof obj.requiredChange === "string" ||
        typeof obj.changeRequired === "string"
      ) {
        const msg = (obj.requiredChange ||
          obj.changeRequired ||
          `Field '${field.label || field.id}' requires modification.`) as string;
        requiredChangesList.push(msg);
      } else if (
        obj.status === "declined" ||
        obj.allowed === false ||
        obj.valid === false ||
        obj.accepted === false
      ) {
        const msg = (obj.reason ||
          obj.rationale ||
          `Field '${field.label || field.id}' is restricted or disallowed.`) as string;
        declinedFields.push(msg);
      }
      continue;
    }
  }

  if (declinedFields.length > 0) {
    return {
      response: "decline",
      rationale: `Recipient policy declines request due to field constraints: ${declinedFields.join("; ")}.`,
    };
  }

  if (requiredChangesList.length > 0) {
    return {
      response: "required_change",
      rationale:
        "Recipient policy requires changes to one or more requested fields.",
      requiredChanges: requiredChangesList,
    };
  }

  if (missingFields.length > 0) {
    return {
      response: "cannot_determine",
      rationale: `Missing or unconfirmed recipient data for field(s): ${missingFields.join(", ")}.`,
    };
  }

  return {
    response: "accept",
    rationale:
      "All requested fields are satisfied and confirmed by the recipient policy.",
  };
}
