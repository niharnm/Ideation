import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { randomUUID } from "node:crypto";

import {
  buildChatSystemPrompt,
  resolveMemoriesFromTurn,
  stripMemoryJsonFromReply,
} from "./src/chat-memories.ts";
import {
  buildEgoistAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  exchangeEgoistAuthCode,
  fetchEgoistMemories,
  registerEgoistOAuthClient,
} from "./src/egoist-client.ts";
import {
  handleEgoistMCPRequest,
  parseMemoryInputsToConstraints,
  syncMemoriesToVault,
} from "./src/egoist-mcp-server.ts";
import { loadUserPassportVault } from "./src/passport-vault.ts";

// In-memory storage for server-side Egoist Passport Vault API
class ServerMemoryStorage {
  #data = new Map();
  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }
  setItem(key, value) {
    this.#data.set(key, String(value));
  }
  removeItem(key) {
    this.#data.delete(key);
  }
  clear() {
    this.#data.clear();
  }
}
const serverStorage = new ServerMemoryStorage();
const SESSION_COOKIE = "handshake_egoist_session";
const sessions = new Map();
let oauthClientPromise = null;
let serverMemories = [];
let localPluginActive = false;

function loadDotEnv() {
  try {
    const envPath = resolve(fileURLToPath(new URL(".", import.meta.url)), ".env");
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional when GROQ_API_KEY is already in the environment.
  }
}

loadDotEnv();
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function readCookies(request) {
  const header = request.headers.cookie ?? "";
  const cookies = {};
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function getSession(request) {
  const sessionId = readCookies(request)[SESSION_COOKIE];
  return sessionId ? sessions.get(sessionId) ?? null : null;
}

function setSessionCookie(response, sessionId) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
}

function originFromRequest(request) {
  const host = request.headers.host ?? `127.0.0.1:${port}`;
  return `http://${host}`;
}

async function getOAuthClient(redirectUri) {
  if (!oauthClientPromise) {
    oauthClientPromise = registerEgoistOAuthClient(redirectUri);
  }
  return oauthClientPromise;
}

async function refreshVaultFromEgoist(session) {
  if (!session?.tokens?.access_token) return loadUserPassportVault(serverStorage);
  const memories = await fetchEgoistMemories(session.tokens.access_token);
  session.lastSyncedAt = new Date().toISOString();
  session.memoryCount = memories.length;
  return syncMemoriesToVault(memories, serverStorage);
}

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ts": "text/javascript; charset=utf-8",
};
const browserCryptoModulePath = "/src/__browser-crypto.js";
const browserCryptoModule = `
const browserCrypto = globalThis.crypto;
if (!browserCrypto?.randomUUID) {
  throw new Error("This browser does not provide crypto.randomUUID().");
}

export const randomUUID = () => browserCrypto.randomUUID();
`;

function browserSpecifier(specifier) {
  if (specifier === "node:crypto") {
    return browserCryptoModulePath;
  }
  return specifier.endsWith(".ts")
    ? `${specifier.slice(0, -3)}.js`
    : specifier;
}

function rewriteBrowserImports(source) {
  return source.replace(
    /\b(from\s*|import\s*\(\s*)(["'])([^"']+)(\2)/g,
    (_match, prefix, quote, specifier) =>
      `${prefix}${quote}${browserSpecifier(specifier)}${quote}`,
  );
}

function resolveRequest(pathname) {
  if (pathname === browserCryptoModulePath) {
    return { virtual: true, contentType: contentTypes[".js"] };
  }

  const requestedPath = pathname === "/"
    ? "/public/demo.html"
    : pathname.startsWith("/src/")
      ? pathname
      : `/public${pathname}`;
  const requestedExtension = extname(requestedPath);
  const sourcePath = pathname.startsWith("/src/") &&
    (requestedExtension === "" || requestedExtension === ".js")
    ? `${requestedPath.slice(0, requestedExtension === "" ? undefined : -3)}.ts`
    : requestedPath;
  const isSourceModule = sourcePath.endsWith(".ts");
  const filePath = resolve(root, `.${sourcePath}`);
  const fileRelativePath = relative(root, filePath);

  if (fileRelativePath.startsWith("..") || isAbsolute(fileRelativePath)) {
    return null;
  }

  return {
    filePath,
    isSourceModule,
    contentType: isSourceModule
      ? contentTypes[".js"]
      : contentTypes[requestedExtension] ?? "text/plain; charset=utf-8",
  };
}

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  // Set CORS headers for external ChatGPT / MCP client connections
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (pathname === "/api/chat" && request.method === "POST") {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: "Chat is unavailable. Set GROQ_API_KEY in .env and restart the server.",
      }));
      return;
    }

    let payload = {};
    try {
      let bodyText = "";
      for await (const chunk of request) bodyText += chunk;
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }

    const incoming = Array.isArray(payload.messages) ? payload.messages : [];
    const userText = [...incoming].reverse().find((item) => item?.role === "user")?.content || "";
    const groqMessages = [
      { role: "system", content: buildChatSystemPrompt(serverMemories) },
      ...incoming
        .filter((item) => item && (item.role === "user" || item.role === "assistant"))
        .map((item) => ({ role: item.role, content: String(item.content || "") })),
    ];

    try {
      const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.4,
          messages: groqMessages,
        }),
      });
      const groqPayload = await groqResponse.json();
      if (!groqResponse.ok) {
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          error: groqPayload.error?.message || "Groq request failed.",
        }));
        return;
      }

      const assistantText = groqPayload.choices?.[0]?.message?.content || "";
      const resolved = resolveMemoriesFromTurn({
        userText,
        assistantText,
        previousMemories: serverMemories,
      });
      if (resolved.replaced) {
        serverMemories = resolved.memories || [];
        localPluginActive = true;
        syncMemoriesToVault(serverMemories, serverStorage);
      } else if (userText) {
        const parsed = parseMemoryInputsToConstraints({ text: userText });
        if (parsed.length > 0) {
          serverMemories = [userText.trim()];
          localPluginActive = true;
          syncMemoriesToVault(serverMemories, serverStorage);
        }
      }

      const vault = loadUserPassportVault(serverStorage);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        reply: stripMemoryJsonFromReply(assistantText) || assistantText,
        memories: serverMemories,
        constraints: vault.allergies.filter((item) => item.allergenId.startsWith("allergen.")),
      }));
    } catch (error) {
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : "Chat request failed.",
      }));
    }
    return;
  }

  const origin = originFromRequest(request);
  const redirectUri = `${origin}/callback`;

  if (pathname === "/api/egoist/status" && request.method === "GET") {
    const session = getSession(request);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      connected: Boolean(session?.tokens?.access_token),
      lastSyncedAt: session?.lastSyncedAt ?? null,
      memoryCount: session?.memoryCount ?? 0,
    }));
    return;
  }

  if (pathname === "/api/egoist/connect" && request.method === "GET") {
    try {
      const client = await getOAuthClient(redirectUri);
      const pkce = createPkcePair();
      const state = createOAuthState();
      const sessionId = randomUUID();
      sessions.set(sessionId, {
        oauthState: state,
        codeVerifier: pkce.verifier,
        clientId: client.client_id,
        tokens: null,
      });
      setSessionCookie(response, sessionId);
      response.writeHead(302, {
        Location: buildEgoistAuthorizeUrl({
          clientId: client.client_id,
          redirectUri,
          state,
          codeChallenge: pkce.challenge,
        }),
      });
      response.end();
    } catch (error) {
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    return;
  }

  if (pathname === "/api/egoist/disconnect" && request.method === "POST") {
    const sessionId = readCookies(request)[SESSION_COOKIE];
    if (sessionId) sessions.delete(sessionId);
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ connected: false }));
    return;
  }

  if (pathname === "/callback" && request.method === "GET") {
    const url = new URL(request.url ?? "/", origin);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const sessionId = readCookies(request)[SESSION_COOKIE];
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!code || !session || session.oauthState !== state) {
      response.writeHead(302, { Location: "/?egoist=error" });
      response.end();
      return;
    }
    try {
      session.tokens = await exchangeEgoistAuthCode({
        clientId: session.clientId,
        redirectUri,
        code,
        codeVerifier: session.codeVerifier,
      });
      await refreshVaultFromEgoist(session);
      response.writeHead(302, { Location: "/" });
      response.end();
    } catch {
      response.writeHead(302, { Location: "/?egoist=error" });
      response.end();
    }
    return;
  }

  // Handle Egoist Passport MCP API Endpoints
  if (
    (pathname === "/api/passport/mcp" ||
      pathname === "/api/passport/sync" ||
      pathname === "/api/passport/import") &&
    request.method === "POST"
  ) {
    let bodyText = "";
    for await (const chunk of request) {
      bodyText += chunk;
    }
    let payload = {};
    try {
      payload = JSON.parse(bodyText);
    } catch {}

    const toolName =
      payload.tool ||
      (Array.isArray(payload.memories)
        ? "egoist_passport_sync_memories"
        : "egoist_passport_parse_natural_language");
    const args = payload.args || {};
    if (typeof payload.text === "string" && payload.text.trim()) {
      args.text = payload.text;
    }
    if (Array.isArray(payload.memories) && !Array.isArray(args.memories)) {
      args.memories = payload.memories;
    }

    const result = handleEgoistMCPRequest(toolName, args, serverStorage);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
    return;
  }

  if (pathname === "/api/passport/vault" && request.method === "GET") {
    const session = getSession(request);
    let vault = loadUserPassportVault(serverStorage);
    if (session?.tokens?.access_token) {
      try {
        vault = await refreshVaultFromEgoist(session);
      } catch {
        vault = loadUserPassportVault(serverStorage);
      }
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ...vault,
      egoistConnected: Boolean(session?.tokens?.access_token) || localPluginActive,
      lastSyncedAt: session?.lastSyncedAt ?? null,
    }));
    return;
  }

  const resolved = resolveRequest(pathname);

  if (!resolved) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  if (resolved.virtual) {
    response.writeHead(200, {
      "Content-Type": resolved.contentType,
      "Cache-Control": "no-store",
    });
    response.end(browserCryptoModule);
    return;
  }

  try {
    const source = await readFile(
      resolved.filePath,
      resolved.contentType.startsWith("image/") ? undefined : "utf8",
    );
    const body = typeof source === "string"
      ? rewriteBrowserImports(
        resolved.isSourceModule ? stripTypeScriptTypes(source) : source,
      )
      : source;
    response.writeHead(200, {
      "Content-Type": resolved.contentType,
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : null;
    if (code !== "ENOENT") {
      console.error(error);
    }
    response.writeHead(code === "ENOENT" ? 404 : 500).end(
      code === "ENOENT" ? "Not found" : "Server error",
    );
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Egoist AI Passport & Handshake Server: http://127.0.0.1:${port}`);
});
