import assert from "node:assert/strict";
import test from "node:test";

const originalKey = process.env.GROQ_API_KEY;
delete process.env.GROQ_API_KEY;

const chat = (await import("../api/chat.ts")).default;
const status = (await import("../api/chat/status.ts")).default;

test.after(() => {
  if (originalKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalKey;
});

test("deployed chat fails safely when the provider key is absent", async () => {
  const result = await chat.fetch(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "I have a peanut allergy." }] }),
  }));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, "chat_unavailable");
});

test("deployed chat status reports provider availability without exposing a key", async () => {
  const result = await status.fetch(new Request("http://localhost/api/chat/status"));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { available: false });
});
