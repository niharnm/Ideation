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
  assert.equal(EGOIST_MCP_TOOLS.length, 4);
  assert.ok(EGOIST_MCP_TOOLS.some((t) => t.name === "egoist_passport_update_vault"));
  assert.ok(EGOIST_MCP_TOOLS.some((t) => t.name === "egoist_passport_read_vault"));
  assert.ok(EGOIST_MCP_TOOLS.some((t) => t.name === "egoist_passport_sync_memories"));
  assert.ok(EGOIST_MCP_TOOLS.some((t) => t.name === "egoist_passport_parse_natural_language"));
});

test("Egoist MCP Server: Natural language parser extracts structured constraints", () => {
  const result = parseNaturalLanguageToConstraints("I am severely allergic to peanuts and lactose intolerant");
  assert.equal(result.length, 2);
  assert.ok(result.some((c) => c.allergenId === "allergen.peanut" && c.severity === "anaphylactic"));
  assert.ok(result.some((c) => c.allergenId === "allergen.dairy"));
});

test("Egoist MCP Server: word boundaries avoid eggplant and selfish false positives", () => {
  assert.equal(parseNaturalLanguageToConstraints("I like eggplant and I am not selfish").length, 0);
});

test("Egoist MCP Server: dislikes are mild preferences, not severe isolation", () => {
  const result = parseNaturalLanguageToConstraints("I don't like milk");
  assert.equal(result.length, 1);
  assert.equal(result[0].allergenId, "allergen.dairy");
  assert.equal(result[0].severity, "mild");
  assert.equal(result[0].crossContaminationTolerance, true);
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
  const gluten = vault.allergies.find((a) => a.allergenId === "allergen.gluten");
  assert.ok(gluten);
  assert.equal(gluten.crossContaminationTolerance, true);
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

test("Egoist MCP Server: Parses Egoist memory 'The user cannot eat nuts' into peanut + tree_nut", () => {
  const result = parseNaturalLanguageToConstraints("The user cannot eat nuts.");
  assert.ok(result.length >= 2, `Expected at least 2 constraints, got ${result.length}`);
  assert.ok(result.some((c) => c.allergenId === "allergen.peanut"));
  assert.ok(result.some((c) => c.allergenId === "allergen.tree_nut"));
});

test("Egoist MCP Server: Parses Egoist memory 'The user cannot drink milk' into dairy", () => {
  const result = parseNaturalLanguageToConstraints("The user cannot drink milk.");
  assert.equal(result.length, 1);
  assert.equal(result[0].allergenId, "allergen.dairy");
});

test("Egoist MCP Server: Parses combined Egoist memories into correct constraints", () => {
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

  const vault = loadUserPassportVault(storage);
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.peanut"));
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.tree_nut"));
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.dairy"));
});

test("Egoist MCP Server: text parse replaces prior allergen.* constraints", () => {
  const storage = new MemoryStorage();

  handleEgoistMCPRequest("egoist_passport_parse_natural_language", { text: "The user cannot eat nuts." }, storage);
  handleEgoistMCPRequest("egoist_passport_parse_natural_language", { text: "The user cannot drink milk." }, storage);

  const vault = loadUserPassportVault(storage);
  assert.ok(!vault.allergies.some((a) => a.allergenId === "allergen.peanut"), "Peanut removed by replace");
  assert.ok(!vault.allergies.some((a) => a.allergenId === "allergen.tree_nut"), "Tree nut removed by replace");
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.dairy"));
});

test("Egoist MCP Server: 'memories' array fully replaces allergen.* constraints", () => {
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
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.peanut"));
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.dairy"));

  // Full replace: only sesame remains — dairy (absent from the new list) is removed
  handleEgoistMCPRequest(
    "egoist_passport_sync_memories",
    { memories: ["The user has a sesame allergy."] },
    storage
  );
  vault = loadUserPassportVault(storage);
  assert.ok(vault.allergies.some((a) => a.allergenId === "allergen.sesame"));
  assert.ok(!vault.allergies.some((a) => a.allergenId === "allergen.dairy"), "Dairy removed by full replace");
  assert.ok(!vault.allergies.some((a) => a.allergenId === "allergen.peanut"), "Peanut removed by full replace");

  // Deleting all memories on Egoist: empty array clears the Egoist namespace
  handleEgoistMCPRequest("egoist_passport_sync_memories", { memories: [] }, storage);
  vault = loadUserPassportVault(storage);
  assert.ok(!vault.allergies.some((a) => a.allergenId.startsWith("allergen.")), "All allergen.* constraints cleared");
});

