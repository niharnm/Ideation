import { ApiError, type ApiPrincipal } from "../src/api/service.ts";
import { errorResponse, json, response } from "./_lib/http.ts";
import { getDemoService } from "./_lib/runtime.ts";

const claimant: ApiPrincipal = {
  organizationId: "demo-claimant",
  roles: ["claimant"],
  keyId: "website-demo-claimant",
};

const recipient: ApiPrincipal = {
  organizationId: "demo-recipient",
  roles: ["recipient"],
  keyId: "website-demo-recipient",
};

const defaultPassport = {
  claimantId: "claimant-demo",
  constraints: [
    { id: "order.constraint.peanut", label: "Peanut avoidance requirement", severity: "severe", crossContaminationTolerance: false },
  ],
};

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(422, "invalid_request", `${name} is required.`);
  return value.trim();
}

async function currentHandshake(principal: ApiPrincipal, id: unknown) {
  return getDemoService().get(principal, string(id, "handshakeId"));
}

async function passport() {
  const service = getDemoService();
  try {
    return await service.getPassport(claimant, defaultPassport.claimantId);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "not_found") throw error;
    return service.putPassport(claimant, defaultPassport);
  }
}

async function handle(request: Request) {
  if (request.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use POST for the website demo adapter.");
  const body = await json(request);
  const action = string(body.action, "action");
  const service = getDemoService();

  if (action === "passport-status") return response({ passport: await passport() });

  if (action === "passport-update") {
    return response({ passport: await service.putPassport(claimant, {
      claimantId: defaultPassport.claimantId,
      constraints: body.constraints,
    }) });
  }

  if (action === "start") {
    const profile = await passport();
    if (profile.constraints.length === 0) throw new ApiError(409, "passport_empty", "Add a passport constraint before starting a handshake.");
    const requestedId = typeof body.constraintId === "string" ? body.constraintId : profile.constraints[0].id;
    const constraint = profile.constraints.find((item) => item.id === requestedId);
    if (!constraint) throw new ApiError(422, "invalid_request", "The requested constraint is not in this passport.");
    const validFrom = new Date();
    const validUntil = new Date(validFrom.getTime() + 15 * 60_000);
    const created = await service.create(claimant, {
      claimantId: profile.claimantId,
      recipientOrganizationId: recipient.organizationId,
      recipient: { id: "recipient-1", displayName: "Fieldline" },
      summary: "Use one passport constraint to safely prepare one restaurant order.",
      dataScope: {
        purpose: `Prepare one Pad Thai order with the ${constraint.label} constraint.`,
        fields: [{ id: constraint.id, label: constraint.label }],
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
      },
    });
    const handshake = await service.consent(claimant, created.id, {
      choice: "approve",
      values: { [constraint.id]: constraint.label },
    });
    return response({ handshake }, 201);
  }

  if (action === "claimant-status") return response({ handshake: await currentHandshake(claimant, body.handshakeId) });

  if (action === "revoke") {
    const handshake = await service.revoke(claimant, string(body.handshakeId, "handshakeId"), { reason: "The customer ended restaurant access from the demo." });
    return response({ handshake });
  }

  if (action === "recipient-status") {
    const handshake = await currentHandshake(recipient, body.handshakeId);
    const grant = handshake.status === "active" ? await service.grant(recipient, handshake.id) : null;
    return response({ handshake, grant });
  }

  if (action === "record-decision") {
    const id = string(body.handshakeId, "handshakeId");
    const responseValue = body.response;
    if (!["accept", "required_change", "decline", "cannot_determine"].includes(String(responseValue))) throw new ApiError(422, "invalid_request", "response is invalid.");
    const rationale = string(body.rationale, "rationale");
    const decision = await service.decision(recipient, id, {
      actorId: "fieldline-kitchen",
      response: responseValue,
      rationale,
      ...(responseValue === "required_change" ? { requiredChanges: ["Omit peanuts from this Pad Thai.", "Use the designated peanut-free preparation surface."] } : {}),
    });
    const acknowledgement = await service.acknowledge(recipient, id, {
      actorId: "fieldline-kitchen",
      roleName: "Kitchen manager",
      outcome: "acknowledged",
    });
    return response({ decision, acknowledgement }, 201);
  }

  throw new ApiError(404, "not_found", "Unknown website demo action.");
}

export default {
  async fetch(request: Request) {
    try {
      return await handle(request);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
