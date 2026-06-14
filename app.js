async function loadListings() {
  const response = await fetch("data/listings.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load listings.json (${response.status})`);
  }
  return response.json();
}

function showLoadError(error) {
  const listingsEl = document.getElementById("listings");
  const resultCountEl = document.getElementById("result-count");
  const emptyState = document.getElementById("empty-state");

  if (resultCountEl) resultCountEl.textContent = "Listings failed to load";
  if (emptyState) {
    emptyState.style.display = "block";
    emptyState.textContent = "Could not load data/listings.json. Run this dashboard through a local web server instead of opening the HTML file directly.";
  }
  if (listingsEl) listingsEl.innerHTML = `<pre class="load-error">${String(error.message || error)}</pre>`;
}

async function initDashboard() {
  const rawResults = await loadListings();

  const allowedEpc = new Set(["A++", "A+", "A", "B", "C"]);
  const results = rawResults.filter(result =>
    ["Appartement", "Huis"].includes(result.type) &&
    (!result.status || result.status === "active") &&
    Number.isFinite(result.price) &&
    Number.isFinite(result.area) &&
    result.area >= 50 &&
    (!result.epc || allowedEpc.has(result.epc))
  );

  function siteColor(site) {
    if (site === "Immoweb") return "var(--immoweb)";
    if (site === "Zimmo") return "var(--zimmo)";
    return "var(--immoscoop)";
  }

  function cityFromPlace(place) {
    if (/Kessel-Lo/i.test(place)) return "Kessel-Lo";
    if (/Heverlee/i.test(place)) return "Heverlee";
    if (/Wijgmaal/i.test(place)) return "Wijgmaal";
    if (/Wilsele/i.test(place)) return "Leuven";
    if (/Kermt|Kortessem/i.test(place)) return "Hasselt";
    if (/Diest/i.test(place)) return "Diest";
    if (/Leuven/i.test(place)) return "Leuven";
    if (/Genk/i.test(place)) return "Genk";
    if (/Hasselt/i.test(place)) return "Hasselt";
    return "Other";
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\b(bus|app|apt|appartement|flat)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function addressFromPlace(place) {
    const firstPart = String(place || "").split(",")[0].trim();
    const normalized = normalizeText(firstPart);
    if (!normalized || ["genk", "leuven", "heverlee", "kessel lo", "wijgmaal", "wilsele", "hasselt", "kermt", "kortessem", "diest", "3500 hasselt", "3290 diest"].includes(normalized)) {
      return "";
    }
    return firstPart;
  }

  function matchKeys(listing) {
    const city = normalizeText(listing.city || cityFromPlace(listing.place));
    const address = normalizeText(addressFromPlace(listing.place));
    const keys = [`url:${listing.url}`];

    if (address && Number.isFinite(listing.price)) {
      keys.push(`addr-price:${city}:${address}:${listing.price}`);
    }

    if (address && Number.isFinite(listing.area) && Number.isFinite(listing.beds)) {
      keys.push(`addr-shape:${city}:${address}:${listing.area}:${listing.beds}`);
    }

    if (!address && Number.isFinite(listing.price) && Number.isFinite(listing.area) && Number.isFinite(listing.beds)) {
      keys.push(`shape:${city}:${normalizeText(listing.type)}:${listing.price}:${listing.area}:${listing.beds}`);
    }

    return keys;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ageLabel(listing) {
    if (Number.isFinite(listing.daysOnline)) {
      return `${listing.daysOnline} ${listing.daysOnline === 1 ? "day" : "days"} online`;
    }
    return "Days online: not shown";
  }

  // firstSeen is written by the refresh pipeline for every listing (YYYY-MM-DD),
  // so it's a reliable cross-source "when did this appear" signal — unlike
  // daysOnline, which only some sites expose.
  const TODAY_MS = new Date(new Date().toISOString().slice(0, 10)).getTime();

  function firstSeenMs(listing) {
    const value = listing.firstSeen;
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function dayGroupLabel(listing) {
    const ms = firstSeenMs(listing);
    if (ms === null) return "Date added unknown";
    const daysAgo = Math.round((TODAY_MS - ms) / 86400000);
    if (daysAgo <= 0) return "New today";
    if (daysAgo === 1) return "Yesterday";
    if (daysAgo < 7) return `${daysAgo} days ago`;
    return `Added ${listing.firstSeen}`;
  }

  function sortListings(listings, sortBy) {
    const sorted = [...listings];
    switch (sortBy) {
      case "newest":
        return sorted.sort((a, b) => {
          const av = firstSeenMs(a) ?? -Infinity;
          const bv = firstSeenMs(b) ?? -Infinity;
          return bv - av;
        });
      case "oldest":
        return sorted.sort((a, b) => {
          const av = firstSeenMs(a) ?? Infinity;
          const bv = firstSeenMs(b) ?? Infinity;
          return av - bv;
        });
      case "price-asc":
        return sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      case "price-desc":
        return sorted.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
      case "area-desc":
        return sorted.sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
      case "area-asc":
        return sorted.sort((a, b) => (a.area ?? Infinity) - (b.area ?? Infinity));
      default:
        return sorted;
    }
  }

  for (const result of results) {
    result.city = cityFromPlace(result.place);
    result.id = result.url;
    result.address = addressFromPlace(result.place);
    result.matchKeys = matchKeys(result);
  }

  // Favourites
  const favsStorageKey = "propertySearchFavourites.v1";

  function loadFavourites() {
    try {
      const parsed = JSON.parse(localStorage.getItem(favsStorageKey) || "[]");
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch { return new Set(); }
  }

  function saveFavourites() {
    localStorage.setItem(favsStorageKey, JSON.stringify([...favourites]));
  }

  function toggleFavourite(listingId) {
    if (favourites.has(listingId)) {
      favourites.delete(listingId);
    } else {
      favourites.add(listingId);
    }
    saveFavourites();
    renderListings();
  }

  let favourites = loadFavourites();
  let showFavsOnly = false;

  const cityFilter = document.getElementById("city-filter");
  const siteFilter = document.getElementById("site-filter");
  const typeFilter = document.getElementById("type-filter");
  const sortSelect = document.getElementById("sort-select");
  const favsToggle = document.getElementById("favs-toggle");
  const listingsEl = document.getElementById("listings");
  const resultCountEl = document.getElementById("result-count");
  const emptyState = document.getElementById("empty-state");
  const shitlistSummary = document.getElementById("shitlist-summary");
  const shitlistItems = document.getElementById("shitlist-items");
  const shitlistPanel = document.getElementById("shitlist-panel");
  const shitlistBackdrop = document.getElementById("shitlist-backdrop");
  const fabEl = document.getElementById("shitlist-fab");
  const fabLabel = document.getElementById("fab-label");
  const shitlistStorageKey = "propertySearchShitlist.v1";

  function openShitlistDrawer() {
    shitlistPanel.classList.add("is-open");
    shitlistBackdrop.classList.add("is-open");
  }

  function closeShitlistDrawer() {
    shitlistPanel.classList.remove("is-open");
    shitlistBackdrop.classList.remove("is-open");
  }

  document.getElementById("shitlist-close").addEventListener("click", closeShitlistDrawer);
  shitlistBackdrop.addEventListener("click", closeShitlistDrawer);
  fabEl.addEventListener("click", openShitlistDrawer);

  // ── GitHub sync ───────────────────────────────────────
  const GH_TOKEN_KEY = "immoBroGHToken.v1";
  const GH_SHA_KEY   = "immoBroRejectedSHA.v1";
  const GH_API       = "https://api.github.com/repos/Mbos12/ImmoBro/contents/data/rejected.json";

  const syncDot   = document.getElementById("sync-dot");
  const syncMsg   = document.getElementById("sync-msg");
  const tokenInput = document.getElementById("gh-token-input");
  const tokenSave  = document.getElementById("gh-token-save");
  const tokenClear = document.getElementById("gh-token-clear");

  function getToken() { return window.IMMO_CONFIG?.ghToken || localStorage.getItem(GH_TOKEN_KEY) || ""; }
  function getSHA()   { return localStorage.getItem(GH_SHA_KEY)   || ""; }

  function setSyncState(state, msg) {
    syncDot.className = "sync-dot" + (state ? ` sync-dot--${state}` : "");
    syncDot.title = msg || "";
    if (syncMsg) syncMsg.textContent = msg || "";
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function ghFetch(token) {
    const res = await fetch(GH_API, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" }
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    localStorage.setItem(GH_SHA_KEY, data.sha);
    return JSON.parse(b64decode(data.content));
  }

  async function ghPush(token, list) {
    const sha = getSHA();
    const body = {
      message: `update rejected listings (${list.length} entries)`,
      content: b64encode(JSON.stringify(list, null, 2) + "\n"),
      ...(sha ? { sha } : {})
    };
    const res = await fetch(GH_API, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (res.status === 409) {
      // SHA conflict — refresh then retry once
      await ghFetch(token);
      return ghPush(token, list);
    }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `GitHub API ${res.status}`); }
    const data = await res.json();
    localStorage.setItem(GH_SHA_KEY, data.content.sha);
  }

  async function loadShitlist() {
    const token = getToken();
    if (token) {
      try {
        setSyncState("syncing", "Loading from GitHub…");
        const list = await ghFetch(token);
        const filtered = Array.isArray(list) ? list.filter(item => Array.isArray(item.keys)) : [];
        localStorage.setItem(shitlistStorageKey, JSON.stringify(filtered));
        setSyncState("ok", `Loaded from GitHub (${filtered.length} entries)`);
        return filtered;
      } catch (e) {
        setSyncState("error", `Load failed: ${e.message}`);
      }
    } else {
      setSyncState("", "No token — changes saved to this browser only");
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(shitlistStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter(item => Array.isArray(item.keys)) : [];
    } catch { return []; }
  }

  function saveShitlist() {
    localStorage.setItem(shitlistStorageKey, JSON.stringify(shitlist));
    const token = getToken();
    if (!token) return;
    setSyncState("syncing", "Saving to GitHub…");
    ghPush(token, shitlist)
      .then(() => setSyncState("ok", `Synced to GitHub (${shitlist.length} entries)`))
      .catch(e => setSyncState("error", `Save failed: ${e.message}`));
  }

  // Token UI
  tokenInput.value = getToken() ? "••••••••••••••••" : "";
  tokenSave.addEventListener("click", async () => {
    const val = tokenInput.value.trim();
    if (!val || val.startsWith("•")) return;
    localStorage.setItem(GH_TOKEN_KEY, val);
    tokenInput.value = "••••••••••••••••";
    shitlist = await loadShitlist();
    renderListings();
  });
  tokenClear.addEventListener("click", () => {
    localStorage.removeItem(GH_TOKEN_KEY);
    localStorage.removeItem(GH_SHA_KEY);
    tokenInput.value = "";
    setSyncState("", "Token cleared — changes saved to this browser only");
  });

  let shitlist = await loadShitlist();

  function keySet(keys) {
    return new Set(keys || []);
  }

  function matchesShitlist(listing, item) {
    const keys = keySet(item.keys);
    return listing.matchKeys.some(key => keys.has(key));
  }

  function shitlistMatch(listing) {
    return shitlist.find(item => matchesShitlist(listing, item));
  }

  function labelFor(listing) {
    return `${listing.type} in ${listing.place} - ${listing.priceLabel}`;
  }

  function addToShitlist(listingId) {
    const listing = results.find(item => item.id === listingId);
    if (!listing) return;

    const existing = shitlistMatch(listing);
    if (!existing) {
      shitlist.push({
        id: `shit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label: labelFor(listing),
        site: listing.site,
        url: listing.url,
        keys: listing.matchKeys,
        addedAt: new Date().toISOString()
      });
      saveShitlist();
    }

    renderListings();
  }

  function restoreFromShitlist(shitId) {
    shitlist = shitlist.filter(item => item.id !== shitId);
    saveShitlist();
    renderListings();
  }

  function setOptions(select, values, allLabel) {
    select.innerHTML = [`<option value="">${allLabel}</option>`]
      .concat(values.map(value => `<option value="${value}">${value}</option>`))
      .join("");
  }

  setOptions(cityFilter, [...new Set(results.map(d => d.city))].sort(), "All cities");
  setOptions(siteFilter, [...new Set(results.map(d => d.site))].sort(), "All websites");

  function renderListings() {
    const selectedCity = cityFilter.value;
    const selectedSite = siteFilter.value;
    const selectedType = typeFilter.value;
    const sortBy = sortSelect.value;
    const hiddenResults = results.filter(d => shitlistMatch(d));
    const activeResults = results.filter(d => !shitlistMatch(d));
    let visible = activeResults.filter(d =>
      (!selectedCity || d.city === selectedCity) &&
      (!selectedSite || d.site === selectedSite) &&
      (!selectedType || d.type === selectedType)
    );

    if (showFavsOnly) {
      visible = visible.filter(d => favourites.has(d.id));
    }

    const sorted = sortListings(visible, sortBy);
    const showDayGroups = sortBy === "newest" || sortBy === "oldest";

    resultCountEl.textContent = `${sorted.length} of ${activeResults.length} listings shown`;
    shitlistSummary.textContent = `${shitlist.length} ${shitlist.length === 1 ? "rule" : "rules"} · ${hiddenResults.length} hidden`;
    fabLabel.textContent = hiddenResults.length > 0 ? `${hiddenResults.length} hidden` : "Rejected";
    fabEl.classList.toggle("has-items", hiddenResults.length > 0);
    shitlistItems.innerHTML = shitlist.length ? shitlist.map(item => `
      <div class="shitlist-item">
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.site)} · ${item.keys.length} match keys</span>
        </div>
        <button type="button" class="restore" data-restore-shit="${escapeHtml(item.id)}">Restore</button>
      </div>
    `).join("") : `<div class="shitlist-empty">Nothing rejected yet.</div>`;
    emptyState.style.display = sorted.length ? "none" : "block";

    let html = "";
    let lastDayKey = undefined;

    for (const d of sorted) {
      const isFav = favourites.has(d.id);
      const dayKey = d.firstSeen || null;

      if (showDayGroups && dayKey !== lastDayKey) {
        html += `<div class="day-divider"><span>${escapeHtml(dayGroupLabel(d))}</span></div>`;
        lastDayKey = dayKey;
      }

      html += `
        <article class="listing">
          ${d.image ? `<a href="${d.url}" target="_blank"><img class="listing-image" src="${d.image}" alt="${escapeHtml(d.type)} in ${escapeHtml(d.place)}" loading="lazy" decoding="async"></a>` : ""}
          <div class="listing-head">
            <span class="site" style="color:${siteColor(d.site)}">${d.site}</span>
            <span class="price">${d.priceLabel}</span>
          </div>
          <p class="type"><a href="${d.url}" target="_blank">${d.type} in ${d.place}</a></p>
          <div class="meta">
            <span class="chip">${d.city}</span>
            <span class="chip">${ageLabel(d)}</span>
            ${d.address ? `<span class="chip">${escapeHtml(d.address)}</span>` : ""}
            <span class="chip">${d.area ? d.area + " m2" : "Surface unknown"}</span>
            <span class="chip">${d.beds ? d.beds + " bedrooms" : "Bedrooms unknown"}</span>
            ${d.baths ? `<span class="chip">${d.baths} bathroom</span>` : ""}
            ${d.epc ? `<span class="chip">EPC ${d.epc}</span>` : ""}
          </div>
          <div class="actions">
            <button type="button" class="fav${isFav ? " is-fav" : ""}" data-fav="${escapeHtml(d.id)}" aria-label="${isFav ? "Remove from favourites" : "Add to favourites"}">${isFav ? "&#9733;" : "&#9734;"}</button>
            <button type="button" class="danger" data-shitlist="${escapeHtml(d.id)}">Reject</button>
          </div>
        </article>
      `;
    }

    listingsEl.innerHTML = html;
  }

  cityFilter.addEventListener("change", renderListings);
  siteFilter.addEventListener("change", renderListings);
  typeFilter.addEventListener("change", renderListings);
  sortSelect.addEventListener("change", renderListings);
  favsToggle.addEventListener("click", () => {
    showFavsOnly = !showFavsOnly;
    favsToggle.classList.toggle("is-active", showFavsOnly);
    favsToggle.setAttribute("aria-pressed", String(showFavsOnly));
    renderListings();
  });
  listingsEl.addEventListener("click", event => {
    const shitBtn = event.target.closest("[data-shitlist]");
    if (shitBtn) { addToShitlist(shitBtn.dataset.shitlist); return; }
    const favBtn = event.target.closest("[data-fav]");
    if (favBtn) toggleFavourite(favBtn.dataset.fav);
  });
  shitlistItems.addEventListener("click", event => {
    const button = event.target.closest("[data-restore-shit]");
    if (button) restoreFromShitlist(button.dataset.restoreShit);
  });
  renderListings();
}

initDashboard().catch(showLoadError);
