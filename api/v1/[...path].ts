import { errorResponse, json, response } from "../_lib/http.ts";
import { getService } from "../_lib/runtime.ts";
import { authenticate, ApiError, MemoryHandshakeStore, PostgresHandshakeStore } from "../../src/api/service.ts";

function getStore() {
  return getService().store as MemoryHandshakeStore | PostgresHandshakeStore;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean); const service = getService(); const principal = await authenticate(getStore(), request.headers.get("authorization"));
  if (request.method === "GET" && path.length === 1 && path[0] === "passport") return response(await service.getPassport(principal, url.searchParams.get("claimantId") ?? ""));
  if (request.method === "PUT" && path.length === 1 && path[0] === "passport") return response(await service.putPassport(principal, await json(request)));
  if (request.method === "POST" && path.length === 1 && path[0] === "handshakes") return response(await service.create(principal, await json(request)), 201);
  if (request.method === "GET" && path.length === 1 && path[0] === "handshakes") return response(await service.list(principal, url.searchParams.get("cursor") ?? undefined, Number(url.searchParams.get("limit") ?? "25")));
  if (path[0] !== "handshakes" || path.length < 2) throw new ApiError(404, "not_found", "Endpoint was not found.");
  const id = path[1];
  if (request.method === "GET" && path.length === 2) return response(await service.get(principal, id));
  if (request.method === "GET" && path.length === 3 && path[2] === "grant") return response(await service.grant(principal, id));
  if (request.method === "POST" && path.length === 3 && path[2] === "consent") return response(await service.consent(principal, id, await json(request)));
  if (request.method === "POST" && path.length === 3 && path[2] === "decisions") return response(await service.decision(principal, id, await json(request)), 201);
  if (request.method === "POST" && path.length === 3 && path[2] === "acknowledgements") return response(await service.acknowledge(principal, id, await json(request)), 201);
  if (request.method === "POST" && path.length === 3 && path[2] === "revocations") return response(await service.revoke(principal, id, await json(request)));
  throw new ApiError(404, "not_found", "Endpoint was not found.");
}

export default { async fetch(request: Request) { try { return await handle(request); } catch (error) { return errorResponse(error); } } };
