import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EGOIST_MCP_TOOLS,
  parseNaturalLanguageToConstraints,
  handleEgoistMCPRequest,
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
  clear() {
    this.#data.clear();
  }
}

test("Egoist MCP Server: Tool definitions registry is valid", () => {
  assert.equal(EGOIST_MCP_TOOLS.length, 3);
  assert.ok(EGOIST_MCP_TOOLS.some((t) => t.name === "egoist_passport_update_vault"));
  assert.ok(EGOIST_MCP_TOOLS.some((t) => t.name === "egoist_passport_read_vault"));
  assert.ok(EGOIST_MCP_TOOLS.some((t) => t.name === "egoist_passport_parse_natural_language"));
});

test("Egoist MCP Server: Natural language parser extracts structured constraints", () => {
  const result = parseNaturalLanguageToConstraints("I am severely allergic to peanuts and lactose intolerant");
  assert.equal(result.length, 2);
  assert.ok(result.some((c) => c.allergenId === "allergen.peanut" && c.severity === "anaphylactic"));
  assert.ok(result.some((c) => c.allergenId === "allergen.dairy"));
});

test("Egoist MCP Server: Handles tool call egoist_passport_update_vault", () => {
  const storage = new MemoryStorage();
  const res = handleEgoistMCPRequest(
    "egoist_passport_update_vault",
    {
      rawAllergenText: "gluten",
      label: "Gluten intolerance",
      severity: "intolerance",
      crossContaminationTolerance: "shared_facility_ok",
    },
    storage
  );

  assert.equal(res.isError, false);
  assert.ok(res.content[0].text.includes("Vault updated"));

  const vault = loadUserPassportVault(storage);
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.gluten"));
});

test("Egoist MCP Server: Handles tool call egoist_passport_read_vault", () => {
  const storage = new MemoryStorage();
  const res = handleEgoistMCPRequest("egoist_passport_read_vault", {}, storage);
  assert.equal(res.isError, false);
  assert.ok(res.content[0].text.includes("Active Passport Claims"));
});

test("Egoist MCP Server: Handles tool call egoist_passport_parse_natural_language", () => {
  const storage = new MemoryStorage();
  const res = handleEgoistMCPRequest(
    "egoist_passport_parse_natural_language",
    { text: "I have a severe tree nut allergy and shellfish constraint" },
    storage
  );

  assert.equal(res.isError, false);
  const vault = loadUserPassportVault(storage);
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.tree_nut"));
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.shellfish"));
});

test("Egoist MCP Server: Handles unknown tool names gracefully", () => {
  const storage = new MemoryStorage();
  const res = handleEgoistMCPRequest("unknown_mcp_tool", {}, storage);
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes("Unknown MCP tool name"));
});
