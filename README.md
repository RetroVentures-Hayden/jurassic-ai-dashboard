# Jurassic AI Dashboard

A local-first Electron desktop app for the Jurassic Park / Jurassic World franchise, combining a
personal collection tracker with a full real-world animal encyclopedia.

Runs entirely on your own machine — no accounts, no cloud services, no telemetry.

## Features

- **Checklist** — track which films, series (per season) and books you own a **physical copy** of,
  each linking to its Amazon listing
- **Wiki/Maps** — a directory of the major Jurassic-franchise wiki sites (kept current from a
  seed file), plus official in-universe park/island maps and fan-made recreations shown in
  pop-up image panels
- **Books** — the Jurassic book universe (Crichton novels, junior novelizations, guides, art books)
- **Animals** — **1.8 million real species**, extinct and living, imported from the Paleobiology
  Database and the GBIF taxonomic backbone. Searchable and filterable by land/water/air and
  extinct/alive, with Wikipedia descriptions.
- **News** — headlines from Google News RSS, grouped into three topics: the Jurassic franchise,
  prehistoric & fossil discoveries, and wildlife & conservation
- **Chat** — a local AI assistant backed by Ollama (`qwen2.5:7b`), grounded against the animal database

## Requirements

- Linux (built and tested on Pop!\_OS 24.04); Windows and macOS build configs are included
- Node.js 20+
- [Ollama](https://ollama.com) with a model pulled — only needed for the Chat tab

## Setup

```bash
npm install
npm start          # desktop (Electron) app
npm run web        # web host — same UI over HTTP, for phones/tablets/other PCs
```

`npm run web` serves the dashboard at `http://127.0.0.1:4178` (set `WEB_TOKEN` to
require a shared secret) and takes over the nightly animal sync. Expose it to your
other devices with a Cloudflare Tunnel — see
[docs/WEB_HOSTING.md](docs/WEB_HOSTING.md). Run the web host **or** the desktop
app, not both (DuckDB allows a single writer).

On first launch the app creates its DuckDB database at
`~/.config/jurassic-ai-dashboard/jurassic.duckdb` and seeds a curated starter set of animals.

## Building an installable package

```bash
npm run build:linux                                   # .deb + AppImage
sudo dpkg -i dist/jurassic-ai-dashboard_*_amd64.deb   # installs to the Applications menu
```

`npm run build:win` (needs Wine on Linux) and `npm run build:mac` (must run on macOS) are also
available.

## Populating the animal database

The app ships with ~139 hand-curated species (the notable real prehistoric and modern animals
featured across the films and series). The **Animals → Sync Now** button tops this up on demand
with new taxa from the Paleobiology Database and GBIF; it runs inside the app process against
the open database, so it works with the app running. The scripts below grow it to the full
dataset instead.

**Close the app before running any of the command-line scripts — DuckDB allows a single writer,
and a second process can't open the database while the app holds it.**

```bash
# 1. Download the GBIF backbone dump (~488MB)
mkdir -p /tmp/gbif_bulk && curl -C - --http1.1 --retry 10 --retry-all-errors \
  -o /tmp/gbif_bulk/simple.txt.gz \
  https://hosted-datasets.gbif.org/datasets/backbone/current/simple.txt.gz

# 2. Import every accepted animal species (~1.8M rows, takes ~10 seconds)
node scripts/import-gbif-backbone.mjs

# 3. Backfill taxonomic class (Mammalia, Aves, …)
node scripts/backfill-clade.mjs

# 4. Backfill real English common names — see docs/RESEARCH_NOTES.md for
#    how to extract VernacularName.tsv without downloading the full 971MB archive
node scripts/backfill-common-names.mjs

# 5. Backfill Wikipedia descriptions for vertebrates (several hours, resumable)
node scripts/enrich-descriptions.mjs --limit=60000
```

Every step is resumable and safe to re-run; progress is saved incrementally.

### Nightly updates

The app installs a `systemd --user` timer that tops up the animal database each night, self-gated
to ~3:00 AM America/New\_York (DST-aware, with a catch-up window if the machine was asleep). If it
doesn't register automatically:

```bash
systemctl --user daemon-reload
systemctl --user enable --now jurassic-animal-sync.timer
systemctl --user list-timers --all | grep jurassic
```

## Useful scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Run in development |
| `npm run sync:animals:force` | Run the nightly sync immediately, bypassing the time gate |
| `node scripts/sync-animal-db.mjs --dry-run --force` | Test the sync without writing |
| `node scripts/sync-animal-db.mjs --simulate-ny-time="2026-03-08T02:30:00" --dry-run` | Test DST-edge gating |
| `node scripts/enrich-descriptions.mjs --limit=N` | Backfill descriptions |
| `node scripts/migrate-to-duckdb.mjs` | One-time migration from a legacy SQLite database |

## Data sources & caveats

- **[GBIF backbone taxonomy](https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c)** —
  species, classes and vernacular names. The bulk dump is a periodic snapshot (currently
  2023-08-28), so it isn't live; the nightly sync queries the live GBIF API for anything newer.
- **[Paleobiology Database](https://paleobiodb.org)** — extinct dinosaur genera.
- **[Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/)** — descriptions and images,
  fetched on demand and cached.

Known limitations, stated plainly:

- **Most species have no description.** Roughly 1.7M of the 1.8M are obscure insects, mites and
  molluscs with no English Wikipedia article at all. The "Load Info" button on each card fetches
  one on demand and says so clearly when none exists.
- **Habitat is inferred from taxonomic class**, so it's accurate at the group level but not
  per-species (aquatic insects, for example, are grouped under land).
- **Extinct/alive status is imperfect.** GBIF's backbone carries no general extinct flag, so only
  wholly-extinct classes (e.g. Trilobita) are marked extinct; fossil species inside otherwise-living
  groups may show as alive.
- **Only ~85k species have a real common name**; the rest display their scientific name, because
  no vernacular name exists in GBIF for them.

## Project layout

```
src/main/          Electron main process — database, IPC handlers, services
src/renderer/      UI (plain HTML/CSS/JS, no framework) — shared by both frontends
src/server/        Web host — reuses the IPC handlers over HTTP (npm run web)
scripts/           Data import, migration and enrichment scripts
packaging/         Icons and systemd unit templates
docs/              Research notes on verified data sources
```

## License

Personal project, unlicensed. Franchise names, artwork and trademarks belong to Universal Studios
and Amblin Entertainment; this app links to public sources and stores no franchise media itself.
