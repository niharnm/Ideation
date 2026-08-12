import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLERGEN_MAP,
  BURGERS_AND_GREENS,
  GOLDEN_THAI_KITCHEN,
  MENU_ITEMS,
  RESTAURANT_FIXTURES,
  SEASIDE_SUSHI_BAR,
  VERIFIED_ALLERGENS,
  evaluateMenuSafety,
  getAvailableSubstitutions,
  getMenuItem,
  getMenuItemsByRestaurant,
} from "../src/index.ts";

test("verifies restaurant fixtures and allergen constants", () => {
  assert.equal(RESTAURANT_FIXTURES.length, 3);
  assert.equal(GOLDEN_THAI_KITCHEN.name, "Golden Thai Kitchen");
  assert.equal(BURGERS_AND_GREENS.name, "Burgers & Greens");
  assert.equal(SEASIDE_SUSHI_BAR.name, "Seaside Sushi Bar");

  assert.deepEqual(VERIFIED_ALLERGENS, ["peanut", "tree_nut", "dairy", "gluten"]);
  assert.equal(ALLERGEN_MAP.peanut, "Peanut");
  assert.equal(ALLERGEN_MAP.gluten, "Gluten");

  assert.ok(MENU_ITEMS.length >= 8);
});

test("verifies menu lookup by item ID and restaurant ID", () => {
  const padThai = getMenuItem("pad-thai");
  assert.ok(padThai);
  assert.equal(padThai.name, "Pad Thai");
  assert.equal(padThai.restaurantName, "Golden Thai Kitchen");
  assert.deepEqual(padThai.allergens, ["peanut", "gluten"]);

  const greenCurry = getMenuItem("green-curry");
  assert.ok(greenCurry);
  assert.equal(greenCurry.name, "Green Curry");

  const nonExistent = getMenuItem("non-existent-dish");
  assert.equal(nonExistent, undefined);

  const thaiItems = getMenuItemsByRestaurant("restaurant-golden-thai");
  assert.equal(thaiItems.length, 4);
  const thaiNames = thaiItems.map((i) => i.name);
  assert.ok(thaiNames.includes("Pad Thai"));
  assert.ok(thaiNames.includes("Green Curry"));
  assert.ok(thaiNames.includes("Peanut Noodle Bowl"));
  assert.ok(thaiNames.includes("Gluten-Free Noodle Bowl"));

  const burgerItems = getMenuItemsByRestaurant("restaurant-burgers-greens");
  assert.equal(burgerItems.length, 3);
});

test("verifies ingredient safety for safe dishes", () => {
  const gfResult = evaluateMenuSafety("gluten-free-noodle-bowl", [
    "peanut",
    "gluten",
  ]);

  assert.equal(gfResult.isSafe, true);
  assert.equal(gfResult.allergensFound.length, 0);
  assert.equal(gfResult.unconfirmedIngredients.length, 0);
  assert.equal(gfResult.policyDecision.response, "accept");

  const saladResult = evaluateMenuSafety("house-green-salad", [
    "peanut",
    "dairy",
    "gluten",
    "tree_nut",
  ]);

  assert.equal(saladResult.isSafe, true);
  assert.equal(saladResult.policyDecision.response, "accept");
});

test("verifies available substitutions and recommendation in safety evaluation", () => {
  const padThaiSubs = getAvailableSubstitutions("pad-thai");
  assert.equal(padThaiSubs.length, 2);
  const tamariSub = padThaiSubs.find((s) => s.id === "sub-tamari-gf");
  assert.ok(tamariSub);
  assert.equal(tamariSub.replacementIngredientName, "Tamari GF Soy Sauce");

  const evalPadThaiGluten = evaluateMenuSafety("pad-thai", ["gluten"]);
  assert.equal(evalPadThaiGluten.isSafe, false);
  assert.equal(evalPadThaiGluten.policyDecision.response, "required_change");
  assert.equal(evalPadThaiGluten.recommendedSubstitutions.length, 1);
  assert.equal(
    evalPadThaiGluten.recommendedSubstitutions[0].replacementIngredientName,
    "Tamari GF Soy Sauce",
  );
  assert.ok(
    evalPadThaiGluten.policyDecision.requiredChanges?.[0].includes(
      "Tamari GF Soy Sauce",
    ),
  );

  const evalVeggieBurger = evaluateMenuSafety("classic-veggie-burger", [
    { id: "order.constraint.dairy", label: "Dairy Intolerance" },
  ]);
  assert.equal(evalVeggieBurger.policyDecision.response, "required_change");
  const subNames = evalVeggieBurger.recommendedSubstitutions.map(
    (s) => s.replacementIngredientName,
  );
  assert.ok(subNames.includes("Gluten-Free Bun") || subNames.includes("Vegan Cheese"));
});

test("verifies handling of unsubstitutable allergen constraints", () => {
  const evalPeanutBowl = evaluateMenuSafety("peanut-noodle-bowl", ["peanut"]);

  assert.equal(evalPeanutBowl.isSafe, false);
  assert.deepEqual(evalPeanutBowl.allergensFound, ["peanut"]);
  assert.equal(evalPeanutBowl.policyDecision.response, "decline");
  assert.ok(evalPeanutBowl.rationale.includes("cannot be safely substituted"));
});

test("verifies detection of unconfirmed / unknown ingredients", () => {
  const greenCurry = getMenuItem("green-curry");
  assert.ok(greenCurry);
  assert.equal(greenCurry.hasUnconfirmedIngredients, true);
  assert.deepEqual(greenCurry.unconfirmedIngredients, ["Special Curry Paste"]);

  const evalGreenCurry = evaluateMenuSafety("green-curry", ["tree_nut"]);
  assert.equal(evalGreenCurry.isSafe, false);
  assert.deepEqual(evalGreenCurry.unconfirmedIngredients, [
    "Special Curry Paste",
  ]);

  const evalMystery = evaluateMenuSafety("mystery-sauce-burger", ["peanut"]);
  assert.equal(evalMystery.isSafe, false);
  assert.deepEqual(evalMystery.unconfirmedIngredients, [
    "Special Secret Sauce",
  ]);

  const evalUnknownItem = evaluateMenuSafety("non-existent-dish", ["peanut"]);
  assert.equal(evalUnknownItem.isSafe, false);
  assert.equal(evalUnknownItem.policyDecision.response, "cannot_determine");
  assert.ok(evalUnknownItem.rationale.includes("was not found"));
});

test("cannot determine safety when a preparation input is unconfirmed", () => {
  const crispyTofuRoll = getMenuItem("crispy-tofu-roll");
  assert.ok(crispyTofuRoll);
  assert.equal(crispyTofuRoll.restaurantName, "Seaside Sushi Bar");
  assert.deepEqual(crispyTofuRoll.unconfirmedIngredients, ["Shared Fryer Oil"]);

  const evaluation = evaluateMenuSafety("crispy-tofu-roll", ["peanut"]);
  assert.equal(evaluation.isSafe, false);
  assert.equal(evaluation.policyDecision.response, "cannot_determine");
  assert.deepEqual(evaluation.unconfirmedIngredients, ["Shared Fryer Oil"]);
});
