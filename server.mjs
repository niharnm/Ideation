import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { stripTypeScriptTypes } from "node:module";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
};

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const requestedPath = pathname === "/"
    ? "/public/index.html"
    : pathname.startsWith("/src/")
      ? pathname
      : `/public${pathname}`;
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const source = await readFile(filePath, "utf8");
    const body = extname(filePath) === ".ts"
      ? stripTypeScriptTypes(source)
      : source;
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "text/plain; charset=utf-8",
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
