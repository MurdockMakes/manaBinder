const STORAGE_KEY = "manaTradeBinderState:v1";

const stores = [
  { id: "arcane-table", name: "Arcane Table", area: "Downtown" },
  { id: "planeswalkers-post", name: "Planeswalker's Post", area: "Northside" },
  { id: "mana-market", name: "Mana Market", area: "West End" },
  { id: "combat-step", name: "Combat Step Games", area: "East Loop" },
  { id: "library-lounge", name: "Library Lounge", area: "South Bay" }
];

const cards = [
  { id: "sol-ring", name: "Sol Ring", type: "Artifact", price: 1.85, art: ["#d4af37", "#1a1f2b"] },
  { id: "rhystic-study", name: "Rhystic Study", type: "Enchantment", price: 42.2, art: ["#276fbf", "#5ec0ce"] },
  { id: "dockside-extortionist", name: "Dockside Extortionist", type: "Creature", price: 58.6, art: ["#a33a3a", "#f2a65a"] },
  { id: "smothering-tithe", name: "Smothering Tithe", type: "Enchantment", price: 28.35, art: ["#f7d774", "#6b7a4f"] },
  { id: "cyclonic-rift", name: "Cyclonic Rift", type: "Instant", price: 31.15, art: ["#2f5f9b", "#91d8e4"] },
  { id: "the-one-ring", name: "The One Ring", type: "Legendary Artifact", price: 72.5, art: ["#111815", "#d4af37"] },
  { id: "esper-sentinel", name: "Esper Sentinel", type: "Artifact Creature", price: 19.4, art: ["#e9e4d0", "#5b6d7d"] },
  { id: "teferis-protection", name: "Teferi's Protection", type: "Instant", price: 36.9, art: ["#f3efe5", "#9370db"] },
  { id: "fierce-guardianship", name: "Fierce Guardianship", type: "Instant", price: 64.25, art: ["#1b4965", "#62b6cb"] },
  { id: "ancient-tomb", name: "Ancient Tomb", type: "Land", price: 81.75, art: ["#7d5a38", "#c2b280"] },
  { id: "deflecting-swat", name: "Deflecting Swat", type: "Instant", price: 44.8, art: ["#c0392b", "#f4d35e"] },
  { id: "parallel-lives", name: "Parallel Lives", type: "Enchantment", price: 49.2, art: ["#1e6f54", "#9bc53d"] }
];

const conditionFactor = {
  "Near Mint": 1,
  "Lightly Played": 0.9,
  "Moderately Played": 0.78,
  "Heavily Played": 0.62,
  Damaged: 0.45
};

const els = {};
let state = loadState();
let cardFilter = "";
let publicFilter = "";
let storeFilter = "mine";

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  renderAll();
});

function bindElements() {
  [
    "sessionBadge",
    "signupForm",
    "emailInput",
    "nicknameInput",
    "passwordInput",
    "storeChoices",
    "saveStoresButton",
    "accountMessage",
    "demoUserButton",
    "publicProfile",
    "cardFilterInput",
    "conditionSelect",
    "binderNoteInput",
    "cardCatalog",
    "binderCount",
    "myBinderList",
    "publishBinderButton",
    "areaSelect",
    "publicCardFilter",
    "binderResults",
    "tradeTarget",
    "theirTradeCards",
    "yourTradeCards",
    "fairnessBadge",
    "fairnessMessage",
    "tradeMeterFill",
    "sendTradeButton",
    "requestLog",
    "clearRequestsButton"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });

  els.signupForm.addEventListener("submit", handleSignup);
  els.saveStoresButton.addEventListener("click", saveStorePreferences);
  els.demoUserButton.addEventListener("click", loadDemoUser);
  els.cardFilterInput.addEventListener("input", (event) => {
    cardFilter = event.target.value.trim().toLowerCase();
    renderCatalog();
  });
  els.publicCardFilter.addEventListener("input", (event) => {
    publicFilter = event.target.value.trim().toLowerCase();
    renderBinderResults();
  });
  els.areaSelect.addEventListener("change", renderBinderResults);
  document.querySelectorAll("[data-store-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      storeFilter = button.dataset.storeFilter;
      document.querySelectorAll("[data-store-filter]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      renderBinderResults();
    });
  });
  els.publishBinderButton.addEventListener("click", publishBinder);
  els.sendTradeButton.addEventListener("click", sendTradeRequest);
  els.clearRequestsButton.addEventListener("click", () => {
    state.requests = [];
    saveState();
    renderRequestLog();
  });
}

async function handleSignup(event) {
  event.preventDefault();
  const email = els.emailInput.value.trim();
  const nickname = els.nicknameInput.value.trim();
  const password = els.passwordInput.value;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAccountMessage("Use a valid email from any provider.", "bad");
    return;
  }

  const existingByNickname = state.users.find(
    (user) => user.nickname.toLowerCase() === nickname.toLowerCase() && user.email.toLowerCase() !== email.toLowerCase()
  );
  if (existingByNickname) {
    showAccountMessage("That nickname is already taken.", "bad");
    return;
  }

  const passwordHash = await hashPassword(password, email);
  let user = state.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    user = {
      id: makeId("user"),
      email,
      nickname,
      passwordHash,
      stores: [],
      binder: [],
      publishedAt: null,
      seeded: false
    };
    state.users.push(user);
  } else {
    user.nickname = nickname;
    user.passwordHash = passwordHash;
  }

  state.activeUserId = user.id;
  saveState();
  showAccountMessage("Account saved.", "good");
  renderAll();
}

function saveStorePreferences() {
  const user = getActiveUser();
  if (!user) {
    showAccountMessage("Create an account before saving stores.", "bad");
    return;
  }
  user.stores = getSelectedStores();
  saveState();
  showAccountMessage("Store preferences saved.", "good");
  renderAll();
}

function loadDemoUser() {
  const demo = state.users.find((user) => user.email === "demo@mana.local");
  state.activeUserId = demo.id;
  els.emailInput.value = demo.email;
  els.nicknameInput.value = demo.nickname;
  els.passwordInput.value = "demopassword";
  saveState();
  showAccountMessage("Demo user loaded.", "good");
  renderAll();
}

function publishBinder() {
  const user = getActiveUser();
  if (!user) {
    showAccountMessage("Create an account first.", "bad");
    activateView("accountView");
    return;
  }
  user.publishedAt = new Date().toISOString();
  saveState();
  renderAll();
}

function addCardToBinder(cardId) {
  const user = getActiveUser();
  if (!user) {
    showAccountMessage("Create an account before building a binder.", "bad");
    activateView("accountView");
    return;
  }
  user.binder.push({
    id: makeId("item"),
    cardId,
    condition: els.conditionSelect.value,
    note: els.binderNoteInput.value.trim(),
    addedAt: new Date().toISOString()
  });
  saveState();
  renderBinder();
}

function removeBinderItem(itemId) {
  const user = getActiveUser();
  user.binder = user.binder.filter((item) => item.id !== itemId);
  saveState();
  renderBinder();
  renderTradeRequest();
}

function startTrade(targetUserId, itemId) {
  state.draftTrade = {
    targetUserId,
    requestedItemIds: [itemId],
    offeredItemIds: []
  };
  saveState();
  activateView("requestsView");
  renderTradeRequest();
}

function toggleRequestedItem(itemId) {
  const selected = state.draftTrade.requestedItemIds;
  state.draftTrade.requestedItemIds = selected.includes(itemId)
    ? selected.filter((id) => id !== itemId)
    : [...selected, itemId];
  saveState();
  renderTradeRequest();
}

function toggleOfferedItem(itemId) {
  const selected = state.draftTrade.offeredItemIds;
  state.draftTrade.offeredItemIds = selected.includes(itemId)
    ? selected.filter((id) => id !== itemId)
    : [...selected, itemId];
  saveState();
  renderTradeRequest();
}

function sendTradeRequest() {
  const activeUser = getActiveUser();
  const targetUser = getTargetUser();
  const fairness = getFairness();
  if (!activeUser || !targetUser || fairness.state !== "even") return;

  state.requests.unshift({
    id: makeId("trade"),
    fromUserId: activeUser.id,
    toUserId: targetUser.id,
    requestedItemIds: [...state.draftTrade.requestedItemIds],
    offeredItemIds: [...state.draftTrade.offeredItemIds],
    createdAt: new Date().toISOString()
  });
  state.draftTrade = null;
  saveState();
  renderTradeRequest();
  renderRequestLog();
}

function renderAll() {
  renderStores();
  renderAreas();
  renderAccount();
  renderCatalog();
  renderBinder();
  renderBinderResults();
  renderTradeRequest();
  renderRequestLog();
}

function renderStores() {
  const activeUser = getActiveUser();
  els.storeChoices.innerHTML = stores
    .map((store) => {
      const checked = activeUser?.stores.includes(store.id) ? "checked" : "";
      return `
        <label class="checkbox-item">
          <input type="checkbox" value="${store.id}" ${checked}>
          <div>${store.name}<span>${store.area}</span></div>
        </label>
      `;
    })
    .join("");
}

function renderAreas() {
  const areas = ["All areas", ...new Set(stores.map((store) => store.area))];
  els.areaSelect.innerHTML = areas.map((area) => `<option value="${area}">${area}</option>`).join("");
}

function renderAccount() {
  const user = getActiveUser();
  els.sessionBadge.textContent = user ? `Signed in as ${user.nickname}` : "No active user";
  els.sessionBadge.className = `status-pill${user ? " good" : ""}`;

  if (user) {
    els.emailInput.value = user.email;
    els.nicknameInput.value = user.nickname;
  }

  els.publicProfile.innerHTML = user
    ? `
      <div class="profile-name">
        <div class="avatar">${escapeHtml(user.nickname.slice(0, 1).toUpperCase())}</div>
        <div>
          <h3>${escapeHtml(user.nickname)}</h3>
          <p class="binder-meta">${user.binder.length} public binder cards</p>
        </div>
      </div>
      <h3>Stores</h3>
      <div class="store-tags">${renderStoreTags(user.stores)}</div>
    `
    : `<p class="empty-state">Create an account with email, nickname, and password.</p>`;
}

function renderCatalog() {
  const filteredCards = cards.filter((card) => card.name.toLowerCase().includes(cardFilter));
  els.cardCatalog.innerHTML = "";
  filteredCards.forEach((card) => {
    const template = document.getElementById("cardTemplate").content.cloneNode(true);
    const article = template.querySelector(".magic-card");
    const art = template.querySelector(".card-art");
    const heading = template.querySelector("h3");
    const copy = template.querySelector("p");
    const button = document.createElement("button");

    article.style.setProperty("--art-one", card.art[0]);
    article.style.setProperty("--art-two", card.art[1]);
    heading.textContent = card.name;
    copy.textContent = card.type;
    button.type = "button";
    button.textContent = "Add to binder";
    button.addEventListener("click", () => addCardToBinder(card.id));
    template.querySelector(".card-copy").appendChild(button);
    els.cardCatalog.appendChild(template);
  });
}

function renderBinder() {
  const user = getActiveUser();
  const count = user?.binder.length ?? 0;
  els.binderCount.textContent = `${count} listed`;

  if (!user) {
    els.myBinderList.innerHTML = `<p class="empty-state">Create an account to start listing cards.</p>`;
    return;
  }
  if (user.binder.length === 0) {
    els.myBinderList.innerHTML = `<p class="empty-state">Your binder is empty.</p>`;
    return;
  }

  els.myBinderList.innerHTML = user.binder.map((item) => renderBinderItem(item, true)).join("");
  els.myBinderList.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => removeBinderItem(button.dataset.removeItem));
  });
}

function renderBinderResults() {
  const activeUser = getActiveUser();
  const selectedArea = els.areaSelect.value || "All areas";
  const activeStores = activeUser?.stores ?? [];
  const publicUsers = state.users.filter((user) => {
    if (user.id === activeUser?.id) return false;
    if (!user.publishedAt || user.binder.length === 0) return false;
    const areaMatch = selectedArea === "All areas" || user.stores.some((storeId) => getStore(storeId).area === selectedArea);
    const storeMatch = storeFilter === "all" || user.stores.some((storeId) => activeStores.includes(storeId));
    const cardMatch = !publicFilter || user.binder.some((item) => getCard(item.cardId).name.toLowerCase().includes(publicFilter));
    return areaMatch && storeMatch && cardMatch;
  });

  if (publicUsers.length === 0) {
    els.binderResults.innerHTML = `<p class="empty-state">No public binders match.</p>`;
    return;
  }

  els.binderResults.innerHTML = publicUsers
    .map((user) => {
      const visibleItems = publicFilter
        ? user.binder.filter((item) => getCard(item.cardId).name.toLowerCase().includes(publicFilter))
        : user.binder;
      return `
        <article class="result-card">
          <div class="result-header">
            <div>
              <h2>${escapeHtml(user.nickname)}</h2>
              <div class="mini-tags">${renderStoreTags(user.stores)}</div>
            </div>
            <span class="status-pill good">${visibleItems.length} cards</span>
          </div>
          <div class="public-card-list">
            ${visibleItems.map((item) => renderPublicCard(user.id, item)).join("")}
          </div>
        </article>
      `;
    })
    .join("");

  els.binderResults.querySelectorAll("[data-start-trade]").forEach((button) => {
    button.addEventListener("click", () => startTrade(button.dataset.userId, button.dataset.startTrade));
  });
}

function renderTradeRequest() {
  const activeUser = getActiveUser();
  const targetUser = getTargetUser();

  if (!activeUser) {
    els.tradeTarget.textContent = "Create an account before sending trades.";
    els.theirTradeCards.innerHTML = "";
    els.yourTradeCards.innerHTML = "";
    setFairnessUi({ state: "empty", message: "Create an account.", ratio: 0 });
    return;
  }

  if (!state.draftTrade || !targetUser) {
    els.tradeTarget.textContent = "Start from a searched binder.";
    els.theirTradeCards.innerHTML = "";
    els.yourTradeCards.innerHTML = renderTradePool(activeUser.binder, [], "offer");
    setFairnessUi({ state: "empty", message: "Start from a searched binder.", ratio: 0 });
    bindTradeButtons();
    return;
  }

  els.tradeTarget.innerHTML = `Trading with <strong>${escapeHtml(targetUser.nickname)}</strong>`;
  els.theirTradeCards.innerHTML = renderTradePool(targetUser.binder, state.draftTrade.requestedItemIds, "request");
  els.yourTradeCards.innerHTML = renderTradePool(activeUser.binder, state.draftTrade.offeredItemIds, "offer");
  setFairnessUi(getFairness());
  bindTradeButtons();
}

function renderRequestLog() {
  const activeUser = getActiveUser();
  const relevantRequests = activeUser
    ? state.requests.filter((request) => request.fromUserId === activeUser.id || request.toUserId === activeUser.id)
    : state.requests;

  if (relevantRequests.length === 0) {
    els.requestLog.innerHTML = `<p class="empty-state">No trade requests yet.</p>`;
    return;
  }

  els.requestLog.innerHTML = relevantRequests
    .map((request) => {
      const fromUser = state.users.find((user) => user.id === request.fromUserId);
      const toUser = state.users.find((user) => user.id === request.toUserId);
      const requestedNames = resolveItems(toUser, request.requestedItemIds).map(itemLabel).join(", ");
      const offeredNames = resolveItems(fromUser, request.offeredItemIds).map(itemLabel).join(", ");
      return `
        <article class="request-item">
          <strong>${escapeHtml(fromUser.nickname)} to ${escapeHtml(toUser.nickname)}</strong>
          <p class="binder-meta">Asked for: ${escapeHtml(requestedNames)}</p>
          <p class="binder-meta">Offered: ${escapeHtml(offeredNames)}</p>
        </article>
      `;
    })
    .join("");
}

function renderBinderItem(item, removable) {
  const card = getCard(item.cardId);
  const note = item.note ? ` · ${escapeHtml(item.note)}` : "";
  const action = removable ? `<button data-remove-item="${item.id}" type="button">Remove</button>` : "";
  return `
    <article class="binder-item">
      <div>
        <strong>${escapeHtml(card.name)}</strong>
        <p class="binder-meta">${escapeHtml(item.condition)}${note}</p>
      </div>
      ${action}
    </article>
  `;
}

function renderPublicCard(userId, item) {
  const card = getCard(item.cardId);
  const note = item.note ? ` · ${escapeHtml(item.note)}` : "";
  return `
    <article class="public-card">
      <strong>${escapeHtml(card.name)}</strong>
      <p class="binder-meta">${escapeHtml(item.condition)}${note}</p>
      <button data-start-trade="${item.id}" data-user-id="${userId}" type="button">Ask</button>
    </article>
  `;
}

function renderTradePool(items, selectedIds, mode) {
  if (items.length === 0) {
    return `<p class="empty-state">${mode === "offer" ? "Your binder is empty." : "No cards listed."}</p>`;
  }
  return items
    .map((item) => {
      const selected = selectedIds.includes(item.id);
      const buttonText = selected ? "Remove" : mode === "offer" ? "Offer" : "Ask";
      const attr = mode === "offer" ? "data-offer-item" : "data-request-item";
      return `
        <article class="trade-card">
          <div>
            <strong>${escapeHtml(itemLabel(item))}</strong>
            <p class="binder-meta">${escapeHtml(item.condition)}</p>
          </div>
          <button ${attr}="${item.id}" type="button">${buttonText}</button>
        </article>
      `;
    })
    .join("");
}

function bindTradeButtons() {
  els.theirTradeCards.querySelectorAll("[data-request-item]").forEach((button) => {
    button.addEventListener("click", () => toggleRequestedItem(button.dataset.requestItem));
  });
  els.yourTradeCards.querySelectorAll("[data-offer-item]").forEach((button) => {
    button.addEventListener("click", () => toggleOfferedItem(button.dataset.offerItem));
  });
}

function setFairnessUi(fairness) {
  const badgeClass = fairness.state === "even" ? " good" : fairness.state === "empty" ? "" : " warn";
  els.fairnessBadge.className = `status-pill${badgeClass}`;
  els.fairnessBadge.textContent = fairness.state === "even" ? "About even" : fairness.message;
  els.fairnessMessage.textContent = fairness.message;
  els.tradeMeterFill.style.width = `${Math.max(6, Math.min(94, fairness.ratio * 100))}%`;
  els.tradeMeterFill.style.background = fairness.state === "even" ? "var(--green)" : "var(--gold)";
  els.sendTradeButton.disabled = fairness.state !== "even";
}

function getFairness() {
  if (!state.draftTrade) {
    return { state: "empty", message: "Start from a searched binder.", ratio: 0 };
  }
  const activeUser = getActiveUser();
  const targetUser = getTargetUser();
  const requestedItems = resolveItems(targetUser, state.draftTrade.requestedItemIds);
  const offeredItems = resolveItems(activeUser, state.draftTrade.offeredItemIds);

  if (requestedItems.length === 0 || offeredItems.length === 0) {
    return { state: "empty", message: "Choose cards on both sides.", ratio: 0 };
  }

  const requestedTotal = requestedItems.reduce((sum, item) => sum + internalValue(item), 0);
  const offeredTotal = offeredItems.reduce((sum, item) => sum + internalValue(item), 0);
  const tolerance = Math.max(0.75, requestedTotal * 0.04);
  const difference = offeredTotal - requestedTotal;
  const ratio = offeredTotal / Math.max(requestedTotal * 2, 1);

  if (Math.abs(difference) <= tolerance) {
    return { state: "even", message: "About even. Ready to send.", ratio: 0.5 };
  }
  if (difference < 0) {
    return { state: "low", message: "Add more to your offer.", ratio };
  }
  return { state: "high", message: "Remove from your offer.", ratio };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return seedState();
}

function seedState() {
  return {
    activeUserId: "user-demo",
    draftTrade: null,
    requests: [],
    users: [
      {
        id: "user-demo",
        email: "demo@mana.local",
        nickname: "ManaPilot",
        passwordHash: "seed",
        stores: ["arcane-table", "mana-market"],
        publishedAt: new Date().toISOString(),
        seeded: true,
        binder: [
          makeSeedItem("sol-ring", "Near Mint", "Retro frame"),
          makeSeedItem("smothering-tithe", "Lightly Played", ""),
          makeSeedItem("cyclonic-rift", "Near Mint", "")
        ]
      },
      {
        id: "user-river",
        email: "river@example.com",
        nickname: "RiverMage",
        passwordHash: "seed",
        stores: ["arcane-table", "planeswalkers-post"],
        publishedAt: new Date().toISOString(),
        seeded: true,
        binder: [
          makeSeedItem("rhystic-study", "Lightly Played", ""),
          makeSeedItem("deflecting-swat", "Near Mint", ""),
          makeSeedItem("esper-sentinel", "Near Mint", "Foil")
        ]
      },
      {
        id: "user-iona",
        email: "iona@example.com",
        nickname: "IonaTrades",
        passwordHash: "seed",
        stores: ["combat-step", "library-lounge"],
        publishedAt: new Date().toISOString(),
        seeded: true,
        binder: [
          makeSeedItem("dockside-extortionist", "Near Mint", ""),
          makeSeedItem("parallel-lives", "Moderately Played", ""),
          makeSeedItem("teferis-protection", "Lightly Played", "")
        ]
      },
      {
        id: "user-west",
        email: "west@example.com",
        nickname: "WestEndStack",
        passwordHash: "seed",
        stores: ["mana-market", "library-lounge"],
        publishedAt: new Date().toISOString(),
        seeded: true,
        binder: [
          makeSeedItem("the-one-ring", "Near Mint", ""),
          makeSeedItem("fierce-guardianship", "Lightly Played", ""),
          makeSeedItem("ancient-tomb", "Heavily Played", "")
        ]
      }
    ]
  };
}

function makeSeedItem(cardId, condition, note) {
  return {
    id: makeId("seed"),
    cardId,
    condition,
    note,
    addedAt: new Date().toISOString()
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveUser() {
  return state.users.find((user) => user.id === state.activeUserId);
}

function getTargetUser() {
  return state.draftTrade ? state.users.find((user) => user.id === state.draftTrade.targetUserId) : null;
}

function getCard(cardId) {
  return cards.find((card) => card.id === cardId);
}

function getStore(storeId) {
  return stores.find((store) => store.id === storeId);
}

function getSelectedStores() {
  return [...els.storeChoices.querySelectorAll("input:checked")].map((input) => input.value);
}

function renderStoreTags(storeIds) {
  return storeIds
    .map((storeId) => {
      const store = getStore(storeId);
      return `<span class="tag">${escapeHtml(store.name)} · ${escapeHtml(store.area)}</span>`;
    })
    .join("");
}

function resolveItems(user, itemIds) {
  if (!user) return [];
  return itemIds.map((itemId) => user.binder.find((item) => item.id === itemId)).filter(Boolean);
}

function itemLabel(item) {
  return getCard(item.cardId).name;
}

function internalValue(item) {
  return getCard(item.cardId).price * conditionFactor[item.condition];
}

async function hashPassword(password, salt) {
  const value = `${salt.toLowerCase()}:${password}`;
  if (!window.crypto?.subtle) return value;
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function activateView(viewId) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === viewId);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === viewId);
  });
}

function showAccountMessage(message, tone) {
  els.accountMessage.textContent = message;
  els.accountMessage.style.color = tone === "bad" ? "var(--red)" : tone === "good" ? "var(--green)" : "var(--muted)";
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
