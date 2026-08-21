# Research Notes

Tracks which external URLs used by the app have been verified as real vs. still pending. This file exists because the app must never ship fabricated/guessed URLs — every `maps` and `books` seed entry needs a checked source.

## Verification method used

This app was built in a sandboxed session with **no general internet access** (Bash and WebFetch were both blocked; only the `WebSearch` tool could reach the web, and it returns search snippets/links rather than full page fetches). URLs below were confirmed to exist via WebSearch results, but page content, exact image URLs, and live API behavior could **not** be directly fetched/tested from that session. Everything needs a first real-world check when you run the app on your own machine (which does have internet access).

## Maps — verified via WebSearch (2026-08-20)

| Title | URL | Status |
|---|---|---|
| Jurassic World Park Map (2015) | https://jurassicpark.fandom.com/wiki/Jurassic_World_map | Page confirmed to exist via search. Image not directly verified — app resolves a preview image lazily via the MediaWiki `pageimages` API at runtime. |
| Isla Nublar | https://jurassicpark.fandom.com/wiki/Isla_Nublar | Same as above. |
| Jurassic Park / World Park Map (general) | https://jurassicpark.fandom.com/wiki/Park_Map | Same as above. |
| Jurassic-Pedia: Film Location Maps | https://www.jurassic-pedia.com/category/encyclopedia/movieuniverse/filmlocations/location-maps-s-f/ | Confirmed real fan encyclopedia site. |
| Jurassic World Orlando Map (fan) | https://www.deviantart.com/joshuadunlop/art/Jurassic-World-Orlando-Map-525994075 | Confirmed real DeviantArt page. |

**Not yet added** (candidates for a future pass, need verification): Isla Sorna page, Biosyn Genetics valley map (Jurassic World Dominion), any dedicated interactive fan map tools.

## Books — verified via WebSearch (2026-08-20)

All 6 entries in `books.seed.json` were confirmed via search (Wikipedia pages for the two Crichton novels, Amazon/publisher pages with real ISBNs for the rest). Cover images use the Open Library Covers API (`https://covers.openlibrary.org/b/isbn/{ISBN}-L.jpg}`), a real, stable, no-auth public service — but not every ISBN is guaranteed to have a cover on file; the modal falls back to "no preview" gracefully if not.

**Not yet added**: the "four visual encyclopedia Field Guides" mentioned in search results exist per secondary sources but specific titles/ISBNs weren't confirmed — add them once verified.

## News feed

Uses the Google News RSS search endpoint (`https://news.google.com/rss/search?q=...&hl=en-US&gl=US&ceid=US:en`), a long-standing, widely used, no-API-key public endpoint. **Could not be live-tested from the build session** (no network). First thing to check when you run the app: open the News tab and click "Refresh News" — if it errors, the query string or endpoint may need adjusting.

## Animal database sources

- Paleobiology Database (`https://paleobiodb.org/data1.2/`) — extinct/fossil taxa. Real, stable, public, documented API.
- GBIF (`https://api.gbif.org/v1/`) — extant taxonomy. Real, stable, public, documented API.
- Wikipedia REST summary API (`https://en.wikipedia.org/api/rest_v1/page/summary/{title}`) — descriptions/images/context.
- The shipped `animals.seed.json` (~34 species) was hand-curated from general knowledge rather than pulled live, since the build session had no network. Run `npm run build:seed` later (with real internet) to regenerate it from live API data, and the nightly sync script will grow the database from there regardless.

## First-run checklist (do this once you have the app running with real internet)

1. `npm install` — could not be run during the build session.
2. `npm start` — confirm the app launches and the seeded data (checklist, maps, books, animals) shows up.
3. Maps/Books tabs — click a few cards, confirm the image pop-up either shows a real image or gracefully shows "no preview" instead of breaking.
4. News tab — click Refresh, confirm real headlines come back.
5. Chat tab — confirm it reaches your local Ollama (`qwen2.5:7b`).
6. Settings → Sync Now — confirm the animal sync script runs and inserts/updates rows without error.
