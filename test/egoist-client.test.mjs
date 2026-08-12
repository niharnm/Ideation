import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEgoistAuthorizeUrl,
  createPkcePair,
  extractMemoryStrings,
  fetchEgoistMemories,
  parseMemoryInputsToConstraints,
} from "../src/index.ts";

test("Egoist client: PKCE authorize URL includes memory scope and challenge", () => {
  const pkce = createPkcePair();
  const url = buildEgoistAuthorizeUrl({
    clientId: "test-client",
    redirectUri: "http://127.0.0.1:4173/callback",
    state: "abc",
    codeChallenge: pkce.challenge,
  });
  assert.match(url, /^https:\/\/passport\.ego\.ist\/authorize\?/);
  assert.match(url, /scope=openid\+profile\+email\+memory/);
  assert.match(url, /code_challenge_method=S256/);
  assert.match(url, /resource=https%3A%2F%2Fpassport\.ego\.ist%2Fmcp/);
  assert.ok(pkce.verifier.length >= 32);
});

test("Egoist client: extracts memory strings from Egoist payloads", () => {
  const memories = extractMemoryStrings({
    memories: [
      { text: "i dont like milk" },
      { content: "peanut allergy" },
      { id: "skip-me" },
    ],
  });
  assert.deepEqual(memories.sort(), ["i dont like milk", "peanut allergy"].sort());
});

test("Egoist client: ChatGPT-style memories parse to dairy + peanut + tree nut", () => {
  const parsed = parseMemoryInputsToConstraints({
    memories: [
      "i dont like milk",
      "i can't eat nuts",
      "peanut allergy",
      "can't eat peanuts",
    ],
  });
  assert.ok(parsed.some((c) => c.allergenId === "allergen.dairy"));
  assert.ok(parsed.some((c) => c.allergenId === "allergen.peanut"));
  assert.ok(parsed.some((c) => c.allergenId === "allergen.tree_nut"));
});

test("Egoist client: fetchEgoistMemories reads REST memories with a bearer token", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), auth: options.headers?.Authorization });
    if (String(url).endsWith("/api/memories")) {
      return {
        ok: true,
        json: async () => ({
          memories: ["i dont like milk", "peanut allergy"],
        }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const memories = await fetchEgoistMemories("token-123", fakeFetch);
  assert.deepEqual(memories.sort(), ["i dont like milk", "peanut allergy"].sort());
  assert.equal(calls[0].auth, "Bearer token-123");
});
