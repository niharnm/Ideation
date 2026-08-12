import type { HandshakeDataScope } from "./handshake-event.ts";
import type { ScopeField } from "./handshake-event.ts";
import type {
  ValidationIssue,
  ValidationResult,
} from "./validate-handshake-event.ts";

export const CLAIM_CONSENT_CHOICES = ["approve", "deny"] as const;
export const MAX_CLAIM_DURATION_MS = 24 * 60 * 60 * 1_000;

export type ClaimConsentChoice = (typeof CLAIM_CONSENT_CHOICES)[number];

export interface ClaimScopeField {
  id: string;
  label: string;
  selected: boolean;
}

export interface ClaimComposerDraft {
  purpose: string;
  fields: readonly ClaimScopeField[];
  validFrom: string;
  validUntil: string;
  choice: ClaimConsentChoice | null;
}

export interface ComposedClaim {
  dataScope: HandshakeDataScope;
  choice: ClaimConsentChoice;
}

export const CLAIM_COMPOSER_COPY = {
  purposeLabel: "Why are these fields being shared?",
  scopeLabel: "Choose the exact fields to share",
  durationLabel: "Choose an end time, up to 24 hours from the start",
  approveAction:
    "Approve selected fields. Access ends at the stated time.",
  denyAction: "Deny and share nothing",
} as const;

export const CLAIM_COMPOSER_COPY_CHECKLIST = [
  { id: "purpose", copy: CLAIM_COMPOSER_COPY.purposeLabel },
  { id: "scope", copy: CLAIM_COMPOSER_COPY.scopeLabel },
  { id: "duration", copy: CLAIM_COMPOSER_COPY.durationLabel },
  { id: "approve", copy: CLAIM_COMPOSER_COPY.approveAction },
  { id: "deny", copy: CLAIM_COMPOSER_COPY.denyAction },
] as const;

export function minimizeClaimScope(
  draft: ClaimComposerDraft,
  retainedFieldIds: readonly string[],
): ClaimComposerDraft {
  const retained = new Set(retainedFieldIds);

  return {
    ...draft,
    fields: draft.fields.map((field) => ({
      ...field,
      selected: field.selected && retained.has(field.id),
    })),
  };
}

type JsonRecord = Record<string, unknown>;

const BROAD_PROFILE_FIELD_IDS = new Set([
  "*",
  "all",
  "profile",
  "profile.*",
  "user",
  "user.*",
  "user.profile",
  "user.profile.*",
  "user_profile",
]);
const RFC_3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateClaimDraft(
  input: unknown,
): ValidationResult<ComposedClaim> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return { success: false, issues: [{ path: "$", message: "must be an object" }] };
  }

  exactKeys(
    input,
    ["purpose", "fields", "validFrom", "validUntil", "choice"],
    "$",
    issues,
  );
  nonEmptyString(input.purpose, "$.purpose", issues);

  const selectedFields = validateFields(input.fields, issues);
  const validFrom = validateTimestamp(input.validFrom, "$.validFrom", issues);
  const validUntil = validateTimestamp(input.validUntil, "$.validUntil", issues);

  if (validFrom !== undefined && validUntil !== undefined) {
    const duration = validUntil - validFrom;
    if (duration <= 0) {
      add(issues, "$.validUntil", "must be after validFrom");
    } else if (duration > MAX_CLAIM_DURATION_MS) {
      add(issues, "$.validUntil", "must be no more than 24 hours after validFrom");
    }
  }

  if (!isOneOf(input.choice, CLAIM_CONSENT_CHOICES)) {
    add(issues, "$.choice", "must be an explicit approve or deny choice");
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    value: {
      dataScope: {
        purpose: input.purpose as string,
        fields: selectedFields,
        validFrom: input.validFrom as string,
        validUntil: input.validUntil as string,
      },
      choice: input.choice as ClaimConsentChoice,
    },
  };
}

export const composeClaim = validateClaimDraft;

function validateFields(
  value: unknown,
  issues: ValidationIssue[],
): readonly ScopeField[] {
  if (!Array.isArray(value) || value.length === 0) {
    add(issues, "$.fields", "must contain at least one field option");
    return [];
  }

  const selected: ScopeField[] = [];
  const seenIds = new Set<string>();

  value.forEach((field, index) => {
    const path = `$.fields[${index}]`;
    if (!isRecord(field)) {
      add(issues, path, "must be an object");
      return;
    }

    exactKeys(field, ["id", "label", "selected"], path, issues);
    nonEmptyString(field.id, `${path}.id`, issues);
    nonEmptyString(field.label, `${path}.label`, issues);
    if (typeof field.selected !== "boolean") {
      add(issues, `${path}.selected`, "must be a boolean");
    }

    if (typeof field.id === "string") {
      const normalizedId = field.id.trim().toLowerCase();
      if (BROAD_PROFILE_FIELD_IDS.has(normalizedId)) {
        add(issues, `${path}.id`, "must identify one claim field, not a broad profile");
      }
      if (seenIds.has(field.id)) {
        add(issues, `${path}.id`, "must be unique within the scope selector");
      }
      seenIds.add(field.id);
    }

    if (
      field.selected === true &&
      typeof field.id === "string" &&
      typeof field.label === "string"
    ) {
      selected.push({ id: field.id, label: field.label });
    }
  });

  if (selected.length === 0) {
    add(issues, "$.fields", "must select at least one exact field");
  }

  return selected;
}

function validateTimestamp(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (
    typeof value !== "string" ||
    !RFC_3339.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    add(issues, path, "must be an RFC 3339 timestamp with a timezone");
    return undefined;
  }

  return Date.parse(value);
}

function nonEmptyString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    add(issues, path, "must be a non-empty string");
  }
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      add(issues, `${path}.${key}`, "is not allowed");
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) {
      add(issues, `${path}.${key}`, "is required");
    }
  }
}

function isOneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): value is Value {
  return typeof value === "string" && allowed.includes(value as Value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}
