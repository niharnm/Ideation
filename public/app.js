import {
  approveScopedRequest,
  denyScopedRequest,
  expireScopedClaimIfNeeded,
  revokeScopedClaim,
} from "/src/passport-flow.ts";
import {
  previewClaimantReceipt,
  previewDemoLinkedEvents,
} from "/src/claimant-receipt.ts";
import {
  addCustomAllergyToVault,
  LOCAL_PASSPORT_VAULT_STORAGE_KEY,
  loadUserPassportVault,
  removeVaultAllergy,
  saveUserPassportVault,
} from "/src/passport-vault.ts";
import {
  CREDENTIAL_BACKED_FIELD_ID,
  DEMO_DIETARY_CREDENTIAL,
  isCredentialBackedField,
} from "/src/identity-proof.ts";

const recipient = { id: "recipient-1", displayName: "Fieldline" };
const purpose = "Prepare one restaurant order from the constraint you choose.";
const summary = "Use the selected scoped field for one restaurant order.";
const defaultFieldOptions = [
  { id: CREDENTIAL_BACKED_FIELD_ID, label: DEMO_DIETARY_CREDENTIAL.label, selected: true },
];
const LOCAL_DEMO_LINKED_EVENTS_STORAGE_KEY = "handshake:demo-linked-events:v1";
const HANDSHAKE_STORAGE_KEY = "egoist.demo.handshake-id";

const requestView = document.querySelector("#request-view");
const outcomeView = document.querySelector("#outcome-view");
const fieldsView = document.querySelector("#fields");
const expiryInput = document.querySelector("#expiry");
const endTimeView = document.querySelector("#end-time");
const approveButton = document.querySelector("#approve");
const denyButton = document.querySelector("#deny");
const errorView = document.querySelector("#error");
const scopeCountView = document.querySelector("#scope-count");
const signalEndTimeView = document.querySelector("#signal-end-time");
const passportCardTitle = document.querySelector("#passport-card-title");
const passportCardDetail = document.querySelector("#passport-card-detail");
const passportCardExpiry = document.querySelector("#passport-card-expiry");
const pollStatusView = document.querySelector("#poll-status");
const chatHintView = document.querySelector("#chat-hint");
const correctionButton = document.querySelector("#show-correction");
const correctionView = document.querySelector("#correction-copy");

const addAllergyModal = document.querySelector("#add-allergy-modal");
const openAddAllergyBtn = document.querySelector("#open-add-allergy-btn");
const closeAddAllergyBtn = document.querySelector("#close-add-allergy-btn");
const cancelAddAllergyBtn = document.querySelector("#cancel-add-allergy");
const addAllergyForm = document.querySelector("#add-allergy-form");
const allergyLabelInput = document.querySelector("#allergy-label");
const allergySeveritySelect = document.querySelector("#allergy-severity");
const allergyCrossContamCheck = document.querySelector("#allergy-cross-contam");
const shareNewAllergyCheck = document.querySelector("#share-new-allergy");
const allergyFormError = document.querySelector("#allergy-form-error");

let validFrom = new Date();
let expiryTimer;
const selectedFieldIds = new Set(
  defaultFieldOptions.filter((field) => field.selected).map((field) => field.id),
);

const dependencies = {
  storage: window.localStorage,
  emit(event) {
    window.dispatchEvent(
      new CustomEvent("handshake:event", { detail: event }),
    );
  },
};

let userVault = loadUserPassportVault(dependencies.storage);

function constraintFamily(allergenId) {
  return String(allergenId)
    .replace(/^allergen\./, "")
    .replace(/^order\.constraint\./, "")
    .replace(/^order\.preference\./, "")
    .replace(/-/g, "_");
}

const SEED_FIELD_IDS = new Set(
  defaultFieldOptions.map((field) => field.id),
);

function allergiesForShare(allergies) {
  return allergies;
}

let seenEgoistIds = new Set();
const deselectedFieldIds = new Set();

async function demoApi(body) {
  const response = await fetch("/api/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? "The passport API could not complete this action.");
  return data;
}

function apiConstraintId(allergenId) {
  return allergenId.startsWith("allergen.")
    ? `order.constraint.${constraintFamily(allergenId)}`
    : allergenId;
}

function apiConstraints(vault) {
  const constraints = new Map();
  for (const allergy of vault.allergies) {
    const id = apiConstraintId(allergy.allergenId);
    constraints.set(id, {
      id,
      label: allergy.label,
      severity: ["severe", "moderate", "mild"].includes(allergy.severity)
        ? allergy.severity
        : "severe",
      crossContaminationTolerance: allergy.crossContaminationTolerance,
    });
  }
  return [...constraints.values()];
}

async function savePassport(vault) {
  return demoApi({ action: "passport-update", constraints: apiConstraints(vault) });
}

async function loadPassport() {
  try {
    const browserVault = loadUserPassportVault(dependencies.storage);
    const browserEgoist = browserVault.allergies.filter((allergy) =>
      allergy.allergenId.startsWith("allergen."),
    );
    const { passport } = await demoApi({ action: "passport-status" });
    const apiVault = {
      claimantId: passport.claimantId,
      allergies: passport.constraints.map((constraint) => ({
        allergenId: constraint.id,
        label: constraint.label,
        severity: constraint.severity,
        crossContaminationTolerance: constraint.crossContaminationTolerance,
      })),
      updatedAt: passport.updatedAt,
    };
    userVault = browserEgoist.length > 0
      ? {
          ...apiVault,
          allergies: [...apiVault.allergies, ...browserEgoist],
          updatedAt: browserVault.updatedAt,
        }
      : apiVault;
    if (browserEgoist.length > 0) await savePassport(userVault);
    saveUserPassportVault(userVault, dependencies.storage);
    if (browserEgoist.length > 0) {
      for (const selected of [...selectedFieldIds]) {
        if (!selected.startsWith("allergen.")) selectedFieldIds.delete(selected);
      }
      for (const allergy of browserEgoist) selectedFieldIds.add(allergy.allergenId);
    }
    for (const selected of [...selectedFieldIds]) {
      if (!userVault.allergies.some((allergy) => allergy.allergenId === selected)) selectedFieldIds.delete(selected);
    }
    if (selectedFieldIds.size === 0 && userVault.allergies[0]) selectedFieldIds.add(userVault.allergies[0].allergenId);
    renderVaultFields();
  } catch (error) {
    errorView.textContent = error instanceof Error ? error.message : "The passport could not be loaded.";
    errorView.hidden = false;
  }
}

function renderVaultFields() {
  fieldsView.replaceChildren();
  const visible = allergiesForShare(userVault.allergies);

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "mcp-status";
    empty.textContent = "No constraints yet. Mention an allergy in NimGTP, or add a custom constraint.";
    fieldsView.append(empty);
    renderScopeSummary();
    return;
  }

  for (const allergy of visible) {
    const labelEl = document.createElement("label");
    labelEl.className = "field";
    const isNewEgoist =
      allergy.allergenId.startsWith("allergen.") &&
      !seenEgoistIds.has(allergy.allergenId);
    if (isNewEgoist) {
      labelEl.classList.add("is-new");
    }

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "field-checkbox";
    input.value = allergy.allergenId;
    const credentialBacked = isCredentialBackedField(allergy.allergenId);
    input.checked = credentialBacked && selectedFieldIds.has(allergy.allergenId);
    input.disabled = !credentialBacked;
    input.dataset.label = allergy.label;
    input.addEventListener("change", () => {
      if (input.checked) {
        selectedFieldIds.add(allergy.allergenId);
        deselectedFieldIds.delete(allergy.allergenId);
      } else {
        selectedFieldIds.delete(allergy.allergenId);
        deselectedFieldIds.add(allergy.allergenId);
      }
      renderScopeSummary();
    });

    const textSpan = document.createElement("span");
    textSpan.textContent = allergy.label;

    const badgeGroup = document.createElement("div");
    badgeGroup.className = "badge-group";

    if (credentialBacked) {
      const sourceBadge = document.createElement("span");
      sourceBadge.className = "badge";
      sourceBadge.textContent = "Credential backed";
      badgeGroup.append(sourceBadge);
    } else {
      const sourceBadge = document.createElement("span");
      sourceBadge.className = "badge";
      sourceBadge.textContent = "Self-reported, not proof eligible";
      badgeGroup.append(sourceBadge);
    }

    const severityBadge = document.createElement("span");
    severityBadge.className = `badge ${allergy.severity}`;
    severityBadge.textContent = allergy.severity;
    badgeGroup.append(severityBadge);

    if (allergy.crossContaminationTolerance === false) {
      const ccBadge = document.createElement("span");
      ccBadge.className = "badge cross-contam";
      ccBadge.textContent = "Zero cross-contam";
      badgeGroup.append(ccBadge);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-allergy-btn";
    removeBtn.textContent = "×";
    removeBtn.title = `Remove ${allergy.label} from vault`;
    removeBtn.setAttribute("aria-label", `Remove ${allergy.label}`);
    if (credentialBacked) {
      removeBtn.hidden = true;
    }
    removeBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nextVault = removeVaultAllergy(userVault, allergy.allergenId);
      try {
        await savePassport(nextVault);
        if (allergy.allergenId.startsWith("allergen.")) {
          const response = await fetch("/api/passport/vault", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ removeAllergenId: allergy.allergenId }),
          });
          if (!response.ok) throw new Error("The chat memory was not removed.");
        }
        userVault = nextVault;
        selectedFieldIds.delete(allergy.allergenId);
        deselectedFieldIds.add(allergy.allergenId);
        saveUserPassportVault(userVault, dependencies.storage);
        renderVaultFields();
      } catch (error) {
        errorView.textContent = error instanceof Error ? error.message : "The passport was not updated.";
        errorView.hidden = false;
      }
    });

    labelEl.append(input, textSpan, badgeGroup, removeBtn);
    fieldsView.append(labelEl);
    if (allergy.allergenId.startsWith("allergen.")) {
      seenEgoistIds.add(allergy.allergenId);
    }
  }

  renderScopeSummary();
}

renderVaultFields();
const passportReady = loadPassport();

function closeModal() {
  if (addAllergyModal) {
    addAllergyModal.hidden = true;
    addAllergyForm.reset();
    allergyFormError.hidden = true;
    allergyFormError.textContent = "";
    openAddAllergyBtn.focus();
  }
}

if (openAddAllergyBtn && addAllergyModal) {
  openAddAllergyBtn.addEventListener("click", () => {
    addAllergyModal.hidden = false;
    allergyFormError.hidden = true;
    allergyFormError.textContent = "";
    if (allergyLabelInput) allergyLabelInput.focus();
  });
}

if (correctionButton && correctionView) {
  correctionButton.addEventListener("click", () => {
    correctionView.hidden = !correctionView.hidden;
    correctionButton.textContent = correctionView.hidden
      ? "How do I correct this?"
      : "Hide correction path";
  });
}

if (closeAddAllergyBtn) closeAddAllergyBtn.addEventListener("click", closeModal);
if (cancelAddAllergyBtn) cancelAddAllergyBtn.addEventListener("click", closeModal);

document.addEventListener("keydown", (event) => {
  if (addAllergyModal.hidden) return;
  if (event.key === "Escape") {
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...addAllergyModal.querySelectorAll("button, input, select, textarea")].filter(
    (node) => !node.disabled && node.offsetParent !== null,
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
  if (!addAllergyModal.hidden || requestView.hidden || approveButton.disabled) return;
  event.preventDefault();
  approveButton.click();
});

addAllergyModal.addEventListener("click", (event) => {
  if (event.target === addAllergyModal) {
    closeModal();
  }
});

if (addAllergyForm) {
  addAllergyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = allergyLabelInput.value.trim();
    if (!label) return;

    const severity = allergySeveritySelect.value;
    const zeroCrossContamRequired = allergyCrossContamCheck.checked;
    const crossContaminationTolerance = !zeroCrossContamRequired;

    const newConstraint = {
      allergenId: `order.constraint.${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      label,
      severity,
      crossContaminationTolerance,
    };

    if (userVault.allergies.some((allergy) => allergy.allergenId === newConstraint.allergenId)) {
      allergyFormError.textContent = "That constraint is already in your passport.";
      allergyFormError.hidden = false;
      return;
    }

    const nextVault = addCustomAllergyToVault(userVault, newConstraint);
    try {
      await savePassport(nextVault);
      userVault = nextVault;
      if (shareNewAllergyCheck.checked) selectedFieldIds.add(newConstraint.allergenId);
      saveUserPassportVault(userVault, dependencies.storage);
      renderVaultFields();
      closeModal();
    } catch (error) {
      allergyFormError.textContent = error instanceof Error ? error.message : "The passport was not updated.";
      allergyFormError.hidden = false;
    }
  });
}

function draft(choice = null) {
  const validUntil = expiryInput.value ? new Date(expiryInput.value) : null;
  return {
    purpose,
    fields: [...fieldsView.querySelectorAll("input.field-checkbox")].map((input) => ({
      id: input.value,
      label: input.dataset.label,
      selected: input.checked,
    })),
    validFrom: validFrom.toISOString(),
    validUntil: validUntil && !Number.isNaN(validUntil.getTime())
      ? validUntil.toISOString()
      : "",
    choice,
  };
}


function input(choice = null) {
  return {
    claimantId: "claimant-1",
    recipient,
    summary,
    draft: draft(choice),
  };
}

function updateEndTime() {
  const date = new Date(draft().validUntil);
  if (Number.isNaN(date.getTime())) {
    endTimeView.textContent = "an end time is required";
    return;
  }
  endTimeView.textContent = date.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  renderScopeSummary();
}

function formatScopeEndTime(value) {
  if (Number.isNaN(Date.parse(value))) {
    return "an end time";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function renderScopeSummary() {
  const selectedFields = [...fieldsView.querySelectorAll("input.field-checkbox")]
    .filter((field) => field.checked);
  const endsAt = draft().validUntil;

  scopeCountView.textContent = selectedFields.length === 1
    ? "One selected field"
    : `${selectedFields.length} selected fields`;
  signalEndTimeView.textContent = formatScopeEndTime(endsAt);
  approveButton.disabled = selectedFields.length === 0;

  if (!passportCardTitle || !passportCardDetail || !passportCardExpiry) {
    return;
  }

  if (selectedFields.length === 0) {
    passportCardTitle.textContent = "Nothing selected";
    passportCardDetail.textContent = "Choose a constraint before approving this order.";
  } else if (selectedFields.length === 1) {
    passportCardTitle.textContent = selectedFields[0].dataset.label;
    passportCardDetail.textContent = "Fieldline can verify and use this one credential-backed fact for the order.";
  } else {
    passportCardTitle.textContent = `${selectedFields.length} selected constraints`;
    passportCardDetail.textContent = "Recipient can use only these selected constraints to evaluate the order.";
  }

  passportCardExpiry.textContent = `Ends ${formatScopeEndTime(endsAt)}`;
}

function dateTimeLocalValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function resetRequestView() {
  const currentClaim = expireScopedClaimIfNeeded(dependencies);
  if (currentClaim?.status === "active") {
    revokeScopedClaim(
      currentClaim.claimantId,
      dependencies,
      "The claimant started a new request and ended this access.",
    );
  }
  window.clearTimeout(expiryTimer);
  validFrom = new Date();
  const earliestAllowed = new Date(validFrom.getTime() + 60 * 1_000);
  const latestAllowed = new Date(validFrom.getTime() + 24 * 60 * 60 * 1_000);
  expiryInput.min = dateTimeLocalValue(earliestAllowed);
  expiryInput.max = dateTimeLocalValue(latestAllowed);
  expiryInput.value = dateTimeLocalValue(new Date(validFrom.getTime() + 30 * 60 * 1_000));
  errorView.hidden = true;
  requestView.hidden = false;
  outcomeView.hidden = true;
  updateEndTime();
}

function addStartNewRequest(container) {
  const startAgain = document.createElement("button");
  startAgain.className = "button";
  startAgain.type = "button";
  startAgain.textContent = "Start a new request";
  startAgain.addEventListener("click", resetRequestView);
  container.append(startAgain);
}

function showError(issues) {
  const messages = issues.map((issue) => {
    const path = String(issue.path || "");
    const text = String(issue.message || "");
    if (path.includes("fields") || /select at least one/i.test(text)) {
      return "Select at least one constraint before approving.";
    }
    if (path.includes("validUntil") || /end time|expir/i.test(text)) {
      return "Choose an end time within the next 24 hours.";
    }
    return text || "This request could not be completed.";
  });
  errorView.textContent = [...new Set(messages)].join(" ");
  errorView.hidden = false;
}

function confirmRevoke() {
  return window.confirm("Revoke now? Fieldline will lose this order scope immediately.");
}

async function revokeActiveApiHandshake() {
  const handshakeId = dependencies.storage.getItem(HANDSHAKE_STORAGE_KEY);
  if (!handshakeId) return;
  await demoApi({ action: "revoke", handshakeId });
}

function showOutcome(kind, title, message, claim = null) {
  requestView.hidden = true;
  outcomeView.hidden = false;
  const fields = claim?.dataScope.fields.map((field) => field.label).join(", ");
  const end = claim
    ? new Date(claim.dataScope.validUntil).toLocaleString([], {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : null;
  outcomeView.replaceChildren();
  const icon = document.createElement("div");
  icon.className = `status-icon ${kind}`;
  icon.textContent = kind === "approved" ? "Access active" : "Access ended";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = message;
  outcomeView.append(icon, heading, body);

  if (claim) {
    const summaryGrid = document.createElement("div");
    summaryGrid.className = "summary-grid";
    for (const [label, value] of [
      ["Recipient", claim.recipient.displayName],
      ["Shared fields", fields],
      ["Access ends", end],
    ]) {
      const item = document.createElement("div");
      const itemLabel = document.createElement("span");
      itemLabel.className = "label";
      itemLabel.textContent = label;
      const itemValue = document.createElement("p");
      itemValue.textContent = value;
      item.append(itemLabel, itemValue);
      summaryGrid.append(item);
    }
    outcomeView.append(summaryGrid);
  }

  if (kind === "approved") {
    const dash = document.createElement("a");
    dash.className = "button";
    dash.href = "/recipient.html";
    dash.textContent = "Continue to Dash";
    outcomeView.append(dash);
    const revoke = document.createElement("button");
    revoke.className = "button revoke";
    revoke.type = "button";
    revoke.textContent = "Revoke access now";
    revoke.title = "This locks the kitchen immediately.";
    revoke.addEventListener("click", async () => {
      if (!confirmRevoke()) return;
      try {
        await revokeActiveApiHandshake();
        revokeScopedClaim("claimant-1", dependencies);
        showOutcome(
          "revoked",
          "Access revoked",
          "The recipient is blocked from future use of this claim.",
        );
      } catch (error) {
        showPreviewError(error instanceof Error ? error.message : "Access was not revoked.");
      }
    });
    outcomeView.append(revoke);
  }

  if (kind !== "approved") {
    addStartNewRequest(outcomeView);
  }
}

function showExpiredOutcome() {
  showOutcome(
    "expired",
    "Access expired",
    "The end time passed. The recipient is blocked from future use of this claim.",
  );
}

function formatTimestamp(value) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function addReceiptItem(container, label, value) {
  const item = document.createElement("div");
  const itemLabel = document.createElement("span");
  itemLabel.className = "label";
  itemLabel.textContent = label;
  const itemValue = document.createElement("p");
  itemValue.textContent = value;
  item.append(itemLabel, itemValue);
  container.append(item);
}

function kitchenOutcomeCopy(outcome) {
  switch (outcome) {
    case "accept":
      return "Kitchen can prepare this order";
    case "required_change":
      return "Kitchen asked for a change";
    case "decline":
      return "Kitchen cannot fulfill this order";
    case "cannot_determine":
      return "Kitchen could not determine safety";
    default:
      return `Kitchen outcome: ${String(outcome).replaceAll("_", " ")}`;
  }
}

function showApiDecision(handshake, claim) {
  const decision = handshake.events.find((event) => event.type === "decision");
  if (!decision) return;
  requestView.hidden = true;
  outcomeView.hidden = false;
  outcomeView.replaceChildren();

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Handshake API response";
  const heading = document.createElement("h2");
  heading.textContent = kitchenOutcomeCopy(decision.payload.response);
  const rationale = document.createElement("p");
  rationale.textContent = decision.payload.rationale;
  outcomeView.append(eyebrow, heading, rationale);

  if (Array.isArray(decision.payload.requiredChanges)) {
    const changes = document.createElement("div");
    changes.className = "receipt-section";
    const label = document.createElement("p");
    label.className = "label";
    label.textContent = "Required changes";
    const list = document.createElement("ul");
    for (const change of decision.payload.requiredChanges) {
      const item = document.createElement("li");
      item.textContent = change;
      list.append(item);
    }
    changes.append(label, list);
    outcomeView.append(changes);
  }

  const scope = document.createElement("p");
  scope.textContent = `Shared with Fieldline: ${claim.dataScope.fields.map((field) => field.label).join(", ")}.`;
  outcomeView.append(scope);

  const revoke = document.createElement("button");
  revoke.className = "button revoke";
  revoke.type = "button";
  revoke.textContent = "Revoke access now";
  revoke.addEventListener("click", async () => {
    if (!confirmRevoke()) return;
    try {
      await revokeActiveApiHandshake();
      revokeScopedClaim(claim.claimantId, dependencies);
      showOutcome(
        "revoked",
        "Access revoked",
        "The recipient is blocked from future use of this claim.",
      );
    } catch (error) {
      showPreviewError(error instanceof Error ? error.message : "Access was not revoked.");
    }
  });
  outcomeView.append(revoke);
}

async function refreshApiDecision() {
  const handshakeId = dependencies.storage.getItem(HANDSHAKE_STORAGE_KEY);
  const claim = expireScopedClaimIfNeeded(dependencies);
  if (!handshakeId || claim?.status !== "active") return;
  try {
    const { handshake } = await demoApi({ action: "claimant-status", handshakeId });
    if (handshake.events.some((event) => event.type === "decision")) {
      showApiDecision(handshake, claim);
    }
  } catch {
    // The local claim remains usable if the optional API response is unavailable.
  }
}

function accessCopy(status) {
  if (status === "active") {
    return "Fieldline can still use this scope. Revoke to lock the kitchen.";
  }
  if (status === "revoked") {
    return "You revoked access. Fieldline cannot use this scope again.";
  }
  return "Access has ended. Fieldline cannot use this scope again.";
}

function showReceipt(receipt) {
  requestView.hidden = true;
  outcomeView.hidden = false;
  outcomeView.replaceChildren();

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Local preview";
  const heading = document.createElement("h2");
  heading.textContent = kitchenOutcomeCopy(receipt.decision.outcome);
  const authenticity = document.createElement("p");
  authenticity.className = "unverified-notice";
  authenticity.textContent = `This is a local preview, not a signed receipt. ${receipt.authenticity.message}`;
  const access = document.createElement("p");
  access.textContent = accessCopy(receipt.access.status);
  const rationale = document.createElement("p");
  rationale.textContent = receipt.decision.rationale;
  outcomeView.append(eyebrow, heading, authenticity, access, rationale);

  if (receipt.decision.requiredChanges) {
    const changes = document.createElement("div");
    changes.className = "receipt-section";
    const changesLabel = document.createElement("p");
    changesLabel.className = "label";
    changesLabel.textContent = "Required changes";
    const changesList = document.createElement("ul");
    for (const change of receipt.decision.requiredChanges) {
      const item = document.createElement("li");
      item.textContent = change;
      changesList.append(item);
    }
    changes.append(changesLabel, changesList);
    outcomeView.append(changes);
  }

  const scope = document.createElement("div");
  scope.className = "receipt-section";
  const scopeLabel = document.createElement("p");
  scopeLabel.className = "label";
  scopeLabel.textContent = "Shared with Fieldline";
  const fields = document.createElement("div");
  fields.className = "receipt-fields";
  for (const field of receipt.fields) {
    const value = document.createElement("p");
    value.textContent = field.label;
    fields.append(value);
  }
  scope.append(scopeLabel, fields);

  const facts = document.createElement("div");
  facts.className = "summary-grid receipt-grid";
  addReceiptItem(facts, "Restaurant", receipt.recipient.displayName);
  addReceiptItem(facts, "Access", receipt.access.status.replaceAll("_", " "));
  addReceiptItem(facts, "Access ends", formatTimestamp(receipt.access.validUntil));
  if (receipt.acknowledgement.note) {
    addReceiptItem(facts, "Kitchen note", receipt.acknowledgement.note);
  }

  const deliveryStatus = document.createElement("p");
  deliveryStatus.className = "delivery-pending";
  deliveryStatus.textContent = "Delivery pending. No recipient delivery is confirmed.";

  const details = document.createElement("details");
  details.className = "receipt-details";
  const summary = document.createElement("summary");
  summary.textContent = "Preview details";
  const times = document.createElement("div");
  times.className = "summary-grid receipt-grid";
  addReceiptItem(
    times,
    "Reported by",
    `${receipt.acknowledgement.roleName} · ${receipt.acknowledgement.outcome}`,
  );
  for (const [label, value] of [
    ["Requested", receipt.timestamps.requestedAt],
    ["Approved", receipt.timestamps.consentedAt],
    ["Kitchen decision", receipt.timestamps.decidedAt],
    ["Reported acknowledgement time", receipt.timestamps.acknowledgedAt],
    ["Preview prepared", receipt.timestamps.preparedAt],
    ...(receipt.timestamps.terminalAt
      ? [["Access ended", receipt.timestamps.terminalAt]]
      : []),
  ]) {
    addReceiptItem(times, label, formatTimestamp(value));
  }
  details.append(summary, times);

  outcomeView.append(scope, facts, deliveryStatus, details);

  const localClaim = expireScopedClaimIfNeeded(dependencies);
  if (
    receipt.access.status === "active" &&
    localClaim?.status === "active" &&
    localClaim.handshakeId === receipt.handshakeId
  ) {
    const revoke = document.createElement("button");
    revoke.className = "button revoke";
    revoke.type = "button";
    revoke.textContent = "Revoke access now";
    revoke.title = "This locks the kitchen immediately.";
    revoke.addEventListener("click", async () => {
      if (!confirmRevoke()) return;
      try {
        await revokeActiveApiHandshake();
        const revocation = revokeScopedClaim(localClaim.claimantId, dependencies);
        showReceipt({
          ...receipt,
          access: { ...receipt.access, status: "revoked" },
          timestamps: { ...receipt.timestamps, terminalAt: revocation.occurredAt },
        });
      } catch (error) {
        showPreviewError(error instanceof Error ? error.message : "Access was not revoked.");
      }
    });
    outcomeView.append(revoke);
  }

  if (receipt.access.status !== "active") {
    addStartNewRequest(outcomeView);
  }
}

function addReceiptPending() {
  const pending = document.createElement("div");
  pending.className = "receipt-pending";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Receipt pending";
  const message = document.createElement("p");
  message.textContent =
    "The kitchen has not recorded an outcome yet. When they do, a local preview appears here. It is not a signed receipt.";
  pending.append(label, message);
  outcomeView.append(pending);
}

function renderClaim(claim) {
  const receipt = previewClaimantReceipt(claim.handshakeId, dependencies);
  if (receipt.success) {
    showReceipt(receipt.value.receipt);
  } else if (claim.status === "active") {
    showOutcome(
      "approved",
      "Approved for one order",
      "Only the selected fields are available to the recipient until the stated time.",
      claim,
    );
    addReceiptPending();
  } else if (claim.status === "revoked") {
    showOutcome(
      "revoked",
      "Access revoked",
      "The recipient is blocked from future use of this claim.",
    );
  } else {
    showExpiredOutcome();
  }
}

function scheduleExpiry(claim) {
  window.clearTimeout(expiryTimer);
  const delay = Date.parse(claim.dataScope.validUntil) - Date.now();
  if (delay <= 0) {
    const expired = expireScopedClaimIfNeeded(dependencies);
    if (expired?.status === "expired") {
      renderClaim(expired);
    }
    return;
  }
  expiryTimer = window.setTimeout(() => {
    const expired = expireScopedClaimIfNeeded(dependencies);
    if (expired?.status === "expired") {
      renderClaim(expired);
    }
  }, delay);
}

expiryInput.addEventListener("change", updateEndTime);

approveButton.addEventListener("click", async () => {
  errorView.hidden = true;
  const result = approveScopedRequest(input("approve"), dependencies);
  if (!result.success) {
    showError(result.issues);
    return;
  }
  try {
    await savePassport(userVault);
    const constraintId = apiConstraintId(result.value.claim.dataScope.fields[0].id);
    const { handshake } = await demoApi({ action: "start", constraintId });
    dependencies.storage.setItem(HANDSHAKE_STORAGE_KEY, handshake.id);
  } catch (error) {
    revokeScopedClaim(result.value.claim.claimantId, dependencies, "The API handshake could not be created.");
    errorView.textContent = error instanceof Error ? error.message : "The order permission could not be created.";
    errorView.hidden = false;
    return;
  }
  renderClaim(result.value.claim);
  scheduleExpiry(result.value.claim);
});

denyButton.addEventListener("click", () => {
  errorView.hidden = true;
  const result = denyScopedRequest(input("deny"), dependencies);
  if (!result.success) {
    showError(result.issues);
    return;
  }
  showOutcome(
    "denied",
    "Request denied",
    "Nothing was shared with the recipient.",
  );
});

const storedClaim = expireScopedClaimIfNeeded(dependencies);
if (storedClaim?.status === "active") {
  renderClaim(storedClaim);
  scheduleExpiry(storedClaim);
} else if (storedClaim?.status === "revoked") {
  renderClaim(storedClaim);
} else if (storedClaim?.status === "expired") {
  renderClaim(storedClaim);
} else {
  resetRequestView();
}
refreshApiDecision();

function showPreviewError(message) {
  const error = document.createElement("p");
  error.className = "error receipt-error";
  error.textContent = `Preview not available. ${message}`;
  outcomeView.append(error);
}

function showLocalDemoPreview(handshakeId, incomingEvents) {
  const claim = expireScopedClaimIfNeeded(dependencies);
  if (!Array.isArray(incomingEvents) || incomingEvents.length === 0) {
    return;
  }
  const linkedHandshakeId = handshakeId ?? incomingEvents[0]?.handshakeId;
  if (
    typeof linkedHandshakeId !== "string" ||
    linkedHandshakeId.length === 0 ||
    claim?.handshakeId !== linkedHandshakeId
  ) {
    return;
  }
  const result = previewDemoLinkedEvents(
    linkedHandshakeId,
    incomingEvents,
    dependencies,
  );
  if (result.success) {
    showReceipt(result.value.receipt);
    return;
  }
  showPreviewError(result.issues
    .map((issue) => issue.message)
    .join(" "));
}

function readLocalDemoLinkedEvents(value) {
  let payload;
  try {
    payload = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.handshakeId !== "string" ||
    payload.handshakeId.length === 0 ||
    !Array.isArray(payload.events) ||
    payload.events.length === 0
  ) {
    return null;
  }
  const hasMismatchedEvent = payload.events.some(
    (event) =>
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      typeof event.eventId !== "string" ||
      typeof event.type !== "string" ||
      event.handshakeId !== payload.handshakeId,
  );
  return hasMismatchedEvent ? null : payload;
}

window.addEventListener("handshake:demo-linked-events", (event) => {
  showLocalDemoPreview(null, event instanceof CustomEvent ? event.detail : null);
});

window.addEventListener("storage", (event) => {
  if (event.key !== LOCAL_DEMO_LINKED_EVENTS_STORAGE_KEY || !event.newValue) {
    return;
  }
  const preview = readLocalDemoLinkedEvents(event.newValue);
  window.localStorage.removeItem(LOCAL_DEMO_LINKED_EVENTS_STORAGE_KEY);
  if (!preview) {
    showPreviewError("Local demo data was invalid.");
    return;
  }
  showLocalDemoPreview(preview.handshakeId, preview.events);
});

let lastVaultUpdatedAt = userVault.updatedAt || "";

function setPollStatus(kind, message) {
  if (pollStatusView) {
    const sameKind = pollStatusView.classList.contains(`is-${kind}`);
    if (sameKind && pollStatusView.textContent === message) {
      return;
    }
    pollStatusView.className = `poll-status is-${kind}`;
    pollStatusView.textContent = message;
  }
  if (chatHintView && kind === "error") chatHintView.textContent = message;
}

async function pollEgoistPassportVault() {
  try {
    let serverVault;
    try {
      const res = await fetch("/api/passport/vault");
      if (!res.ok) throw new Error("Passport vault route unavailable.");
      serverVault = await res.json();
      const browserVault = loadUserPassportVault(dependencies.storage);
      const browserHasLocalMemory = browserVault.allergies.some((allergy) =>
        allergy.allergenId.startsWith("allergen."),
      );
      if (!serverVault.egoistConnected && browserHasLocalMemory) {
        serverVault = browserVault;
      }
    } catch {
      serverVault = loadUserPassportVault(dependencies.storage);
    }
    const egoist = (serverVault.allergies || []).filter((allergy) =>
      allergy.allergenId.startsWith("allergen."),
    );
    if (!serverVault.updatedAt || serverVault.updatedAt === lastVaultUpdatedAt) {
      if (egoist.length === 0) {
        setPollStatus(
          "waiting",
          "NimGTP notes remain private and are not Identity proofs.",
        );
      }
      return;
    }
    lastVaultUpdatedAt = serverVault.updatedAt;

    const previousEgoistIds = new Set(
      userVault.allergies
        .filter((allergy) => allergy.allergenId.startsWith("allergen."))
        .map((allergy) => allergy.allergenId),
    );
    const nonEgoist = userVault.allergies.filter(
      (allergy) => !allergy.allergenId.startsWith("allergen."),
    );
    userVault = {
      ...userVault,
      allergies: [...nonEgoist, ...egoist],
      updatedAt: serverVault.updatedAt,
    };
    await savePassport(userVault);
    saveUserPassportVault(userVault, dependencies.storage);
    selectedFieldIds.add(CREDENTIAL_BACKED_FIELD_ID);
    if (egoist.length > 0) {
      setPollStatus(
        "ready",
        `NimGTP saved ${egoist.length} private note${egoist.length === 1 ? "" : "s"}. They are not eligible for this Identity presentation.`,
      );
    } else {
      setPollStatus(
        "waiting",
        "NimGTP notes remain private and are not Identity proofs.",
      );
    }
    renderVaultFields();
  } catch {
    setPollStatus("error", "Could not check NimGTP memories. Is npm start running?");
  }
}

setInterval(pollEgoistPassportVault, 3000);
passportReady.then(pollEgoistPassportVault);
window.addEventListener("storage", (event) => {
  if (event.key === LOCAL_PASSPORT_VAULT_STORAGE_KEY) pollEgoistPassportVault();
});
