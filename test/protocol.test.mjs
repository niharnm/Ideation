import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_VERSION } from "../src/protocol.ts";

test("exports the protocol version", () => {
  assert.equal(PROTOCOL_VERSION, "0.1.0");
});
