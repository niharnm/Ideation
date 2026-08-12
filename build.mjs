import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const outputDirectory = join(root, "dist");
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

async function buildSourceDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const sourcePath = join(directory, entry.name);
    const outputPath = join(outputDirectory, relative(root, sourcePath));

    if (entry.isDirectory()) {
      await buildSourceDirectory(sourcePath);
      return;
    }

    if (!entry.isFile() || extname(entry.name) !== ".ts") {
      return;
    }

    const source = await readFile(sourcePath, "utf8");
    const body = rewriteBrowserImports(stripTypeScriptTypes(source));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath.replace(/\.ts$/, ".js"), body);
  }));
}

await mkdir(outputDirectory, { recursive: true });
await cp(join(root, "public"), outputDirectory, { recursive: true });

for (const fileName of ["app.js", "recipient.js"]) {
  const outputPath = join(outputDirectory, fileName);
  const source = await readFile(outputPath, "utf8");
  await writeFile(outputPath, rewriteBrowserImports(source));
}

await buildSourceDirectory(join(root, "src"));
await mkdir(join(outputDirectory, "src"), { recursive: true });
await writeFile(join(outputDirectory, browserCryptoModulePath), browserCryptoModule);
