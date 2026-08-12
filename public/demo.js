import {
  HANDSHAKE_CLAIM_STORAGE_KEY,
  HANDSHAKE_EVENT_LEDGER_STORAGE_KEY,
  approveScopedRequest,
  readHandshakeEventLedger,
  readScopedClaim,
  revokeScopedClaim,
} from "/src/passport-flow.ts";

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

const dependencies = {
  storage: window.localStorage,
  emit(event) {
    window.dispatchEvent(new CustomEvent("handshake:event", { detail: event }));
  },
};

function clearError() {
  errorView.textContent = "";
}

function formatRemaining(validUntil) {
  const minutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
  return `${minutes} min remaining`;
}

function updatePreview({ status, claim = null }) {
  previewBadge.classList.toggle("revoked", status === "revoked");
  if (status === "active" && claim) {
    previewBadge.textContent = "Scope active";
    previewTime.textContent = formatRemaining(claim.dataScope.validUntil);
    previewConstraint.textContent = claim.dataScope.fields[0]?.label ?? "Approved constraint";
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
  const claim = readScopedClaim(dependencies.storage);
  const decisionCount = readHandshakeEventLedger(dependencies.storage).events.filter((event) => event.type === "decision").length;
  statusDot.className = "status-dot";
  revokeButton.hidden = true;

  if (claim?.status === "active" && Date.parse(claim.dataScope.validUntil) > Date.now()) {
    statusDot.classList.add("active");
    statusKicker.textContent = "Active restaurant scope";
    statusTitle.textContent = "The restaurant can review one approved constraint.";
    statusDescription.textContent = decisionCount > 0
      ? "A kitchen decision has been recorded in this local demo. The customer can still revoke future use at any time."
      : "The restaurant receives only the peanut constraint for this order, then chooses how it can safely proceed.";
    statusScope.textContent = claim.dataScope.fields.map((field) => field.label).join(", ");
    statusAccess.textContent = formatRemaining(claim.dataScope.validUntil);
    revokeButton.hidden = false;
    updatePreview({ status: "active", claim });
    return;
  }

  if (claim?.status === "revoked") {
    statusDot.classList.add("revoked");
    statusKicker.textContent = "Customer revoked access";
    statusTitle.textContent = "The restaurant’s permission is now locked.";
    statusDescription.textContent = "The restaurant workspace can no longer retrieve the allergy scope or make a future decision from it. The local demo keeps its event history only as unverified proof-case data.";
    statusScope.textContent = "No longer available";
    statusAccess.textContent = "Revoked";
    updatePreview({ status: "revoked" });
    return;
  }

  statusKicker.textContent = "Demo ready";
  statusTitle.textContent = "No restaurant scope is active.";
  statusDescription.textContent = "Start the handshake to issue one time-bound peanut constraint to the restaurant workspace.";
  statusScope.textContent = "Not shared";
  statusAccess.textContent = "Waiting";
  updatePreview({ status: "none" });
}

startButton.addEventListener("click", () => {
  clearError();
  try {
    const existing = readScopedClaim(dependencies.storage);
    if (existing?.status === "active") {
      if (existing.claimantId !== "claimant-demo") {
        errorView.textContent = "An unrelated local demo claim is active. Revoke it from its original claimant screen before starting this flow.";
        return;
      }
      revokeScopedClaim("claimant-demo", dependencies, "A fresh demo handshake replaced this scope.");
    }
    const validFrom = new Date();
    const validUntil = new Date(validFrom.getTime() + 15 * 60_000);
    const result = approveScopedRequest({
      claimantId: "claimant-demo",
      recipient: { id: "recipient-1", displayName: "Fieldline" },
      summary: "Use one allergy constraint to safely prepare one restaurant order.",
      draft: {
        purpose: "Prepare one Pad Thai order with a peanut constraint.",
        fields: [{ id: "order.constraint.peanut", label: "Peanut allergy", selected: true }],
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
        choice: null,
      },
    }, dependencies);
    if (!result.success) {
      errorView.textContent = result.issues.map((issue) => issue.message).join(" ");
    }
  } catch (error) {
    errorView.textContent = error instanceof Error ? error.message : "The demo handshake could not be started.";
  }
  render();
});

revokeButton.addEventListener("click", () => {
  clearError();
  try {
    revokeScopedClaim("claimant-demo", dependencies, "The customer ended restaurant access from the demo.");
  } catch (error) {
    errorView.textContent = error instanceof Error ? error.message : "Restaurant access could not be revoked.";
  }
  render();
});

window.addEventListener("storage", (event) => {
  if (event.key === HANDSHAKE_CLAIM_STORAGE_KEY || event.key === HANDSHAKE_EVENT_LEDGER_STORAGE_KEY) {
    render();
  }
});
window.addEventListener("handshake:event", render);

render();
