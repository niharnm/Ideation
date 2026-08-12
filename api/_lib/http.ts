import { ApiError, authenticate, type HandshakeService, type HandshakeStore } from "../../src/api/service.ts";

export async function json(request: Request): Promise<Record<string, unknown>> {
  try { const value = await request.json(); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new ApiError(400, "invalid_json", "Request body must be a JSON object."); }
}

export function response(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return response({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status);
  console.error(error); return response({ error: { code: "internal_error", message: "The API could not complete the request." } }, 500);
}
export async function principal(request: Request, store: HandshakeStore) { return authenticate(store, request.headers.get("authorization")); }
