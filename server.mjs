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
    ? "/public/index.html"
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
    const source = await readFile(resolved.filePath, "utf8");
    const body = rewriteBrowserImports(
      resolved.isSourceModule ? stripTypeScriptTypes(source) : source,
    );
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
