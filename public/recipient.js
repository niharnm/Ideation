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

function renderScope() {
  scopeCard.className = `scope-card ${workspace.phase}`;
  if (workspace.phase === "active") {
    const fields = workspace.handshake.dataScope.fields;
    const labels = fields.map((field) => String(workspace.grant.values[field.id] ?? field.label));
    scopeTitle.textContent = "Allergy scope active";
    scopeState.textContent = formatRemaining(workspace.handshake.dataScope.validUntil);
    const detail = element("div", "scope-detail");
    detail.append(element("span", "scope-detail-icon", "✓"), (() => { const copy = document.createElement("div"); copy.append(element("span", "scope-label", fields.length === 1 ? "Approved constraint" : "Approved constraints"), element("p", "", labels.join(", "))); return copy; })());
    const facts = element("div", "scope-facts");
    for (const [label, value] of [["Purpose", workspace.handshake.dataScope.purpose], ["Order context", "Pad Thai · #A1024"], ["Access", formatRemaining(workspace.handshake.dataScope.validUntil)], ["Customer data", fields.length === 1 ? "One approved constraint" : `${fields.length} approved constraints`]]) { const fact = element("div", "scope-fact"); fact.append(element("span", "", label), element("strong", "", value)); facts.append(fact); }
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
  const fields = workspace.handshake.dataScope.fields.map((field) => ({
    ...field,
    value: workspace.grant.values[field.id],
  }));
  const [label, note, buttonLabel] = actionCopy(selectedAction, fields);
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
  const fieldCount = workspace.handshake.dataScope.fields.length;
  appendHistory("Permission active", fieldCount === 1 ? "One customer-approved constraint was retrieved from the Handshake API." : `${fieldCount} customer-approved constraints were retrieved from the Handshake API.`);
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
    const fields = workspace.handshake.dataScope.fields.map((field) => ({
      ...field,
      value: workspace.grant.values[field.id],
    }));
    await api({ action: "record-decision", handshakeId: workspace.handshake.id, response: selectedAction, rationale: decisionNote.value.trim() || actionCopy(selectedAction, fields)[1] });
    decisionNotice.textContent = "Kitchen decision and acknowledgement recorded through the Handshake API.";
    decisionNotice.hidden = false;
    await load();
  } catch (error) { decisionNotice.textContent = error instanceof Error ? error.message : "Decision was not recorded."; decisionNotice.hidden = false; }
  finally { busy = false; render(); }
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
window.addEventListener("storage", (event) => { if (event.key === HANDSHAKE_STORAGE_KEY) load(); });
load();
