import { ApiError } from "../src/api/service.ts";
import {
  buildChatSystemPrompt,
  resolveMemoriesFromTurn,
  stripMemoryJsonFromReply,
} from "../src/chat-memories.ts";
import { parseMemoryInputsToConstraints } from "../src/egoist-mcp-server.ts";
import { errorResponse, json, response } from "./_lib/http.ts";

const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

async function handle(request: Request) {
  if (request.method !== "POST") {
    throw new ApiError(405, "method_not_allowed", "Use POST for chat.");
  }
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new ApiError(503, "chat_unavailable", "Chat is unavailable. The local passport adapter remains available.");
  }

  const body = await json(request);
  const incoming = Array.isArray(body.messages)
    ? body.messages.filter((item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string"
      )
    : [];
  if (incoming.length === 0) {
    throw new ApiError(422, "invalid_request", "messages must contain at least one chat message.");
  }

  const userText = [...incoming].reverse().find((item) => item.role === "user")?.content || "";
  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: buildChatSystemPrompt([]) },
        ...incoming,
      ],
    }),
  });
  const payload = await groqResponse.json();
  if (!groqResponse.ok) {
    throw new ApiError(502, "chat_provider_error", "The chat provider could not complete this request.");
  }

  const assistantText = payload.choices?.[0]?.message?.content;
  if (typeof assistantText !== "string" || !assistantText.trim()) {
    throw new ApiError(502, "chat_provider_error", "The chat provider returned an empty response.");
  }
  const resolved = resolveMemoriesFromTurn({
    userText,
    assistantText,
    previousMemories: [],
  });
  const memories = resolved.memories || [userText];
  const constraints = parseMemoryInputsToConstraints({ memories });
  return response({
    reply: stripMemoryJsonFromReply(assistantText) || assistantText,
    memories,
    constraints,
  });
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
