import { test } from "node:test";
import assert from "node:assert/strict";

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
