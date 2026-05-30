const state = {
  user: null,
  cards: [],
  stores: [],
  binders: [],
  tradeDraft: null,
  storeQuery: "",
  cardQuery: ""
};

const conditions = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
const manaColors = {
  white: ["#f4ead8", "#b9904e"],
  blue: ["#24577a", "#91c7df"],
  black: ["#1d1814", "#6d6258"],
  red: ["#9a3f31", "#e0a14a"],
  green: ["#315d30", "#93b85d"],
  colorless: ["#b8a173", "#3a332c"]
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  await boot();
});

function bindElements() {
  [
    "sessionBadge",
    "loginForm",
    "loginEmail",
    "loginPassword",
    "signupForm",
    "signupEmail",
    "signupNickname",
    "signupPassword",
    "authMessage",
    "profileStatus",
    "profileSummary",
    "profileStoreCount",
    "profileStores",
    "profileBinderCount",
    "profileBinders",
    "profileCollectionCount",
    "profileCollection",
    "lookingForCount",
    "lookingForList",
    "lookingForSearchInput",
    "lookingForCardSelect",
    "lookingForPrioritySelect",
    "lookingForNoteInput",
    "addLookingForButton",
    "collectionCardSelect",
    "collectionPrintingSelect",
    "collectionConditionSelect",
    "collectionQuantityInput",
    "collectionLocationInput",
    "addCollectionButton",
    "conditionSelect",
    "noteInput",
    "cardSearch",
    "catalogCount",
    "catalog",
    "myBinder",
    "logoutButton",
    "storeCount",
    "storeSearch",
    "storeList",
    "saveStoresButton",
    "binderStoreFilter",
    "wantedOnlyToggle",
    "binderResults",
    "tradeDraft",
    "tradeQuoteBadge"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });
  els.loginForm.addEventListener("submit", login);
  els.signupForm.addEventListener("submit", signup);
  els.logoutButton.addEventListener("click", logout);
  els.cardSearch.addEventListener("input", (event) => {
    state.cardQuery = event.target.value.trim().toLowerCase();
    loadCards(state.cardQuery);
  });
  els.storeSearch.addEventListener("input", (event) => {
    state.storeQuery = event.target.value.trim().toLowerCase();
    renderStores();
  });
  els.saveStoresButton.addEventListener("click", saveStores);
  els.binderStoreFilter.addEventListener("change", loadBinders);
  els.wantedOnlyToggle.addEventListener("change", loadBinders);
  els.collectionCardSelect.addEventListener("change", renderCollectionPrintingOptions);
  els.addCollectionButton.addEventListener("click", addCollectionItem);
  els.addLookingForButton.addEventListener("click", addLookingForItem);
  els.lookingForSearchInput.addEventListener("input", async (event) => {
    const payload = await api(`/api/cards?q=${encodeURIComponent(event.target.value.trim())}&limit=60`);
    state.cards = payload.cards;
    renderLookingForControls();
  });
}

async function boot() {
  const payload = await api("/api/session");
  state.user = normalizeUser(payload.user);
  state.cards = payload.cards;
  state.stores = payload.stores;
  els.conditionSelect.innerHTML = conditions.map((condition) => `<option value="${condition}">${condition}</option>`).join("");
  els.collectionConditionSelect.innerHTML = conditions.map((condition) => `<option value="${condition}">${condition}</option>`).join("");
  renderEverything();
  await loadCards("");
  await loadBinders();
}

async function loadCards(query) {
  const payload = await api(`/api/cards?q=${encodeURIComponent(query)}&limit=60`);
  state.cards = payload.cards;
  renderCatalog();
  renderCollectionControls();
  renderLookingForControls();
}

async function login(event) {
  event.preventDefault();
  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: {
        email: els.loginEmail.value,
        password: els.loginPassword.value
      }
    });
    state.user = normalizeUser(payload.user);
    showMessage("Logged in.");
    renderEverything();
    activateView("binderView");
  } catch (error) {
    showMessage(error.message);
  }
}

async function signup(event) {
  event.preventDefault();
  try {
    const payload = await api("/api/signup", {
      method: "POST",
      body: {
        email: els.signupEmail.value,
        nickname: els.signupNickname.value,
        password: els.signupPassword.value
      }
    });
    state.user = normalizeUser(payload.user);
    showMessage("Account created.");
    renderEverything();
    activateView("storesView");
  } catch (error) {
    showMessage(error.message);
  }
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  state.user = null;
  renderEverything();
  activateView("authView");
}

async function addCard(cardId) {
  if (!state.user) return requireLogin();
  const printingId = document.querySelector(`[data-printing="${cardId}"]`)?.value;
  const payload = await api("/api/me/binder", {
    method: "POST",
    body: {
      cardId,
      printingId,
      condition: els.conditionSelect.value,
      note: els.noteInput.value
    }
  });
  state.user = normalizeUser(payload.user);
  renderBinder();
  await loadBinders();
}

async function addCollectionItem() {
  if (!state.user) return requireLogin();
  const payload = await api("/api/me/collection", {
    method: "POST",
    body: {
      cardId: els.collectionCardSelect.value,
      printingId: els.collectionPrintingSelect.value,
      condition: els.collectionConditionSelect.value,
      quantity: els.collectionQuantityInput.value,
      location: els.collectionLocationInput.value
    }
  });
  state.user = normalizeUser(payload.user);
  els.collectionQuantityInput.value = "1";
  els.collectionLocationInput.value = "";
  renderProfile();
}

async function removeCollectionItem(itemId) {
  const payload = await api(`/api/me/collection/${itemId}`, { method: "DELETE" });
  state.user = normalizeUser(payload.user);
  renderProfile();
}

async function addLookingForItem() {
  if (!state.user) return requireLogin();
  const payload = await api("/api/me/looking-for", {
    method: "POST",
    body: {
      cardId: els.lookingForCardSelect.value,
      priority: els.lookingForPrioritySelect.value,
      note: els.lookingForNoteInput.value
    }
  });
  state.user = normalizeUser(payload.user);
  els.lookingForNoteInput.value = "";
  renderProfile();
  await loadBinders();
}

async function removeLookingForItem(itemId) {
  const payload = await api(`/api/me/looking-for/${itemId}`, { method: "DELETE" });
  state.user = normalizeUser(payload.user);
  renderProfile();
  await loadBinders();
}

async function removeBinderItem(itemId) {
  const payload = await api(`/api/me/binder/${itemId}`, { method: "DELETE" });
  state.user = normalizeUser(payload.user);
  renderBinder();
  await loadBinders();
}

async function saveStores() {
  if (!state.user) return requireLogin();
  const storeIds = [...document.querySelectorAll("[data-store-checkbox]:checked")].map((input) => input.value);
  const payload = await api("/api/me/stores", {
    method: "PATCH",
    body: { storeIds }
  });
  state.user = normalizeUser(payload.user);
  showMessage("Stores saved.");
  renderEverything();
  await loadBinders();
}

async function loadBinders() {
  const storeId = els.binderStoreFilter.value;
  const params = new URLSearchParams();
  if (storeId) params.set("storeId", storeId);
  if (els.wantedOnlyToggle.checked && state.user?.id) params.set("wantedByUserId", state.user.id);
  const query = params.toString() ? `?${params.toString()}` : "";
  const payload = await api(`/api/binders${query}`);
  state.binders = payload.binders;
  renderBinders();
  renderTradeDraft();
}

function renderEverything() {
  renderSession();
  renderCollectionControls();
  renderLookingForControls();
  renderProfile();
  renderCatalog();
  renderBinder();
  renderStores();
  renderStoreFilter();
  renderBinders();
  renderTradeDraft();
}

function renderProfile() {
  if (!state.user) {
    els.profileStatus.textContent = "Logged out";
    els.profileStatus.className = "chip";
    els.profileSummary.innerHTML = `<p class="meta">Login to view your profile.</p>`;
    els.profileStores.innerHTML = `<p class="meta">No stores selected.</p>`;
    els.profileBinders.innerHTML = `<p class="meta">No public listings.</p>`;
    els.profileCollection.innerHTML = `<p class="meta">No collection items.</p>`;
    els.lookingForList.innerHTML = `<p class="meta">No wanted cards.</p>`;
    els.profileStoreCount.textContent = "0 stores";
    els.profileBinderCount.textContent = "0 cards";
    els.profileCollectionCount.textContent = "0 items";
    els.lookingForCount.textContent = "0 cards";
    return;
  }

  const selectedStores = state.stores.filter((store) => state.user.storeIds.includes(store.id));
  const collection = state.user.collection || [];
  const lookingFor = state.user.lookingFor || [];
  els.profileStatus.textContent = state.user.nickname;
  els.profileStatus.className = "chip mana-green";
  els.profileStoreCount.textContent = `${selectedStores.length} stores`;
  els.profileBinderCount.textContent = `${state.user.binder.length} cards`;
  els.profileCollectionCount.textContent = `${collection.length} items`;
  els.lookingForCount.textContent = `${lookingFor.length} cards`;
  els.profileSummary.innerHTML = `
    <div class="metric-grid">
      <div class="metric"><strong>${escapeHtml(state.user.nickname)}</strong><span>${escapeHtml(state.user.email)}</span></div>
      <div class="metric"><strong>${state.user.binder.length}</strong><span>public binder cards</span></div>
      <div class="metric"><strong>${collection.reduce((sum, item) => sum + item.quantity, 0)}</strong><span>collection quantity</span></div>
      <div class="metric"><strong>${lookingFor.length}</strong><span>wanted cards</span></div>
      <div class="metric"><strong>${selectedStores.length}</strong><span>selected stores</span></div>
    </div>
  `;
  els.profileStores.innerHTML = selectedStores.length
    ? selectedStores.map(renderProfileStore).join("")
    : `<p class="meta">No stores selected. Use the Stores tab to add your regular locations.</p>`;
  els.profileBinders.innerHTML = state.user.binder.length
    ? state.user.binder.map(renderBinderItem).join("")
    : `<p class="meta">No public listings. Add cards from the Binder tab.</p>`;
  els.profileCollection.innerHTML = collection.length
    ? collection.map(renderCollectionItem).join("")
    : `<p class="meta">No collection items yet.</p>`;
  els.lookingForList.innerHTML = lookingFor.length
    ? lookingFor.map(renderLookingForItem).join("")
    : `<p class="meta">No wanted cards yet.</p>`;
  els.profileCollection.querySelectorAll("[data-remove-collection]").forEach((button) => {
    button.addEventListener("click", () => removeCollectionItem(button.dataset.removeCollection));
  });
  els.lookingForList.querySelectorAll("[data-remove-looking]").forEach((button) => {
    button.addEventListener("click", () => removeLookingForItem(button.dataset.removeLooking));
  });
  els.profileBinders.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => removeBinderItem(button.dataset.removeItem));
  });
}

function renderCollectionControls() {
  const selectedCardId = els.collectionCardSelect.value;
  els.collectionCardSelect.innerHTML = state.cards
    .map((card) => `<option value="${card.id}">${escapeHtml(card.name)}</option>`)
    .join("");
  if (selectedCardId && state.cards.some((card) => card.id === selectedCardId)) {
    els.collectionCardSelect.value = selectedCardId;
  }
  renderCollectionPrintingOptions();
}

function renderLookingForControls() {
  const selectedCardId = els.lookingForCardSelect.value;
  els.lookingForCardSelect.innerHTML = state.cards
    .map((card) => `<option value="${card.id}">${escapeHtml(card.name)}</option>`)
    .join("");
  if (selectedCardId && state.cards.some((card) => card.id === selectedCardId)) {
    els.lookingForCardSelect.value = selectedCardId;
  }
}

function renderCollectionPrintingOptions() {
  const card = state.cards.find((item) => item.id === els.collectionCardSelect.value) || state.cards[0];
  els.collectionPrintingSelect.innerHTML = card
    ? card.printings
      .map((printing) => `<option value="${printing.id}">${escapeHtml(printing.set)} #${escapeHtml(printing.number)} · ${escapeHtml(printing.treatment)}</option>`)
      .join("")
    : "";
}

function renderProfileStore(store) {
  return `
    <article class="row-card">
      <div>
        <strong>${escapeHtml(store.name)}</strong>
        <p class="meta">${escapeHtml(store.address)}</p>
        <p class="meta">${store.phone ? escapeHtml(store.phone) : "No phone listed"}</p>
      </div>
      ${store.isPremium ? `<span class="premium">Premium</span>` : ""}
    </article>
  `;
}

function renderCollectionItem(item) {
  return `
    <article class="row-card">
      <div>
        <strong>${escapeHtml(item.cardName)} <span class="subtle">x${item.quantity}</span></strong>
        <p class="meta">${escapeHtml(item.printing)}</p>
        <p class="meta">${escapeHtml(item.condition)}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</p>
      </div>
      <button type="button" data-remove-collection="${item.id}">Remove</button>
    </article>
  `;
}

function renderLookingForItem(item) {
  return `
    <article class="row-card">
      <div>
        <strong>${escapeHtml(item.cardName)}</strong>
        <p class="meta">${escapeHtml(item.priority)} priority${item.note ? ` · ${escapeHtml(item.note)}` : ""}</p>
        <p class="meta">${escapeHtml(item.type)}</p>
      </div>
      <button type="button" data-remove-looking="${item.id}">Remove</button>
    </article>
  `;
}

function renderSession() {
  els.sessionBadge.textContent = state.user ? state.user.nickname : "Logged out";
  els.sessionBadge.className = `chip ${state.user ? "mana-green" : ""}`;
}

function renderCatalog() {
  const cards = state.cards.filter((card) => card.name.toLowerCase().includes(state.cardQuery));
  els.catalogCount.textContent = `${cards.length} cards`;
  els.catalog.innerHTML = cards
    .map((card) => {
      const palette = manaColors[card.colors[0]] || manaColors.colorless;
      return `
        <article class="spell-card" style="--mana-one:${palette[0]};--mana-two:${palette[1]}">
          <div class="spell-art"></div>
          <div class="spell-body">
            <h3>${escapeHtml(card.name)}</h3>
            <p>${escapeHtml(card.type)}</p>
            <select data-printing="${card.id}" aria-label="${escapeHtml(card.name)} printing">
              ${card.printings.map((printing) => {
                return `<option value="${printing.id}">${escapeHtml(printing.set)} #${escapeHtml(printing.number)} · ${escapeHtml(printing.treatment)}</option>`;
              }).join("")}
            </select>
            <button type="button" data-add-card="${card.id}">Add to binder</button>
          </div>
        </article>
      `;
    })
    .join("");
  els.catalog.querySelectorAll("[data-add-card]").forEach((button) => {
    button.addEventListener("click", () => addCard(button.dataset.addCard));
  });
}

function renderBinder() {
  if (!state.user) {
    els.myBinder.innerHTML = `<p class="meta">Login to create listings.</p>`;
    return;
  }
  if (state.user.binder.length === 0) {
    els.myBinder.innerHTML = `<p class="meta">No active listings.</p>`;
    return;
  }
  els.myBinder.innerHTML = state.user.binder.map(renderBinderItem).join("");
  els.myBinder.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => removeBinderItem(button.dataset.removeItem));
  });
}

function renderBinderItem(item) {
  return `
    <article class="row-card">
      <div>
        <strong>${escapeHtml(item.cardName)}</strong>
        <p class="meta">${escapeHtml(item.printing)}</p>
        <p class="meta">${escapeHtml(item.condition)}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</p>
      </div>
      <button type="button" data-remove-item="${item.id}">Remove</button>
    </article>
  `;
}

function renderStores() {
  const selected = new Set(state.user?.storeIds || []);
  const stores = state.stores.filter((store) => {
    const haystack = `${store.name} ${store.address}`.toLowerCase();
    return haystack.includes(state.storeQuery);
  });
  els.storeCount.textContent = `${selected.size} selected`;
  els.storeList.innerHTML = stores
    .map((store) => {
      return `
        <label class="store-card">
          <input data-store-checkbox type="checkbox" value="${store.id}" ${selected.has(store.id) ? "checked" : ""}>
          <span>
            <strong>${escapeHtml(store.name)}</strong>
            <p class="meta">${escapeHtml(store.address)}</p>
            <p class="meta">${store.phone ? escapeHtml(store.phone) : "No phone listed"}</p>
          </span>
          ${store.isPremium ? `<span class="premium">Premium</span>` : ""}
        </label>
      `;
    })
    .join("");
}

function renderStoreFilter() {
  const options = [`<option value="">All stores</option>`].concat(
    state.stores.map((store) => `<option value="${store.id}">${escapeHtml(store.name)}</option>`)
  );
  els.binderStoreFilter.innerHTML = options.join("");
}

function renderBinders() {
  const ownId = state.user?.id;
  const binders = state.binders.filter((binder) => binder.id !== ownId);
  if (binders.length === 0) {
    els.binderResults.innerHTML = `<p class="meta">No matching public binders.</p>`;
    return;
  }
  els.binderResults.innerHTML = binders
    .map((binder) => {
      return `
        <article class="row-card">
          <div>
            <strong>${escapeHtml(binder.nickname)}</strong>
            <p class="meta">${binder.stores.map((store) => escapeHtml(store.name)).join(" · ") || "No stores selected"}</p>
            <div class="stack">
              ${binder.binder.map((item) => `<p class="meta">${item.wantedMatch ? `<span class="match-pill">Wanted</span> ` : ""}${escapeHtml(item.cardName)} — ${escapeHtml(item.printing)} · ${escapeHtml(item.condition)}</p>`).join("")}
            </div>
          </div>
          <button type="button" data-start-request="${binder.id}">Request</button>
        </article>
      `;
    })
    .join("");
  els.binderResults.querySelectorAll("[data-start-request]").forEach((button) => {
    button.addEventListener("click", () => startTradeDraft(button.dataset.startRequest));
  });
}

function startTradeDraft(targetUserId) {
  const target = state.binders.find((binder) => binder.id === targetUserId);
  if (!state.user) return requireLogin();
  if (!target) return;
  state.tradeDraft = {
    targetUserId,
    requestedItemIds: target.binder[0] ? [target.binder[0].id] : [],
    offeredItemIds: []
  };
  renderTradeDraft();
  quoteTrade();
}

function renderTradeDraft() {
  const draft = state.tradeDraft;
  const target = draft ? state.binders.find((binder) => binder.id === draft.targetUserId) : null;
  if (!draft || !target) {
    els.tradeQuoteBadge.textContent = "No draft";
    els.tradeQuoteBadge.className = "chip";
    els.tradeDraft.innerHTML = `<p class="meta">Choose Request on a public binder to start a trade.</p>`;
    return;
  }
  const offerItems = [...(state.user?.binder || []), ...(state.user?.collection || [])];
  els.tradeDraft.innerHTML = `
    <div class="trade-draft-heading">
      <strong>${escapeHtml(target.nickname)}</strong>
      <p class="meta">${target.stores.map((store) => escapeHtml(store.name)).join(" · ")}</p>
    </div>
    <div class="trade-columns">
      <div>
        <h3>Their cards</h3>
        <div class="stack">${target.binder.map((item) => renderTradeChoice(item, "requested", draft.requestedItemIds)).join("")}</div>
      </div>
      <div>
        <h3>Your offer</h3>
        <div class="stack">${offerItems.length ? offerItems.map((item) => renderTradeChoice(item, "offered", draft.offeredItemIds)).join("") : `<p class="meta">Add binder or collection items before offering.</p>`}</div>
      </div>
    </div>
    <div class="trade-actions">
      <p id="tradeQuoteMessage" class="meta">Prices are checked only while quoting this trade.</p>
      <button id="sendTradeButton" class="primary" type="button" disabled>Send request</button>
    </div>
  `;
  els.tradeDraft.querySelectorAll("[data-trade-choice]").forEach((input) => {
    input.addEventListener("change", () => {
      toggleTradeChoice(input.dataset.tradeChoice, input.value, input.checked);
      quoteTrade();
    });
  });
  document.getElementById("sendTradeButton").addEventListener("click", sendTrade);
}

function renderTradeChoice(item, side, selectedIds) {
  return `
    <label class="choice-card">
      <input data-trade-choice="${side}" type="checkbox" value="${item.id}" ${selectedIds.includes(item.id) ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(item.cardName)}</strong>
        <span class="meta">${escapeHtml(item.printing)} · ${escapeHtml(item.condition)}</span>
      </span>
    </label>
  `;
}

function toggleTradeChoice(side, itemId, checked) {
  const key = side === "requested" ? "requestedItemIds" : "offeredItemIds";
  const selected = new Set(state.tradeDraft[key]);
  if (checked) selected.add(itemId);
  else selected.delete(itemId);
  state.tradeDraft[key] = [...selected];
}

async function quoteTrade() {
  if (!state.tradeDraft) return;
  const message = document.getElementById("tradeQuoteMessage");
  const sendButton = document.getElementById("sendTradeButton");
  try {
    const quote = await api("/api/trades/quote", { method: "POST", body: state.tradeDraft });
    els.tradeQuoteBadge.textContent = quote.state === "even" ? "About even" : quote.message;
    els.tradeQuoteBadge.className = `chip ${quote.state === "even" ? "mana-green" : quote.state === "empty" ? "" : "mana-white"}`;
    if (message) message.textContent = quote.message;
    if (sendButton) sendButton.disabled = quote.state !== "even";
  } catch (error) {
    els.tradeQuoteBadge.textContent = "Quote failed";
    els.tradeQuoteBadge.className = "chip mana-white";
    if (message) message.textContent = error.message;
    if (sendButton) sendButton.disabled = true;
  }
}

async function sendTrade() {
  if (!state.tradeDraft) return;
  const payload = await api("/api/trades", { method: "POST", body: state.tradeDraft });
  state.tradeDraft = null;
  renderTradeDraft();
  showMessage(payload.quote.message);
}

function activateView(viewId) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === viewId);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === viewId);
  });
}

function requireLogin() {
  showMessage("Login before using that feature.");
  activateView("authView");
}

function showMessage(message) {
  els.authMessage.textContent = message;
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    ...user,
    storeIds: user.storeIds || [],
    binder: user.binder || [],
    collection: user.collection || [],
    lookingFor: user.lookingFor || []
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
