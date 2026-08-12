import {
  processRecipientRequest,
  createAcceptDecisionEvent,
  createRequiredChangeDecisionEvent,
  createDeclineDecisionEvent,
  createCannotDetermineDecisionEvent,
  recordRecipientDecision,
} from "/src/recipient-console.ts";
import { evaluateUniversalAllergyPolicy } from "/src/universal-policy-engine.ts";
import {
  HANDSHAKE_CLAIM_STORAGE_KEY,
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
  readHandshakeEventLedger,
} from "/src/passport-flow.ts";

const RECIPIENT_ID = "recipient-1";
const SAMPLE_RECIPIENT_DATA = {
  "order.constraint.peanut": "Peanut allergy",
  "order.constraint.dairy": "Dairy constraint",
  "order.preference.vegetarian": "Vegetarian preference",
  "allergen.peanut": "Peanut allergy",
  "allergen.dairy": "Dairy / Milk",
  "allergen.tree_nut": "Tree nut allergy",
  "allergen.gluten": "Wheat / Gluten",
  "allergen.shellfish": "Shellfish allergy",
  "allergen.egg": "Egg allergy",
  "allergen.soy": "Soy allergy",
  "allergen.sesame": "Sesame allergy",
  "allergen.fish": "Fish allergy",
  "allergen.alpha_gal": "Alpha-gal (red meat)",
  "allergen.sulfite": "Sulfite sensitivity",
  "allergen.mustard": "Mustard allergy",
  "allergen.celery": "Celery allergy",
  "allergen.lupin": "Lupin allergy",
};
const PAD_THAI = {
  id: "pad-thai",
  name: "Pad Thai",
  ingredients: [
    { id: "rice-noodles", name: "Rice noodles", allergens: [], isVerifiedSupplier: true },
    { id: "peanuts", name: "Peanuts", allergens: ["allergen.peanut"], isVerifiedSupplier: true },
  ],
  allergens: ["allergen.peanut"],
  substitutions: [{
    id: "omit-peanuts",
    originalIngredientId: "peanuts",
    originalIngredientName: "peanuts",
    replacementIngredientId: "none",
    replacementIngredientName: "no peanuts",
    removesAllergens: ["allergen.peanut"],
  }],
  hasUnverifiedSuppliers: false,
};

const dependencies = {
  storage: window.localStorage,
  emit(event) {
    window.dispatchEvent(new CustomEvent("handshake:event", { detail: event }));
  },
};

const scopeCard = document.querySelector("#scope-card");
const scopeTitle = document.querySelector("#scope-title");
const scopeState = document.querySelector("#scope-state");
const scopeBody = document.querySelector("#scope-body");
const kitchenIntro = document.querySelector("#kitchen-intro");
const actionButtons = [...document.querySelectorAll(".action")];
const decisionLabel = document.querySelector("#decision-label");
const decisionNote = document.querySelector("#decision-note");
const recordButton = document.querySelector("#record-decision");
const recordNote = document.querySelector("#record-note");
const decisionNotice = document.querySelector("#decision-notice");
const historyList = document.querySelector("#history-list");

let currentWorkspace = null;
let selectedAction = "required_change";

function sameDataScope(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findWorkspaceState() {
  const events = readHandshakeEventLedger(dependencies.storage).events;
  const requests = events
    .filter((event) => event.type === "request" && event.payload.recipient.id === RECIPIENT_ID)
    .reverse();

  for (const request of requests) {
    const consent = events.find((event) =>
      event.type === "consent" &&
      event.handshakeId === request.handshakeId &&
      event.payload.choice === "approve" &&
      event.payload.recipientId === RECIPIENT_ID &&
      sameDataScope(event.dataScope, request.dataScope),
    );
    if (!consent) continue;

    const terminal = events.find((event) =>
      event.handshakeId === request.handshakeId &&
      (event.type === "revocation" || event.type === "expiry"),
    );
    if (terminal) {
      return { phase: terminal.type === "revocation" ? "revoked" : "expired", events, request, consent, terminal };
    }

    const now = Date.now();
    if (now < Date.parse(request.dataScope.validFrom) || now >= Date.parse(request.dataScope.validUntil)) {
      return { phase: "expired", events, request, consent };
    }

    const decision = events.find((event) => event.handshakeId === request.handshakeId && event.type === "decision");
    return {
      phase: "active",
      events,
      request,
      consent,
      decision,
      recipientRequest: processRecipientRequest(request, consent, SAMPLE_RECIPIENT_DATA),
    };
  }

  return { phase: "locked", events };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatRemaining(validUntil) {
  const minutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
  return `${minutes} min remaining`;
}

function setScopeState(phase) {
  scopeCard.className = `scope-card ${phase}`;
}

function renderScope(workspace) {
  if (workspace.phase === "active") {
    const field = workspace.recipientRequest.scopedFields[0];
    const fields = workspace.recipientRequest.scopedFields;
    setScopeState("active");
    scopeTitle.textContent = "Allergy scope active";
    scopeState.textContent = formatRemaining(workspace.recipientRequest.validUntil);
    const detail = element("div", "scope-detail");
    detail.append(
      element("span", "scope-detail-icon", "✓"),
      (() => {
        const copy = document.createElement("div");
        const labels = fields.map((item) => item?.label || String(item?.value ?? field?.label ?? "Approved constraint"));
        copy.append(
          element("span", "scope-label", fields.length === 1 ? "Approved constraint" : "Approved constraints"),
          element("p", "", labels.join(", ")),
        );
        return copy;
      })(),
    );
    const facts = element("div", "scope-facts");
    for (const [label, value] of [
      ["Purpose", workspace.recipientRequest.purpose],
      ["Order context", "Pad Thai · #A1024"],
      ["Access", formatRemaining(workspace.recipientRequest.validUntil)],
      ["Customer data", fields.length === 1 ? "One approved constraint" : `${fields.length} approved constraints`],
    ]) {
      const fact = element("div", "scope-fact");
      fact.append(element("span", "", label), element("strong", "", value));
      facts.append(fact);
    }
    scopeBody.replaceChildren(detail, facts, element("p", "scope-note", "This permission is temporary and limited to this order. It is not a permanent customer profile."));
    return;
  }

  const revoked = workspace.phase === "revoked";
  setScopeState(revoked ? "revoked" : "locked");
  scopeTitle.textContent = revoked ? "Access ended by customer" : "Permission required";
  scopeState.textContent = revoked ? "Scope removed" : "Not shared";
  const message = revoked
    ? "The customer ended this order scope. Allergy detail has been removed and Fieldline cannot retrieve or use that permission for a future action."
    : "Allergy details are unavailable. The customer has not granted a constraint for this order. Fieldline cannot view or act on allergy information without that temporary permission.";
  scopeBody.replaceChildren(element("div", "locked-body", message));
}

function scopeLabels(fields) {
  return (fields || [])
    .map((item) => String(item?.label || item?.value || "").trim())
    .filter(Boolean);
}

function actionCopy(action, fields = []) {
  const labels = scopeLabels(fields);
  const constraint = labels.length > 0 ? labels.join(", ") : "the approved constraint";
  switch (action) {
    case "accept": return ["Preparation confirmation", `Kitchen can fulfill this order within ${constraint}.`, "Confirm safe preparation"];
    case "required_change": return ["Requested preparation change", `Adjust preparation so this order honors ${constraint}.`, "Request preparation change"];
    case "decline": return ["Kitchen note", `The kitchen cannot safely honor ${constraint} for this order.`, "Cannot safely fulfill"];
    case "cannot_determine": return ["Supplier review note", `Supplier documentation is unavailable for ${constraint}.`, "Cannot determine"];
    default: return ["Preparation detail", "", "Record kitchen decision"];
  }
}

function renderKitchen(workspace) {
  const active = workspace.phase === "active";
  const alreadyDecided = Boolean(workspace.decision);
  const enabled = active && !alreadyDecided;
  actionButtons.forEach((button) => {
    button.disabled = !enabled;
    button.classList.toggle("active", enabled && button.dataset.action === selectedAction);
  });
  decisionNote.disabled = !enabled;
  recordButton.disabled = !enabled;
  decisionNotice.hidden = true;

  if (!active) {
    kitchenIntro.textContent = workspace.phase === "revoked"
      ? "Future kitchen actions are locked because the customer ended access."
      : "Grant is required before a kitchen decision can use a customer constraint.";
    decisionLabel.textContent = "Preparation detail";
    decisionNote.value = "";
    recordNote.textContent = workspace.phase === "revoked" ? "Access ended by customer. No further action is permitted." : "Actions unlock only for an active order scope.";
    recordButton.textContent = "Record kitchen decision";
    return;
  }

  if (alreadyDecided) {
    kitchenIntro.textContent = "A kitchen decision has been recorded for this temporary order scope.";
    decisionLabel.textContent = "Recorded preparation detail";
    decisionNote.value = workspace.decision.payload.rationale;
    recordNote.textContent = "One kitchen decision is recorded for this order.";
    recordButton.textContent = "Decision recorded";
    return;
  }

  const fields = workspace.recipientRequest?.scopedFields || [];
  const [label, note, buttonLabel] = actionCopy(selectedAction, fields);
  kitchenIntro.textContent = "Choose the kitchen outcome for the approved order scope.";
  decisionLabel.textContent = label;
  decisionNote.value = note;
  recordNote.textContent = "This records a local kitchen decision for this order only.";
  recordButton.textContent = buttonLabel;
}

function appendHistory(title, detail, ended = false) {
  const item = element("div", `history-item${ended ? " ended" : ""}`);
  item.append(element("span", "history-dot"));
  const copy = document.createElement("div");
  copy.append(element("strong", "", title), document.createTextNode(detail));
  item.append(copy);
  historyList.append(item);
}

function renderHistory(workspace) {
  historyList.replaceChildren();
  appendHistory("Order received", "Pad Thai added to the lunch queue.");
  if (workspace.phase === "locked") {
    appendHistory("Customer constraint not shared", "Waiting for an order-specific permission.");
    return;
  }
  if (workspace.phase === "active") {
    const fieldCount = workspace.recipientRequest?.scopedFields?.length || 0;
    appendHistory(
      "Permission active",
      fieldCount === 1
        ? "One customer-approved constraint is available for this order."
        : `${fieldCount} customer-approved constraints are available for this order.`,
    );
    if (workspace.decision) appendHistory("Kitchen decision recorded", "The order team recorded its preparation response.");
    return;
  }
  appendHistory("Access ended by customer", "The temporary order scope was removed. Allergy detail is no longer available.", true);
}

function applyPolicyDefault(workspace) {
  if (workspace.phase !== "active" || workspace.decision) return;
  const evaluation = evaluateUniversalAllergyPolicy(
    PAD_THAI,
    workspace.recipientRequest.scopedFields.map((field) => ({ id: field.id, label: field.label, requireDedicatedSurface: true })),
    { dedicatedPrepSurface: true },
  );
  selectedAction = evaluation.response;
  workspace.policyEvaluation = evaluation;
}

function renderWorkspace() {
  try {
    currentWorkspace = findWorkspaceState();
    applyPolicyDefault(currentWorkspace);
    renderScope(currentWorkspace);
    renderKitchen(currentWorkspace);
    renderHistory(currentWorkspace);
  } catch (error) {
    currentWorkspace = { phase: "locked" };
    renderScope(currentWorkspace);
    renderKitchen(currentWorkspace);
    renderHistory(currentWorkspace);
  }
}

function buildDecision(workspace) {
  const fields = workspace.recipientRequest.scopedFields || [];
  const common = {
    handshakeId: workspace.recipientRequest.handshakeId,
    recipientId: workspace.recipientRequest.recipientId,
    dataScope: workspace.recipientRequest.dataScope,
  };
  const note = decisionNote.value.trim() || actionCopy(selectedAction, fields)[1];
  if (selectedAction === "accept") return createAcceptDecisionEvent({ ...common, rationale: note });
  if (selectedAction === "required_change") {
    const requiredChanges = workspace.policyEvaluation?.requiredChanges?.length
      ? workspace.policyEvaluation.requiredChanges
      : fields.map((field) => `Honor ${field.label} for this order.`);
    return createRequiredChangeDecisionEvent({ ...common, rationale: note, requiredChanges });
  }
  if (selectedAction === "decline") return createDeclineDecisionEvent({ ...common, rationale: note });
  return createCannotDetermineDecisionEvent({ ...common, reason: note });
}

actionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!currentWorkspace || currentWorkspace.phase !== "active" || currentWorkspace.decision) return;
    selectedAction = button.dataset.action;
    renderKitchen(currentWorkspace);
  });
});

recordButton.addEventListener("click", () => {
  if (!currentWorkspace || currentWorkspace.phase !== "active" || currentWorkspace.decision) return;
  try {
    recordRecipientDecision(buildDecision(currentWorkspace), dependencies);
    decisionNotice.textContent = "Kitchen decision recorded for this temporary order scope.";
    decisionNotice.hidden = false;
    renderWorkspace();
  } catch (error) {
    decisionNotice.textContent = `Decision was not recorded: ${error instanceof Error ? error.message : String(error)}`;
    decisionNotice.hidden = false;
  }
});

let lastLedgerSignature = "";
function pollClaim() {
  const signature = `${dependencies.storage.getItem(HANDSHAKE_CLAIM_STORAGE_KEY) || ""}|${dependencies.storage.getItem(HANDSHAKE_EVENT_LEDGER_STORAGE_KEY) || ""}`;
  if (signature === lastLedgerSignature) return;
  lastLedgerSignature = signature;
  renderWorkspace();
}
pollClaim();
setInterval(pollClaim, 1500);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pollClaim();
});
window.addEventListener("storage", (event) => {
  if (event.key === HANDSHAKE_CLAIM_STORAGE_KEY || event.key === HANDSHAKE_EVENT_LEDGER_STORAGE_KEY) renderWorkspace();
});
window.addEventListener("handshake:event", (event) => {
  const detail = event instanceof CustomEvent ? event.detail : null;
  if (detail && ["request", "consent", "decision", "expiry", "revocation"].includes(detail.type)) renderWorkspace();
});

document.querySelectorAll(".mode button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode button").forEach((item) => {
      item.classList.toggle("is-on", item === button);
    });
  });
});

document.querySelectorAll("#filters .chip").forEach((button) => {
  button.addEventListener("click", () => {
    button.classList.toggle("is-on");
  });
});

const placeButton = document.querySelector("#place");
const placeMenu = document.querySelector("#place-menu");
const placeLabel = document.querySelector("#place-label");
const placeMeta = document.querySelector("#place-meta");
placeButton?.addEventListener("click", (event) => {
  if (event.target.closest("#place-menu")) return;
  const open = placeMenu?.hidden;
  if (placeMenu) placeMenu.hidden = !open;
  placeButton.setAttribute("aria-expanded", String(Boolean(open)));
});
placeMenu?.querySelectorAll("button").forEach((option) => {
  option.addEventListener("click", () => {
    if (placeLabel) placeLabel.textContent = option.dataset.place || "Choose address";
    if (placeMeta) placeMeta.textContent = option.dataset.meta || "ASAP · Convenience";
    placeMenu.querySelectorAll("button").forEach((item) => {
      item.classList.toggle("is-on", item === option);
    });
    placeMenu.hidden = true;
    placeButton?.setAttribute("aria-expanded", "false");
  });
});
document.addEventListener("click", (event) => {
  if (!placeButton || placeButton.contains(event.target)) return;
  if (placeMenu) placeMenu.hidden = true;
  placeButton.setAttribute("aria-expanded", "false");
});

const cartLine = document.querySelector("#cart-line");
document.querySelectorAll(".card .add").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".card");
    const name = card?.querySelector(".name")?.textContent?.trim();
    const price = card?.querySelector(".price")?.textContent?.trim();
    if (!cartLine || !name || !price) return;
    const item = document.createElement("strong");
    item.textContent = name;
    const cost = document.createElement("span");
    cost.textContent = price;
    cartLine.replaceChildren(item, cost);
  });
});
