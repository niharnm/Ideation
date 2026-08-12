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
const API_HANDSHAKE_STORAGE_KEY = "egoist.demo.handshake-id";
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
const actionButtons = [...document.querySelectorAll(".kitchen-act-btn")];
const decisionLabel = document.querySelector("#decision-label") || { textContent: "" };
const decisionNote = document.querySelector("#decision-note");
const recordButton = document.querySelector("#record-decision");
const recordNote = document.querySelector("#record-note");
const decisionNotice = document.querySelector("#decision-notice");
const historyList = document.querySelector("#history-list");

let currentWorkspace = null;
let selectedAction = "required_change";
let busy = false;

async function demoApi(body) {
  const response = await fetch("/api/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? "The Handshake API could not complete this action.");
  return data;
}

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
    const fields = workspace.recipientRequest.scopedFields || [];
    const labels = fields.map((item) => item?.label || String(item?.value || field?.label || "Approved constraint"));
    setScopeState("active");
    scopeTitle.textContent = "Allergy scope active";
    scopeState.textContent = formatRemaining(workspace.recipientRequest.validUntil);

    const listWrapper = element("div", "scope-detail");
    const countText = fields.length === 1 ? "One approved constraint" : `${fields.length} approved constraints`;
    const labelTitle = element("span", "scope-label", countText);
    const allergyNames = element("strong", "", labels.join(", ") || "Peanut allergy");
    allergyNames.style.fontSize = "15px";
    allergyNames.style.color = "#00824d";
    allergyNames.style.display = "block";
    allergyNames.style.marginTop = "4px";

    listWrapper.append(labelTitle, allergyNames);
    scopeBody.replaceChildren(listWrapper);
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
  const enabled = active && !alreadyDecided && !busy;
  actionButtons.forEach((button) => {
    button.disabled = !enabled;
    button.classList.toggle("active", enabled && button.dataset.action === selectedAction);
  });
  decisionNote.disabled = !enabled;
  recordButton.disabled = !enabled;

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

recordButton.addEventListener("click", async () => {
  if (busy || !currentWorkspace || currentWorkspace.phase !== "active" || currentWorkspace.decision) return;
  const decision = buildDecision(currentWorkspace);
  const apiHandshakeId = dependencies.storage.getItem(API_HANDSHAKE_STORAGE_KEY);
  busy = true;
  decisionNotice.hidden = true;
  renderKitchen(currentWorkspace);
  try {
    if (apiHandshakeId) {
      await demoApi({
        action: "record-decision",
        handshakeId: apiHandshakeId,
        response: decision.payload.response,
        rationale: decision.payload.rationale,
      });
    }
    recordRecipientDecision(decision, dependencies);
    decisionNotice.textContent = apiHandshakeId
      ? "Kitchen decision and acknowledgement recorded through the Handshake API."
      : "Kitchen decision recorded for this temporary order scope.";
    decisionNotice.hidden = false;
    renderWorkspace();
  } catch (error) {
    decisionNotice.textContent = `Decision was not recorded: ${error instanceof Error ? error.message : String(error)}`;
    decisionNotice.hidden = false;
  } finally {
    busy = false;
    if (!currentWorkspace?.decision) renderKitchen(currentWorkspace);
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

// Place Order & Fake Checkout Confirmation
const placeOrderBtn = document.querySelector("#place-order-btn");
const orderConfirmedCard = document.querySelector("#order-confirmed-card");
const drawerBodyContent = document.querySelector("#drawer-body-content");

placeOrderBtn?.addEventListener("click", () => {
  // Read current Passport Vault memories or create default peanut claim
  let memories = [];
  try {
    const rawVault = window.localStorage.getItem("egoist.passport.vault.v1");
    if (rawVault) {
      const parsed = JSON.parse(rawVault);
      memories = Object.values(parsed.allergies || {}).map((a) => a.label);
    }
  } catch {
    memories = [];
  }
  if (memories.length === 0) memories = ["Peanut allergy"];

  // Emit N1 request & consent events automatically for this order
  const handshakeId = `handshake-${Date.now()}`;
  const now = new Date();
  const validUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  const requestEvent = {
    version: 1,
    type: "request",
    handshakeId,
    timestamp: now.toISOString(),
    payload: {
      recipient: { id: RECIPIENT_ID, name: "Fieldline" },
      purpose: "Prepare Pad Thai order with allergy constraints",
    },
    dataScope: {
      fields: memories.map((m) => `order.constraint.${m.toLowerCase().replace(/[^a-z]/g, "")}`),
      validFrom: now.toISOString(),
      validUntil,
    },
  };

  const consentEvent = {
    version: 1,
    type: "consent",
    handshakeId,
    timestamp: now.toISOString(),
    payload: {
      choice: "approve",
      recipientId: RECIPIENT_ID,
    },
    dataScope: requestEvent.dataScope,
  };

  const ledgerRaw = dependencies.storage.getItem(HANDSHAKE_EVENT_LEDGER_STORAGE_KEY);
  let ledger = { version: 1, events: [] };
  try {
    if (ledgerRaw) ledger = JSON.parse(ledgerRaw);
  } catch {}
  ledger.events.push(requestEvent, consentEvent);
  dependencies.storage.setItem(HANDSHAKE_EVENT_LEDGER_STORAGE_KEY, JSON.stringify(ledger));
  dependencies.storage.setItem(HANDSHAKE_CLAIM_STORAGE_KEY, JSON.stringify({ handshakeId, recipientId: RECIPIENT_ID }));

  // Notify listeners and re-render workspace
  dependencies.emit(consentEvent);
  renderWorkspace();

  // Show Order Confirmed visual card
  if (orderConfirmedCard) {
    orderConfirmedCard.hidden = false;
    const confirmedDetail = document.querySelector("#confirmed-allergy-detail");
    if (confirmedDetail) confirmedDetail.textContent = memories.join(", ");
  }
});

// Drawer Toggle Handlers
const cartTrigger = document.querySelector("#cart-header-trigger");
const cartDrawer = document.querySelector("#cart-drawer");
const drawerOverlay = document.querySelector("#drawer-overlay");
const closeDrawerBtn = document.querySelector("#close-drawer-btn");

function openCartDrawer() {
  cartDrawer?.classList.add("open");
  drawerOverlay?.classList.add("open");
}

function closeCartDrawer() {
  cartDrawer?.classList.remove("open");
  drawerOverlay?.classList.remove("open");
}

cartTrigger?.addEventListener("click", openCartDrawer);
closeDrawerBtn?.addEventListener("click", closeCartDrawer);
drawerOverlay?.addEventListener("click", closeCartDrawer);

// Smart AI Chef Prep Suggestion via Groq API
const smartAiBtn = document.querySelector("#smart-ai-suggest-btn");
smartAiBtn?.addEventListener("click", async () => {
  const fields = currentWorkspace?.recipientRequest?.scopedFields || [];
  const decisionNote = document.querySelector("#decision-note");
  if (!decisionNote) return;

  smartAiBtn.textContent = "Asking AI Chef...";
  try {
    const res = await fetch("/api/smart-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: "Pad Thai · #A1024",
        constraints: fields.map((f) => f.label || f.value || f.id),
      }),
    });
    const data = await res.json();
    if (data.suggestion) {
      decisionNote.value = data.suggestion;
    }
  } catch (err) {
    // Fallback if API fails
  } finally {
    smartAiBtn.textContent = "AI Chef Smart Suggestion";
  }
});

document.querySelectorAll(".mode-btn").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((item) => {
      item.classList.toggle("is-on", item === button);
    });
  });
});

document.querySelectorAll("#filters .filter-chip").forEach((button) => {
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
  if (placeMenu) {
    placeMenu.hidden = !open;
    placeMenu.classList.toggle("open", Boolean(open));
  }
  placeButton.setAttribute("aria-expanded", String(Boolean(open)));
});
placeMenu?.querySelectorAll(".address-opt").forEach((option) => {
  option.addEventListener("click", () => {
    if (placeLabel) placeLabel.textContent = option.dataset.place || "Delivery to Home";
    if (placeMeta) placeMeta.textContent = option.dataset.meta || "ASAP · 15-25 min";
    placeMenu.querySelectorAll(".address-opt").forEach((item) => {
      item.classList.toggle("is-on", item === option);
    });
    placeMenu.hidden = true;
    placeMenu.classList.remove("open");
    placeButton?.setAttribute("aria-expanded", "false");
  });
});
document.addEventListener("click", (event) => {
  if (!placeButton || placeButton.contains(event.target)) return;
  if (placeMenu) {
    placeMenu.hidden = true;
    placeMenu.classList.remove("open");
  }
  placeButton.setAttribute("aria-expanded", "false");
});

const cartLine = document.querySelector("#cart-line");
const cartCount = document.querySelector("#cart-count");
let totalCartItems = 1;

document.querySelectorAll(".food-card .add-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".food-card");
    const name = button.dataset.item || card?.querySelector(".food-title")?.textContent?.trim();
    const price = button.dataset.price || card?.querySelector(".food-price")?.textContent?.trim();
    if (!cartLine || !name || !price) return;

    totalCartItems += 1;
    if (cartCount) cartCount.textContent = String(totalCartItems);

    button.classList.add("added");
    button.textContent = "✓";

    const item = document.createElement("strong");
    item.textContent = name;
    const cost = document.createElement("span");
    cost.textContent = price;
    cartLine.replaceChildren(item, cost);

    // Open drawer to confirm addition visually
    openCartDrawer();
  });
});
