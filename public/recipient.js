import {
  processRecipientRequest,
  createAcceptDecisionEvent,
  createRequiredChangeDecisionEvent,
  createDeclineDecisionEvent,
  createCannotDetermineDecisionEvent,
  recordRecipientDecision,
} from "/src/recipient-console.ts";
import {
  evaluateUniversalAllergyPolicy,
  UNIVERSAL_ALLERGEN_TAXONOMY,
  getAllergenMetadata,
} from "/src/universal-policy-engine.ts";
import {
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
  "order.constraint.dairy": "Dairy Free (No Lactose)",
  "allergen.peanut": "Peanut Allergy",
  "allergen.gluten": "Gluten Sensitivity",
  "allergen.mustard": "Mustard Allergy",
  "allergen.alpha_gal": "Alpha-Gal Allergy",
  "user.ssn": "999-00-1234 (UNREQUESTED PRIVACY FIELD)",
  "user.homeAddress": "123 Private St, Cityville (UNREQUESTED PRIVACY FIELD)",
};

const dependencies = {
  storage: window.localStorage,
  emit(event) {
    window.dispatchEvent(
      new CustomEvent("handshake:event", { detail: event }),
    );
  },
};

function getOrCreateSampleEvents() {
  const ledger = readHandshakeEventLedger(dependencies.storage);
  let requestEvent = ledger.events.find((e) => e.type === "request");
  let consentEvent = ledger.events.find((e) => e.type === "consent");

  if (!requestEvent || !consentEvent) {
    const handshakeId = `handshake-${Date.now()}`;
    const validFrom = new Date().toISOString();
    const validUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    requestEvent = {
      schemaVersion: "1.0.0",
      eventId: `event-req-${Date.now()}`,
      handshakeId,
      type: "request",
      occurredAt: validFrom,
      actor: { id: "claimant-1", role: "claimant" },
      dataScope: {
        purpose: "Prepare one restaurant order from requested dietary constraints.",
        fields: [
          { id: "allergen.peanut", label: "Peanut Constraint" },
          { id: "allergen.gluten", label: "Gluten Constraint" },
          { id: "allergen.alpha_gal", label: "Alpha-Gal Constraint" },
        ],
        validFrom,
        validUntil,
      },
      result: { status: "succeeded", failureCondition: null },
      payload: {
        recipient: { id: "recipient-1", displayName: "Bistro 42" },
        summary: "Universal allergen policy evaluation for dining order.",
      },
    };

    consentEvent = {
      schemaVersion: "1.0.0",
      eventId: `event-cons-${Date.now()}`,
      handshakeId,
      type: "consent",
      occurredAt: validFrom,
      actor: { id: "claimant-1", role: "claimant" },
      dataScope: {
        purpose: "Prepare one restaurant order from requested dietary constraints.",
        fields: [
          { id: "allergen.peanut", label: "Peanut Constraint" },
          { id: "allergen.gluten", label: "Gluten Constraint" },
          { id: "allergen.alpha_gal", label: "Alpha-Gal Constraint" },
        ],
        validFrom,
        validUntil,
      },
      result: { status: "succeeded", failureCondition: null },
      payload: { recipientId: "recipient-1", choice: "approve" },
    };
  }

  return { requestEvent, consentEvent };
}

let activeRequest = null;
let currentTab = "accept";
let selectedDishId = "pad-thai";

// Tab Switching Logic
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    selectTab(tabName);
  });
});

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
  const { requestEvent, consentEvent } = getOrCreateSampleEvents();
  activeRequest = processRecipientRequest(requestEvent, consentEvent, sampleRecipientData);

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

// Decision Form Submission
const form = document.querySelector("#decision-form");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!activeRequest) return;

  let decisionEvent;
  const handshakeId = activeRequest.handshakeId;
  const recipientId = activeRequest.recipientId;
  const dataScope = activeRequest.dataScope;

  try {
    switch (currentTab) {
      case "accept": {
        const rationale = document.querySelector("#accept-rationale").value.trim();
        decisionEvent = createAcceptDecisionEvent({
          handshakeId,
          recipientId,
          dataScope,
          rationale: rationale || "Request accepted. Scoped fields verified.",
        });
        break;
      }
      case "required_change": {
        const rationale = document.querySelector("#req-change-rationale").value.trim();
        const rawChanges = document.querySelector("#req-change-list").value;
        const requiredChanges = rawChanges
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        decisionEvent = createRequiredChangeDecisionEvent({
          handshakeId,
          recipientId,
          dataScope,
          rationale: rationale || "Required changes must be made before proceeding.",
          requiredChanges: requiredChanges.length > 0 ? requiredChanges : ["Specify constraint threshold."],
        });
        break;
      }
      case "decline": {
        const rationale = document.querySelector("#decline-rationale").value.trim();
        decisionEvent = createDeclineDecisionEvent({
          handshakeId,
          recipientId,
          dataScope,
          rationale: rationale || "Request declined by recipient policy.",
        });
        break;
      }
      case "cannot_determine": {
        const reason = document.querySelector("#cannot-determine-reason").value.trim();
        decisionEvent = createCannotDetermineDecisionEvent({
          handshakeId,
          recipientId,
          dataScope,
          reason: reason || "Unable to determine decision due to missing data.",
        });
        break;
      }
      default:
        throw new Error(`Unknown tab: ${currentTab}`);
    }

    recordRecipientDecision(decisionEvent, dependencies);
    showOutcome(decisionEvent);
  } catch (error) {
    alert(`Error generating decision event: ${error instanceof Error ? error.message : String(error)}`);
  }
});

function showOutcome(decisionEvent) {
  const card = document.querySelector("#outcome-card");
  card.hidden = false;

  const badge = document.querySelector("#status-badge");
  badge.className = `status-badge ${decisionEvent.payload.response}`;
  badge.textContent = `RESPONSE: ${decisionEvent.payload.response.toUpperCase().replaceAll("_", " ")}`;

  document.querySelector("#outcome-heading").textContent = `Decision: ${decisionEvent.payload.response.replaceAll("_", " ")}`;
  document.querySelector("#outcome-rationale").textContent = `Rationale: ${decisionEvent.payload.rationale}`;

  const reqBox = document.querySelector("#required-changes-box");
  const reqList = document.querySelector("#required-changes-list");
  if (decisionEvent.payload.response === "required_change" && decisionEvent.payload.requiredChanges) {
    reqList.replaceChildren();
    for (const change of decisionEvent.payload.requiredChanges) {
      const li = document.createElement("li");
      li.textContent = change;
      reqList.append(li);
    }
    reqBox.hidden = false;
  } else {
    reqBox.hidden = true;
  }

  document.querySelector("#event-json").textContent = JSON.stringify(decisionEvent, null, 2);
  card.scrollIntoView({ behavior: "smooth" });
}

// Initial render
renderRequest();

// Listen to handshake:event for live updates
window.addEventListener("handshake:event", (e) => {
  if (e instanceof CustomEvent && e.detail && e.detail.type === "consent") {
    renderRequest();
  }
});
