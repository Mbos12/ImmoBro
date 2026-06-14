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
  
  function typeColor(d) {
    if (d.type === "Huis") return "var(--house)";
    if (d.type === "Project") return "var(--project)";
    return "var(--apt)";
  }
  
  function cityFromPlace(place) {
    if (/Kessel-Lo/i.test(place)) return "Kessel-Lo";
    if (/Heverlee/i.test(place)) return "Heverlee";
    if (/Wijgmaal/i.test(place)) return "Wijgmaal";
    if (/Wilsele/i.test(place)) return "Leuven";
    if (/Kermt|Kortessem/i.test(place)) return "Hasselt";
    if (/Leuven/i.test(place)) return "Leuven";
    if (/Diest/i.test(place)) return "Diest";
    if (/Genk/i.test(place)) return "Genk";
    if (/Hasselt/i.test(place)) return "Hasselt";
    return "Other";
  }
  
  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
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
  
  for (const result of results) {
    result.city = cityFromPlace(result.place);
    result.id = result.url;
    result.address = addressFromPlace(result.place);
    result.matchKeys = matchKeys(result);
  }
  
  const cityFilter = document.getElementById("city-filter");
  const siteFilter = document.getElementById("site-filter");
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
  let shitlist = loadShitlist();
  
  function loadShitlist() {
    try {
      const parsed = JSON.parse(localStorage.getItem(shitlistStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter(item => Array.isArray(item.keys)) : [];
    } catch {
      return [];
    }
  }
  
  function saveShitlist() {
    localStorage.setItem(shitlistStorageKey, JSON.stringify(shitlist));
  }
  
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
    const hiddenResults = results.filter(d => shitlistMatch(d));
    const activeResults = results.filter(d => !shitlistMatch(d));
    const visible = activeResults.filter(d =>
      (!selectedCity || d.city === selectedCity) &&
      (!selectedSite || d.site === selectedSite)
    );
  
    resultCountEl.textContent = `${visible.length} of ${activeResults.length} listings shown`;
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
    emptyState.style.display = visible.length ? "none" : "block";
    listingsEl.innerHTML = visible.map(d => `
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
          <button type="button" class="danger" data-shitlist="${escapeHtml(d.id)}">Reject</button>
        </div>
      </article>
    `).join("");
  }
  
  cityFilter.addEventListener("change", renderListings);
  siteFilter.addEventListener("change", renderListings);
  listingsEl.addEventListener("click", event => {
    const button = event.target.closest("[data-shitlist]");
    if (button) addToShitlist(button.dataset.shitlist);
  });
  shitlistItems.addEventListener("click", event => {
    const button = event.target.closest("[data-restore-shit]");
    if (button) restoreFromShitlist(button.dataset.restoreShit);
  });
  renderListings();
}

initDashboard().catch(showLoadError);
