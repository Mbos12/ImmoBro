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
- `docs/immo_search_pattern.md` documents the source-specific query patterns.

## Daily refresh direction

The next sustainability step is a refresh script that reads `data/searches.json`, queries Immoweb/Zimmo/Immoscoop, normalizes results, and writes an updated `data/listings.json`. The dashboard does not need to change for that; it only consumes the JSON.
