import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateUniversalAllergyPolicy,
  getAllergenMetadata,
  normalizeAllergenUri,
  UNIVERSAL_ALLERGEN_TAXONOMY,
} from "../src/index.ts";

test("verated taxonomy contains all FDA Big 9, EU 14, and custom allergen URIs", () => {
  const expectedUris = [
    "allergen.peanut",
    "allergen.tree_nut",
    "allergen.dairy",
    "allergen.egg",
    "allergen.gluten",
    "allergen.soy",
    "allergen.fish",
    "allergen.shellfish",
    "allergen.sesame",
    "allergen.alpha_gal",
    "allergen.sulfite",
    "allergen.mustard",
    "allergen.celery",
    "allergen.lupin",
  ];

  for (const uri of expectedUris) {
    assert.ok(UNIVERSAL_ALLERGEN_TAXONOMY[uri], `Taxonomy must contain ${uri}`);
    const metadata = getAllergenMetadata(uri);
    assert.equal(metadata.uri, uri);
    assert.ok(metadata.name.length > 0);
    assert.ok(metadata.sources.length > 0);
  }
});

test("normalizes allergen URIs consistently from raw IDs, shortnames, and constraint strings", () => {
  assert.equal(normalizeAllergenUri("peanut"), "allergen.peanut");
  assert.equal(normalizeAllergenUri("order.constraint.peanut"), "allergen.peanut");
  assert.equal(normalizeAllergenUri("allergen.peanut"), "allergen.peanut");
  assert.equal(normalizeAllergenUri("tree_nut"), "allergen.tree_nut");
  assert.equal(normalizeAllergenUri("order.constraint.alpha_gal"), "allergen.alpha_gal");
});

test("multi-allergen evaluation across 10+ allergens", () => {
  const dish = {
    id: "global-sampler-dish",
    name: "Global 14 Allergen Tasting Dish",
    ingredients: [
      { id: "ing-rice", name: "Rice Noodles", allergens: [], isVerifiedSupplier: true },
      { id: "ing-peanuts", name: "Roasted Peanuts", allergens: ["allergen.peanut"], isVerifiedSupplier: true },
      { id: "ing-almonds", name: "Sliced Almonds", allergens: ["allergen.tree_nut"], isVerifiedSupplier: true },
      { id: "ing-butter", name: "Grassfed Butter", allergens: ["allergen.dairy"], isVerifiedSupplier: true },
      { id: "ing-egg", name: "Poached Egg", allergens: ["allergen.egg"], isVerifiedSupplier: true },
      { id: "ing-wheat", name: "Wheat Flour", allergens: ["allergen.gluten"], isVerifiedSupplier: true },
      { id: "ing-soy", name: "Soy Sauce", allergens: ["allergen.soy"], isVerifiedSupplier: true },
      { id: "ing-fish", name: "Fish Sauce", allergens: ["allergen.fish"], isVerifiedSupplier: true },
      { id: "ing-shrimp", name: "Dried Shrimp", allergens: ["allergen.shellfish"], isVerifiedSupplier: true },
      { id: "ing-sesame", name: "Sesame Oil", allergens: ["allergen.sesame"], isVerifiedSupplier: true },
      { id: "ing-beef", name: "Beef Tenderloin", allergens: ["allergen.alpha_gal"], isVerifiedSupplier: true },
      { id: "ing-wine", name: "White Wine", allergens: ["allergen.sulfite"], isVerifiedSupplier: true },
      { id: "ing-mustard", name: "Mustard Seed", allergens: ["allergen.mustard"], isVerifiedSupplier: true },
      { id: "ing-celery", name: "Celery Root", allergens: ["allergen.celery"], isVerifiedSupplier: true },
      { id: "ing-lupin", name: "Lupin Bean Flour", allergens: ["allergen.lupin"], isVerifiedSupplier: true },
    ],
    allergens: [
      "allergen.peanut",
      "allergen.tree_nut",
      "allergen.dairy",
      "allergen.egg",
      "allergen.gluten",
      "allergen.soy",
      "allergen.fish",
      "allergen.shellfish",
      "allergen.sesame",
      "allergen.alpha_gal",
      "allergen.sulfite",
      "allergen.mustard",
      "allergen.celery",
      "allergen.lupin",
    ],
    substitutions: [],
    hasUnverifiedSuppliers: false,
  };

  const requestedAllergies = [
    "allergen.peanut",
    "allergen.tree_nut",
    "allergen.dairy",
    "allergen.egg",
    "allergen.gluten",
    "allergen.soy",
    "allergen.fish",
    "allergen.shellfish",
    "allergen.sesame",
    "allergen.alpha_gal",
    "allergen.sulfite",
    "allergen.mustard",
    "allergen.celery",
    "allergen.lupin",
  ];

  const result = evaluateUniversalAllergyPolicy(dish, requestedAllergies);

  assert.equal(result.response, "decline");
  assert.equal(result.isSafe, false);
  assert.equal(result.matchedAllergens.length, 14);
  assert.equal(result.severityBadges.length, 14);
  assert.equal(result.evaluatedAllergens.length, 14);
  assert.match(result.rationale, /Policy decline for dish 'Global 14 Allergen Tasting Dish'/);
});

test("substitution matching and required changes", () => {
  const dish = {
    id: "pad-thai-sub",
    name: "Pad Thai with Substitutions",
    ingredients: [
      { id: "ing-rice", name: "Rice Noodles", allergens: [], isVerifiedSupplier: true },
      { id: "ing-peanuts", name: "Crushed Peanuts", allergens: ["allergen.peanut"], isVerifiedSupplier: true },
      { id: "ing-soy-sauce", name: "Soy Sauce", allergens: ["allergen.gluten"], isVerifiedSupplier: true },
    ],
    allergens: ["allergen.peanut", "allergen.gluten"],
    substitutions: [
      {
        id: "sub-no-peanuts",
        originalIngredientId: "ing-peanuts",
        originalIngredientName: "Crushed Peanuts",
        replacementIngredientId: "ing-none",
        replacementIngredientName: "Omit Peanuts",
        description: "Omit peanuts from preparation",
        removesAllergens: ["allergen.peanut"],
      },
      {
        id: "sub-tamari-gf",
        originalIngredientId: "ing-soy-sauce",
        originalIngredientName: "Soy Sauce",
        replacementIngredientId: "ing-tamari",
        replacementIngredientName: "Tamari GF Soy Sauce",
        description: "Substitute soy sauce with Tamari GF Soy Sauce",
        removesAllergens: ["allergen.gluten"],
      },
    ],
    hasUnverifiedSuppliers: false,
  };

  const requestedAllergies = ["allergen.peanut", "allergen.gluten"];
  const result = evaluateUniversalAllergyPolicy(dish, requestedAllergies);

  assert.equal(result.response, "required_change");
  assert.equal(result.isSafe, false);
  assert.equal(result.requiredChanges.length, 2);
  assert.deepEqual(result.requiredChanges, [
    "Substitute Crushed Peanuts with Omit Peanuts to eliminate Peanut",
    "Substitute Soy Sauce with Tamari GF Soy Sauce to eliminate Gluten / Wheat",
  ]);
});

test("cross-contamination dedicated surface enforcement", () => {
  const dish = {
    id: "safe-salad",
    name: "Organic Garden Salad",
    ingredients: [
      { id: "ing-greens", name: "Mixed Greens", allergens: [], isVerifiedSupplier: true },
      { id: "ing-olive-oil", name: "Olive Oil", allergens: [], isVerifiedSupplier: true },
    ],
    allergens: [],
    substitutions: [],
    hasUnverifiedSuppliers: false,
  };

  const requestedAllergies = [
    {
      id: "allergen.peanut",
      label: "Peanut Sensitivity",
      requireDedicatedSurface: true,
      severity: "critical",
    },
  ];

  // Case A: Kitchen confirms dedicated prep surface
  const resultAccepted = evaluateUniversalAllergyPolicy(dish, requestedAllergies, {
    dedicatedPrepSurface: true,
  });
  assert.equal(resultAccepted.response, "accept");
  assert.equal(resultAccepted.isSafe, true);

  // Case B: Kitchen explicitly lacks dedicated prep surface
  const resultDeclined = evaluateUniversalAllergyPolicy(dish, requestedAllergies, {
    dedicatedPrepSurface: false,
  });
  assert.equal(resultDeclined.response, "decline");
  assert.equal(resultDeclined.isSafe, false);
  assert.match(resultDeclined.rationale, /lacks dedicated prep surface/);

  // Case C: Kitchen capabilities undefined -> requires dedicated surface setup change
  const resultReqChange = evaluateUniversalAllergyPolicy(dish, requestedAllergies);
  assert.equal(resultReqChange.response, "required_change");
  assert.equal(resultReqChange.isSafe, false);
  assert.match(resultReqChange.requiredChanges[0], /dedicated prep surface/);
});

test("unverified ingredient supplier fail-closed behavior", () => {
  const dishWithUnverifiedFlag = {
    id: "curry-unverified",
    name: "Special Thai Green Curry",
    ingredients: [
      { id: "ing-coconut", name: "Coconut Milk", allergens: ["allergen.tree_nut"], isVerifiedSupplier: true },
      { id: "ing-curry-paste", name: "Special House Curry Paste", allergens: [], isVerifiedSupplier: false },
    ],
    allergens: ["allergen.tree_nut"],
    substitutions: [],
    hasUnverifiedSuppliers: true,
  };

  const requestedAllergies = ["allergen.dairy", "allergen.tree_nut"];
  const result = evaluateUniversalAllergyPolicy(dishWithUnverifiedFlag, requestedAllergies);

  assert.equal(result.response, "cannot_determine");
  assert.equal(result.isSafe, false);
  assert.ok(result.unverifiedIngredients.length > 0);
  assert.match(result.rationale, /Unverified ingredient supplier/);
});
