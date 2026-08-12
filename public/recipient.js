import { processRecipientRequest } from "/src/recipient-console.ts";
import {
  evaluateUniversalAllergyPolicy,
} from "/src/universal-policy-engine.ts";
import {
  HANDSHAKE_CLAIM_STORAGE_KEY,
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
  readHandshakeEventLedger,
} from "/src/passport-flow.ts";

const SAMPLE_DISH_PROFILES = {
  "pad-thai": {
    id: "pad-thai",
    name: "Pad Thai",
    ingredients: [
      { id: "ing-rice-noodles", name: "Rice Noodles", allergens: [], isVerifiedSupplier: true },
      { id: "ing-tofu", name: "Tofu", allergens: [], isVerifiedSupplier: true },
      { id: "ing-peanuts", name: "Peanuts", allergens: ["allergen.peanut"], isVerifiedSupplier: true },
      { id: "ing-soy-sauce", name: "Soy Sauce", allergens: ["allergen.gluten", "allergen.soy"], isVerifiedSupplier: true },
    ],
    allergens: ["allergen.peanut", "allergen.gluten", "allergen.soy"],
    substitutions: [
      {
        id: "sub-tamari",
        originalIngredientId: "ing-soy-sauce",
        originalIngredientName: "Soy Sauce",
        replacementIngredientId: "ing-tamari",
        replacementIngredientName: "Tamari GF Soy Sauce",
        description: "Substitute soy sauce with Tamari GF Soy Sauce",
        removesAllergens: ["allergen.gluten"],
      },
      {
        id: "sub-no-peanuts",
        originalIngredientId: "ing-peanuts",
        originalIngredientName: "Peanuts",
        replacementIngredientId: "ing-none",
        replacementIngredientName: "Omit Peanuts",
        description: "Omit peanuts from dish preparation",
        removesAllergens: ["allergen.peanut"],
      },
    ],
    hasUnverifiedSuppliers: false,
  },
  "green-curry": {
    id: "green-curry",
    name: "Green Curry",
    ingredients: [
      { id: "ing-coconut-milk", name: "Coconut Milk", allergens: ["allergen.tree_nut"], isVerifiedSupplier: true },
      { id: "ing-curry-paste", name: "Uncertified Special Curry Paste", allergens: [], isVerifiedSupplier: false },
      { id: "ing-bamboo", name: "Bamboo Shoots", allergens: [], isVerifiedSupplier: true },
    ],
    allergens: ["allergen.tree_nut"],
    substitutions: [],
    hasUnverifiedSuppliers: true,
  },
  "peanut-noodle-bowl": {
    id: "peanut-noodle-bowl",
    name: "Peanut Noodle Bowl",
    ingredients: [
      { id: "ing-egg-noodles", name: "Egg Noodles", allergens: ["allergen.gluten", "allergen.egg"], isVerifiedSupplier: true },
      { id: "ing-peanut-sauce", name: "Peanut Sauce", allergens: ["allergen.peanut"], isVerifiedSupplier: true },
    ],
    allergens: ["allergen.peanut", "allergen.gluten", "allergen.egg"],
    substitutions: [],
    hasUnverifiedSuppliers: false,
  },
  "gf-noodle-bowl": {
    id: "gf-noodle-bowl",
    name: "Gluten-Free Noodle Bowl",
    ingredients: [
      { id: "ing-rice-noodles", name: "Rice Noodles", allergens: [], isVerifiedSupplier: true },
      { id: "ing-tamari", name: "Tamari GF Soy Sauce", allergens: [], isVerifiedSupplier: true },
    ],
    allergens: [],
    substitutions: [],
    hasUnverifiedSuppliers: false,
  },
  "eu-14-sampler": {
    id: "eu-14-sampler",
    name: "EU 14 & Custom Sampler",
    ingredients: [
      { id: "ing-mustard-seed", name: "Mustard Seeds", allergens: ["allergen.mustard"], isVerifiedSupplier: true },
      { id: "ing-celery-root", name: "Celery Root", allergens: ["allergen.celery"], isVerifiedSupplier: true },
      { id: "ing-lupin-flour", name: "Lupin Flour", allergens: ["allergen.lupin"], isVerifiedSupplier: true },
      { id: "ing-beef-stock", name: "Beef Stock", allergens: ["allergen.alpha_gal"], isVerifiedSupplier: true },
      { id: "ing-wine-reduction", name: "Wine Reduction", allergens: ["allergen.sulfite"], isVerifiedSupplier: true },
    ],
    allergens: ["allergen.mustard", "allergen.celery", "allergen.lupin", "allergen.alpha_gal", "allergen.sulfite"],
    substitutions: [
      {
        id: "sub-veggie-stock",
        originalIngredientId: "ing-beef-stock",
        originalIngredientName: "Beef Stock",
        replacementIngredientId: "ing-veggie-stock",
        replacementIngredientName: "Organic Vegetable Broth",
        description: "Substitute beef stock with vegetable broth to eliminate Alpha-Gal",
        removesAllergens: ["allergen.alpha_gal"],
      },
    ],
    hasUnverifiedSuppliers: false,
  },
};

// Sample recipient database data
const sampleRecipientData = {
  "order.constraint.peanut": "Severe Peanut Allergy (No Peanuts)",
  "allergen.peanut": "Peanut Allergy",
  "allergen.gluten": "Gluten Sensitivity",
  "allergen.mustard": "Mustard Allergy",
  "allergen.alpha_gal": "Alpha-Gal Allergy",
};
const LOCAL_DEMO_LINKED_EVENTS_STORAGE_KEY = "handshake:demo-linked-events:v1";

const dependencies = {
  storage: window.localStorage,
  emit(event) {
    window.dispatchEvent(new CustomEvent("handshake:event", { detail: event }));
  },
};

const details = document.querySelector(".details");
const emptyState = document.querySelector("#empty-state");
const decisionCard = document.querySelector("#decision-card");
const outcomeCard = document.querySelector("#outcome-card");
const acknowledgementSection = document.querySelector("#acknowledgement-section");
const acknowledgementForm = document.querySelector("#acknowledgement-form");
const previewNotice = document.querySelector("#preview-notice");
const decisionForm = document.querySelector("#decision-form");
const errorView = document.querySelector("#recipient-error");

let activeRequest = null;
let activeDecision = null;
let currentTab = "accept";
let selectedDishId = "pad-thai";

function showError(message) {
  errorView.textContent = message;
  errorView.hidden = false;
}

function hasActiveGrant(events, request) {
  const now = Date.now();
  const startsAt = Date.parse(request.dataScope.validFrom);
  const endsAt = Date.parse(request.dataScope.validUntil);
  const hasTerminalEvent = events.some(
    (event) =>
      event.handshakeId === request.handshakeId &&
      (event.type === "expiry" || event.type === "revocation"),
  );
  return now >= startsAt && now < endsAt && !hasTerminalEvent;
}

function findActiveRequest() {
  const events = readHandshakeEventLedger(dependencies.storage).events;
  const requests = events.filter((event) => event.type === "request").reverse();

  for (const requestEvent of requests) {
    const consentEvent = events.find(
      (event) =>
        event.type === "consent" &&
        event.handshakeId === requestEvent.handshakeId &&
        event.payload.choice === "approve" &&
        event.payload.recipientId === requestEvent.payload.recipient.id,
    );
    if (!consentEvent || !hasActiveGrant(events, requestEvent)) {
      continue;
    }
    if (JSON.stringify(requestEvent.dataScope) !== JSON.stringify(consentEvent.dataScope)) {
      continue;
    }
    return processRecipientRequest(requestEvent, consentEvent, sampleRecipientData);
  }
  return null;
}

function resetResponseState() {
  activeDecision = null;
  outcomeCard.hidden = true;
  acknowledgementSection.hidden = true;
  previewNotice.hidden = true;
  decisionForm.querySelectorAll("button").forEach((button) => {
    button.disabled = false;
  });
  acknowledgementForm.reset();
  acknowledgementForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = false;
  });
  errorView.hidden = true;
}

function renderEmptyState() {
  activeRequest = null;
  details.hidden = true;
  emptyState.hidden = false;
  decisionCard.hidden = true;
  resetResponseState();
}

function selectTab(tabName) {
  currentTab = tabName;
  tabButtons.forEach((b) => {
    if (b.dataset.tab === tabName) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  tabPanels.forEach((panel) => {
    panel.hidden = panel.id !== `tab-panel-${tabName}`;
  });
}

// Dish Selector Switcher
const dishSelect = document.querySelector("#dish-select");
if (dishSelect) {
  dishSelect.addEventListener("change", (e) => {
    selectedDishId = e.target.value;
    renderRequest();
  });
}

function renderRequest() {
  const request = findActiveRequest();
  if (!request) {
    renderEmptyState();
    return;
  }

  activeRequest = request;
  details.hidden = false;
  emptyState.hidden = true;
  decisionCard.hidden = false;
  resetResponseState();

  document.querySelector("#handshake-id").textContent = activeRequest.handshakeId;
  document.querySelector("#claimant-id").textContent = activeRequest.claimantId;
  document.querySelector("#purpose").textContent = activeRequest.purpose;
  document.querySelector("#consent-choice").textContent = activeRequest.consentChoice.toUpperCase();
  document.querySelector("#field-count").textContent = String(activeRequest.scopedFields.length);

  // Render Scoped Fields Card List
  const container = document.querySelector("#scoped-fields-container");
  container.replaceChildren();

  if (activeRequest.scopedFields.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.style.color = "#65645c";
    emptyMsg.textContent = "No scoped fields available (consent denied or empty scope).";
    container.append(emptyMsg);
  } else {
    for (const field of activeRequest.scopedFields) {
      const card = document.createElement("div");
      card.className = "field-card";

      const header = document.createElement("div");
      header.className = "field-card-header";

      const label = document.createElement("span");
      label.className = "field-label";
      label.textContent = field.label;

      const idTag = document.createElement("span");
      idTag.className = "field-id";
      idTag.textContent = field.id;

      header.append(label, idTag);

      const val = document.createElement("div");
      val.className = "field-val";
      val.textContent = field.value !== undefined ? String(field.value) : "(No value provided)";

      card.append(header, val);
      container.append(card);
    }
  }

  // Universal Policy Engine Evaluation Logic
  const dish = SAMPLE_DISH_PROFILES[selectedDishId] || SAMPLE_DISH_PROFILES["pad-thai"];
  const requestedAllergies = activeRequest.scopedFields.map((f) => ({
    id: f.id,
    label: f.label,
    requireDedicatedSurface: true,
  }));

  const kitchenCapabilities = { dedicatedPrepSurface: true };
  const evalResult = evaluateUniversalAllergyPolicy(dish, requestedAllergies, kitchenCapabilities);

  // Render Severity Badges
  const badgesContainer = document.querySelector("#severity-badges-container");
  if (badgesContainer) {
    badgesContainer.replaceChildren();
    for (const badge of evalResult.severityBadges) {
      const el = document.createElement("span");
      el.className = `severity-badge ${badge.severity}`;
      el.textContent = badge.badgeLabel;
      badgesContainer.append(el);
    }
  }

  // Render Universal Policy Evaluation Rationale & Outcome
  const titleEl = document.querySelector("#policy-eval-title");
  const rationaleEl = document.querySelector("#policy-eval-rationale");

  if (titleEl && rationaleEl) {
    titleEl.textContent = `Policy Outcome: ${evalResult.response.toUpperCase().replace("_", " ")} (Dish: ${dish.name})`;
    rationaleEl.textContent = evalResult.rationale;
  }

  // Auto-switch decision tabs & prefill rationale based on policy evaluation
  selectTab(evalResult.response);

  if (evalResult.response === "accept") {
    const acceptInput = document.querySelector("#accept-rationale");
    if (acceptInput) acceptInput.value = evalResult.rationale;
  } else if (evalResult.response === "required_change") {
    const reqRationaleInput = document.querySelector("#req-change-rationale");
    const reqListInput = document.querySelector("#req-change-list");
    if (reqRationaleInput) reqRationaleInput.value = evalResult.rationale;
    if (reqListInput) reqListInput.value = evalResult.requiredChanges.join("\n");
  } else if (evalResult.response === "decline") {
    const declineInput = document.querySelector("#decline-rationale");
    if (declineInput) declineInput.value = evalResult.rationale;
  } else if (evalResult.response === "cannot_determine") {
    const cannotDetInput = document.querySelector("#cannot-determine-reason");
    if (cannotDetInput) cannotDetInput.value = evalResult.rationale;
  }
}

const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");
tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tabName = button.dataset.tab;
    currentTab = tabName;
    tabButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    tabPanels.forEach((panel) => {
      panel.hidden = panel.id !== `tab-panel-${tabName}`;
    });
  });
});

async function decisionForCurrentTab() {
  const {
    createAcceptDecisionEvent,
    createRequiredChangeDecisionEvent,
    createDeclineDecisionEvent,
    createCannotDetermineDecisionEvent,
  } = await import("/src/recipient-console.ts");
  const common = {
    handshakeId: activeRequest.handshakeId,
    recipientId: activeRequest.recipientId,
    dataScope: activeRequest.dataScope,
  };
  switch (currentTab) {
    case "accept":
      return createAcceptDecisionEvent({
        ...common,
        rationale: document.querySelector("#accept-rationale").value.trim() || "Peanut constraint confirmed for this order.",
      });
    case "required_change": {
      const requiredChanges = document.querySelector("#req-change-list").value
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean);
      return createRequiredChangeDecisionEvent({
        ...common,
        rationale: document.querySelector("#req-change-rationale").value.trim() || "A preparation change is needed before the order can proceed.",
        requiredChanges: requiredChanges.length > 0
          ? requiredChanges
          : ["Confirm the approved ingredient substitution."],
      });
    }
    case "decline":
      return createDeclineDecisionEvent({
        ...common,
        rationale: document.querySelector("#decline-rationale").value.trim() || "The kitchen cannot safely meet the peanut constraint for this order.",
      });
    case "cannot_determine":
      return createCannotDetermineDecisionEvent({
        ...common,
        reason: document.querySelector("#cannot-determine-reason").value.trim() || "Ingredient information is unavailable for this order.",
      });
    default:
      throw new Error("Unsupported decision response.");
  }
}

function showOutcome(decisionEvent) {
  outcomeCard.hidden = false;
  const badge = document.querySelector("#status-badge");
  badge.className = `status-badge ${decisionEvent.payload.response}`;
  badge.textContent = `RESPONSE: ${decisionEvent.payload.response.replaceAll("_", " ")}`;
  document.querySelector("#outcome-heading").textContent = `Decision: ${decisionEvent.payload.response.replaceAll("_", " ")}`;
  document.querySelector("#outcome-rationale").textContent = `Rationale: ${decisionEvent.payload.rationale}`;

  const changesBox = document.querySelector("#required-changes-box");
  const changesList = document.querySelector("#required-changes-list");
  if (decisionEvent.payload.requiredChanges) {
    changesList.replaceChildren(...decisionEvent.payload.requiredChanges.map((change) => {
      const item = document.createElement("li");
      item.textContent = change;
      return item;
    }));
    changesBox.hidden = false;
  } else {
    changesBox.hidden = true;
  }
  document.querySelector("#event-json").textContent = JSON.stringify(decisionEvent, null, 2);
  acknowledgementSection.hidden = false;
  outcomeCard.scrollIntoView({ behavior: "smooth" });
}

decisionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorView.hidden = true;
  if (!activeRequest) {
    renderEmptyState();
    return;
  }
  try {
    activeDecision = await decisionForCurrentTab();
    const { recordRecipientDecision } = await import("/src/recipient-console.ts");
    recordRecipientDecision(activeDecision, dependencies);
    decisionForm.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    showOutcome(activeDecision);
  } catch (error) {
    showError(`Decision was not recorded: ${error instanceof Error ? error.message : String(error)}`);
  }
});

acknowledgementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorView.hidden = true;
  if (!activeRequest || !activeDecision) {
    return;
  }
  const roleName = document.querySelector("#acknowledger-role").value.trim();
  if (!roleName) {
    return;
  }
  try {
    const { buildAcknowledgementEvent } = await import("/src/acknowledgement-event.ts");
    const acknowledgement = buildAcknowledgementEvent({
      handshakeId: activeRequest.handshakeId,
      actorId: activeRequest.recipientId,
      roleName,
      decisionEventId: activeDecision.eventId,
      outcome: document.querySelector("#acknowledgement-outcome").value,
      note: document.querySelector("#acknowledgement-note").value.trim() || undefined,
      dataScope: activeRequest.dataScope,
    });
    const { assertAcknowledgementCanBeRecorded } = await import("/src/recipient-console.ts");
    assertAcknowledgementCanBeRecorded(
      acknowledgement,
      activeDecision,
      activeRequest.recipientId,
      dependencies,
    );
    const localPreview = {
      handshakeId: activeRequest.handshakeId,
      events: [activeDecision, acknowledgement],
    };
    window.localStorage.setItem(
      LOCAL_DEMO_LINKED_EVENTS_STORAGE_KEY,
      JSON.stringify(localPreview),
    );
    window.dispatchEvent(
      new CustomEvent("handshake:demo-linked-events", {
        detail: localPreview.events,
      }),
    );
    acknowledgementForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
      control.disabled = true;
    });
    previewNotice.textContent = "Local acknowledgement recorded. Any claimant result is an unverified local preview, and delivery is pending authenticated recipient transport.";
    previewNotice.hidden = false;
  } catch (error) {
    showError(`Acknowledgement was not recorded: ${error instanceof Error ? error.message : String(error)}`);
  }
});

renderRequest();
window.addEventListener("storage", (event) => {
  if (
    event.key === HANDSHAKE_CLAIM_STORAGE_KEY ||
    event.key === HANDSHAKE_EVENT_LEDGER_STORAGE_KEY
  ) {
    renderRequest();
  }
});
window.addEventListener("handshake:event", (event) => {
  const detail = event instanceof CustomEvent ? event.detail : null;
  if (
    detail &&
    ["request", "consent", "expiry", "revocation"].includes(detail.type)
  ) {
    renderRequest();
  }
});
