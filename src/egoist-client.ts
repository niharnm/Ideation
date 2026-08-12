import { createHash, randomBytes } from "node:crypto";

export const EGOIST_ISSUER = "https://passport.ego.ist";
export const EGOIST_MCP_URL = "https://passport.ego.ist/mcp";
export const EGOIST_MEMORY_SCOPE = "openid profile email memory";

export interface EgoistOAuthClient {
  client_id: string;
  token_endpoint_auth_method?: string;
}

export interface EgoistTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState(): string {
  return base64Url(randomBytes(16));
}

export function buildEgoistAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: EGOIST_MEMORY_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: EGOIST_MCP_URL,
  });
  return `${EGOIST_ISSUER}/authorize?${params.toString()}`;
}

export async function registerEgoistOAuthClient(
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EgoistOAuthClient> {
  const response = await fetchImpl(`${EGOIST_ISSUER}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Handshake",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (!response.ok) {
    throw new Error(`Egoist client registration failed (${response.status})`);
  }
  return (await response.json()) as EgoistOAuthClient;
}

export async function exchangeEgoistAuthCode(
  input: {
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<EgoistTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
    resource: EGOIST_MCP_URL,
  });
  const response = await fetchImpl(`${EGOIST_ISSUER}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Egoist token exchange failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
    expires_at: payload.expires_in
      ? Date.now() + payload.expires_in * 1000
      : undefined,
  };
}

export function extractMemoryStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (text && text.length >= 4 && !text.startsWith("{") && !text.startsWith("[")) {
      out.push(text);
    } else if (text.startsWith("{") || text.startsWith("[")) {
      try {
        extractMemoryStrings(JSON.parse(text), out);
      } catch {
        if (text.length >= 4) out.push(text);
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractMemoryStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (
        lower === "text" ||
        lower === "content" ||
        lower === "memory" ||
        lower === "body" ||
        lower === "value" ||
        lower === "note" ||
        lower === "description" ||
        lower.includes("memor")
      ) {
        extractMemoryStrings(nested, out);
      } else if (nested && typeof nested === "object") {
        extractMemoryStrings(nested, out);
      }
    }
  }
  return [...new Set(out)];
}

function parseMcpResponseBody(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  const dataLines = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) return null;
  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function callEgoistMcp(
  accessToken: string,
  method: string,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(EGOIST_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2024-11-05",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Egoist MCP ${method} failed (${response.status})`);
  }
  const parsed = parseMcpResponseBody(raw) as {
    result?: unknown;
    error?: { message?: string };
  } | null;
  if (parsed?.error) {
    throw new Error(parsed.error.message || `Egoist MCP ${method} error`);
  }
  return parsed?.result ?? parsed;
}

function isMemoryTool(tool: { name?: string; description?: string }): boolean {
  const haystack = `${tool.name || ""} ${tool.description || ""}`.toLowerCase();
  return (
    haystack.includes("memor") ||
    haystack.includes("passport") ||
    haystack.includes("context") ||
    haystack.includes("preference")
  );
}

async function fetchMemoriesViaRest(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<string[] | null> {
  const urls = [
    `${EGOIST_ISSUER}/api/memories`,
    `${EGOIST_ISSUER}/api/memories-page`,
  ];
  for (const url of urls) {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      redirect: "manual",
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const memories = extractMemoryStrings(payload);
    if (memories.length > 0) return memories;
    if (Array.isArray(payload) && payload.length === 0) return [];
    if (payload && typeof payload === "object" && Array.isArray((payload as { memories?: unknown }).memories)) {
      return extractMemoryStrings((payload as { memories: unknown }).memories);
    }
  }
  return null;
}

export async function fetchEgoistMemories(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const restMemories = await fetchMemoriesViaRest(accessToken, fetchImpl);
  if (restMemories) return restMemories;

  await callEgoistMcp(
    accessToken,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "handshake", version: "0.0.0" },
    },
    fetchImpl,
  ).catch(() => null);

  const listed = (await callEgoistMcp(accessToken, "tools/list", {}, fetchImpl)) as {
    tools?: Array<{ name: string; description?: string }>;
  };
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  const memoryTools = tools.filter(isMemoryTool);
  const toCall = memoryTools.length > 0 ? memoryTools : tools;

  const collected: string[] = [];
  for (const tool of toCall) {
    try {
      const result = await callEgoistMcp(
        accessToken,
        "tools/call",
        { name: tool.name, arguments: {} },
        fetchImpl,
      );
      collected.push(...extractMemoryStrings(result));
    } catch {
      // Try the next Egoist tool; names are not a public contract.
    }
  }
  return [...new Set(collected)];
}
