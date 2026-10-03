const state = {
  user: null,
  csrfToken: "",
  storeDraft: new Set(),
  collectionCards: [],
  wantedCards: [],
  searchVersions: {},
  quoteVersion: 0,
  sessionVersion: 0,
  cards: [],
  stores: [],
  binders: [],
  tradeDraft: null,
  storeQuery: "",
  cardQuery: "",
};

const conditions = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
];
const manaColors = {
  white: ["#f4ead8", "#b9904e"],
  blue: ["#24577a", "#91c7df"],
  black: ["#1d1814", "#6d6258"],
  red: ["#9a3f31", "#e0a14a"],
  green: ["#315d30", "#93b85d"],
  colorless: ["#b8a173", "#3a332c"],
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  document.querySelector("main").prepend(els.authMessage);
  document.querySelector("header").append(els.logoutButton);
  installExtras();
  document.addEventListener("click", guardAction, true);
  document.addEventListener("submit", guardAction, true);
  await boot();
  await handleAccountLink();
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
    "tradeQuoteBadge",
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
    delayedSearch("binder", state.cardQuery);
  });
  els.storeSearch.addEventListener("input", (event) => {
    state.storeQuery = event.target.value.trim().toLowerCase();
    renderStores();
  });
  els.saveStoresButton.addEventListener("click", saveStores);
  els.binderStoreFilter.addEventListener("change", loadBinders);
  els.wantedOnlyToggle.addEventListener("change", loadBinders);
  els.collectionCardSelect.addEventListener(
    "change",
    renderCollectionPrintingOptions,
  );
  els.addCollectionButton.addEventListener("click", addCollectionItem);
  els.addLookingForButton.addEventListener("click", addLookingForItem);
  els.lookingForSearchInput.addEventListener("input", async (event) => {
    delayedSearch("wanted", event.target.value.trim());
  });
}

async function boot() {
  const payload = await api("/api/session");
  state.user = normalizeUser(payload.user);
  state.cards = payload.cards;
  state.collectionCards = payload.cards;
  state.wantedCards = payload.cards;
  state.storeDraft = new Set(state.user?.storeIds || []);
  state.csrfToken = payload.csrfToken;
  state.stores = payload.stores;
  els.conditionSelect.innerHTML = conditions
    .map((condition) => `<option value="${condition}">${condition}</option>`)
    .join("");
  els.collectionConditionSelect.innerHTML = conditions
    .map((condition) => `<option value="${condition}">${condition}</option>`)
    .join("");
  renderEverything();
  await loadCards("");
  await loadBinders();
}

async function loadCards(query, lane = "binder") {
  const version = (state.searchVersions[lane] || 0) + 1;
  state.searchVersions[lane] = version;
  const payload = await api(
    `/api/cards?q=${encodeURIComponent(query)}&limit=60`,
  );
  if (version !== state.searchVersions[lane]) return;
  if (lane === "wanted") {
    state.wantedCards = payload.cards;
    renderLookingForControls();
  } else if (lane === "collection") {
    state.collectionCards = payload.cards;
    renderCollectionControls();
  } else {
    state.cards = payload.cards;
    renderCatalog();
  }
}

async function login(event) {
  event.preventDefault();
  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: {
        email: els.loginEmail.value,
        password: els.loginPassword.value,
      },
    });
    resetSessionState(payload.user);
    await refreshCsrf();
    await loadBinders();
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
        password: els.signupPassword.value,
      },
    });
    resetSessionState(payload.user);
    await refreshCsrf();
    await loadBinders();
    showMessage("Account created.");
    renderEverything();
    activateView("storesView");
  } catch (error) {
    showMessage(error.message);
  }
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  resetSessionState(null);
  await refreshCsrf();
  await loadBinders();
  renderEverything();
  activateView("authView");
}

async function addCard(cardId) {
  if (!state.user) return requireLogin();
  const printingId = document.querySelector(
    `[data-printing="${cardId}"]`,
  )?.value;
  const payload = await api("/api/me/binder", {
    method: "POST",
    body: {
      cardId,
      printingId: printingId?.split("|")[0],
      finish: printingId?.split("|")[1],
      quantity: 1,
      condition: els.conditionSelect.value,
      note: els.noteInput.value,
    },
  });
  state.user = normalizeUser(payload.user);
  renderBinder();
  renderProfile();
  await loadBinders();
}

async function addCollectionItem() {
  if (!state.user) return requireLogin();
  const payload = await api("/api/me/collection", {
    method: "POST",
    body: {
      cardId: els.collectionCardSelect.value,
      printingId: els.collectionPrintingSelect.value.split("|")[0],
      finish: els.collectionPrintingSelect.value.split("|")[1],
      condition: els.collectionConditionSelect.value,
      quantity: Number(els.collectionQuantityInput.value),
      location: els.collectionLocationInput.value,
    },
  });
  state.user = normalizeUser(payload.user);
  els.collectionQuantityInput.value = "1";
  els.collectionLocationInput.value = "";
  renderProfile();
}

async function removeCollectionItem(itemId) {
  const payload = await api(`/api/me/collection/${itemId}`, {
    method: "DELETE",
  });
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
      note: els.lookingForNoteInput.value,
    },
  });
  state.user = normalizeUser(payload.user);
  els.lookingForNoteInput.value = "";
  renderProfile();
  await loadBinders();
}

async function removeLookingForItem(itemId) {
  const payload = await api(`/api/me/looking-for/${itemId}`, {
    method: "DELETE",
  });
  state.user = normalizeUser(payload.user);
  renderProfile();
  await loadBinders();
}

async function removeBinderItem(itemId) {
  const payload = await api(`/api/me/binder/${itemId}`, { method: "DELETE" });
  state.user = normalizeUser(payload.user);
  renderBinder();
  renderProfile();
  await loadBinders();
}

async function saveStores() {
  if (!state.user) return requireLogin();
  const storeIds = [...state.storeDraft];
  const payload = await api("/api/me/stores", {
    method: "PATCH",
    body: { storeIds },
  });
  state.user = normalizeUser(payload.user);
  showMessage("Stores saved.");
  renderEverything();
  await loadBinders();
}

async function loadBinders(offset = 0) {
  if (typeof offset !== "number") offset = 0;
  const version = (state.searchVersions.binders || 0) + 1;
  state.searchVersions.binders = version;
  const storeId = els.binderStoreFilter.value;
  const params = new URLSearchParams({ offset: String(offset) });
  if (storeId) params.set("storeId", storeId);
  if (els.wantedOnlyToggle.checked && state.user?.id)
    params.set("wantedByUserId", state.user.id);
  const query = params.toString() ? `?${params.toString()}` : "";
  const payload = await api(`/api/binders${query}`);
  if (version !== state.searchVersions.binders) return;
  state.binders = offset
    ? [...state.binders, ...payload.binders]
    : payload.binders;
  state.nextBinderOffset = payload.nextOffset;
  document.getElementById("moreBinders").hidden = payload.nextOffset === null;
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

  const selectedStores = state.stores.filter((store) =>
    state.user.storeIds.includes(store.id),
  );
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
  els.profileCollection
    .querySelectorAll("[data-remove-collection]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        removeCollectionItem(button.dataset.removeCollection),
      );
    });
  els.lookingForList
    .querySelectorAll("[data-remove-looking]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        removeLookingForItem(button.dataset.removeLooking),
      );
    });
  els.profileBinders
    .querySelectorAll("[data-remove-item]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        removeBinderItem(button.dataset.removeItem),
      );
    });
}

function renderCollectionControls() {
  const selectedCardId = els.collectionCardSelect.value;
  els.collectionCardSelect.innerHTML = state.collectionCards
    .map(
      (card) => `<option value="${card.id}">${escapeHtml(card.name)}</option>`,
    )
    .join("");
  if (
    selectedCardId &&
    state.collectionCards.some((card) => card.id === selectedCardId)
  ) {
    els.collectionCardSelect.value = selectedCardId;
  }
  renderCollectionPrintingOptions();
}

function renderLookingForControls() {
  const selectedCardId = els.lookingForCardSelect.value;
  els.lookingForCardSelect.innerHTML = state.wantedCards
    .map(
      (card) => `<option value="${card.id}">${escapeHtml(card.name)}</option>`,
    )
    .join("");
  if (
    selectedCardId &&
    state.wantedCards.some((card) => card.id === selectedCardId)
  ) {
    els.lookingForCardSelect.value = selectedCardId;
  }
}

function renderCollectionPrintingOptions() {
  const card =
    state.collectionCards.find(
      (item) => item.id === els.collectionCardSelect.value,
    ) || state.collectionCards[0];
  els.collectionPrintingSelect.innerHTML = card
    ? card.printings
        .flatMap((printing) =>
          printing.finishes.map(
            (finish) =>
              `<option value="${printing.id}|${finish}">${escapeHtml(printing.set)} #${escapeHtml(printing.number)} · ${escapeHtml(printing.treatment)} · ${finish}</option>`,
          ),
        )
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
  els.sessionBadge.textContent = state.user
    ? state.user.nickname
    : "Logged out";
  els.sessionBadge.className = `chip ${state.user ? "mana-green" : ""}`;
}

function renderCatalog() {
  const cards = state.cards.filter((card) =>
    card.name.toLowerCase().includes(state.cardQuery),
  );
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
              ${card.printings.flatMap((printing) => printing.finishes.map((finish) => `<option value="${printing.id}|${finish}">${escapeHtml(printing.set)} #${escapeHtml(printing.number)} · ${escapeHtml(printing.treatment)} · ${finish}</option>`)).join("")}
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
    button.addEventListener("click", () =>
      removeBinderItem(button.dataset.removeItem),
    );
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
  const selected = state.storeDraft;
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
  const previous = els.binderStoreFilter.value;
  const options = [`<option value="">All stores</option>`].concat(
    state.stores.map(
      (store) =>
        `<option value="${store.id}">${escapeHtml(store.name)}</option>`,
    ),
  );
  els.binderStoreFilter.innerHTML = options.join("");
  els.binderStoreFilter.value = previous;
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
  els.binderResults
    .querySelectorAll("[data-start-request]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        startTradeDraft(button.dataset.startRequest),
      );
    });
}

function startTradeDraft(targetUserId) {
  const target = state.binders.find((binder) => binder.id === targetUserId);
  if (!state.user) return requireLogin();
  if (!target) return;
  state.tradeDraft = {
    targetUserId,
    idempotencyKey: crypto.randomUUID(),
    quantities: {},
    requestedItemIds: target.binder[0] ? [target.binder[0].id] : [],
    offeredItemIds: [],
  };
  renderTradeDraft();
  quoteTrade();
}

function renderTradeDraft() {
  const draft = state.tradeDraft;
  const target = draft
    ? state.binders.find((binder) => binder.id === draft.targetUserId)
    : null;
  if (!draft || !target) {
    els.tradeQuoteBadge.textContent = "No draft";
    els.tradeQuoteBadge.className = "chip";
    els.tradeDraft.innerHTML = `<p class="meta">Choose Request on a public binder to start a trade.</p>`;
    return;
  }
  const offerItems = [
    ...(state.user?.binder || []),
    ...(state.user?.collection || []),
  ];
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
  els.tradeDraft.querySelectorAll("[data-trade-quantity]").forEach((input) =>
    input.addEventListener("input", () => {
      state.tradeDraft.quantities[input.dataset.tradeQuantity] = Number(
        input.value,
      );
      quoteTrade().catch(showError);
    }),
  );
  document
    .getElementById("sendTradeButton")
    .addEventListener("click", sendTrade);
}

function renderTradeChoice(item, side, selectedIds) {
  return `
    <label class="choice-card">
      <input data-trade-choice="${side}" type="checkbox" value="${item.id}" ${selectedIds.includes(item.id) ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(item.cardName)}</strong>
        <span class="meta">${escapeHtml(item.printing)} · ${escapeHtml(item.condition)} · available ${item.quantity}</span>
        <input aria-label="Quantity of ${escapeHtml(item.cardName)}" data-trade-quantity="${item.id}" type="number" min="1" max="${item.quantity}" value="${state.tradeDraft.quantities[item.id] || 1}">
      </span>
    </label>
  `;
}

function toggleTradeChoice(side, itemId, checked) {
  invalidateQuote();
  const key = side === "requested" ? "requestedItemIds" : "offeredItemIds";
  const selected = new Set(state.tradeDraft[key]);
  if (checked) selected.add(itemId);
  else selected.delete(itemId);
  state.tradeDraft[key] = [...selected];
}

async function quoteTrade() {
  if (!state.tradeDraft) return;
  invalidateQuote();
  const version = state.quoteVersion,
    session = state.sessionVersion;
  const message = document.getElementById("tradeQuoteMessage");
  const sendButton = document.getElementById("sendTradeButton");
  if (!state.tradeDraft.requestedItemIds.length || !state.tradeDraft.offeredItemIds.length) {
    els.tradeQuoteBadge.textContent = "Choose cards on both sides";
    if (message) message.textContent = "Choose cards on both sides to check fairness.";
    return;
  }
  try {
    const quote = await api("/api/trades/quote", {
      method: "POST",
      body: tradeBody(),
    });
    if (version !== state.quoteVersion || session !== state.sessionVersion)
      return;
    els.tradeQuoteBadge.textContent =
      quote.state === "even" ? "About even" : quote.message;
    els.tradeQuoteBadge.className = `chip ${quote.state === "even" ? "mana-green" : quote.state === "empty" ? "" : "mana-white"}`;
    if (message) message.textContent = quote.message;
    if (sendButton) sendButton.disabled = quote.state !== "even";
  } catch (error) {
    if (version !== state.quoteVersion || session !== state.sessionVersion)
      return;
    els.tradeQuoteBadge.textContent = "Quote failed";
    els.tradeQuoteBadge.className = "chip mana-white";
    if (message) message.textContent = error.message;
    if (sendButton) sendButton.disabled = true;
  }
}

async function sendTrade() {
  if (!state.tradeDraft) return;
  const payload = await api("/api/trades", {
    method: "POST",
    body: tradeBody(),
    headers: { "idempotency-key": state.tradeDraft.idempotencyKey },
  });
  state.tradeDraft = null;
  renderTradeDraft();
  showMessage("Trade request sent.");
  await loadHistory();
}

function activateView(viewId) {
  if (viewId === "historyView") loadHistory().catch(showError);
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
    lookingFor: user.lookingFor || [],
  };
}

async function api(path, options = {}) {
  const mutation = options.method && options.method !== "GET";
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: mutation
      ? {
          "content-type": "application/json",
          "x-csrf-token": state.csrfToken,
          ...options.headers,
        }
      : {},
    body: mutation ? JSON.stringify(options.body || {}) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed.");
    showError(error);
    throw error;
  }
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

const searchTimers = {};
function delayedSearch(lane, query) {
  state.searchVersions[lane] = (state.searchVersions[lane] || 0) + 1;
  clearTimeout(searchTimers[lane]);
  searchTimers[lane] = setTimeout(
    () => loadCards(query, lane).catch(showError),
    200,
  );
}
function showError(error) {
  showMessage(error.message || String(error));
}
window.addEventListener("unhandledrejection", (event) => {
  showError(event.reason);
  event.preventDefault();
});
function invalidateQuote() {
  state.quoteVersion++;
  const button = document.getElementById("sendTradeButton");
  if (button) button.disabled = true;
}
function resetSessionState(user) {
  state.sessionVersion++;
  invalidateQuote();
  state.tradeDraft = null;
  state.user = normalizeUser(user);
  state.storeDraft = new Set(user?.storeIds || []);
  state.binders = [];
  document.getElementById("tradeHistory").replaceChildren();
  els.loginPassword.value = "";
  els.signupPassword.value = "";
}
async function refreshCsrf() {
  const payload = await api("/api/session");
  state.csrfToken = payload.csrfToken;
}
function tradeBody() {
  const d = state.tradeDraft;
  return {
    targetUserId: d.targetUserId,
    requestedItems: d.requestedItemIds.map((id) => ({
      id,
      quantity: d.quantities[id] || 1,
    })),
    offeredItems: d.offeredItemIds.map((id) => ({
      id,
      quantity: d.quantities[id] || 1,
    })),
  };
}
// Capture prevents duplicate submissions while promises settle. The API tracks mutations globally.
let pendingAction = 0;
function guardAction(event) {
  const target = event.target.closest("button");
  if (
    pendingAction &&
    ((target && !target.classList.contains("tab")) || event.type === "submit")
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
const originalApi = api;
api = async function (path, options = {}) {
  const mutation = options.method && options.method !== "GET" && path !== "/api/trades/quote";
  if (mutation) { pendingAction++; document.body.setAttribute("aria-busy", "true"); }
  try {
    return await originalApi(path, options);
  } finally {
    if (mutation) { pendingAction--; document.body.setAttribute("aria-busy", String(pendingAction > 0)); }
  }
};
function installExtras() {
  els.storeList.addEventListener("change", (event) => {
    if (event.target.matches("[data-store-checkbox]")) {
      if (event.target.checked) state.storeDraft.add(event.target.value);
      else state.storeDraft.delete(event.target.value);
      els.storeCount.textContent = state.storeDraft.size + " selected";
    }
  });
  document
    .getElementById("collectionSearch")
    .addEventListener("input", (e) =>
      delayedSearch("collection", e.target.value),
    );
  document
    .getElementById("moreBinders")
    .addEventListener("click", () => loadBinders(state.nextBinderOffset));
  document
    .getElementById("refreshHistory")
    .addEventListener("click", loadHistory);
  document
    .getElementById("resendVerification")
    .addEventListener("click", async () => {
      await api("/api/account/verification-request", { method: "POST" });
      showMessage("Verification message requested.");
    });
  document
    .getElementById("resetRequest")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const p = await api("/api/account/reset-request", {
        method: "POST",
        body: { email: document.getElementById("resetEmail").value },
      });
      showMessage(p.message);
    });
  document
    .getElementById("resetPasswordForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("/api/account/reset", {
        method: "POST",
        body: {
          token: state.resetToken,
          password: document.getElementById("resetPassword").value,
        },
      });
      state.resetToken = null;
      e.target.reset();
      e.target.hidden = true;
      resetSessionState(null);
      await refreshCsrf();
      renderEverything();
      showMessage("Password reset. Sign in again.");
    });
  document
    .getElementById("changePasswordForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("/api/account/password", {
        method: "POST",
        body: {
          currentPassword: document.getElementById("currentPassword").value,
          password: document.getElementById("newPassword").value,
        },
      });
      e.target.reset();
      resetSessionState(null);
      await refreshCsrf();
      renderEverything();
      showMessage("Password changed. Sign in again.");
    });
  document
    .getElementById("exportAccount")
    .addEventListener("click", async () => {
      const data = await api("/api/account/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "manabinder-export.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  document
    .getElementById("deleteAccountForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!document.getElementById("deleteConfirm").checked) return;
      await api("/api/account", {
        method: "DELETE",
        body: { password: document.getElementById("deletePassword").value },
      });
      e.target.reset();
      resetSessionState(null);
      await refreshCsrf();
      renderEverything();
      showMessage("Account deleted.");
    });
  document
    .getElementById("reportForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("/api/reports", {
        method: "POST",
        body: {
          targetId: document.getElementById("reportTarget").value,
          reason: document.getElementById("reportReason").value,
        },
      });
      e.target.reset();
      showMessage("Report submitted.");
    });
  document.getElementById("blockUser").addEventListener("click", async () => {
    await api("/api/blocks", {
      method: "POST",
      body: { targetId: document.getElementById("reportTarget").value },
    });
    await loadBinders();
    showMessage("User blocked and active trades cancelled.");
  });
  document.getElementById("unblockUser").addEventListener("click", async () => {
    await api("/api/blocks", {
      method: "DELETE",
      body: { targetId: document.getElementById("reportTarget").value },
    });
    await loadBinders();
    showMessage("User unblocked.");
  });
}
async function handleAccountLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  if (params.has("verify")) {
    await api("/api/account/verify", {
      method: "POST",
      body: { token: params.get("verify") },
    });
    showMessage("Email verified.");
    await boot();
  }
  if (params.has("reset")) {
    state.resetToken = params.get("reset");
    document.getElementById("resetPasswordForm").hidden = false;
    activateView("authView");
    document.getElementById("resetPassword").focus();
  }
}
async function loadHistory() {
  if (!state.user) {
    document.getElementById("tradeHistory").textContent =
      "Sign in to see trades.";
    return;
  }
  const session = state.sessionVersion;
  const [payload, notice] = await Promise.all([
    api("/api/trades"),
    api("/api/notifications"),
  ]);
  if (session !== state.sessionVersion) return;
  const root = document.getElementById("tradeHistory");
  root.replaceChildren();
  document.getElementById("notificationCount").textContent =
    notice.notifications.filter((n) => !n.is_read).length + " unread";
  for (const trade of payload.trades) {
    const article = document.createElement("article");
    article.className = "row-card";
    const label = document.createElement("p");
    label.textContent =
      trade.status +
      " · " +
      (trade.from_user === state.user.id
        ? "Sent to " + trade.to_user
        : "Received from " + trade.from_user);
    article.append(label);
    const details = document.createElement("button");
    details.textContent = "Details";
    details.onclick = async () => {
      const p = await api("/api/trades/" + trade.id);
      let out = article.querySelector("pre");
      if (!out) {
        out = document.createElement("pre");
        article.append(out);
      }
      out.textContent =
        p.items
          .map(
            (i) =>
              i.quantity +
              " × " +
              i.snapshot.cardName +
              " · " +
              i.snapshot.printing,
          )
          .join("\n") +
        "\n" +
        p.events.map((e) => e.event).join(" → ");
    };
    article.append(details);
    const actions = [];
    if (trade.status === "pending" && trade.to_user === state.user.id)
      actions.push("accept", "decline");
    if (["pending", "accepted"].includes(trade.status)) actions.push("cancel");
    if (trade.status === "accepted") actions.push("complete");
    for (const action of actions) {
      const button = document.createElement("button");
      button.textContent =
        action === "complete" ? "Confirm physical handoff" : action;
      button.onclick = async () => {
        await api("/api/trades/" + trade.id + "/" + action, { method: "POST" });
        await boot();
        await loadHistory();
      };
      article.append(button);
    }
    root.append(article);
  }
  if (!payload.trades.length) root.textContent = "No trades yet.";
  await api("/api/notifications/read", { method: "POST" });
}
