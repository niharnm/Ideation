import { ApiError } from "../src/api/service.ts";
import { errorResponse, json, response } from "./_lib/http.ts";

const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

async function handle(request: Request) {
  if (request.method !== "POST") {
    throw new ApiError(405, "method_not_allowed", "Use POST for a kitchen preparation suggestion.");
  }
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new ApiError(503, "smart_prep_unavailable", "The kitchen suggestion service is unavailable.");
  }

  const body = await json(request);
  const item = typeof body.item === "string" && body.item.trim()
    ? body.item.trim().slice(0, 200)
    : "Pad Thai";
  const constraints = Array.isArray(body.constraints)
    ? body.constraints
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .slice(0, 10)
        .map((value) => value.trim().slice(0, 200))
    : [];

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a precise restaurant safety assistant. Return one or two plain sentences with a concrete preparation recommendation. Do not use markdown.",
        },
        {
          role: "user",
          content: `Order: ${item}. Customer-approved constraints: ${JSON.stringify(constraints)}. Explain the safe preparation change or say that the kitchen cannot determine safety.`,
        },
      ],
    }),
  });
  const payload = await groqResponse.json().catch(() => ({}));
  if (!groqResponse.ok) {
    throw new ApiError(502, "smart_prep_provider_error", "The kitchen suggestion provider could not complete this request.");
  }
  const suggestion = payload.choices?.[0]?.message?.content;
  if (typeof suggestion !== "string" || !suggestion.trim()) {
    throw new ApiError(502, "smart_prep_provider_error", "The kitchen suggestion provider returned an empty response.");
  }
  return response({ suggestion: suggestion.trim() });
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
