import {
  processRecipientRequest,
  createAcceptDecisionEvent,
  createRequiredChangeDecisionEvent,
  createDeclineDecisionEvent,
  createCannotDetermineDecisionEvent,
  createRecipientDecisionEvent,
  recordRecipientDecision,
} from "/src/recipient-console.ts";
import {
  readHandshakeEventLedger,
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
} from "/src/passport-flow.ts";

// Sample recipient database data containing both requested fields AND unrequested claimant data
const sampleRecipientData = {
  "order.constraint.peanut": "Severe Peanut Allergy (No Peanuts)",
  "order.constraint.dairy": "Dairy Free (No Lactose)",
  "user.ssn": "999-00-1234 (UNREQUESTED PRIVACY FIELD)",
  "user.homeAddress": "123 Private St, Cityville (UNREQUESTED PRIVACY FIELD)",
  "user.creditCard": "4111-XXXX-XXXX-1111 (UNREQUESTED PRIVACY FIELD)",
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
          { id: "order.constraint.peanut", label: "Peanut constraint" },
          { id: "order.constraint.dairy", label: "Dairy constraint" },
        ],
        validFrom,
        validUntil,
      },
      result: { status: "succeeded", failureCondition: null },
      payload: {
        recipient: { id: "recipient-1", displayName: "Bistro 42" },
        summary: "Scoped dietary constraint request for dinner order.",
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
          { id: "order.constraint.peanut", label: "Peanut constraint" },
          { id: "order.constraint.dairy", label: "Dairy constraint" },
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

// Tab Switching Logic
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    currentTab = tabName;

    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    tabPanels.forEach((panel) => {
      if (panel.id === `tab-panel-${tabName}`) {
        panel.hidden = false;
      } else {
        panel.hidden = true;
      }
    });
  });
});

function renderRequest() {
  const { requestEvent, consentEvent } = getOrCreateSampleEvents();
  activeRequest = processRecipientRequest(requestEvent, consentEvent, sampleRecipientData);

  document.querySelector("#handshake-id").textContent = activeRequest.handshakeId;
  document.querySelector("#claimant-id").textContent = activeRequest.claimantId;
  document.querySelector("#purpose").textContent = activeRequest.purpose;
  document.querySelector("#consent-choice").textContent = activeRequest.consentChoice.toUpperCase();
  document.querySelector("#field-count").textContent = String(activeRequest.scopedFields.length);

  const container = document.querySelector("#scoped-fields-container");
  container.replaceChildren();

  if (activeRequest.scopedFields.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.style.color = "#65645c";
    emptyMsg.textContent = "No scoped fields available (consent denied or empty scope).";
    container.append(emptyMsg);
    return;
  }

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
