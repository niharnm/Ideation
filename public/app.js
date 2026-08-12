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

const recipient = { id: "recipient-1", displayName: "Recipient" };
const purpose = "Prepare one restaurant order from the constraints you choose.";
const summary = "Use the selected scoped fields for one restaurant order.";

const requestView = document.querySelector("#request-view");
const outcomeView = document.querySelector("#outcome-view");
const fieldsView = document.querySelector("#fields");
const durationSelect = document.querySelector("#duration");
const endTimeView = document.querySelector("#end-time");
const approveButton = document.querySelector("#approve");
const denyButton = document.querySelector("#deny");
const errorView = document.querySelector("#error");

const addAllergyModal = document.querySelector("#add-allergy-modal");
const openAddAllergyBtn = document.querySelector("#open-add-allergy-btn");
const closeAddAllergyBtn = document.querySelector("#close-add-allergy-btn");
const cancelAddAllergyBtn = document.querySelector("#cancel-add-allergy");
const addAllergyForm = document.querySelector("#add-allergy-form");
const allergyLabelInput = document.querySelector("#allergy-label");
const allergySeveritySelect = document.querySelector("#allergy-severity");
const allergyCrossContamCheck = document.querySelector("#allergy-cross-contam");

let validFrom = new Date();
let expiryTimer;

const dependencies = {
  storage: window.localStorage,
  emit(event) {
    window.dispatchEvent(
      new CustomEvent("handshake:event", { detail: event }),
    );
  },
};

let userVault = loadUserPassportVault(dependencies.storage);

function renderVaultFields() {
  fieldsView.replaceChildren();

  for (const allergy of userVault.allergies) {
    const labelEl = document.createElement("label");
    labelEl.className = "field";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "field-checkbox";
    input.value = allergy.allergenId;
    input.checked = true;
    input.dataset.label = allergy.label;

    const textSpan = document.createElement("span");
    textSpan.textContent = allergy.label;

    const badgeGroup = document.createElement("div");
    badgeGroup.className = "badge-group";

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
    removeBtn.innerHTML = "&times;";
    removeBtn.title = `Remove ${allergy.label} from vault`;
    removeBtn.setAttribute("aria-label", `Remove ${allergy.label}`);
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      userVault = removeVaultAllergy(userVault, allergy.allergenId);
      saveUserPassportVault(userVault, dependencies.storage);
      renderVaultFields();
    });

    labelEl.append(input, textSpan, badgeGroup, removeBtn);
    fieldsView.append(labelEl);
  }
}

renderVaultFields();

function closeModal() {
  if (addAllergyModal) {
    addAllergyModal.hidden = true;
    addAllergyForm.reset();
  }
}

if (openAddAllergyBtn && addAllergyModal) {
  openAddAllergyBtn.addEventListener("click", () => {
    addAllergyModal.hidden = false;
    if (allergyLabelInput) allergyLabelInput.focus();
  });
}

if (closeAddAllergyBtn) closeAddAllergyBtn.addEventListener("click", closeModal);
if (cancelAddAllergyBtn) cancelAddAllergyBtn.addEventListener("click", closeModal);

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

    userVault = addCustomAllergyToVault(userVault, newConstraint);
    saveUserPassportVault(userVault, dependencies.storage);
    renderVaultFields();
    closeModal();
  });
}

function draft(choice = null) {
  const durationMs = Number(durationSelect.value) * 60 * 1_000;
  return {
    purpose,
    fields: [...fieldsView.querySelectorAll("input.field-checkbox")].map((input) => ({
      id: input.value,
      label: input.dataset.label,
      selected: input.checked,
    })),
    validFrom: validFrom.toISOString(),
    validUntil: new Date(validFrom.getTime() + durationMs).toISOString(),
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
  endTimeView.textContent = date.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function showError(issues) {
  errorView.textContent = issues
    .map((issue) => `${issue.path.replace("$.", "")}: ${issue.message}`)
    .join(" ");
  errorView.hidden = false;
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
  icon.textContent = kind === "approved" ? "✓" : "×";
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
    const revoke = document.createElement("button");
    revoke.className = "button revoke";
    revoke.type = "button";
    revoke.textContent = "Revoke access now";
    revoke.addEventListener("click", () => {
      revokeScopedClaim("claimant-1", dependencies);
      showOutcome(
        "revoked",
        "Access revoked",
        "The recipient is blocked from future use of this claim.",
      );
    });
    outcomeView.append(revoke);
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

function showReceipt(receipt) {
  requestView.hidden = true;
  outcomeView.hidden = false;
  outcomeView.replaceChildren();

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Unverified receipt preview";
  const heading = document.createElement("h2");
  heading.textContent = `Recipient outcome: ${receipt.decision.outcome.replaceAll("_", " ")}`;
  const authenticity = document.createElement("p");
  authenticity.className = "unverified-notice";
  authenticity.textContent = receipt.authenticity.message;
  const rationale = document.createElement("p");
  rationale.textContent = receipt.decision.rationale;
  outcomeView.append(eyebrow, heading, authenticity, rationale);

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
  scopeLabel.textContent = "Exactly shared fields";
  const fields = document.createElement("div");
  fields.className = "receipt-fields";
  for (const field of receipt.fields) {
    const value = document.createElement("code");
    value.textContent = `${field.label} · ${field.id}`;
    fields.append(value);
  }
  scope.append(scopeLabel, fields);

  const facts = document.createElement("div");
  facts.className = "summary-grid receipt-grid";
  addReceiptItem(facts, "Recipient", receipt.recipient.displayName);
  addReceiptItem(
    facts,
    "Reported acknowledgement role",
    `${receipt.acknowledgement.roleName} · ${receipt.acknowledgement.outcome}`,
  );
  if (receipt.acknowledgement.note) {
    addReceiptItem(facts, "Reported acknowledgement note", receipt.acknowledgement.note);
  }
  addReceiptItem(facts, "Current access", receipt.access.status.replaceAll("_", " "));
  addReceiptItem(facts, "Access ends", formatTimestamp(receipt.access.validUntil));

  const times = document.createElement("div");
  times.className = "summary-grid receipt-grid";
  for (const [label, value] of [
    ["Requested", receipt.timestamps.requestedAt],
    ["Approved", receipt.timestamps.consentedAt],
    ["Recipient decision", receipt.timestamps.decidedAt],
    ["Reported acknowledgement time", receipt.timestamps.acknowledgedAt],
    ["Preview prepared", receipt.timestamps.preparedAt],
    ...(receipt.timestamps.terminalAt
      ? [["Access ended", receipt.timestamps.terminalAt]]
      : []),
  ]) {
    addReceiptItem(times, label, formatTimestamp(value));
  }

  const delivery = document.createElement("div");
  delivery.className = "receipt-section";
  const deliveryLabel = document.createElement("p");
  deliveryLabel.className = "label";
  deliveryLabel.textContent = "Intended receipt recipients";
  const deliveryValue = document.createElement("p");
  deliveryValue.textContent = receipt.delivery.intendedRecipients
    .map((party) => `${party.displayName} (${party.role})`)
    .join(" and ");
  const deliveryStatus = document.createElement("p");
  deliveryStatus.className = "delivery-pending";
  deliveryStatus.textContent = "Delivery pending. No recipient delivery is confirmed.";
  delivery.append(deliveryLabel, deliveryValue, deliveryStatus);
  outcomeView.append(scope, facts, times, delivery);

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
    revoke.addEventListener("click", () => {
      revokeScopedClaim(localClaim.claimantId, dependencies);
      const updated = previewClaimantReceipt(receipt.handshakeId, dependencies);
      if (updated.success) {
        showReceipt(updated.value.receipt);
      }
    });
    outcomeView.append(revoke);
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
    "Authenticated recipient decision and acknowledgement transport is required before receipt delivery.";
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

durationSelect.addEventListener("change", updateEndTime);

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
  validFrom = new Date();
  updateEndTime();
}

window.addEventListener("handshake:demo-linked-events", (event) => {
  const claim = expireScopedClaimIfNeeded(dependencies);
  const incomingEvents = event instanceof CustomEvent ? event.detail : null;
  if (!Array.isArray(incomingEvents) || incomingEvents.length === 0) {
    return;
  }
  const handshakeId = incomingEvents[0]?.handshakeId ?? claim?.handshakeId;
  if (typeof handshakeId !== "string" || handshakeId.length === 0) {
    return;
  }
  const result = previewDemoLinkedEvents(
    handshakeId,
    incomingEvents,
    dependencies,
  );
  if (result.success) {
    showReceipt(result.value.receipt);
    return;
  }
  const message = document.createElement("p");
  message.className = "error receipt-error";
  message.textContent = `Preview not available. ${result.issues
    .map((issue) => issue.message)
    .join(" ")}`;
  outcomeView.append(message);
});
