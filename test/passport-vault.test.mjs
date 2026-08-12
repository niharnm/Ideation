import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VAULT_ALLERGIES,
  LOCAL_PASSPORT_VAULT_STORAGE_KEY,
  addCustomAllergyToVault,
  loadUserPassportVault,
  removeVaultAllergy,
  saveUserPassportVault,
} from "../src/index.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("Vault initialization and default seeding", () => {
  const storage = new MemoryStorage();
  const vault = loadUserPassportVault(storage);

  assert.strictEqual(vault.claimantId, "claimant-1");
  assert.strictEqual(vault.allergies.length, DEFAULT_VAULT_ALLERGIES.length);
  assert.strictEqual(vault.allergies[0].allergenId, "order.constraint.peanut");
  assert.strictEqual(vault.allergies[0].source, "credential");
  assert.ok(typeof vault.updatedAt === "string");

  const rawStored = storage.getItem(LOCAL_PASSPORT_VAULT_STORAGE_KEY);
  assert.ok(rawStored);
  const parsedStored = JSON.parse(rawStored);
  assert.strictEqual(parsedStored.claimantId, "claimant-1");
  assert.strictEqual(parsedStored.allergies.length, DEFAULT_VAULT_ALLERGIES.length);
});

test("Saving and loading from storage", () => {
  const storage = new MemoryStorage();
  const customVault = {
    claimantId: "claimant-custom-99",
    allergies: [
      {
        allergenId: "order.constraint.alpha-gal",
        label: "Alpha-gal",
        severity: "severe",
        crossContaminationTolerance: false,
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  saveUserPassportVault(customVault, storage);

  const loadedVault = loadUserPassportVault(storage);
  assert.strictEqual(loadedVault.claimantId, "claimant-custom-99");
  assert.strictEqual(loadedVault.allergies.length, 1);
  assert.strictEqual(loadedVault.allergies[0].allergenId, "order.constraint.alpha-gal");
  assert.strictEqual(loadedVault.allergies[0].label, "Alpha-gal");
  assert.strictEqual(loadedVault.allergies[0].severity, "severe");
  assert.strictEqual(loadedVault.allergies[0].crossContaminationTolerance, false);
});

test("Adding custom allergy and removing allergy", () => {
  const storage = new MemoryStorage();
  let vault = loadUserPassportVault(storage);

  const initialCount = vault.allergies.length;

  vault = addCustomAllergyToVault(vault, {
    allergenId: "order.constraint.tree-nuts",
    label: "Tree Nuts",
    severity: "severe",
    crossContaminationTolerance: false,
  });

  assert.strictEqual(vault.allergies.length, initialCount + 1);
  const treeNuts = vault.allergies.find(
    (a) => a.allergenId === "order.constraint.tree-nuts"
  );
  assert.ok(treeNuts);
  assert.strictEqual(treeNuts.label, "Tree Nuts");
  assert.strictEqual(treeNuts.severity, "severe");

  vault = addCustomAllergyToVault(vault, {
    allergenId: "",
    label: "Sesame",
    severity: "moderate",
    crossContaminationTolerance: true,
  });

  assert.strictEqual(vault.allergies.length, initialCount + 2);
  const sesame = vault.allergies.find((a) => a.label === "Sesame");
  assert.ok(sesame);
  assert.strictEqual(sesame.allergenId, "order.constraint.sesame");

  vault = removeVaultAllergy(vault, "order.constraint.tree-nuts");
  assert.strictEqual(vault.allergies.length, initialCount + 1);
  assert.strictEqual(
    vault.allergies.some((a) => a.allergenId === "order.constraint.tree-nuts"),
    false
  );
});

test("Invalid storage data fallback", () => {
  const storage = new MemoryStorage();

  storage.setItem(LOCAL_PASSPORT_VAULT_STORAGE_KEY, "invalid-json-{{{");
  let vault = loadUserPassportVault(storage);
  assert.strictEqual(vault.claimantId, "claimant-1");
  assert.strictEqual(vault.allergies.length, DEFAULT_VAULT_ALLERGIES.length);

  storage.setItem(
    LOCAL_PASSPORT_VAULT_STORAGE_KEY,
    JSON.stringify({ claimantId: 123, allergies: "invalid-array" })
  );
  vault = loadUserPassportVault(storage);
  assert.strictEqual(vault.claimantId, "claimant-1");
  assert.strictEqual(vault.allergies.length, DEFAULT_VAULT_ALLERGIES.length);
});
