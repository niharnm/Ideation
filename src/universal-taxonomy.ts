export type AllergenSource = "FDA_BIG_9" | "EU_14" | "CUSTOM";
export type AllergenSeverity = "low" | "medium" | "high" | "critical";

export interface AllergenMetadata {
  id: string;
  uri: string;
  name: string;
  description: string;
  sources: AllergenSource[];
  severityDefault: AllergenSeverity;
  category: string;
}

export interface IngredientOntology {
  id: string;
  name: string;
  allergens: string[];
  isVerifiedSupplier?: boolean;
}

export interface SubstitutionOptionProfile {
  id: string;
  originalIngredientId: string;
  originalIngredientName: string;
  replacementIngredientId: string;
  replacementIngredientName: string;
  description: string;
  removesAllergens: string[];
}

export interface DishIngredientProfile {
  id: string;
  name: string;
  description?: string;
  ingredients: IngredientOntology[];
  hasUnverifiedSuppliers?: boolean;
  allergens?: string[];
  substitutions?: SubstitutionOptionProfile[];
  dedicatedPrepSurfaceAvailable?: boolean;
}

export const UNIVERSAL_ALLERGEN_TAXONOMY: Record<string, AllergenMetadata> = {
  "allergen.peanut": {
    id: "allergen.peanut",
    uri: "allergen.peanut",
    name: "Peanut",
    description: "Peanuts and peanut-derived products.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "critical",
    category: "Legumes",
  },
  "allergen.tree_nut": {
    id: "allergen.tree_nut",
    uri: "allergen.tree_nut",
    name: "Tree Nut",
    description: "Tree nuts including almonds, walnuts, cashews, pecans, and pistachios.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "critical",
    category: "Nuts",
  },
  "allergen.dairy": {
    id: "allergen.dairy",
    uri: "allergen.dairy",
    name: "Dairy / Milk",
    description: "Milk and dairy products including whey, casein, and lactose.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "high",
    category: "Dairy",
  },
  "allergen.egg": {
    id: "allergen.egg",
    uri: "allergen.egg",
    name: "Egg",
    description: "Eggs and egg-derived proteins.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "high",
    category: "Poultry Products",
  },
  "allergen.gluten": {
    id: "allergen.gluten",
    uri: "allergen.gluten",
    name: "Gluten / Wheat",
    description: "Cereals containing gluten including wheat, rye, barley, and oats.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "high",
    category: "Grains",
  },
  "allergen.soy": {
    id: "allergen.soy",
    uri: "allergen.soy",
    name: "Soy",
    description: "Soybeans and soy-derived ingredients.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "medium",
    category: "Legumes",
  },
  "allergen.fish": {
    id: "allergen.fish",
    uri: "allergen.fish",
    name: "Fish",
    description: "Finned fish and fish products.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "high",
    category: "Seafood",
  },
  "allergen.shellfish": {
    id: "allergen.shellfish",
    uri: "allergen.shellfish",
    name: "Shellfish",
    description: "Crustaceans and molluscs (shrimp, crab, lobster, oysters, clams).",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "high",
    category: "Seafood",
  },
  "allergen.sesame": {
    id: "allergen.sesame",
    uri: "allergen.sesame",
    name: "Sesame",
    description: "Sesame seeds, paste (tahini), and sesame oil.",
    sources: ["FDA_BIG_9", "EU_14"],
    severityDefault: "high",
    category: "Seeds",
  },
  "allergen.alpha_gal": {
    id: "allergen.alpha_gal",
    uri: "allergen.alpha_gal",
    name: "Alpha-Gal",
    description: "Galactose-alpha-1,3-galactose carbohydrate found in mammalian meat and dairy.",
    sources: ["CUSTOM"],
    severityDefault: "critical",
    category: "Mammalian Meat",
  },
  "allergen.sulfite": {
    id: "allergen.sulfite",
    uri: "allergen.sulfite",
    name: "Sulfite",
    description: "Sulphur dioxide and sulphites at concentrations > 10mg/kg.",
    sources: ["EU_14"],
    severityDefault: "medium",
    category: "Preservatives",
  },
  "allergen.mustard": {
    id: "allergen.mustard",
    uri: "allergen.mustard",
    name: "Mustard",
    description: "Mustard seeds, powder, leaves, and condiments.",
    sources: ["EU_14"],
    severityDefault: "medium",
    category: "Spices",
  },
  "allergen.celery": {
    id: "allergen.celery",
    uri: "allergen.celery",
    name: "Celery",
    description: "Celery stalks, leaves, seeds, and celeriac.",
    sources: ["EU_14"],
    severityDefault: "medium",
    category: "Vegetables",
  },
  "allergen.lupin": {
    id: "allergen.lupin",
    uri: "allergen.lupin",
    name: "Lupin",
    description: "Lupin seeds, flour, and lupin protein preparations.",
    sources: ["EU_14"],
    severityDefault: "high",
    category: "Legumes",
  },
};

export function normalizeAllergenUri(uriOrId: string): string {
  if (!uriOrId) return "";
  let clean = uriOrId.trim().toLowerCase();
  clean = clean.replace(/^order\.constraint\./, "");
  if (!clean.startsWith("allergen.")) {
    clean = `allergen.${clean}`;
  }
  return clean;
}

export function getAllergenMetadata(uriOrId: string): AllergenMetadata {
  const normUri = normalizeAllergenUri(uriOrId);
  if (UNIVERSAL_ALLERGEN_TAXONOMY[normUri]) {
    return UNIVERSAL_ALLERGEN_TAXONOMY[normUri];
  }
  const name = normUri
    .replace(/^allergen\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    id: normUri,
    uri: normUri,
    name,
    description: `Custom allergen sensitivity (${normUri})`,
    sources: ["CUSTOM"],
    severityDefault: "medium",
    category: "Custom",
  };
}
