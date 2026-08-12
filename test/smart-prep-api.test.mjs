import assert from "node:assert/strict";
import test from "node:test";

const originalKey = process.env.GROQ_API_KEY;
const originalFetch = globalThis.fetch;
process.env.GROQ_API_KEY = "test-groq-key";

const smartPrep = (await import("../api/smart-prep.ts")).default;

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

  const result = await smartPrep.fetch(new Request("http://localhost/api/smart-prep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item: "Pad Thai", constraints: ["Peanut allergy"] }),
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    suggestion: "Use a dedicated surface and replace the peanut garnish.",
  });
});

test("deployed smart preparation route rejects non-POST requests", async () => {
  const result = await smartPrep.fetch(new Request("http://localhost/api/smart-prep"));
  assert.equal(result.status, 405);
  assert.equal((await result.json()).error.code, "method_not_allowed");
});
