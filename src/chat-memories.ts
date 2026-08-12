const MEMORY_FENCE = /```json\s*([\s\S]*?)```/i;
const CLEAR_PATTERN =
  /\b(no (allerg|diet|constraint)|deleted all|clear (my )?(allerg|memor)|i have no allerg)/i;

export function extractMemoryJsonFromReply(reply: string): string[] | null {
  const fence = reply.match(MEMORY_FENCE);
  const raw = fence ? fence[1] : reply;
  const objectMatch = raw.match(/\{[\s\S]*"memories"[\s\S]*\}/);
  if (!objectMatch) return null;
  try {
    const parsed = JSON.parse(objectMatch[0]) as { memories?: unknown };
    if (!Array.isArray(parsed.memories)) return null;
    return parsed.memories
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function stripMemoryJsonFromReply(reply: string): string {
  return reply
    .replace(MEMORY_FENCE, "")
    .replace(/\{[\s\S]*"memories"[\s\S]*\}/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function shouldClearMemories(text: string): boolean {
  return CLEAR_PATTERN.test(text);
}

export function resolveMemoriesFromTurn(input: {
  userText: string;
  assistantText: string;
  previousMemories: string[];
}): { memories: string[] | null; replaced: boolean } {
  const extracted = extractMemoryJsonFromReply(input.assistantText);
  if (extracted) {
    return { memories: extracted, replaced: true };
  }
  if (shouldClearMemories(input.userText)) {
    return { memories: [], replaced: true };
  }
  return { memories: null, replaced: false };
}

export function buildChatSystemPrompt(currentMemories: string[]): string {
  const current = currentMemories.length > 0
    ? currentMemories.map((memory) => `- ${memory}`).join("\n")
    : "(none yet)";
  return [
    "You are ChatGPT with an Egoist AI Passport plugin connected.",
    "Talk like ChatGPT: helpful, concise, and conversational.",
    "The plugin can save dietary and allergy memories to the user's local AI Passport.",
    "Current passport memories:",
    current,
    "When the user states, updates, or clears food allergies or diet constraints, end your reply with a JSON code fence containing the FULL current memory list:",
    '```json',
    '{"memories":["i dont like milk","peanut allergy"]}',
    "```",
    "The memories array is the complete current state. Use an empty array to clear all dietary memories.",
    "If the user is not talking about diet or allergies, do not include the JSON block.",
    "Never mention Groq, API keys, or that this is a local demo unless asked.",
  ].join("\n");
}
