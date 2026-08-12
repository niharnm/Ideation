import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { handleEgoistMCPRequest, loadUserPassportVault } from "../src/index.ts";

class MemoryStorage {
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

test("Server API: Egoist MCP Handler processes ChatGPT external requests", () => {
  const storage = new MemoryStorage();
  const res = handleEgoistMCPRequest(
    "egoist_passport_parse_natural_language",
    { text: "I have a severe peanut allergy and lactose intolerance" },
    storage
  );

  assert.equal(res.isError, false);
  assert.ok(res.content[0].text.includes("Synced"));

  const vault = loadUserPassportVault(storage);
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.peanut"));
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.dairy"));
});

test("Server API: egoist_passport_sync_memories clears deleted memories", () => {
  const storage = new MemoryStorage();

  handleEgoistMCPRequest(
    "egoist_passport_sync_memories",
    {
      memories: [
        "The user cannot eat nuts.",
        "The user cannot drink milk.",
      ],
    },
    storage
  );

  let vault = loadUserPassportVault(storage);
  assert.equal(
    vault.allergies.filter((a) => a.allergenId.startsWith("allergen.")).length,
    3
  );

  const res = handleEgoistMCPRequest(
    "egoist_passport_sync_memories",
    { memories: [] },
    storage
  );

  assert.equal(res.isError, false);
  vault = loadUserPassportVault(storage);
  assert.equal(
    vault.allergies.filter((a) => a.allergenId.startsWith("allergen.")).length,
    0
  );
});

test("Server API: chat status endpoint exists and client never embeds a Groq key", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const chatgpt = readFileSync(new URL("../public/chatgpt.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(server, /pathname === "\/api\/chat\/status"/);
  assert.match(server, /available: Boolean\(process\.env\.GROQ_API_KEY\)/);
  assert.doesNotMatch(chatgpt, /gsk_[A-Za-z0-9]+/);
  assert.doesNotMatch(app, /gsk_[A-Za-z0-9]+/);
  assert.doesNotMatch(chatgpt, /Authorization:\s*`Bearer/);
  assert.match(server, /extractMemoriesWithGroq/);
  assert.match(server, /mergeMemoryStrings/);
  assert.match(server, /syncApiPassport\(vault\)/);
  assert.match(server, /order\.constraint\.\$\{allergy\.allergenId\.slice/);
  assert.doesNotMatch(server, /\/api\/egoist\/connect/);
  assert.doesNotMatch(server, /passport\.ego\.ist/);
  assert.match(server, /"\.css": "text\/css; charset=utf-8"/);
});

test("Landing nav is styled in the page so Chat/Handshake/Fieldline stay on one row", () => {
  const html = readFileSync(new URL("../public/demo.html", import.meta.url), "utf8");
  assert.match(html, /\.demo-steps \{ display: flex; flex-direction: row/);
  assert.match(html, /\.demo-steps \{[^}]*list-style: none/);
  assert.match(html, /Identity · Build/);
  assert.match(html, /<span class="num">1<\/span> NimGTP/);
});
