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
    name: "egoist_passport_parse_natural_language",
    description: "Parses natural language conversation text into structured Egoist Passport Vault constraints.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Natural language input (e.g., 'I am severely allergic to peanuts and lactose intolerant')" },
      },
      required: ["text"],
    },
  },
];

export function parseNaturalLanguageToConstraints(text: string): AllergyConstraint[] {
  const lower = text.toLowerCase();
  const constraints: AllergyConstraint[] = [];

  const allergenKeywords: Array<{ keyword: string; allergenId: string; defaultLabel: string }> = [
    { keyword: "peanut", allergenId: "allergen.peanut", defaultLabel: "Peanut constraint" },
    { keyword: "tree nut", allergenId: "allergen.tree_nut", defaultLabel: "Tree nut constraint" },
    { keyword: "walnut", allergenId: "allergen.tree_nut", defaultLabel: "Tree nut constraint" },
    { keyword: "almond", allergenId: "allergen.tree_nut", defaultLabel: "Tree nut constraint" },
    { keyword: "dairy", allergenId: "allergen.dairy", defaultLabel: "Dairy / Lactose constraint" },
    { keyword: "lactose", allergenId: "allergen.dairy", defaultLabel: "Dairy / Lactose constraint" },
    { keyword: "milk", allergenId: "allergen.dairy", defaultLabel: "Dairy / Lactose constraint" },
    { keyword: "gluten", allergenId: "allergen.gluten", defaultLabel: "Wheat / Gluten constraint" },
    { keyword: "wheat", allergenId: "allergen.gluten", defaultLabel: "Wheat / Gluten constraint" },
    { keyword: "egg", allergenId: "allergen.egg", defaultLabel: "Egg constraint" },
    { keyword: "soy", allergenId: "allergen.soy", defaultLabel: "Soy constraint" },
    { keyword: "fish", allergenId: "allergen.fish", defaultLabel: "Fish constraint" },
    { keyword: "shellfish", allergenId: "allergen.shellfish", defaultLabel: "Shellfish constraint" },
    { keyword: "shrimp", allergenId: "allergen.shellfish", defaultLabel: "Shellfish constraint" },
    { keyword: "sesame", allergenId: "allergen.sesame", defaultLabel: "Sesame constraint" },
    { keyword: "alpha-gal", allergenId: "allergen.alpha_gal", defaultLabel: "Alpha-gal (Red Meat) constraint" },
    { keyword: "sulfite", allergenId: "allergen.sulfite", defaultLabel: "Sulfite constraint" },
  ];

  for (const item of allergenKeywords) {
    if (lower.includes(item.keyword)) {
      const isAnaphylactic = lower.includes("anaphylac") || lower.includes("severe");
      const isStrict = lower.includes("strict") || lower.includes("dedicated") || isAnaphylactic;
      const meta = getAllergenMetadata(item.allergenId);

      constraints.push({
        allergenId: item.allergenId,
        label: meta ? meta.name : item.defaultLabel,
        severity: isAnaphylactic ? "anaphylactic" : "severe",
        crossContaminationTolerance: isStrict ? "strict_isolation" : "shared_facility_ok",
      });
    }
  }

  return constraints;
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

      case "egoist_passport_parse_natural_language": {
        const text = String(args.text || "");
        const parsed = parseNaturalLanguageToConstraints(text);

        for (const constraint of parsed) {
          const existingIdx = vault.allergies.findIndex((a) => a.allergenId === constraint.allergenId);
          if (existingIdx >= 0) {
            vault.allergies[existingIdx] = constraint;
          } else {
            vault.allergies.push(constraint);
          }
        }

        vault.updatedAt = new Date().toISOString();
        saveUserPassportVault(vault, storage);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `[Egoist MCP Hub] Natural language parsed successfully: Synced ${parsed.length} constraint(s) to Egoist AI Passport.`,
            },
          ],
          structuredData: { vault, parsedConstraints: parsed },
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
