import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

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
const apiV1 = await import("./api/v1/[...path].ts");
const demoApi = await import("./api/demo.ts");

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
  console.log(`Handshake prototype: http://127.0.0.1:${port}`);
});
