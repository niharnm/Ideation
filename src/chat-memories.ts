const MEMORY_FENCE = /```json\s*([\s\S]*?)```/i;
const CLEAR_PATTERN =
  /\b(no (allerg|diet|constraint)|deleted all|clear (my )?(allerg|memor)|i have no allerg)\b/i;
const DIETARY_TURN_PATTERN =
  /\b(allerg|anaphylac|intoleran|celiac|glutens?|peanuts?|tree\s*nuts?|nuts?|dairy|lactose|milk|wheat|eggs?|soy|fish|shellfish|shrimp|sesame|vegan|vegetarian|cross[-\s]?contam|diet(ary)?|passport|memor(?:y|ies))\b/i;

export function extractMemoryJsonFromReply(reply: string): string[] | null {
  const fence = reply.match(MEMORY_FENCE);
  const raw = fence ? fence[1] : reply;
  const objectMatch = raw.match(/\{[\s\S]*"memories"[\s\S]*\}/);
  if (!objectMatch) return null;
  return parseMemoriesPayload(objectMatch[0]);
}

export function parseExtractorJson(raw: string): string[] | null {
  const fromReply = extractMemoryJsonFromReply(raw);
  if (fromReply) return fromReply;
  return parseMemoriesPayload(raw);
}

function parseMemoriesPayload(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw) as { memories?: unknown };
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

export function looksLikeDietaryTurn(text: string): boolean {
  return shouldClearMemories(text) || DIETARY_TURN_PATTERN.test(text);
}

export function mergeMemoryStrings(
  previous: string[],
  incoming: string,
): string[] {
  const next = incoming.trim();
  if (!next) return [...previous];
  if (previous.some((item) => item.toLowerCase() === next.toLowerCase())) {
    return [...previous];
  }
  return [...previous, next];
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
    "The plugin saves dietary and allergy memories to the user's local AI Passport.",
    "Current passport memories:",
    current,
    "When the user states, updates, or clears food allergies or diet constraints, end your reply with a JSON code fence containing the FULL current memory list:",
    "```json",
    '{"memories":["does not like milk","peanut allergy"]}',
    "```",
    "The memories array is the complete current state. Keep prior memories unless the user changed or removed them.",
    "Use an empty array to clear all dietary memories.",
    "Write allergy facts as allergies (for example 'peanut allergy') and dislikes as preferences (for example 'does not like milk').",
    "If the user is not talking about diet or allergies, do not include the JSON block.",
    "Never mention Groq, API keys, or that this is a local demo unless asked.",
  ].join("\n");
}

export function buildMemoryExtractorPrompt(currentMemories: string[]): string {
  const current = currentMemories.length > 0
    ? currentMemories.map((memory) => `- ${memory}`).join("\n")
    : "(none yet)";
  return [
    "You maintain a diner's AI Passport memory list for food allergies and diet only.",
    "Return JSON with key memories, an array of short strings. No markdown.",
    "Current memories:",
    current,
    "Rules:",
    "- Return the FULL current list, not a delta.",
    "- Keep prior memories unless the user changed or removed them.",
    "- Use [] if the user cleared dietary memories or said they have none.",
    "- Prefer short phrases: 'peanut allergy', 'does not like milk'.",
    "- Distinguish preference from allergy in the wording.",
    "- If the user is not talking about diet, return the current list unchanged.",
  ].join("\n");
}
