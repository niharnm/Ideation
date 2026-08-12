import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const originalKey = process.env.GROQ_API_KEY;
const originalFetch = globalThis.fetch;
process.env.GROQ_API_KEY = "test-groq-key";

const chat = (await import("../api/chat.ts")).default;

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalKey;
});

test("deployed smart preparation route sends scoped order context to Groq", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer test-groq-key");
    const payload = JSON.parse(init.body);
    assert.match(payload.messages[1].content, /Pad Thai/);
    assert.match(payload.messages[1].content, /Peanut allergy/);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Use a dedicated surface and replace the peanut garnish." } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await chat.fetch(new Request("http://localhost/api/chat?mode=smart-prep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item: "Pad Thai", constraints: ["Peanut allergy"] }),
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    suggestion: "Use a dedicated surface and replace the peanut garnish.",
  });
});

test("deployed smart preparation rewrite is declared without adding a function", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.rewrites[0], {
    source: "/api/smart-prep",
    destination: "/api/chat?mode=smart-prep",
  });
  assert.equal(config.functions["api/smart-prep.ts"], undefined);
});
