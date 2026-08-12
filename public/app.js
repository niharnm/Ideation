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
  loadUserPassportVault,
  removeVaultAllergy,
  saveUserPassportVault,
} from "/src/passport-vault.ts";

const recipient = { id: "recipient-1", displayName: "Fieldline" };
const purpose = "Prepare one restaurant order from the constraint you choose.";
const summary = "Use the selected scoped field for one restaurant order.";
const defaultFieldOptions = [
  { id: "order.constraint.peanut", label: "Peanut constraint", selected: true },
  { id: "order.constraint.dairy", label: "Dairy constraint", selected: false },
  { id: "order.preference.vegetarian", label: "Vegetarian preference", selected: false },
];
const LOCAL_DEMO_LINKED_EVENTS_STORAGE_KEY = "handshake:demo-linked-events:v1";

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
  const hasEgoist = allergies.some((allergy) => allergy.allergenId.startsWith("allergen."));
  const egoistFamilies = new Set(
    allergies
      .filter((allergy) => allergy.allergenId.startsWith("allergen."))
      .map((allergy) => constraintFamily(allergy.allergenId)),
  );
  return allergies.filter((allergy) => {
    if (allergy.allergenId.startsWith("allergen.")) return true;
    if (hasEgoist && SEED_FIELD_IDS.has(allergy.allergenId)) return false;
    if (!allergy.allergenId.startsWith("order.constraint.")) return true;
    return !egoistFamilies.has(constraintFamily(allergy.allergenId));
  });
}

let seenEgoistIds = new Set();
const deselectedFieldIds = new Set();

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
    input.checked = selectedFieldIds.has(allergy.allergenId);
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

    if (allergy.allergenId.startsWith("allergen.")) {
      const sourceBadge = document.createElement("span");
      sourceBadge.className = "badge";
      sourceBadge.textContent = "From NimGTP";
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
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      userVault = removeVaultAllergy(userVault, allergy.allergenId);
      selectedFieldIds.delete(allergy.allergenId);
      deselectedFieldIds.add(allergy.allergenId);
      saveUserPassportVault(userVault, dependencies.storage);
      renderVaultFields();
      if (allergy.allergenId.startsWith("allergen.")) {
        fetch("/api/passport/vault", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ removeAllergenId: allergy.allergenId }),
        }).catch(() => {});
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
  addAllergyForm.addEventListener("submit", (e) => {
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

    userVault = addCustomAllergyToVault(userVault, newConstraint);
    if (shareNewAllergyCheck.checked) {
      selectedFieldIds.add(newConstraint.allergenId);
    }
    saveUserPassportVault(userVault, dependencies.storage);
    renderVaultFields();
    closeModal();
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
    passportCardDetail.textContent = "Recipient can use this one constraint to evaluate the order.";
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
    revoke.addEventListener("click", () => {
      if (!confirmRevoke()) return;
      revokeScopedClaim("claimant-1", dependencies);
      showOutcome(
        "revoked",
        "Access revoked",
        "The recipient is blocked from future use of this claim.",
      );
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
    revoke.addEventListener("click", () => {
      if (!confirmRevoke()) return;
      const revocation = revokeScopedClaim(localClaim.claimantId, dependencies);
      showReceipt({
        ...receipt,
        access: { ...receipt.access, status: "revoked" },
        timestamps: { ...receipt.timestamps, terminalAt: revocation.occurredAt },
      });
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

approveButton.addEventListener("click", () => {
  errorView.hidden = true;
  const result = approveScopedRequest(input("approve"), dependencies);
  if (!result.success) {
    showError(result.issues);
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
  if (chatHintView && kind !== "waiting") {
    chatHintView.textContent = message;
  }
}

async function pollEgoistPassportVault() {
  try {
    const res = await fetch("/api/passport/vault");
    if (!res.ok) {
      setPollStatus("error", "Could not check NimGTP memories. Is npm start running?");
      return;
    }
    const serverVault = await res.json();
    const egoist = (serverVault.allergies || []).filter((allergy) =>
      allergy.allergenId.startsWith("allergen."),
    );
    if (!serverVault.updatedAt || serverVault.updatedAt === lastVaultUpdatedAt) {
      if (egoist.length === 0) {
        setPollStatus(
          "waiting",
          "Waiting for NimGTP memories. This page checks every few seconds.",
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
    saveUserPassportVault(userVault, dependencies.storage);
    if (egoist.length > 0) {
      for (const id of [...selectedFieldIds]) {
        if (!id.startsWith("allergen.")) selectedFieldIds.delete(id);
      }
    }
    for (const allergy of egoist) {
      if (
        !previousEgoistIds.has(allergy.allergenId) &&
        !deselectedFieldIds.has(allergy.allergenId)
      ) {
        selectedFieldIds.add(allergy.allergenId);
      }
    }
    if (egoist.length > 0) {
      const countLabel = egoist.length === 1 ? "memory" : "memories";
      setPollStatus(
        "ready",
        `NimGTP saved ${egoist.length} ${countLabel} to your passport. Select what Fieldline may see, then approve.`,
      );
    } else {
      setPollStatus(
        "waiting",
        "Waiting for NimGTP memories. This page checks every few seconds.",
      );
    }
    renderVaultFields();
  } catch {
    setPollStatus("error", "Could not check NimGTP memories. Is npm start running?");
  }
}

setInterval(pollEgoistPassportVault, 3000);
pollEgoistPassportVault();
