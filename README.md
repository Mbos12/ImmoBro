# ImmoBro

A small personal apartment dashboard built with plain HTML, CSS, and JavaScript.

The dashboard is intentionally static and lightweight: the UI reads listings from `data/listings.json`, applies the standard filters in the browser, and keeps the shitlist in `localStorage`.

## Run locally

```sh
python3 -m http.server 8765
```

Then open [http://127.0.0.1:8765](http://127.0.0.1:8765).

Opening `index.html` directly from Finder is not recommended because browsers usually block `fetch()` from reading local JSON files on `file://` URLs.

## Project shape

- `index.html` contains only the page structure.
- `styles.css` contains the dashboard styling.
- `app.js` loads and renders listings, handles filters, and manages the shitlist.
- `data/listings.json` contains the current normalized listing data.
- `data/searches.json` records reusable search criteria and source URLs/place IDs.
- `scripts/refresh-listings.mjs` contains reusable parsing and merge logic for refreshes.
- `docs/immo_search_pattern.md` documents the source-specific query patterns.

## How the dashboard works

The dashboard is a static GitHub Pages app. It does not have a backend server. On page load, `app.js` fetches `data/listings.json`, filters the listings, and renders cards in the browser.

`data/listings.json` is the source of truth for apartments shown in the dashboard. Each listing stores the source website, URL, location, price, surface area, bedroom count, EPC label when available, first/last seen dates, status, and a remote image URL.

The shitlist currently lives in browser `localStorage`. That is simple and private, but it is local to one browser/device. For cross-device shitlist sync, add a small database such as Supabase later.

## Daily refresh

The refresh is scheduled as a Codex automation at 08:00 and 20:00 Belgium time. The automation runs in the local workspace and uses the Codex in-app browser workflow to open the configured searches, read the visible listing pages, update the JSON data, and push changed data back to GitHub.

The refresh flow is:

1. Read search criteria from `data/searches.json`.
2. Query Immoweb, Zimmo, and Immoscoop with the Codex in-app browser.
3. Normalize all listings into the same JSON shape.
4. Skip price-on-request listings, service flats, unknown/below-50m2 surfaces, over-budget listings, and EPC labels worse than C when exposed.
5. Merge fresh results into `data/listings.json`.
6. Merge new listings into the existing JSON without deleting existing rows.
7. Commit `data/listings.json` and `data/refresh-log.json` back to GitHub only when data changed.

The `scripts/refresh-listings.mjs` file remains useful as a helper/reference for parsing, normalization, and merge rules. The scheduled automation should still use browser-visible search pages as the primary source of truth.

Images are stored as remote image URLs, not copied into the repo. That keeps the repository small and avoids committing large binary files every day.

## Why JSON commits instead of Supabase for listings?

For the public listing feed, updating JSON in GitHub is the simplest durable option:

- GitHub Pages can serve the JSON directly.
- GitHub history becomes a free audit trail of changes over time.
- There is no extra database to maintain.
- The dashboard stays static and cheap.

Supabase is a good next step for user-specific state, especially shitlist/favorites/notes across devices. It is less necessary for the listing feed itself unless the JSON file becomes too large or querying history in the UI becomes important.

Recommended split:

- Listings over time: `data/listings.json` committed by the Codex automation.
- Personal state across devices: Supabase table for shitlist/favorites, protected by Supabase Auth.

## Where an LLM is useful

An LLM is useful for maintenance and interpretation, not for every refresh.

Good LLM tasks:

- Repair a scraper when a website changes its HTML.
- Compare a listing across websites and improve deduplication rules.
- Extract messy text into structured fields when a site exposes inconsistent labels.
- Summarize new listings or explain why a listing was filtered out.
- Suggest better search parameters per city.
- Review `data/refresh-log.json` when a refresh starts failing.

Tasks that should stay deterministic code:

- Running the 08:00/20:00 refresh.
- Applying price, surface, EPC, and service-flat filters.
- Merging by URL/canonical key.
- Updating `firstSeen` and `lastSeen`.
- Rendering the dashboard.

This keeps the app reliable and cheap: deterministic code does the daily work, and an LLM helps when the real estate sites get weird.
