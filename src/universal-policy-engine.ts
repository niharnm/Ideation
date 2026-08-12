import type { PolicyDecisionResponse } from "./decision-policy.ts";
import {
  getAllergenMetadata,
  normalizeAllergenUri,
  type AllergenMetadata,
  type AllergenSeverity,
  type DishIngredientProfile,
} from "./universal-taxonomy.ts";

export interface RequestedAllergyInput {
  id: string;
  label?: string;
  requireDedicatedSurface?: boolean;
  strictCrossContamination?: boolean;
  severity?: AllergenSeverity;
}

export interface KitchenCapabilities {
  dedicatedPrepSurface?: boolean;
  dedicatedPrepSurfaces?: Record<string, boolean>;
  canProvideDedicatedSurface?: boolean;
  requiresDedicatedSurfaceSetup?: boolean;
}

export interface AllergenEvaluationDetail {
  allergenUri: string;
  allergenName: string;
  status: PolicyDecisionResponse;
  detail: string;
  substitutionUsed?: string;
  severity: AllergenSeverity;
}

export interface SeverityBadge {
  allergenUri: string;
  allergenName: string;
  severity: AllergenSeverity;
  badgeLabel: string;
}

export interface UniversalPolicyEvaluationResult {
  dishId: string;
  dishName: string;
  response: PolicyDecisionResponse;
  isSafe: boolean;
  rationale: string;
  matchedAllergens: AllergenMetadata[];
  unverifiedIngredients: string[];
  requiredChanges: string[];
  severityBadges: SeverityBadge[];
  evaluatedAllergens: AllergenEvaluationDetail[];
}

export function evaluateUniversalAllergyPolicy(
  dish: DishIngredientProfile,
  requestedAllergies: (string | RequestedAllergyInput)[],
  kitchenCapabilities?: KitchenCapabilities,
): UniversalPolicyEvaluationResult {
  if (!dish) {
    return {
      dishId: "unknown",
      dishName: "Unknown Dish",
      response: "cannot_determine",
      isSafe: false,
      rationale: "No dish profile provided for universal allergy policy evaluation.",
      matchedAllergens: [],
      unverifiedIngredients: [],
      requiredChanges: [],
      severityBadges: [],
      evaluatedAllergens: [],
    };
  }

  // 1. Normalize requested allergies
  const normalizedRequests: Array<{
    rawInput: string | RequestedAllergyInput;
    uri: string;
    metadata: AllergenMetadata;
    label: string;
    strictCrossContamination: boolean;
    severity: AllergenSeverity;
  }> = (requestedAllergies || []).map((req) => {
    const rawId = typeof req === "string" ? req : req.id;
    const uri = normalizeAllergenUri(rawId);
    const metadata = getAllergenMetadata(uri);
    const label =
      typeof req === "string"
        ? metadata.name || uri
        : req.label || metadata.name;
    const strictCrossContamination =
      typeof req === "object"
        ? Boolean(req.requireDedicatedSurface || req.strictCrossContamination)
        : false;
    const severity =
      typeof req === "object" && req.severity
        ? req.severity
        : metadata.severityDefault;
    return {
      rawInput: req,
      uri,
      metadata,
      label,
      strictCrossContamination,
      severity,
    };
  });

  // 2. Check for unverified ingredient suppliers (FAIL-CLOSED)
  const unverifiedIngredients: string[] = [];
  if (dish.hasUnverifiedSuppliers) {
    unverifiedIngredients.push("Uncertified supplier ingredients in dish");
  }
  for (const ing of dish.ingredients || []) {
    if (ing.isVerifiedSupplier === false) {
      if (!unverifiedIngredients.includes(ing.name)) {
        unverifiedIngredients.push(ing.name);
      }
    }
  }

  if (unverifiedIngredients.length > 0) {
    const severityBadges: SeverityBadge[] = normalizedRequests.map((r) => ({
      allergenUri: r.uri,
      allergenName: r.metadata.name,
      severity: r.severity,
      badgeLabel: `[${r.severity.toUpperCase()}] ${r.metadata.name}`,
    }));

    return {
      dishId: dish.id,
      dishName: dish.name,
      response: "cannot_determine",
      isSafe: false,
      rationale: `Unverified ingredient supplier(s) in '${dish.name}': ${unverifiedIngredients.join(", ")}. Policy fails closed with cannot_determine safety.`,
      matchedAllergens: [],
      unverifiedIngredients,
      requiredChanges: [],
      severityBadges,
      evaluatedAllergens: normalizedRequests.map((r) => ({
        allergenUri: r.uri,
        allergenName: r.metadata.name,
        status: "cannot_determine",
        detail: `Unverified supplier for ingredient(s) in ${dish.name}`,
        severity: r.severity,
      })),
    };
  }

  // 3. Build dish allergen URIs set
  const dishAllergenSet = new Set<string>();
  if (Array.isArray(dish.allergens)) {
    for (const a of dish.allergens) {
      dishAllergenSet.add(normalizeAllergenUri(a));
    }
  }
  for (const ing of dish.ingredients || []) {
    if (Array.isArray(ing.allergens)) {
      for (const a of ing.allergens) {
        dishAllergenSet.add(normalizeAllergenUri(a));
      }
    }
  }

  // 4. Set-intersection matching and substitution / cross-contamination evaluation
  const matchedAllergens: AllergenMetadata[] = [];
  const requiredChanges: string[] = [];
  const evaluatedAllergens: AllergenEvaluationDetail[] = [];
  const severityBadges: SeverityBadge[] = [];

  let hasDecline = false;
  let hasRequiredChange = false;
  const declineReasons: string[] = [];

  for (const req of normalizedRequests) {
    severityBadges.push({
      allergenUri: req.uri,
      allergenName: req.metadata.name,
      severity: req.severity,
      badgeLabel: `[${req.severity.toUpperCase()}] ${req.metadata.name}`,
    });

    const isMatch = dishAllergenSet.has(req.uri);

    if (isMatch) {
      if (!matchedAllergens.some((m) => m.uri === req.uri)) {
        matchedAllergens.push(req.metadata);
      }

      // Check safe substitution options
      const sub = (dish.substitutions || []).find((s) =>
        (s.removesAllergens || []).map(normalizeAllergenUri).includes(req.uri),
      );

      if (sub) {
        const changeMsg = `Substitute ${sub.originalIngredientName || "ingredient"} with ${sub.replacementIngredientName} to eliminate ${req.metadata.name}`;
        if (!requiredChanges.includes(changeMsg)) {
          requiredChanges.push(changeMsg);
        }
        hasRequiredChange = true;
        evaluatedAllergens.push({
          allergenUri: req.uri,
          allergenName: req.metadata.name,
          status: "required_change",
          detail: changeMsg,
          substitutionUsed: sub.replacementIngredientName,
          severity: req.severity,
        });
      } else {
        hasDecline = true;
        const msg = `Dish '${dish.name}' contains ${req.metadata.name} which cannot be safely substituted.`;
        declineReasons.push(msg);
        evaluatedAllergens.push({
          allergenUri: req.uri,
          allergenName: req.metadata.name,
          status: "decline",
          detail: msg,
          severity: req.severity,
        });
      }
    } else {
      // Dish does not directly contain the allergen.
      // Evaluate strict cross-contamination requirement if requested.
      if (req.strictCrossContamination) {
        const dedicatedSurfaceOk =
          kitchenCapabilities?.dedicatedPrepSurface === true ||
          kitchenCapabilities?.dedicatedPrepSurfaces?.[req.uri] === true ||
          dish.dedicatedPrepSurfaceAvailable === true;

        if (dedicatedSurfaceOk) {
          evaluatedAllergens.push({
            allergenUri: req.uri,
            allergenName: req.metadata.name,
            status: "accept",
            detail: `Kitchen dedicated prep surface confirmed for ${req.metadata.name} isolation.`,
            severity: req.severity,
          });
        } else if (kitchenCapabilities?.dedicatedPrepSurface === false) {
          hasDecline = true;
          const msg = `Kitchen lacks dedicated prep surface required for cross-contamination isolation of ${req.metadata.name}.`;
          declineReasons.push(msg);
          evaluatedAllergens.push({
            allergenUri: req.uri,
            allergenName: req.metadata.name,
            status: "decline",
            detail: msg,
            severity: req.severity,
          });
        } else {
          const changeMsg = `Kitchen must sanitize and use dedicated prep surface for ${req.metadata.name} cross-contamination isolation.`;
          if (!requiredChanges.includes(changeMsg)) {
            requiredChanges.push(changeMsg);
          }
          hasRequiredChange = true;
          evaluatedAllergens.push({
            allergenUri: req.uri,
            allergenName: req.metadata.name,
            status: "required_change",
            detail: changeMsg,
            severity: req.severity,
          });
        }
      } else {
        evaluatedAllergens.push({
          allergenUri: req.uri,
          allergenName: req.metadata.name,
          status: "accept",
          detail: `Dish '${dish.name}' is free of ${req.metadata.name}.`,
          severity: req.severity,
        });
      }
    }
  }

  // Determine final policy response and rationale
  let finalResponse: PolicyDecisionResponse = "accept";
  let rationale = `All requested allergen constraints satisfied safely for dish '${dish.name}'.`;

  if (hasDecline) {
    finalResponse = "decline";
    rationale = `Policy decline for dish '${dish.name}': ${declineReasons.join("; ")}`;
  } else if (hasRequiredChange) {
    finalResponse = "required_change";
    rationale = `Policy requires changes for dish '${dish.name}': ${requiredChanges.join("; ")}`;
  }

  const isSafe = finalResponse === "accept";

  return {
    dishId: dish.id,
    dishName: dish.name,
    response: finalResponse,
    isSafe,
    rationale,
    matchedAllergens,
    unverifiedIngredients,
    requiredChanges,
    severityBadges,
    evaluatedAllergens,
  };
}
