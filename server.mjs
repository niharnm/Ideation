import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import {
  buildChatSystemPrompt,
  buildMemoryExtractorPrompt,
  looksLikeDietaryTurn,
  mergeMemoryStrings,
  parseExtractorJson,
  resolveMemoriesFromTurn,
  stripMemoryJsonFromReply,
} from "./src/chat-memories.ts";
import {
  handleEgoistMCPRequest,
  parseMemoryInputsToConstraints,
  parseNaturalLanguageToConstraints,
  syncMemoriesToVault,
} from "./src/egoist-mcp-server.ts";
import {
  loadUserPassportVault,
  removeVaultAllergy,
  saveUserPassportVault,
} from "./src/passport-vault.ts";

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

async function groqComplete(groqKey, messages, options = {}) {
  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: options.temperature ?? 0.4,
      messages,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const groqPayload = await groqResponse.json();
  if (!groqResponse.ok) {
    const error = new Error(groqPayload.error?.message || "Groq request failed.");
    error.status = groqResponse.status;
    error.payload = groqPayload;
    throw error;
  }
  return groqPayload.choices?.[0]?.message?.content || "";
}

async function extractMemoriesWithGroq(groqKey, input) {
  const raw = await groqComplete(
    groqKey,
    [
      { role: "system", content: buildMemoryExtractorPrompt(input.previousMemories) },
      {
        role: "user",
        content: `Current memories: ${JSON.stringify(input.previousMemories)}\nUser: ${input.userText}\nAssistant: ${input.assistantText}`,
      },
    ],
    { temperature: 0, json: true },
  );
  return parseExtractorJson(raw);
}

function applyMemories(memories) {
  serverMemories = Array.isArray(memories)
    ? memories.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  localPluginActive = true;
  return syncMemoriesToVault(serverMemories, serverStorage);
}

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
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
const apiV1 = await import("./api/v1/[...path].ts");
const demoApi = await import("./api/demo.ts");

function apiConstraintsFromVault(vault) {
  const constraints = new Map();
  for (const allergy of vault.allergies) {
    const id = allergy.allergenId.startsWith("allergen.")
      ? `order.constraint.${allergy.allergenId.slice("allergen.".length)}`
      : allergy.allergenId;
    constraints.set(id, {
      id,
      label: allergy.label,
      severity: ["severe", "moderate", "mild"].includes(allergy.severity)
        ? allergy.severity
        : "severe",
      crossContaminationTolerance: allergy.crossContaminationTolerance,
    });
  }
  return [...constraints.values()];
}

async function syncApiPassport(vault) {
  const apiResponse = await demoApi.default.fetch(new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "passport-update",
      constraints: apiConstraintsFromVault(vault),
    }),
  }));
  if (!apiResponse.ok) {
    const payload = await apiResponse.json().catch(() => ({}));
    throw new Error(payload.error?.message ?? "The API passport could not be updated.");
  }
}

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

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (pathname === "/api/chat/status" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      available: Boolean(process.env.GROQ_API_KEY),
      error: process.env.GROQ_API_KEY
        ? ""
        : "Chat is unavailable. Set GROQ_API_KEY in .env and restart the server.",
    }));
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
      const assistantText = await groqComplete(groqKey, groqMessages);
      let resolved = resolveMemoriesFromTurn({
        userText,
        assistantText,
        previousMemories: serverMemories,
      });

      if (!resolved.replaced && looksLikeDietaryTurn(userText)) {
        try {
          const extracted = await extractMemoriesWithGroq(groqKey, {
            userText,
            assistantText,
            previousMemories: serverMemories,
          });
          if (extracted) {
            resolved = { memories: extracted, replaced: true };
          }
        } catch {
          // Fall through to keyword merge so a missed JSON fence cannot wipe the vault.
        }
      }

      if (resolved.replaced) {
        applyMemories(resolved.memories || []);
      } else if (userText && parseMemoryInputsToConstraints({ text: userText }).length > 0) {
        applyMemories(mergeMemoryStrings(serverMemories, userText));
      }

      const vault = loadUserPassportVault(serverStorage);
      await syncApiPassport(vault);
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
    if (Array.isArray(args.memories)) {
      serverMemories = args.memories
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim());
      localPluginActive = true;
    } else if (typeof args.text === "string" && args.text.trim()) {
      serverMemories = [args.text.trim()];
      localPluginActive = true;
    }
    await syncApiPassport(loadUserPassportVault(serverStorage));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
    return;
  }

  if (pathname === "/api/passport/vault" && request.method === "POST") {
    let payload = {};
    try {
      let bodyText = "";
      for await (const chunk of request) bodyText += chunk;
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }

    let vault = loadUserPassportVault(serverStorage);
    if (Array.isArray(payload.memories)) {
      vault = applyMemories(payload.memories);
    } else if (typeof payload.removeAllergenId === "string" && payload.removeAllergenId.trim()) {
      const allergenId = payload.removeAllergenId.trim();
      serverMemories = serverMemories.filter((memory) =>
        !parseNaturalLanguageToConstraints(memory).some((item) => item.allergenId === allergenId)
      );
      vault = removeVaultAllergy(loadUserPassportVault(serverStorage), allergenId);
      saveUserPassportVault(vault, serverStorage);
    }

    await syncApiPassport(vault);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ...vault,
      memories: serverMemories,
      egoistConnected: localPluginActive,
    }));
    return;
  }

  if (pathname === "/api/passport/vault" && request.method === "GET") {
    const vault = loadUserPassportVault(serverStorage);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ...vault,
      memories: serverMemories,
      egoistConnected: localPluginActive,
      lastSyncedAt: null,
    }));
    return;
  }

  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const origin = `http://${request.headers.host ?? "127.0.0.1"}`;
    const apiRequest = new Request(`${origin}${request.url ?? "/api/v1"}`, {
      method: request.method,
      headers: request.headers,
      ...(["GET", "HEAD"].includes(request.method ?? "GET")
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    const apiResponse = await apiV1.default.fetch(apiRequest);
    const headers = Object.fromEntries(apiResponse.headers.entries());
    response.writeHead(apiResponse.status, headers).end(
      Buffer.from(await apiResponse.arrayBuffer()),
    );
    return;
  }
  if (pathname === "/api/demo") {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const origin = `http://${request.headers.host ?? "127.0.0.1"}`;
    const apiRequest = new Request(`${origin}${request.url ?? "/api/demo"}`, {
      method: request.method,
      headers: request.headers,
      ...(["GET", "HEAD"].includes(request.method ?? "GET")
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    const apiResponse = await demoApi.default.fetch(apiRequest);
    const headers = Object.fromEntries(apiResponse.headers.entries());
    response.writeHead(apiResponse.status, headers).end(
      Buffer.from(await apiResponse.arrayBuffer()),
    );
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
