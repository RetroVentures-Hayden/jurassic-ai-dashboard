#!/usr/bin/env node
// Dev-time only: (re)builds src/main/db/seed/animals.seed.json from live PBDB
// (extinct)/GBIF (extant) + Wikipedia summaries. Not run by the packaged app
// or the systemd timer — the shipped seed file is committed as-is so first
// install works offline; the daily sync script grows the DB from there.
// Run manually with real network access: `npm run build:seed`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'src', 'main', 'db', 'seed', 'animals.seed.json');
const USER_AGENT = 'JurassicAiDashboard/1.0 (https://github.com/RetroVentures-Hayden/jurassic-ai-dashboard)';
const TARGET_COUNT = parseInt(process.env.SEED_COUNT || '60', 10);

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function wikipediaSummary(title) {
  try {
    const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    return {
      description: data.extract || null,
      image_url: data.thumbnail?.source || null,
      image_attribution: data.content_urls?.desktop?.page || null,
    };
  } catch {
    return { description: null, image_url: null, image_attribution: null };
  }
}

async function fetchExtinct(limit) {
  const data = await fetchJson(
    `https://paleobiodb.org/data1.2/taxa/list.json?base_name=Dinosauria&rank=genus&status=valid&limit=${limit}`
  );
  return (data.records || []).map((rec) => ({
    common_name: rec.nam,
    scientific_name: rec.nam,
    status: 'extinct',
    habitat: 'land',
    clade: rec.phl || rec.odl || 'Dinosauria',
    period: rec.tei || rec.tli || null,
    conservation_status: null,
    source: 'pbdb',
    source_id: String(rec.oid || rec.tid || rec.nam),
  }));
}

function guessHabitat(rec) {
  const cls = (rec.class || '').toLowerCase();
  if (cls === 'aves') return 'air';
  if (['actinopterygii', 'chondrichthyes', 'elasmobranchii'].includes(cls)) return 'water';
  return 'land';
}

async function fetchExtant(limit) {
  const data = await fetchJson(
    `https://api.gbif.org/v1/species/search?rank=SPECIES&highertaxon_key=44&status=ACCEPTED&limit=${limit}`
  );
  return (data.results || [])
    .filter((rec) => rec.canonicalName)
    .map((rec) => ({
      common_name: rec.vernacularName || rec.canonicalName,
      scientific_name: rec.canonicalName,
      status: 'extant',
      habitat: guessHabitat(rec),
      clade: rec.class || rec.phylum || null,
      period: null,
      conservation_status: null,
      source: 'gbif',
      source_id: String(rec.key),
    }));
}

async function main() {
  const half = Math.ceil(TARGET_COUNT / 2);
  console.log(`Fetching ~${half} extinct taxa from PBDB and ~${half} extant taxa from GBIF...`);

  const [extinct, extant] = await Promise.all([fetchExtinct(half), fetchExtant(half)]);
  const combined = [...extinct, ...extant];

  const enriched = [];
  for (const animal of combined) {
    const enrichment = await wikipediaSummary(animal.scientific_name || animal.common_name);
    enriched.push({ ...animal, ...enrichment });
    process.stdout.write('.');
  }
  console.log(`\nEnriched ${enriched.length} records.`);

  fs.writeFileSync(OUT_PATH, JSON.stringify(enriched, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('Failed to build animal seed:', err);
  process.exit(1);
});
