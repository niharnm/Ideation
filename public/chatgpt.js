const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#send");
const messagesView = document.querySelector("#messages");
const emptyView = document.querySelector("#empty");
const savedView = document.querySelector("#saved");
const newChatButton = document.querySelector("#new-chat");

const messages = [];

function appendMessage(role, text) {
  emptyView?.remove();
  const row = document.createElement("div");
  row.className = "msg";
  const avatar = document.createElement("div");
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === "user" ? "You" : "AI";
  const bubble = document.createElement("p");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.append(avatar, bubble);
  messagesView.append(row);
  row.scrollIntoView({ block: "end" });
  return bubble;
}

function renderSaved(constraints) {
  savedView.replaceChildren();
  if (!Array.isArray(constraints) || constraints.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No dietary memories saved yet.";
    savedView.append(empty);
    return;
  }
  const heading = document.createElement("p");
  heading.textContent = "Saved to AI Passport";
  savedView.append(heading);
  for (const constraint of constraints) {
    const item = document.createElement("div");
    item.className = "saved-item";
    item.textContent = constraint.label || constraint.allergenId;
    savedView.append(item);
  }
}

async function refreshPassport() {
  try {
    const res = await fetch("/api/passport/vault");
    if (!res.ok) return;
    const vault = await res.json();
    const constraints = (vault.allergies || []).filter((item) =>
      String(item.allergenId).startsWith("allergen.")
    );
    renderSaved(constraints);
  } catch {
    // Vault poll is best-effort while chatting.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  promptInput.value = "";
  sendButton.disabled = true;
  appendMessage("user", text);
  messages.push({ role: "user", content: text });
  const bubble = appendMessage("assistant", "Thinking…");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const payload = await res.json();
    if (!res.ok) {
      bubble.classList.add("error");
      bubble.textContent = payload.error || "Chat is unavailable.";
      return;
    }
    bubble.textContent = payload.reply;
    messages.push({ role: "assistant", content: payload.reply });
    renderSaved(payload.constraints || []);
  } catch {
    bubble.classList.add("error");
    bubble.textContent = "Could not reach the local chat server.";
  } finally {
    sendButton.disabled = false;
    promptInput.focus();
  }
});

newChatButton.addEventListener("click", () => {
  messages.length = 0;
  messagesView.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.id = "empty";
  empty.innerHTML =
    "<h1>What's on the menu?</h1><p>Tell me your allergies. The Egoist AI Passport plugin will save them for checkout.</p>";
  messagesView.append(empty);
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
});

refreshPassport();
renderSaved([]);
