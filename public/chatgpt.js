const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#send");
const messagesView = document.querySelector("#messages");
const newChatButton = document.querySelector("#new-chat");
const recentsView = document.querySelector("#recents");
const shareButton = document.querySelector("#share");

const threads = [
  {
    id: "allergy-update",
    title: "AI Passport Allergy Update",
    messages: [
      { role: "user", content: "Please update my AI Passport — I have a peanut allergy." },
      { role: "assistant", content: "Got it. I saved a peanut allergy to your AI Passport. I’ll treat peanuts as unsafe in any food suggestion." },
    ],
  },
  {
    id: "milk-inquiry",
    title: "AI Passport Milk Inquiry",
    messages: [
      { role: "user", content: "I don’t like milk. Can you save that preference?" },
      { role: "assistant", content: "Saved. I’ll remember that you prefer to avoid milk, and I’ll keep that in mind when we talk about food." },
    ],
  },
  {
    id: "peanut-info",
    title: "Peanut Allergy Information",
    messages: [
      { role: "user", content: "What should I watch for with a peanut allergy when ordering food?" },
      { role: "assistant", content: "Ask about sauces, desserts, and shared fryers — peanuts show up in unexpected places, and cross-contact is common. When in doubt, tell the kitchen before you order." },
    ],
  },
];

let activeId = null;

function emptyMarkup() {
  return `<div class="empty" id="empty">
    <h1>How can I help you today?</h1>
    <div class="suggestions">
      <button class="suggestion" type="button" data-prompt="I don't like milk and I can't eat peanuts.">Remember that I don't like milk and I can't eat peanuts.</button>
      <button class="suggestion" type="button" data-prompt="I have a severe peanut allergy.">I have a severe peanut allergy — save that.</button>
      <button class="suggestion" type="button" data-prompt="I'm gluten free and allergic to shellfish.">I'm gluten free and allergic to shellfish.</button>
      <button class="suggestion" type="button" data-prompt="Help me pick a sandwich that is safe for my allergies.">Help me pick a sandwich that is safe for my allergies.</button>
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

function titleFrom(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "New chat";
  return compact.length > 42 ? `${compact.slice(0, 41)}…` : compact;
}

function currentThread() {
  return threads.find((thread) => thread.id === activeId) || null;
}

function renderRecents() {
  recentsView.replaceChildren();
  for (const thread of threads) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = thread.id === activeId ? "recent is-active" : "recent";
    button.dataset.thread = thread.id;
    button.textContent = thread.title;
    button.addEventListener("click", () => selectThread(thread.id));
    recentsView.append(button);
  }
}

function appendMessage(role, text) {
  document.querySelector("#empty")?.remove();
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const bubble = document.createElement("p");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.append(bubble);
  if (role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `<button type="button" data-action="copy" aria-label="Copy">⎘</button><button type="button" data-action="up" aria-label="Good response">👍</button><button type="button" data-action="down" aria-label="Bad response">👎</button>`;
    const copyBtn = actions.querySelector('[data-action="copy"]');
    const upBtn = actions.querySelector('[data-action="up"]');
    const downBtn = actions.querySelector('[data-action="down"]');
    copyBtn.addEventListener("click", () => copyText(bubble.textContent || ""));
    upBtn.addEventListener("click", () => {
      const on = upBtn.classList.toggle("is-on");
      if (on) downBtn.classList.remove("is-on");
    });
    downBtn.addEventListener("click", () => {
      const on = downBtn.classList.toggle("is-on");
      if (on) upBtn.classList.remove("is-on");
    });
    row.append(actions);
  }
  messagesView.append(row);
  row.scrollIntoView({ block: "end" });
  return bubble;
}

function renderThread() {
  const thread = currentThread();
  messagesView.replaceChildren();
  if (!thread || thread.messages.length === 0) {
    messagesView.innerHTML = emptyMarkup();
    bindSuggestions(messagesView);
    return;
  }
  for (const message of thread.messages) {
    appendMessage(message.role, message.content);
  }
}

function selectThread(id) {
  activeId = id;
  renderRecents();
  renderThread();
  promptInput.focus();
}

function ensureActiveThread(firstUserText) {
  let thread = currentThread();
  if (thread) {
    if (thread.messages.length === 0 && firstUserText) {
      thread.title = titleFrom(firstUserText);
    }
    return thread;
  }
  thread = {
    id: `thread-${Date.now()}`,
    title: titleFrom(firstUserText),
    messages: [],
  };
  threads.unshift(thread);
  activeId = thread.id;
  return thread;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

async function refreshChatStatus() {
  try {
    await fetch("/api/chat/status");
  } catch {
    // Status is best-effort; chat POST still syncs memories.
  }
}

async function refreshPassport() {
  try {
    await fetch("/api/passport/vault");
  } catch {
    // Vault poll is best-effort while chatting.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  promptInput.value = "";
  promptInput.style.height = "auto";
  sendButton.disabled = true;
  const thread = ensureActiveThread(text);
  thread.messages.push({ role: "user", content: text });
  renderRecents();
  appendMessage("user", text);
  const bubble = appendMessage("assistant", "Thinking…");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: thread.messages }),
    });
    const payload = await res.json();
    if (!res.ok) {
      bubble.classList.add("error");
      const setup = payload.error || "Chat is unavailable.";
      bubble.textContent = res.status === 503
        ? `${setup} You can still add a constraint in Handshake, or use the landing-page shortcut.`
        : setup;
      thread.messages.push({ role: "assistant", content: bubble.textContent });
      return;
    }
    bubble.textContent = payload.reply;
    thread.messages.push({ role: "assistant", content: payload.reply });
  } catch {
    bubble.classList.add("error");
    bubble.textContent = "Could not reach the local chat server. Is npm start running?";
    thread.messages.push({ role: "assistant", content: bubble.textContent });
  } finally {
    sendButton.disabled = false;
    promptInput.focus();
  }
});

newChatButton.addEventListener("click", () => {
  const current = currentThread();
  if (current && current.messages.length === 0) {
    promptInput.focus();
    return;
  }
  const thread = {
    id: `thread-${Date.now()}`,
    title: "New chat",
    messages: [],
  };
  threads.unshift(thread);
  activeId = thread.id;
  renderRecents();
  renderThread();
  promptInput.focus();
});

shareButton?.addEventListener("click", () => {
  copyText(`${location.origin}/chatgpt.html`);
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
renderRecents();
refreshChatStatus();
refreshPassport();
setInterval(refreshPassport, 4000);
