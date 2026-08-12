import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractMemoryJsonFromReply,
  looksLikeDietaryTurn,
  mergeMemoryStrings,
  parseExtractorJson,
  resolveMemoriesFromTurn,
  stripMemoryJsonFromReply,
  syncMemoriesToVault,
  loadUserPassportVault,
} from "../src/index.ts";

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
}

test("Chat proxy: extracts memories JSON from a Groq-style reply", () => {
  const reply = [
    "Got it — I'll save a milk preference and a peanut allergy to your AI Passport.",
    "```json",
    '{"memories":["i dont like milk","peanut allergy"]}',
    "```",
  ].join("\n");
  assert.deepEqual(
    extractMemoryJsonFromReply(reply),
    ["i dont like milk", "peanut allergy"],
  );
  assert.equal(
    stripMemoryJsonFromReply(reply).includes("i dont like milk"),
    false,
  );
});

test("Chat proxy: empty memories clear allergen.* constraints", () => {
  const storage = new MemoryStorage();
  syncMemoriesToVault(["i dont like milk", "can't eat peanuts"], storage);
  let vault = loadUserPassportVault(storage);
  assert.ok(vault.allergies.some((item) => item.allergenId === "allergen.dairy"));
  assert.ok(vault.allergies.some((item) => item.allergenId === "allergen.peanut"));

  const resolved = resolveMemoriesFromTurn({
    userText: "I have no allergies",
    assistantText: '```json\n{"memories":[]}\n```',
    previousMemories: ["i dont like milk"],
  });
  assert.equal(resolved.replaced, true);
  assert.deepEqual(resolved.memories, []);
  syncMemoriesToVault(resolved.memories, storage);
  vault = loadUserPassportVault(storage);
  assert.equal(
    vault.allergies.filter((item) => item.allergenId.startsWith("allergen.")).length,
    0,
  );
});

test("Chat proxy: keyword fallback merges instead of replacing prior memories", () => {
  assert.deepEqual(
    mergeMemoryStrings(["peanut allergy"], "I also don't like milk"),
    ["peanut allergy", "I also don't like milk"],
  );
  assert.deepEqual(
    mergeMemoryStrings(["peanut allergy"], "peanut allergy"),
    ["peanut allergy"],
  );
});

test("Chat proxy: extractor JSON and dietary-turn detection", () => {
  assert.deepEqual(parseExtractorJson('{"memories":["peanut allergy"]}'), ["peanut allergy"]);
  assert.equal(looksLikeDietaryTurn("I can't eat peanuts"), true);
  assert.equal(looksLikeDietaryTurn("What is on the menu?"), false);
});

test("ChatGPT demo tab exposes a connected Egoist plugin", () => {
  const html = readFileSync(new URL("../public/chatgpt.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/chatgpt.js", import.meta.url), "utf8");
  const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(html, /NimGTP/);
  assert.match(html, /data-thread/);
  assert.match(js, /\bthreads\b/);
  assert.match(js, /fetch\("\/api\/chat"/);
  assert.match(js, /\/api\/chat\/status/);
  assert.match(gitignore, /^\.env$/m);
});
