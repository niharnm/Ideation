import { evaluatePolicy, type PolicyDecision } from "../decision-policy.ts";
import type { HandshakeDataScope } from "../handshake-event.ts";

export const VERIFIED_ALLERGENS = ["peanut", "tree_nut", "dairy", "gluten"] as const;
export type VerifiedAllergen = (typeof VERIFIED_ALLERGENS)[number];

export const ALLERGEN_MAP: Record<VerifiedAllergen, string> = {
  peanut: "Peanut",
  tree_nut: "Tree Nut",
  dairy: "Dairy",
  gluten: "Gluten",
};

export interface Ingredient {
  id: string;
  name: string;
  allergens: VerifiedAllergen[];
  isConfirmed: boolean;
}

export interface SubstitutionOption {
  id: string;
  originalIngredientId: string;
  originalIngredientName: string;
  replacementIngredientId: string;
  replacementIngredientName: string;
  description: string;
  removesAllergens: VerifiedAllergen[];
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  description: string;
  ingredients: Ingredient[];
  allergens: VerifiedAllergen[];
  substitutions: SubstitutionOption[];
  hasUnconfirmedIngredients: boolean;
  unconfirmedIngredients: string[];
}

export interface RestaurantFixture {
  id: string;
  name: string;
  cuisine: string;
  menuItems: MenuItem[];
}

export interface MenuSafetyConstraint {
  id: string;
  label?: string;
}

export interface MenuSafetyEvaluation {
  itemId: string;
  menuItem?: MenuItem;
  isSafe: boolean;
  allergensFound: VerifiedAllergen[];
  unconfirmedIngredients: string[];
  recommendedSubstitutions: SubstitutionOption[];
  policyDecision: PolicyDecision;
  rationale: string;
}

export const GOLDEN_THAI_KITCHEN: RestaurantFixture = {
  id: "restaurant-golden-thai",
  name: "Golden Thai Kitchen",
  cuisine: "Thai",
  menuItems: [
    {
      id: "pad-thai",
      restaurantId: "restaurant-golden-thai",
      restaurantName: "Golden Thai Kitchen",
      name: "Pad Thai",
      description:
        "Classic Thai stir-fried rice noodles with tofu, peanuts, bean sprouts, and soy sauce.",
      ingredients: [
        { id: "ing-rice-noodles", name: "Rice Noodles", allergens: [], isConfirmed: true },
        { id: "ing-tofu", name: "Tofu", allergens: [], isConfirmed: true },
        { id: "ing-peanuts", name: "Peanuts", allergens: ["peanut"], isConfirmed: true },
        { id: "ing-soy-sauce", name: "Soy Sauce", allergens: ["gluten"], isConfirmed: true },
        { id: "ing-bean-sprouts", name: "Bean Sprouts", allergens: [], isConfirmed: true },
      ],
      allergens: ["peanut", "gluten"],
      substitutions: [
        {
          id: "sub-tamari-gf",
          originalIngredientId: "ing-soy-sauce",
          originalIngredientName: "Soy Sauce",
          replacementIngredientId: "ing-tamari-soy-sauce",
          replacementIngredientName: "Tamari GF Soy Sauce",
          description: "Substitute regular soy sauce with Tamari GF Soy Sauce",
          removesAllergens: ["gluten"],
        },
        {
          id: "sub-no-peanuts",
          originalIngredientId: "ing-peanuts",
          originalIngredientName: "Peanuts",
          replacementIngredientId: "ing-none",
          replacementIngredientName: "Omit Peanuts",
          description: "Omit peanuts from dish preparation",
          removesAllergens: ["peanut"],
        },
      ],
      hasUnconfirmedIngredients: false,
      unconfirmedIngredients: [],
    },
    {
      id: "green-curry",
      restaurantId: "restaurant-golden-thai",
      restaurantName: "Golden Thai Kitchen",
      name: "Green Curry",
      description:
        "Aromatic Thai green curry with coconut milk, bamboo shoots, eggplant, and chef's special curry paste.",
      ingredients: [
        { id: "ing-coconut-milk", name: "Coconut Milk", allergens: ["tree_nut"], isConfirmed: true },
        { id: "ing-special-curry-paste", name: "Special Curry Paste", allergens: [], isConfirmed: false },
        { id: "ing-bamboo-shoots", name: "Bamboo Shoots", allergens: [], isConfirmed: true },
        { id: "ing-jasmine-rice", name: "Jasmine Rice", allergens: [], isConfirmed: true },
      ],
      allergens: ["tree_nut"],
      substitutions: [],
      hasUnconfirmedIngredients: true,
      unconfirmedIngredients: ["Special Curry Paste"],
    },
    {
      id: "peanut-noodle-bowl",
      restaurantId: "restaurant-golden-thai",
      restaurantName: "Golden Thai Kitchen",
      name: "Peanut Noodle Bowl",
      description:
        "Wheat egg noodles tossed in rich peanut sauce topped with crushed roasted peanuts.",
      ingredients: [
        { id: "ing-egg-noodles", name: "Egg Noodles", allergens: ["gluten"], isConfirmed: true },
        { id: "ing-peanut-sauce", name: "Peanut Sauce", allergens: ["peanut"], isConfirmed: true },
        { id: "ing-crushed-peanuts", name: "Crushed Peanuts", allergens: ["peanut"], isConfirmed: true },
      ],
      allergens: ["peanut", "gluten"],
      substitutions: [],
      hasUnconfirmedIngredients: false,
      unconfirmedIngredients: [],
    },
    {
      id: "gluten-free-noodle-bowl",
      restaurantId: "restaurant-golden-thai",
      restaurantName: "Golden Thai Kitchen",
      name: "Gluten-Free Noodle Bowl",
      description:
        "Certified gluten-free rice noodles tossed with Tamari GF Soy Sauce, fresh vegetables, and herbs.",
      ingredients: [
        { id: "ing-rice-noodles", name: "Rice Noodles", allergens: [], isConfirmed: true },
        { id: "ing-tamari-soy-sauce", name: "Tamari GF Soy Sauce", allergens: [], isConfirmed: true },
        { id: "ing-fresh-veggies", name: "Fresh Vegetables", allergens: [], isConfirmed: true },
      ],
      allergens: [],
      substitutions: [],
      hasUnconfirmedIngredients: false,
      unconfirmedIngredients: [],
    },
  ],
};

export const BURGERS_AND_GREENS: RestaurantFixture = {
  id: "restaurant-burgers-greens",
  name: "Burgers & Greens",
  cuisine: "American / Salad",
  menuItems: [
    {
      id: "classic-veggie-burger",
      restaurantId: "restaurant-burgers-greens",
      restaurantName: "Burgers & Greens",
      name: "Classic Veggie Burger",
      description:
        "House veggie patty on a brioche bun with cheddar cheese, lettuce, and tomato.",
      ingredients: [
        { id: "ing-veggie-patty", name: "Veggie Patty", allergens: ["gluten"], isConfirmed: true },
        { id: "ing-brioche-bun", name: "Brioche Bun", allergens: ["gluten", "dairy"], isConfirmed: true },
        { id: "ing-cheddar-cheese", name: "Cheddar Cheese", allergens: ["dairy"], isConfirmed: true },
        { id: "ing-lettuce-tomato", name: "Lettuce & Tomato", allergens: [], isConfirmed: true },
      ],
      allergens: ["gluten", "dairy"],
      substitutions: [
        {
          id: "sub-gf-bun",
          originalIngredientId: "ing-brioche-bun",
          originalIngredientName: "Brioche Bun",
          replacementIngredientId: "ing-gf-bun",
          replacementIngredientName: "Gluten-Free Bun",
          description: "Substitute brioche bun with gluten-free & dairy-free bun",
          removesAllergens: ["gluten", "dairy"],
        },
        {
          id: "sub-vegan-cheese",
          originalIngredientId: "ing-cheddar-cheese",
          originalIngredientName: "Cheddar Cheese",
          replacementIngredientId: "ing-vegan-cheese",
          replacementIngredientName: "Vegan Cheese",
          description: "Substitute dairy cheese with plant-based vegan cheese",
          removesAllergens: ["dairy"],
        },
      ],
      hasUnconfirmedIngredients: false,
      unconfirmedIngredients: [],
    },
    {
      id: "house-green-salad",
      restaurantId: "restaurant-burgers-greens",
      restaurantName: "Burgers & Greens",
      name: "House Green Salad",
      description:
        "Fresh organic mixed greens, cucumbers, cherry tomatoes, and lemon olive oil dressing.",
      ingredients: [
        { id: "ing-mixed-greens", name: "Mixed Greens", allergens: [], isConfirmed: true },
        { id: "ing-cucumbers-tomatoes", name: "Cucumbers & Cherry Tomatoes", allergens: [], isConfirmed: true },
        { id: "ing-lemon-dressing", name: "Lemon Dressing", allergens: [], isConfirmed: true },
      ],
      allergens: [],
      substitutions: [],
      hasUnconfirmedIngredients: false,
      unconfirmedIngredients: [],
    },
    {
      id: "mystery-sauce-burger",
      restaurantId: "restaurant-burgers-greens",
      restaurantName: "Burgers & Greens",
      name: "Mystery Sauce Burger",
      description:
        "Grass-fed beef patty with lettuce and restaurant's secret special sauce.",
      ingredients: [
        { id: "ing-beef-patty", name: "Beef Patty", allergens: [], isConfirmed: true },
        { id: "ing-secret-sauce", name: "Special Secret Sauce", allergens: [], isConfirmed: false },
        { id: "ing-lettuce", name: "Lettuce", allergens: [], isConfirmed: true },
      ],
      allergens: [],
      substitutions: [],
      hasUnconfirmedIngredients: true,
      unconfirmedIngredients: ["Special Secret Sauce"],
    },
  ],
};

export const SEASIDE_SUSHI_BAR: RestaurantFixture = {
  id: "restaurant-seaside-sushi",
  name: "Seaside Sushi Bar",
  cuisine: "Japanese",
  menuItems: [
    {
      id: "crispy-tofu-roll",
      restaurantId: "restaurant-seaside-sushi",
      restaurantName: "Seaside Sushi Bar",
      name: "Crispy Tofu Roll",
      description:
        "Rice, avocado, cucumber, and crispy tofu. The fryer oil used for the tofu is not confirmed for this service.",
      ingredients: [
        { id: "ing-sushi-rice", name: "Sushi Rice", allergens: [], isConfirmed: true },
        { id: "ing-avocado", name: "Avocado", allergens: [], isConfirmed: true },
        { id: "ing-cucumber", name: "Cucumber", allergens: [], isConfirmed: true },
        { id: "ing-crispy-tofu", name: "Crispy Tofu", allergens: [], isConfirmed: true },
        { id: "ing-shared-fryer-oil", name: "Shared Fryer Oil", allergens: [], isConfirmed: false },
      ],
      allergens: [],
      substitutions: [],
      hasUnconfirmedIngredients: true,
      unconfirmedIngredients: ["Shared Fryer Oil"],
    },
  ],
};

export const RESTAURANT_FIXTURES: readonly RestaurantFixture[] = [
  GOLDEN_THAI_KITCHEN,
  BURGERS_AND_GREENS,
  SEASIDE_SUSHI_BAR,
];

export const MENU_ITEMS: readonly MenuItem[] = RESTAURANT_FIXTURES.flatMap(
  (r) => r.menuItems,
);

export function getMenuItem(id: string): MenuItem | undefined {
  return MENU_ITEMS.find((item) => item.id === id);
}

export function getMenuItemsByRestaurant(restaurantId: string): MenuItem[] {
  const restaurant = RESTAURANT_FIXTURES.find((r) => r.id === restaurantId);
  return restaurant ? [...restaurant.menuItems] : [];
}

export function getAvailableSubstitutions(itemId: string): SubstitutionOption[] {
  const item = getMenuItem(itemId);
  return item ? [...item.substitutions] : [];
}

function normalizeAllergenConstraint(constraint: string | MenuSafetyConstraint): VerifiedAllergen {
  const rawId = typeof constraint === "string" ? constraint : constraint.id;
  const normalized = rawId.replace(/^order\.constraint\./, "").toLowerCase();
  return normalized as VerifiedAllergen;
}

export function evaluateMenuSafety(
  itemId: string,
  requestedConstraints: readonly (string | MenuSafetyConstraint)[],
): MenuSafetyEvaluation {
  const menuItem = getMenuItem(itemId);

  if (!menuItem) {
    const dataScope: HandshakeDataScope = {
      purpose: `Menu safety evaluation for ${itemId}`,
      fields: requestedConstraints.map((c) => {
        const id = typeof c === "string" ? c : c.id;
        const label = typeof c === "string" ? c : c.label ?? c.id;
        return { id, label, selected: true };
      }),
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      choice: "approve",
    };

    const recipientData: Record<string, unknown> = {
      status: "cannot_determine",
      rationale: `Menu item '${itemId}' was not found in restaurant fixtures.`,
    };

    const policyDecision = evaluatePolicy({ dataScope, recipientData });

    return {
      itemId,
      menuItem: undefined,
      isSafe: false,
      allergensFound: [],
      unconfirmedIngredients: [],
      recommendedSubstitutions: [],
      policyDecision,
      rationale: policyDecision.rationale,
    };
  }

  const normalizedConstraints = requestedConstraints.map((c) => ({
    raw: c,
    allergen: normalizeAllergenConstraint(c),
    fieldId: typeof c === "string" ? c : c.id,
    label: typeof c === "string" ? c : c.label ?? c.id,
  }));

  const allergensFound: VerifiedAllergen[] = [];
  const recommendedSubstitutions: SubstitutionOption[] = [];
  const recipientData: Record<string, unknown> = {};

  const unconfirmedIngredients = menuItem.ingredients
    .filter((ing) => !ing.isConfirmed)
    .map((ing) => ing.name);

  for (const c of normalizedConstraints) {
    const allergenKey = c.allergen;

    // Check if dish has confirmed ingredients with this allergen
    const matchingIngredients = menuItem.ingredients.filter(
      (ing) => ing.isConfirmed && ing.allergens.includes(allergenKey),
    );

    if (matchingIngredients.length > 0) {
      if (!allergensFound.includes(allergenKey)) {
        allergensFound.push(allergenKey);
      }

      // Check if substitution is available for this allergen
      const sub = menuItem.substitutions.find((s) =>
        s.removesAllergens.includes(allergenKey),
      );

      if (sub) {
        if (!recommendedSubstitutions.some((s) => s.id === sub.id)) {
          recommendedSubstitutions.push(sub);
        }
        recipientData[c.fieldId] = {
          status: "required_change",
          requiredChange: `Substitute ${sub.originalIngredientName} with ${sub.replacementIngredientName} to eliminate ${c.label}`,
        };
      } else {
        recipientData[c.fieldId] = {
          status: "declined",
          allowed: false,
          reason: `Item '${menuItem.name}' contains ${c.label} (${matchingIngredients.map((i) => i.name).join(", ")}) which cannot be safely substituted.`,
        };
      }
    } else if (unconfirmedIngredients.length > 0) {
      recipientData[c.fieldId] = {
        status: "cannot_determine",
        confirmed: false,
        rationale: `Unconfirmed ingredient(s) in '${menuItem.name}': ${unconfirmedIngredients.join(", ")}. Cannot guarantee safety for ${c.label}.`,
      };
    } else {
      recipientData[c.fieldId] = {
        status: "accept",
        allowed: true,
        confirmed: true,
      };
    }
  }

  const dataScope: HandshakeDataScope = {
    purpose: `Menu safety evaluation for ${menuItem.name} (${itemId})`,
    fields: normalizedConstraints.map((c) => ({
      id: c.fieldId,
      label: c.label,
      selected: true,
    })),
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    choice: "approve",
  };

  const policyDecision = evaluatePolicy({ dataScope, recipientData });

  const isSafe =
    allergensFound.length === 0 &&
    unconfirmedIngredients.length === 0 &&
    policyDecision.response === "accept";

  return {
    itemId,
    menuItem,
    isSafe,
    allergensFound,
    unconfirmedIngredients,
    recommendedSubstitutions,
    policyDecision,
    rationale: policyDecision.rationale,
  };
}
