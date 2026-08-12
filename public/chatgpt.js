const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#send");
const messagesView = document.querySelector("#messages");
const savedView = document.querySelector("#saved");
const newChatButton = document.querySelector("#new-chat");
const pluginChip = document.querySelector("#plugin-chip");
const pluginChipLabel = document.querySelector("#plugin-chip-label");
const nextStep = document.querySelector("#next-step");

const messages = [];

function emptyMarkup() {
  return `<div class="empty" id="empty">
    <h1>What's on the menu?</h1>
    <p>Tell me your allergies. The Egoist AI Passport plugin will save them for checkout.</p>
    <div class="suggestions">
      <button class="suggestion" type="button" data-prompt="I don't like milk and I can't eat peanuts.">Milk and peanuts</button>
      <button class="suggestion" type="button" data-prompt="I have a severe peanut allergy.">Peanut allergy</button>
      <button class="suggestion" type="button" data-prompt="I'm gluten free and allergic to shellfish.">Gluten and shellfish</button>
    </div>
  </div>`;
}

function bindSuggestions(root = document) {
  root.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      promptInput.value = button.dataset.prompt || button.textContent;
      promptInput.focus();
      promptInput.dispatchEvent(new Event("input"));
    });
  });
}

function appendMessage(role, text) {
  document.querySelector("#empty")?.remove();
  const row = document.createElement("div");
  row.className = "msg enter-fade";
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

function setPluginAvailable(available, detail = "") {
  pluginChip.classList.toggle("unavailable", !available);
  pluginChipLabel.textContent = available
    ? "Egoist AI Passport · Connected"
    : detail || "Egoist AI Passport · Chat unavailable";
}

let lastSavedKey = "";

function renderSaved(constraints) {
  const key = JSON.stringify(constraints || []);
  const isUpdate = key !== lastSavedKey && lastSavedKey !== "";
  lastSavedKey = key;
  savedView.replaceChildren();
  if (!Array.isArray(constraints) || constraints.length === 0) {
    const empty = document.createElement("p");
    empty.className = "saved-empty";
    empty.textContent = "No dietary memories saved yet. Mention an allergy in chat.";
    savedView.append(empty);
    nextStep?.classList.remove("is-visible");
    return;
  }
  const heading = document.createElement("p");
  heading.className = "saved-heading";
  heading.textContent = "Saved to AI Passport";
  savedView.append(heading);
  for (const constraint of constraints) {
    const item = document.createElement("div");
    item.className = isUpdate ? "saved-item is-new" : "saved-item";
    item.textContent = constraint.label || constraint.allergenId;
    savedView.append(item);
  }
  nextStep?.classList.add("is-visible");
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

async function refreshChatStatus() {
  try {
    const res = await fetch("/api/chat/status");
    if (!res.ok) return;
    const status = await res.json();
    setPluginAvailable(Boolean(status.available), status.error);
  } catch {
    setPluginAvailable(false, "Egoist AI Passport · Offline");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  promptInput.value = "";
  promptInput.style.height = "auto";
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
      const setup = payload.error || "Chat is unavailable.";
      bubble.textContent = res.status === 503
        ? `${setup} You can still add a constraint in Handshake, or use the landing-page shortcut.`
        : setup;
      if (res.status === 503) {
        setPluginAvailable(false, setup);
      }
      return;
    }
    setPluginAvailable(true);
    bubble.textContent = payload.reply;
    messages.push({ role: "assistant", content: payload.reply });
    renderSaved(payload.constraints || []);
  } catch {
    bubble.classList.add("error");
    bubble.textContent = "Could not reach the local chat server. Is npm start running?";
    setPluginAvailable(false, "Egoist AI Passport · Offline");
  } finally {
    sendButton.disabled = false;
    promptInput.focus();
  }
});

newChatButton.addEventListener("click", () => {
  messages.length = 0;
  messagesView.innerHTML = emptyMarkup();
  bindSuggestions(messagesView);
  promptInput.focus();
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

bindSuggestions();
renderSaved([]);
refreshChatStatus();
refreshPassport();
setInterval(refreshPassport, 4000);
