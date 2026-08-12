const HANDSHAKE_STORAGE_KEY = "egoist.demo.handshake-id";
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

let workspace = { phase: "locked", handshake: null, grant: null };
let selectedAction = "required_change";
let busy = false;

async function api(body) {
  const response = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? "The Handshake API could not complete this action.");
  return data;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatRemaining(validUntil) {
  return `${Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000))} min remaining`;
}

function decisionEvent(handshake) { return handshake.events.find((event) => event.type === "decision"); }

function actionCopy(action) {
  switch (action) {
    case "accept": return ["Preparation confirmation", "Dedicated peanut-free prep surface confirmed. Peanuts omitted from this order.", "Confirm safe preparation"];
    case "required_change": return ["Requested preparation change", "Omit peanuts and use the designated peanut-free preparation surface.", "Request preparation change"];
    case "decline": return ["Kitchen note", "The kitchen cannot safely separate peanut handling for this order.", "Cannot safely fulfill"];
    case "cannot_determine": return ["Supplier review note", "Supplier allergen documentation is unavailable for the selected ingredients.", "Cannot determine"];
  }
}

function renderScope() {
  scopeCard.className = `scope-card ${workspace.phase}`;
  if (workspace.phase === "active") {
    const field = workspace.handshake.dataScope.fields[0];
    scopeTitle.textContent = "Allergy scope active";
    scopeState.textContent = formatRemaining(workspace.handshake.dataScope.validUntil);
    const detail = element("div", "scope-detail");
    detail.append(element("span", "scope-detail-icon", "✓"), (() => { const copy = document.createElement("div"); copy.append(element("span", "scope-label", "Approved constraint"), element("p", "", String(workspace.grant.values[field.id] ?? field.label))); return copy; })());
    const facts = element("div", "scope-facts");
    for (const [label, value] of [["Purpose", workspace.handshake.dataScope.purpose], ["Order context", "Pad Thai · #A1024"], ["Access", formatRemaining(workspace.handshake.dataScope.validUntil)], ["Customer data", "One approved constraint"]]) { const fact = element("div", "scope-fact"); fact.append(element("span", "", label), element("strong", "", value)); facts.append(fact); }
    scopeBody.replaceChildren(detail, facts, element("p", "scope-note", "This permission is temporary and limited to this order. It is not a permanent customer profile."));
    return;
  }
  const revoked = workspace.phase === "revoked";
  scopeTitle.textContent = revoked ? "Access ended by customer" : "Permission required";
  scopeState.textContent = revoked ? "Scope removed" : "Not shared";
  scopeBody.replaceChildren(element("div", "locked-body", revoked ? "The customer ended this order scope. Allergy detail was removed by the Handshake API and cannot be retrieved for future action." : "Allergy details are unavailable. The customer has not granted a constraint for this order."));
}

function renderKitchen() {
  const decision = workspace.handshake && decisionEvent(workspace.handshake);
  const enabled = workspace.phase === "active" && !decision && !busy;
  actionButtons.forEach((button) => { button.disabled = !enabled; button.classList.toggle("active", enabled && button.dataset.action === selectedAction); });
  decisionNote.disabled = !enabled;
  recordButton.disabled = !enabled;
  if (!enabled) {
    kitchenIntro.textContent = decision ? "A kitchen decision has been recorded in the Handshake API." : workspace.phase === "revoked" ? "Future kitchen actions are locked because the customer ended access." : "Grant is required before a kitchen decision can use a customer constraint.";
    decisionLabel.textContent = decision ? "Recorded preparation detail" : "Preparation detail";
    decisionNote.value = decision?.payload.rationale ?? "";
    recordNote.textContent = decision ? "One kitchen decision is recorded for this order." : "Actions unlock only for an active order scope.";
    recordButton.textContent = decision ? "Decision recorded" : "Record kitchen decision";
    return;
  }
  const [label, note, buttonLabel] = actionCopy(selectedAction);
  kitchenIntro.textContent = "Choose the kitchen outcome for the approved order scope.";
  decisionLabel.textContent = label;
  decisionNote.value = note;
  recordNote.textContent = "This records a signed kitchen decision and receipt for this order only.";
  recordButton.textContent = buttonLabel;
}

function appendHistory(title, detail, ended = false) { const item = element("div", `history-item${ended ? " ended" : ""}`); item.append(element("span", "history-dot")); const copy = document.createElement("div"); copy.append(element("strong", "", title), document.createTextNode(detail)); item.append(copy); historyList.append(item); }

function renderHistory() {
  historyList.replaceChildren();
  appendHistory("Order received", "Pad Thai added to the lunch queue.");
  if (workspace.phase === "locked") return appendHistory("Customer constraint not shared", "Waiting for an order-specific permission.");
  if (workspace.phase === "revoked") return appendHistory("Access ended by customer", "The temporary order scope was removed. Allergy detail is no longer available.", true);
  appendHistory("Permission active", "One customer-approved constraint was retrieved from the Handshake API.");
  if (decisionEvent(workspace.handshake)) appendHistory("Kitchen decision recorded", "The order team recorded its preparation response and acknowledgement.");
}

function render() { renderScope(); renderKitchen(); renderHistory(); }

async function load() {
  const id = localStorage.getItem(HANDSHAKE_STORAGE_KEY);
  if (!id) { workspace = { phase: "locked", handshake: null, grant: null }; render(); return; }
  try {
    const data = await api({ action: "recipient-status", handshakeId: id });
    workspace = { phase: data.handshake.status === "active" ? "active" : data.handshake.status, handshake: data.handshake, grant: data.grant };
  } catch { workspace = { phase: "locked", handshake: null, grant: null }; }
  render();
}

actionButtons.forEach((button) => button.addEventListener("click", () => { if (!busy && workspace.phase === "active" && !decisionEvent(workspace.handshake)) { selectedAction = button.dataset.action; renderKitchen(); } }));

recordButton.addEventListener("click", async () => {
  if (busy || workspace.phase !== "active" || decisionEvent(workspace.handshake)) return;
  busy = true; render(); decisionNotice.hidden = true;
  try {
    await api({ action: "record-decision", handshakeId: workspace.handshake.id, response: selectedAction, rationale: decisionNote.value.trim() || actionCopy(selectedAction)[1] });
    decisionNotice.textContent = "Kitchen decision and acknowledgement recorded through the Handshake API.";
    decisionNotice.hidden = false;
    await load();
  } catch (error) { decisionNotice.textContent = error instanceof Error ? error.message : "Decision was not recorded."; decisionNotice.hidden = false; }
  finally { busy = false; render(); }
});

window.addEventListener("storage", (event) => { if (event.key === HANDSHAKE_STORAGE_KEY) load(); });
load();
