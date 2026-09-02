# Research Notes

Tracks which external URLs used by the app have been verified as real vs. still pending. This file exists because the app must never ship fabricated/guessed URLs — every `maps` and `books` seed entry needs a checked source.

## Verification method used

This app was built in a sandboxed session with **no general internet access** (Bash and WebFetch were both blocked; only the `WebSearch` tool could reach the web, and it returns search snippets/links rather than full page fetches). URLs below were confirmed to exist via WebSearch results, but page content, exact image URLs, and live API behavior could **not** be directly fetched/tested from that session. Everything needs a first real-world check when you run the app on your own machine (which does have internet access).

## Wiki/Maps

The "Maps" tab was renamed **Wiki/Maps** and now has three sections, all fed from
`maps.seed.json` and kept current by `syncMapsFromSeed` in `db/index.js` (adds new titles,
refreshes URL/description/category on existing ones — same pattern as the books seed):
`category: 'wiki'` (franchise wiki sites, opened straight in the browser), `'official'`
(in-universe maps, image pop-up) and `'fan'` (fan-made maps, image pop-up). Migration
`003_maps_wiki_category.sql` widens the `maps.category` CHECK to allow `'wiki'`.

### Maps — verified via WebSearch (2026-08-20)

| Title | URL | Status |
|---|---|---|
| Jurassic World Park Map (2015) | https://jurassicpark.fandom.com/wiki/Jurassic_World_map | Page confirmed to exist via search. Image not directly verified — app resolves a preview image lazily via the MediaWiki `pageimages` API at runtime. |
| Isla Nublar | https://jurassicpark.fandom.com/wiki/Isla_Nublar | Same as above. |
| Jurassic Park / World Park Map (general) | https://jurassicpark.fandom.com/wiki/Park_Map | Same as above. |
| Jurassic-Pedia: Film Location Maps | https://www.jurassic-pedia.com/category/encyclopedia/movieuniverse/filmlocations/location-maps-s-f/ | Confirmed real fan encyclopedia site. |
| Jurassic World Orlando Map (fan) | https://www.deviantart.com/joshuadunlop/art/Jurassic-World-Orlando-Map-525994075 | Confirmed real DeviantArt page. |

### Franchise wiki sites — verified via WebSearch (2026-09-02)

| Title | URL | Status |
|---|---|---|
| Jurassic Park Wiki (ParkPedia) | https://jurassicpark.fandom.com | Largest community wiki; confirmed active. |
| Jurassic-Pedia | https://www.jurassic-pedia.com | Unofficial canon encyclopedia; confirmed active (also used above for maps). |
| Jurassic Outpost | https://jurassicoutpost.com | Fan-news site (2016 rebrand of JurassicWorld.org); confirmed active, covering Rebirth. |
| The Jurassic Wiki (Jurassic Outpost Encyclopedia) | https://jurassicwiki.com | Encyclopedia arm of Jurassic Outpost; confirmed via search. |
| Jurassic Park Institute Wiki | https://jurassic-park-institute.fandom.com | Dinosaur-focused Fandom wiki (~1,000 articles); confirmed active. |
| Jurassic World Evolution Wiki | https://jurassicworld-evolution.fandom.com | Fandom wiki for the Frontier games; confirmed active (notes JWE3). |
| Jurassic World Alive Wiki | https://jurassic-world-alive.fandom.com | Fandom wiki for the Ludia AR game; confirmed active. |
| Jurassic World: The Game Wiki | https://jurassic-world-the-game.fandom.com | Fandom wiki for the Ludia builder game; confirmed via search. |
| Wikipedia: Jurassic Park (franchise) | https://en.wikipedia.org/wiki/Jurassic_Park | Real-world reference. |
| Wikipedia: Dinosaurs in Jurassic Park | https://en.wikipedia.org/wiki/Dinosaurs_in_Jurassic_Park | Canonical on-screen creature list. |

**Deliberately excluded:** Jurassic Park Legacy (jplegacy.org) — a major fan encyclopedia/forum
but it shut down in June 2016, so it fails the "keep the links up to date" bar.

**Not yet added** (candidates for a future pass, need verification): Isla Sorna page, Biosyn
Genetics valley map (Jurassic World Dominion), any dedicated interactive fan map tools.

## Books — verified via WebSearch (2026-08-20)

All 6 entries in `books.seed.json` were confirmed via search (Wikipedia pages for the two Crichton novels, Amazon/publisher pages with real ISBNs for the rest). Cover images use the Open Library Covers API (`https://covers.openlibrary.org/b/isbn/{ISBN}-L.jpg}`), a real, stable, no-auth public service — but not every ISBN is guaranteed to have a cover on file; the modal falls back to "no preview" gracefully if not.

**Not yet added**: the "four visual encyclopedia Field Guides" mentioned in search results exist per secondary sources but specific titles/ISBNs weren't confirmed — add them once verified.

## News feed

Uses the Google News RSS search endpoint (`https://news.google.com/rss/search?q=...&hl=en-US&gl=US&ceid=US:en`), a long-standing, widely used, no-API-key public endpoint.

The dashboard covers two subjects — the Jurassic franchise **and** a real extinct/living-animal
encyclopedia — so `newsService.js` runs one feed per topic and merges the results (deduped by
link). Each stored row carries a `topic` (`franchise` / `paleo` / `wildlife`; migration
`004_news_topic.sql`) and the News tab groups the headlines under three headings:

| Topic | Heading | Query gist |
|---|---|---|
| `franchise` | Jurassic Franchise | `("Jurassic World" OR "Jurassic Park") (movie OR film OR series OR "Universal Studios" OR Amblin)` |
| `paleo` | Prehistoric & Fossil Discoveries | `(dinosaur OR fossil OR paleontology OR "prehistoric animal" OR "de-extinction") (discovery OR species OR research OR excavation)` |
| `wildlife` | Wildlife & Conservation | `("endangered species" OR "wildlife conservation" OR "extinct in the wild" OR "newly discovered species" OR rewilding) animal` |

Verified live on 2026-09-02: all three feeds return ~100 relevant items. Tune the query strings
in `newsService.js` if a topic drifts off-subject. If one feed rate-limits, the others still load.

## Animal database sources

- Paleobiology Database (`https://paleobiodb.org/data1.2/`) — extinct/fossil taxa. Real, stable, public, documented API.
- GBIF (`https://api.gbif.org/v1/`) — extant taxonomy. Real, stable, public, documented API.
- Wikipedia REST summary API (`https://en.wikipedia.org/api/rest_v1/page/summary/{title}`) — descriptions/images/context.
- The shipped `animals.seed.json` (~139 species) was hand-curated from general knowledge rather than pulled live, since the build session had no network. Run `npm run build:seed` later (with real internet) to regenerate it from live API data, and the nightly sync script will grow the database from there regardless.
- The curated set holds **both** extinct and living animals (84 extinct / 55 extant as of 2026-09-02) — the Animals tab's "Extinct" / "Alive Today" filters both have content out of the box. `syncAnimalsFromSeed` in `db/index.js` adds any new `common_name` from the seed on startup, so the list only ever grows.
- 2026-09-02 pass: added ~28 real prehistoric animals featured across the films, *Camp Cretaceous*, *Chaos Theory* and *Rebirth* that were missing (e.g. Ceratosaurus, Corythosaurus, Sinoceratops, Nasutoceratops, Suchomimus, Pyroraptor, Atrociraptor, Dreadnoughtus, Moros intrepidus, Dimetrodon, Lystrosaurus, Titanosaurus, Aquilops, Kentrosaurus, Majungasaurus, Pachyrhinosaurus). Fictional hybrids (Indominus rex, Indoraptor, Scorpios rex, Distortus rex, Mutadon) were deliberately left out — the tab is real animals only.

## First-run checklist (do this once you have the app running with real internet)

1. `npm install` — could not be run during the build session.
2. `npm start` — confirm the app launches and the seeded data (checklist, maps, books, animals) shows up.
3. Maps/Books tabs — click a few cards, confirm the image pop-up either shows a real image or gracefully shows "no preview" instead of breaking.
4. News tab — click Refresh, confirm real headlines come back.
5. Chat tab — confirm it reaches your local Ollama (`qwen2.5:7b`).
6. Animals → Sync Now — confirm it inserts/updates rows without error. It now runs the sync
   **in-process** (`src/main/services/animalSync.js`) against the app's own DB connection; it used
   to spawn `scripts/sync-animal-db.mjs`, which could never get DuckDB's single writer lock while
   the app was open and so always failed with "Connection was never established". The standalone
   script still exists for the nightly `systemd --user` timer (app closed) and shares that same
   core module.
