import {
  approveScopedRequest,
  denyScopedRequest,
  expireScopedClaimIfNeeded,
  revokeScopedClaim,
} from "/src/passport-flow.ts";

const recipient = { id: "recipient-1", displayName: "Recipient" };
const purpose = "Prepare one restaurant order from the constraints you choose.";
const summary = "Use the selected scoped fields for one restaurant order.";
const fieldOptions = [
  { id: "order.constraint.peanut", label: "Peanut constraint", selected: true },
  { id: "order.constraint.dairy", label: "Dairy constraint", selected: true },
  { id: "order.preference.vegetarian", label: "Vegetarian preference", selected: false },
];

const requestView = document.querySelector("#request-view");
const outcomeView = document.querySelector("#outcome-view");
const fieldsView = document.querySelector("#fields");
const durationSelect = document.querySelector("#duration");
const endTimeView = document.querySelector("#end-time");
const approveButton = document.querySelector("#approve");
const denyButton = document.querySelector("#deny");
const errorView = document.querySelector("#error");

let validFrom = new Date();

for (const field of fieldOptions) {
  const label = document.createElement("label");
  label.className = "field";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = field.id;
  input.checked = field.selected;
  input.dataset.label = field.label;
  const text = document.createElement("span");
  text.textContent = field.label;
  label.append(input, text);
  fieldsView.append(label);
}

const dependencies = {
  storage: window.localStorage,
  emit(event) {
    window.dispatchEvent(
      new CustomEvent("handshake:event", { detail: event }),
    );
  },
};

function draft(choice = null) {
  const durationMs = Number(durationSelect.value) * 60 * 1_000;
  return {
    purpose,
    fields: [...fieldsView.querySelectorAll("input")].map((input) => ({
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

function scheduleExpiry(claim) {
  const delay = Date.parse(claim.dataScope.validUntil) - Date.now();
  if (delay <= 0) {
    const expired = expireScopedClaimIfNeeded(dependencies);
    if (expired?.status === "expired") {
      showExpiredOutcome();
    }
    return;
  }
  window.setTimeout(() => {
    const expired = expireScopedClaimIfNeeded(dependencies);
    if (expired?.status === "expired") {
      showExpiredOutcome();
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
  showOutcome(
    "approved",
    "Approved for one order",
    "Only the selected fields are available to the recipient until the stated time.",
    result.value.claim,
  );
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
  showOutcome(
    "approved",
    "Approved for one order",
    "Only the selected fields are available to the recipient until the stated time.",
    storedClaim,
  );
  scheduleExpiry(storedClaim);
} else if (storedClaim?.status === "revoked") {
  showOutcome(
    "revoked",
    "Access revoked",
    "The recipient is blocked from future use of this claim.",
  );
} else if (storedClaim?.status === "expired") {
  showExpiredOutcome();
} else {
  validFrom = new Date();
  updateEndTime();
}
