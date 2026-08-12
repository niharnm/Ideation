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

function hasKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`\\b${escaped}s?\\b`, "i").test(text);
}

function clauseForKeyword(text: string, keyword: string): string {
  const parts = text.split(/\band\b|,|;|\./i);
  return parts.find((part) => hasKeyword(part, keyword))?.trim() || text;
}

function classifyConstraint(clause: string): {
  severity: string;
  crossContaminationTolerance: boolean;
} {
  const lower = clause.toLowerCase();
  const allergyLanguage =
    /\b(allerg|anaphylac|cannot|can'?t\s+(eat|drink)|intoleran|severe|strict|dedicated)/i.test(
      lower,
    );
  const preferenceLanguage =
    /\b(don'?t like|do not like|does not like|dislike|prefer not|not a fan)\b/i.test(lower);
  if (preferenceLanguage && !allergyLanguage) {
    return { severity: "mild", crossContaminationTolerance: true };
  }
  if (/\b(anaphylac|severe)/i.test(lower)) {
    return { severity: "anaphylactic", crossContaminationTolerance: false };
  }
  return { severity: "severe", crossContaminationTolerance: false };
}

export function normalizeCrossContaminationTolerance(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "shared_facility_ok" || lower === "true") return true;
    if (lower === "strict_isolation" || lower === "false") return false;
  }
  return false;
}

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

  const hasPeanutExplicit = hasKeyword(lower, "peanut");
  const hasTreeNutExplicit = hasKeyword(lower, "tree nut");
  if (/\bnuts?\b/i.test(lower) && !hasPeanutExplicit && !hasTreeNutExplicit) {
    const classified = classifyConstraint(clauseForKeyword(text, "nut"));
    for (const allergenId of ["allergen.peanut", "allergen.tree_nut"] as const) {
      const meta = getAllergenMetadata(allergenId);
      constraints.push({
        allergenId,
        label: meta ? meta.name : allergenId,
        severity: classified.severity,
        crossContaminationTolerance: classified.crossContaminationTolerance,
      });
      seen.add(allergenId);
    }
  }

  for (const item of allergenKeywords) {
    if (hasKeyword(lower, item.keyword) && !seen.has(item.allergenId)) {
      seen.add(item.allergenId);
      const classified = classifyConstraint(clauseForKeyword(text, item.keyword));
      const meta = getAllergenMetadata(item.allergenId);
      constraints.push({
        allergenId: item.allergenId,
        label: meta ? meta.name : item.defaultLabel,
        severity: classified.severity,
        crossContaminationTolerance: classified.crossContaminationTolerance,
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
          crossContaminationTolerance: normalizeCrossContaminationTolerance(
            args.crossContaminationTolerance ?? "strict_isolation",
          ),
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
