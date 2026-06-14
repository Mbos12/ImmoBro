import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const LISTINGS_PATH = new URL("../data/listings.json", import.meta.url);
const SEARCHES_PATH = new URL("../data/searches.json", import.meta.url);
const LOG_PATH = new URL("../data/refresh-log.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const ALLOWED_EPC = new Set(["A++", "A+", "A", "B", "C"]);

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(bus|app|apt|appartement|flat)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function numericPrice(text) {
  const match = compact(text).match(/(?:€|EUR)\s*([0-9. ]{4,})/i);
  return match ? Number(match[1].replace(/[^0-9]/g, "")) : null;
}

function numericArea(text) {
  const match = compact(text).match(/(\d{2,4})\s*(?:m²|m2|㎡)/i);
  return match ? Number(match[1]) : null;
}

function priceLabel(price) {
  return `EUR ${Number(price).toLocaleString("en-US")}`;
}

function cityFromPlace(place) {
  if (/Kessel-Lo/i.test(place)) return "Kessel-Lo";
  if (/Heverlee/i.test(place)) return "Heverlee";
  if (/Wijgmaal/i.test(place)) return "Wijgmaal";
  if (/Wilsele/i.test(place)) return "Leuven";
  if (/Kermt|Kortessem/i.test(place)) return "Hasselt";
  if (/Leuven/i.test(place)) return "Leuven";
  if (/Genk/i.test(place)) return "Genk";
  if (/Hasselt/i.test(place)) return "Hasselt";
  return "Other";
}

function addressFromPlace(place) {
  const firstPart = String(place || "").split(",")[0].trim();
  const normalized = normalizeText(firstPart);
  const cityOnly = ["genk", "leuven", "heverlee", "kessel lo", "wijgmaal", "wilsele", "hasselt", "kermt", "kortessem", "3500 hasselt", "3000 leuven", "3600 genk"];
  return !normalized || cityOnly.includes(normalized) ? "" : firstPart;
}

function canonicalKey(listing) {
  const city = normalizeText(listing.city || cityFromPlace(listing.place));
  const address = normalizeText(addressFromPlace(listing.place));
  if (address && Number.isFinite(listing.price)) {
    return `addr-price:${city}:${address}:${listing.price}`;
  }
  if (address && Number.isFinite(listing.area) && Number.isFinite(listing.beds)) {
    return `addr-shape:${city}:${address}:${listing.area}:${listing.beds}`;
  }
  return `url:${listing.url}`;
}

function isEligible(listing, criteria) {
  if (!["Appartement"].includes(listing.type)) return false;
  if (!Number.isFinite(listing.price) || listing.price > criteria.maxPriceEur) return false;
  if (!Number.isFinite(listing.area) || listing.area < criteria.minLivingAreaM2) return false;
  if (listing.epc && !ALLOWED_EPC.has(listing.epc)) return false;
  if (/serviceflat|assistentie|senioren|prijs op aanvraag|price on request/i.test(`${listing.place} ${listing.title || ""}`)) return false;
  return true;
}

function mergeListings(existing, fresh) {
  const byKey = new Map();

  for (const listing of existing) {
    const derivedCity = cityFromPlace(listing.place);
    const city = derivedCity === "Other" ? listing.city || derivedCity : derivedCity;
    const key = listing.canonicalKey || canonicalKey({ ...listing, city });
    byKey.set(key, {
      ...listing,
      city,
      canonicalKey: key,
      firstSeen: listing.firstSeen || TODAY,
      lastSeen: listing.lastSeen || TODAY,
      status: listing.status || "active"
    });
  }

  for (const listing of fresh) {
    const derivedCity = cityFromPlace(listing.place);
    const city = derivedCity === "Other" ? listing.city || derivedCity : derivedCity;
    const key = listing.canonicalKey || canonicalKey({ ...listing, city });
    const previous = byKey.get(key);
    byKey.set(key, {
      ...previous,
      ...listing,
      city,
      canonicalKey: key,
      firstSeen: previous?.firstSeen || TODAY,
      lastSeen: TODAY,
      status: "active"
    });
  }

  return [...byKey.values()].sort((a, b) =>
    String(a.city).localeCompare(String(b.city)) ||
    String(a.site).localeCompare(String(b.site)) ||
    Number(b.price || 0) - Number(a.price || 0)
  );
}

async function safeGoto(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
}

async function scrapeImmoscoop(page, city, url, criteria) {
  await safeGoto(page, url);
  const rows = await page.evaluate(() => {
    const compact = value => String(value || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('a[href*="/te-koop/"]')]
      .map(anchor => {
        const href = new URL(anchor.getAttribute("href"), location.href).href.split("?")[0];
        const text = compact(anchor.innerText);
        const img = anchor.querySelector("img");
        return { href, text, image: img?.currentSrc || img?.src || img?.getAttribute("src") || "" };
      })
      .filter(row => /^Appartement - Te koop/i.test(row.text));
  });

  return rows.map(row => {
    const price = numericPrice(row.text);
    const epc = (row.text.match(/\b(A\+\+|A\+|A|B|C|D|E|F)\b\s*$/) || [])[1] || null;
    const postal = row.text.match(/\b(3\d{3})\s+([A-Za-zÀ-ÿ' -]+)/);
    const beforePostal = postal ? row.text.slice(0, postal.index).trim() : row.text;
    const afterPostal = postal ? row.text.slice(postal.index + postal[0].length).trim() : "";
    const address = beforePostal.replace(/^Appartement\s+-\s+Te koop\s+\S+\s+€\s*[0-9. ]+/i, "").trim();
    const numbers = (afterPostal.match(/\b\d{1,4}(?:\.\d{3})?\b/g) || []).map(n => Number(n.replace(".", "")));
    const area = numbers.find(n => n >= criteria.minLivingAreaM2 && n <= 400) || numericArea(row.text);
    const small = numbers.filter(n => n > 0 && n < 10);
    const place = [address, postal ? `${postal[1]} ${postal[2].trim()}` : city].filter(Boolean).join(", ");
    return {
      site: "Immoscoop",
      type: "Appartement",
      price,
      priceLabel: price ? priceLabel(price) : "Price on request",
      area,
      beds: small.length ? small[small.length - 2] || small[0] : null,
      baths: small.length ? small[small.length - 1] : null,
      epc,
      place,
      url: row.href,
      image: row.image
    };
  }).filter(listing => isEligible(listing, criteria));
}

async function scrapeImmoweb(page, city, url, criteria) {
  await safeGoto(page, url);
  const rows = await page.evaluate(() => {
    const compact = value => String(value || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('a.card__title-link[href*="/zoekertje/"]')]
      .map(anchor => {
        const article = anchor.closest("article");
        const href = anchor.href.split("?")[0];
        const img = article?.querySelector("img");
        return {
          href,
          text: compact(article?.innerText || anchor.innerText),
          image: img?.currentSrc || img?.src || img?.getAttribute("src") || ""
        };
      })
      .filter(row => /\/appartement\//.test(row.href));
  });

  return rows.map(row => {
    const price = numericPrice(row.text);
    const area = numericArea(row.text);
    const beds = Number((row.text.match(/(\d+)\s*slp\./i) || row.text.match(/(\d+)\s*slaapkamer/i) || [])[1]) || null;
    const place = (row.text.match(/\b(3\d{3})\s+([A-ZÀ-Ÿa-zà-ÿ -]+)/) || [])[0] || city;
    return {
      site: "Immoweb",
      type: "Appartement",
      price,
      priceLabel: price ? priceLabel(price) : "Price on request",
      area,
      beds,
      place: compact(place),
      daysOnline: /NIEUW/i.test(row.text) ? 0 : null,
      url: row.href,
      image: row.image
    };
  }).filter(listing => isEligible(listing, criteria));
}

function zimmoSearchUrl(placeId, criteria) {
  const search = {
    filter: {
      status: { in: ["FOR_SALE", "TAKE_OVER"] },
      placeId: { in: [placeId] },
      price: { range: { max: criteria.maxPriceEur }, unknown: false },
      floorspaceSurface: { range: { min: criteria.minLivingAreaM2 }, unknown: false },
      category: { in: ["APARTMENT"] }
    },
    paging: { from: 0, size: 20 },
    sorting: [{ type: "DATE", order: "DESC" }]
  };
  return `https://www.zimmo.be/nl/zoeken/?search=${encodeURIComponent(Buffer.from(JSON.stringify(search)).toString("base64"))}&p=1#gallery`;
}

async function scrapeZimmo(page, city, source, criteria) {
  const url = source.zimmoPlaceId ? zimmoSearchUrl(source.zimmoPlaceId, criteria) : source.zimmoUrl;
  if (!url) return [];
  await safeGoto(page, url);
  const rows = await page.evaluate(() => {
    const compact = value => String(value || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('a.property-item_link[href*="/te-koop/appartement/"]')]
      .map(anchor => {
        const card = anchor.parentElement?.closest(".property-item");
        const img = card?.querySelector("img");
        return {
          href: anchor.href.split("?")[0].replace(/\/?$/, "/"),
          text: compact(card?.innerText || ""),
          image: img?.currentSrc || img?.src || img?.getAttribute("src") || ""
        };
      });
  });

  return rows.map(row => {
    const price = numericPrice(row.text);
    const area = numericArea(row.text);
    const beds = Number((row.text.match(/m²\s*(\d+)\b/i) || [])[1]) || null;
    const d = row.text.match(/\b(\d+)d\b/);
    const address = row.text.match(/Appartement te koop\s+(.+?)\s+(3\d{3}\s+[A-Za-zÀ-ÿ' -]+)/i);
    return {
      site: "Zimmo",
      type: "Appartement",
      price,
      priceLabel: price ? priceLabel(price) : "Price on request",
      area,
      beds,
      place: address ? `${address[1]}, ${address[2]}` : city,
      daysOnline: d ? Number(d[1]) : (/\b\d+u\b|Nieuw/i.test(row.text) ? 0 : null),
      url: row.href,
      image: row.image
    };
  }).filter(listing => isEligible(listing, criteria));
}

async function main() {
  const config = JSON.parse(await fs.readFile(SEARCHES_PATH, "utf8"));
  const existing = JSON.parse(await fs.readFile(LISTINGS_PATH, "utf8"));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const fresh = [];
  const log = [];

  for (const search of config.searches) {
    const { city, sources } = search;
    const before = fresh.length;
    try {
      if (sources.immoscoopApartment) fresh.push(...await scrapeImmoscoop(page, city, sources.immoscoopApartment, config.criteria));
      if (sources.immoweb) fresh.push(...await scrapeImmoweb(page, city, sources.immoweb, config.criteria));
      fresh.push(...await scrapeZimmo(page, city, sources, config.criteria));
      const addedCandidates = fresh.length - before;
      log.push({ city, ok: true, addedCandidates });
    } catch (error) {
      log.push({ city, ok: false, error: String(error.message || error) });
    }
  }

  await browser.close();

  if (fresh.length === 0) {
    await fs.writeFile(LOG_PATH, `${JSON.stringify({ refreshedAt: new Date().toISOString(), candidates: 0, totalListings: existing.length, searches: log, skippedWrite: true }, null, 2)}\n`);
    throw new Error("Refresh produced zero eligible candidates; keeping existing listings.json unchanged.");
  }

  const merged = mergeListings(existing, fresh);
  await fs.writeFile(LISTINGS_PATH, `${JSON.stringify(merged, null, 2)}\n`);
  await fs.writeFile(LOG_PATH, `${JSON.stringify({ refreshedAt: new Date().toISOString(), candidates: fresh.length, totalListings: merged.length, searches: log }, null, 2)}\n`);
  console.log(`Refreshed ${fresh.length} candidates; ${merged.length} listings in data/listings.json`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
