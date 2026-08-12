import {
  loadUserPassportVault,
  saveUserPassportVault,
  type AllergyConstraint,
  type UserPassportVault,
} from "./passport-vault.ts";
import { normalizeAllergenUri, getAllergenMetadata } from "./universal-taxonomy.ts";

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface MCPToolResponse {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredData?: any;
}

export const EGOIST_MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: "egoist_passport_update_vault",
    description: "Updates user's central Egoist AI Passport Vault with dietary & allergy constraints extracted from conversation.",
    inputSchema: {
      type: "object",
      properties: {
        rawAllergenText: { type: "string", description: "Raw allergen name or URI (e.g., 'peanut', 'gluten', 'allergen.dairy')" },
        label: { type: "string", description: "Human-readable display label (e.g., 'Peanut constraint')" },
        severity: {
          type: "string",
          enum: ["anaphylactic", "severe", "intolerance", "preference"],
          description: "Medical severity level",
        },
        crossContaminationTolerance: {
          type: "string",
          enum: ["strict_isolation", "shared_facility_ok"],
          description: "Cross contamination tolerance flag",
        },
      },
      required: ["rawAllergenText"],
    },
  },
  {
    name: "egoist_passport_read_vault",
    description: "Reads active claims stored in the user's central Egoist AI Passport Vault.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "egoist_passport_sync_memories",
    description: "Replaces the Egoist AI Passport's allergen.* constraints with the current memory list. Pass the full list of memory strings; an empty array clears all Egoist constraints. Use this when memories are added, changed, or deleted on ego.ist.",
    inputSchema: {
      type: "object",
      properties: {
        memories: {
          type: "array",
          items: { type: "string" },
          description: "Full current list of Egoist memory strings. Replaces all prior allergen.* constraints; an empty array clears them.",
        },
      },
      required: ["memories"],
    },
  },
  {
    name: "egoist_passport_parse_natural_language",
    description: "Parses natural language into structured Egoist Passport Vault constraints and REPLACES the passport's allergen.* namespace with the parsed result. An empty parse clears all Egoist constraints. Prefer egoist_passport_sync_memories when syncing the full memory list from ego.ist.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Natural language input (e.g., 'I am severely allergic to peanuts and lactose intolerant')" },
        memories: { type: "array", items: { type: "string" }, description: "Full current list of Egoist memory strings. Replaces all prior allergen.* constraints; an empty array clears them." },
      },
    },
  },
];

export function parseNaturalLanguageToConstraints(text: string): AllergyConstraint[] {
  const lower = text.toLowerCase();
  const constraints: AllergyConstraint[] = [];
  const seen = new Set<string>();

  const allergenKeywords: Array<{ keyword: string; allergenId: string; defaultLabel: string }> = [
    { keyword: "peanut", allergenId: "allergen.peanut", defaultLabel: "Peanut" },
    { keyword: "tree nut", allergenId: "allergen.tree_nut", defaultLabel: "Tree Nut" },
    { keyword: "walnut", allergenId: "allergen.tree_nut", defaultLabel: "Tree Nut" },
    { keyword: "almond", allergenId: "allergen.tree_nut", defaultLabel: "Tree Nut" },
    { keyword: "cashew", allergenId: "allergen.tree_nut", defaultLabel: "Tree Nut" },
    { keyword: "dairy", allergenId: "allergen.dairy", defaultLabel: "Dairy / Milk" },
    { keyword: "lactose", allergenId: "allergen.dairy", defaultLabel: "Dairy / Milk" },
    { keyword: "milk", allergenId: "allergen.dairy", defaultLabel: "Dairy / Milk" },
    { keyword: "gluten", allergenId: "allergen.gluten", defaultLabel: "Wheat / Gluten" },
    { keyword: "wheat", allergenId: "allergen.gluten", defaultLabel: "Wheat / Gluten" },
    { keyword: "egg", allergenId: "allergen.egg", defaultLabel: "Egg" },
    { keyword: "soy", allergenId: "allergen.soy", defaultLabel: "Soy" },
    { keyword: "fish", allergenId: "allergen.fish", defaultLabel: "Fish" },
    { keyword: "shellfish", allergenId: "allergen.shellfish", defaultLabel: "Shellfish" },
    { keyword: "shrimp", allergenId: "allergen.shellfish", defaultLabel: "Shellfish" },
    { keyword: "sesame", allergenId: "allergen.sesame", defaultLabel: "Sesame" },
    { keyword: "alpha-gal", allergenId: "allergen.alpha_gal", defaultLabel: "Alpha-gal (Red Meat)" },
    { keyword: "sulfite", allergenId: "allergen.sulfite", defaultLabel: "Sulfite" },
  ];

  // Handle Egoist memory patterns: "The user cannot eat nuts" -> peanut + tree_nut
  // "nuts" alone (not "peanut", not "tree nut") maps to BOTH peanut and tree_nut
  const nutsPattern = /\bnut(s)?\b/;
  const hasPeanutExplicit = lower.includes("peanut");
  const hasTreeNutExplicit = lower.includes("tree nut");
  if (nutsPattern.test(lower) && !hasPeanutExplicit && !hasTreeNutExplicit) {
    const meta1 = getAllergenMetadata("allergen.peanut");
    const meta2 = getAllergenMetadata("allergen.tree_nut");
    const isAnaphylactic = lower.includes("anaphylac") || lower.includes("severe");
    constraints.push({
      allergenId: "allergen.peanut",
      label: meta1 ? meta1.name : "Peanut",
      severity: isAnaphylactic ? "anaphylactic" : "severe",
      crossContaminationTolerance: false, // strict: no cross-contamination allowed
    });
    constraints.push({
      allergenId: "allergen.tree_nut",
      label: meta2 ? meta2.name : "Tree Nut",
      severity: isAnaphylactic ? "anaphylactic" : "severe",
      crossContaminationTolerance: false, // strict: no cross-contamination allowed
    });
    seen.add("allergen.peanut");
    seen.add("allergen.tree_nut");
  }

  for (const item of allergenKeywords) {
    if (lower.includes(item.keyword) && !seen.has(item.allergenId)) {
      seen.add(item.allergenId);
      const isAnaphylactic = lower.includes("anaphylac") || lower.includes("severe");
      const isStrict = lower.includes("strict") || lower.includes("dedicated") || isAnaphylactic;
      const meta = getAllergenMetadata(item.allergenId);

      constraints.push({
        allergenId: item.allergenId,
        label: meta ? meta.name : item.defaultLabel,
        severity: isAnaphylactic ? "anaphylactic" : "severe",
        crossContaminationTolerance: false, // Egoist memories = strict by default (no cross-contam)
      });
    }
  }

  return constraints;
}

export function parseMemoryInputsToConstraints(args: Record<string, any>): AllergyConstraint[] {
  const parsed: AllergyConstraint[] = [];
  const texts: string[] = [];

  if (Array.isArray(args.memories)) {
    for (const memoryText of args.memories) {
      if (typeof memoryText === "string" && memoryText.trim()) {
        texts.push(memoryText.trim());
      }
    }
  } else {
    const text = String(args.text || "").trim();
    if (text) texts.push(text);
  }

  for (const memoryText of texts) {
    for (const constraint of parseNaturalLanguageToConstraints(memoryText)) {
      if (!parsed.some((c) => c.allergenId === constraint.allergenId)) {
        parsed.push(constraint);
      }
    }
  }

  return parsed;
}

export function replaceEgoistAllergies(
  vault: UserPassportVault,
  parsed: AllergyConstraint[],
): UserPassportVault {
  return {
    ...vault,
    allergies: [
      ...vault.allergies.filter((a) => !a.allergenId.startsWith("allergen.")),
      ...parsed,
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function syncMemoriesToVault(
  memories: string[],
  storage: Storage,
): UserPassportVault {
  const vault = loadUserPassportVault(storage);
  const parsed = parseMemoryInputsToConstraints({ memories });
  const updated = replaceEgoistAllergies(vault, parsed);
  saveUserPassportVault(updated, storage);
  return updated;
}

export function handleEgoistMCPRequest(
  toolName: string,
  args: Record<string, any>,
  storage: Storage
): MCPToolResponse {
  try {
    const vault = loadUserPassportVault(storage);

    switch (toolName) {
      case "egoist_passport_update_vault": {
        const rawText = String(args.rawAllergenText || "");
        const allergenId = normalizeAllergenUri(rawText);
        const meta = getAllergenMetadata(allergenId);
        const label = args.label || (meta ? meta.name : rawText);

        const newConstraint: AllergyConstraint = {
          allergenId,
          label,
          severity: args.severity || "severe",
          crossContaminationTolerance: args.crossContaminationTolerance || "strict_isolation",
        };

        const existingIdx = vault.allergies.findIndex((a) => a.allergenId === allergenId);
        if (existingIdx >= 0) {
          vault.allergies[existingIdx] = newConstraint;
        } else {
          vault.allergies.push(newConstraint);
        }

        vault.updatedAt = new Date().toISOString();
        saveUserPassportVault(vault, storage);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `[Egoist MCP Hub] Vault updated: Added constraint '${label}' (${allergenId}) to Egoist AI Passport.`,
            },
          ],
          structuredData: { vault, addedConstraint: newConstraint },
        };
      }

      case "egoist_passport_read_vault": {
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `[Egoist MCP Hub] Active Passport Claims (${vault.allergies.length}): ${vault.allergies.map((a) => a.label).join(", ")}`,
            },
          ],
          structuredData: { vault },
        };
      }

      case "egoist_passport_sync_memories":
      case "egoist_passport_parse_natural_language": {
        const parsed = parseMemoryInputsToConstraints(args);
        const updatedVault = replaceEgoistAllergies(vault, parsed);
        saveUserPassportVault(updatedVault, storage);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `[Egoist MCP Hub] Synced ${parsed.length} constraint(s) to Egoist AI Passport (full replace).`,
            },
          ],
          structuredData: { vault: updatedVault, parsedConstraints: parsed },
        };
      }

      default:
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `[Egoist MCP Hub Error] Unknown MCP tool name: '${toolName}'.`,
            },
          ],
        };
    }
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `[Egoist MCP Hub Exception] ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
