export interface AllergyConstraint {
  allergenId: string;
  label: string;
  severity: "severe" | "moderate" | "mild" | string;
  crossContaminationTolerance: boolean;
}

export interface UserPassportVault {
  claimantId: string;
  allergies: AllergyConstraint[];
  updatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LOCAL_PASSPORT_VAULT_STORAGE_KEY = "handshake.local_passport_vault.v1";

export const DEFAULT_VAULT_ALLERGIES: AllergyConstraint[] = [
  {
    allergenId: "order.constraint.peanut",
    label: "Peanut constraint",
    severity: "severe",
    crossContaminationTolerance: false,
  },
  {
    allergenId: "order.constraint.dairy",
    label: "Dairy constraint",
    severity: "moderate",
    crossContaminationTolerance: false,
  },
  {
    allergenId: "order.preference.vegetarian",
    label: "Vegetarian preference",
    severity: "mild",
    crossContaminationTolerance: true,
  },
];

export function loadUserPassportVault(storage: StorageLike | Storage): UserPassportVault {
  try {
    const raw =
      storage.getItem(LOCAL_PASSPORT_VAULT_STORAGE_KEY) ??
      storage.getItem("user_passport_vault");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.claimantId === "string" &&
        Array.isArray(parsed.allergies) &&
        typeof parsed.updatedAt === "string"
      ) {
        const validAllergies: AllergyConstraint[] = parsed.allergies
          .filter(
            (a: any) =>
              a &&
              typeof a === "object" &&
              typeof a.allergenId === "string" &&
              typeof a.label === "string"
          )
          .map((a: any) => ({
            allergenId: a.allergenId,
            label: a.label,
            severity: typeof a.severity === "string" ? a.severity : "moderate",
            crossContaminationTolerance:
              typeof a.crossContaminationTolerance === "boolean"
                ? a.crossContaminationTolerance
                : Boolean(a.crossContaminationTolerance),
          }));

        return {
          claimantId: parsed.claimantId,
          allergies: validAllergies,
          updatedAt: parsed.updatedAt,
        };
      }
    }
  } catch (_err) {
    // Fallback on storage reading or parsing error
  }

  const defaultVault: UserPassportVault = {
    claimantId: "claimant-1",
    allergies: [...DEFAULT_VAULT_ALLERGIES],
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(
      LOCAL_PASSPORT_VAULT_STORAGE_KEY,
      JSON.stringify(defaultVault)
    );
  } catch (_err) {
    // Ignore error
  }

  return defaultVault;
}

export function saveUserPassportVault(
  vault: UserPassportVault,
  storage: StorageLike | Storage
): void {
  const updatedVault: UserPassportVault = {
    ...vault,
    updatedAt: new Date().toISOString(),
  };
  storage.setItem(
    LOCAL_PASSPORT_VAULT_STORAGE_KEY,
    JSON.stringify(updatedVault)
  );
}

export function addCustomAllergyToVault(
  vault: UserPassportVault,
  allergy: AllergyConstraint
): UserPassportVault {
  const allergenId =
    allergy.allergenId ||
    `order.constraint.${allergy.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

  const normalizedAllergy: AllergyConstraint = {
    allergenId,
    label: allergy.label,
    severity: allergy.severity || "moderate",
    crossContaminationTolerance: Boolean(allergy.crossContaminationTolerance),
  };

  const existingIndex = vault.allergies.findIndex(
    (a) => a.allergenId === allergenId
  );

  let newAllergies: AllergyConstraint[];
  if (existingIndex >= 0) {
    newAllergies = [...vault.allergies];
    newAllergies[existingIndex] = normalizedAllergy;
  } else {
    newAllergies = [...vault.allergies, normalizedAllergy];
  }

  return {
    ...vault,
    allergies: newAllergies,
    updatedAt: new Date().toISOString(),
  };
}

export function removeVaultAllergy(
  vault: UserPassportVault,
  allergenId: string
): UserPassportVault {
  const newAllergies = vault.allergies.filter(
    (a) => a.allergenId !== allergenId
  );

  return {
    ...vault,
    allergies: newAllergies,
    updatedAt: new Date().toISOString(),
  };
}
