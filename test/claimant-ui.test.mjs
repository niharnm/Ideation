import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("claimant screen supports removable constraints, exact expiry, and a new request", () => {
  assert.match(html, /id="expiry" type="datetime-local"/);
  assert.match(html, /id="share-new-allergy" checked/);
  assert.match(app, /removeBtn\.textContent = "×"/);
  assert.match(app, /selectedFieldIds\.delete\(allergy\.allergenId\)/);
  assert.match(app, /textContent = "Start a new request"/);
  assert.match(app, /The claimant started a new request and ended this access\./);
});
