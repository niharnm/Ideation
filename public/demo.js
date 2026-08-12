const HANDSHAKE_STORAGE_KEY = "egoist.demo.handshake-id";
const startButton = document.querySelector("#start-handshake");
const revokeButton = document.querySelector("#revoke-handshake");
const errorView = document.querySelector("#demo-error");
const statusDot = document.querySelector("#status-dot");
const statusKicker = document.querySelector("#status-kicker");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");
const statusScope = document.querySelector("#status-scope");
const statusAccess = document.querySelector("#status-access");
const previewBadge = document.querySelector("#preview-badge");
const previewTime = document.querySelector("#preview-time");
const previewConstraint = document.querySelector("#preview-constraint");
const previewCopy = document.querySelector("#preview-copy");
const previewAction = document.querySelector("#preview-action");

let handshake = null;
let busy = false;

async function api(body) {
  const response = await fetch("/api/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? "The Handshake API could not complete this action.");
  return data;
}

function clearError() { errorView.textContent = ""; }

function formatRemaining(validUntil) {
  const minutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
  return `${minutes} min remaining`;
}

function updatePreview(status, record = null) {
  previewBadge.classList.toggle("revoked", status === "revoked");
  if (status === "active" && record) {
    previewBadge.textContent = "Scope active";
    previewTime.textContent = formatRemaining(record.dataScope.validUntil);
    previewConstraint.textContent = record.dataScope.fields[0]?.label ?? "Approved constraint";
    previewCopy.textContent = "Use this one constraint to evaluate this order. Access expires automatically.";
    previewCopy.classList.remove("revoked-copy");
    previewAction.textContent = "Kitchen review is ready.";
    return;
  }
  if (status === "revoked") {
    previewBadge.textContent = "Access ended";
    previewTime.textContent = "No future access";
    previewConstraint.textContent = "Scoped detail removed";
    previewCopy.textContent = "The customer revoked this permission. Restaurant actions that need the scope are blocked.";
    previewCopy.classList.add("revoked-copy");
    previewAction.textContent = "Kitchen review is locked.";
    return;
  }
  previewBadge.textContent = "No scope";
  previewTime.textContent = "Waiting";
  previewConstraint.textContent = "No order constraint shared";
  previewCopy.textContent = "A customer can grant only the minimum information required for a single order.";
  previewCopy.classList.remove("revoked-copy");
  previewAction.textContent = "Waiting for a handshake.";
}

function render() {
  startButton.disabled = busy;
  revokeButton.disabled = busy;
  statusDot.className = "status-dot";
  revokeButton.hidden = true;
  if (handshake?.status === "active" && Date.parse(handshake.dataScope.validUntil) > Date.now()) {
    const decision = handshake.events.find((event) => event.type === "decision");
    statusDot.classList.add("active");
    statusKicker.textContent = "Active restaurant scope";
    statusTitle.textContent = "The restaurant can review one approved constraint.";
    statusDescription.textContent = decision
      ? "A kitchen decision is recorded in the Handshake API. You can still revoke future use at any time."
      : `The restaurant receives only ${handshake.dataScope.fields[0]?.label ?? "the approved constraint"} for this order, then chooses how it can safely proceed.`;
    statusScope.textContent = handshake.dataScope.fields.map((field) => field.label).join(", ");
    statusAccess.textContent = formatRemaining(handshake.dataScope.validUntil);
    revokeButton.hidden = false;
    updatePreview("active", handshake);
    return;
  }
  if (handshake?.status === "revoked") {
    statusDot.classList.add("revoked");
    statusKicker.textContent = "Customer revoked access";
    statusTitle.textContent = "The restaurant’s permission is now locked.";
    statusDescription.textContent = "The Handshake API removed the encrypted scoped value. The restaurant can no longer retrieve or use it.";
    statusScope.textContent = "No longer available";
    statusAccess.textContent = "Revoked";
    updatePreview("revoked");
    return;
  }
  statusKicker.textContent = "Demo ready";
  statusTitle.textContent = "No restaurant scope is active.";
  statusDescription.textContent = "Start the handshake to issue one time-bound passport constraint through the API.";
  statusScope.textContent = "Not shared";
  statusAccess.textContent = "Waiting";
  updatePreview("none");
}

async function load() {
  const id = localStorage.getItem(HANDSHAKE_STORAGE_KEY);
  if (!id) return render();
  try {
    handshake = (await api({ action: "claimant-status", handshakeId: id })).handshake;
  } catch {
    localStorage.removeItem(HANDSHAKE_STORAGE_KEY);
    handshake = null;
  }
  render();
}

startButton.addEventListener("click", (event) => {
  event.preventDefault();
  window.location.href = "/index.html";
});

revokeButton.addEventListener("click", async () => {
  if (!handshake) return;
  clearError();
  busy = true;
  render();
  try {
    handshake = (await api({ action: "revoke", handshakeId: handshake.id })).handshake;
  } catch (error) {
    errorView.textContent = error instanceof Error ? error.message : "Restaurant access could not be revoked.";
  } finally {
    busy = false;
    render();
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === HANDSHAKE_STORAGE_KEY) load();
});

load();
