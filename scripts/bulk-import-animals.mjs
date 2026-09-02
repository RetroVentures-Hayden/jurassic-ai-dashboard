#!/usr/bin/env node
// One-off (re-runnable) bulk importer: pulls real taxa in bulk from PBDB
// (extinct) and GBIF (extant) directly into the animals table, without the
// per-item Wikipedia enrichment the nightly sync does (that's what makes
// pulling thousands of records at once practical instead of taking hours).
// Descriptions/images for these rows stay null until the user clicks that
// animal's "Wikipedia" button in the app, which resolves+caches it lazily —
// same mechanism already used for the hand-curated animals.
//
// Shares its exhaustion bookkeeping (settings keys like
// `pbdb_offset__exhausted` / `gbif_offset_<key>__exhausted`) with the nightly
// sync script, so a source this marks as exhausted correctly makes the
// nightly job switch to its lightweight "anything new yet" check instead of
// requesting large pages for nothing, and vice versa.
//
// Usage: node scripts/bulk-import-animals.mjs [--count=400000]
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import duckdb from 'duckdb';

const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');
const USER_AGENT = 'JurassicAiDashboard/1.0 (https://github.com/RetroVentures-Hayden/jurassic-ai-dashboard)';

const countArg = process.argv.find((a) => a.startsWith('--count='));
const TARGET_COUNT = countArg ? parseInt(countArg.split('=')[1], 10) : 2000;
const PBDB_SHARE = Math.ceil(TARGET_COUNT * 0.1); // dinosaurs are a small, finite pool; give them a modest slice
const GBIF_SHARE = TARGET_COUNT - PBDB_SHARE;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// GBIF starts timing out requests under sustained load (observed directly:
// a run of consecutive "operation was aborted due to timeout" errors across
// every active group at once, not random bad luck). Retrying with backoff
// instead of giving up on the first timeout means a big run recovers on its
// own instead of prematurely marking groups exhausted from network noise.
async function fetchJson(url, attempt = 1) {
  const MAX_ATTEMPTS = 6;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    const backoffMs = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s, 16s, 32s
    console.error(`  request failed (attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${backoffMs}ms): ${err.message}`);
    await sleep(backoffMs);
    return fetchJson(url, attempt + 1);
  }
}

// --- Minimal promisified DuckDB helpers ---
function dbAll(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.all(sql, ...params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function dbRun(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.run(sql, ...params, (err) => (err ? reject(err) : resolve()));
  });
}
async function dbGet(conn, sql, params = []) {
  const rows = await dbAll(conn, sql, params);
  return rows[0] ?? null;
}
function dbExec(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function getCursor(conn, key) {
  const row = await dbGet(conn, 'SELECT value FROM settings WHERE key = ?', [key]);
  return row ? parseInt(row.value, 10) : 0;
}

async function setCursor(conn, key, value) {
  await dbRun(
    conn,
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}

async function isExhausted(conn, key) {
  return (await getCursor(conn, `${key}__exhausted`)) === 1;
}

async function setExhausted(conn, key, value) {
  await setCursor(conn, `${key}__exhausted`, value ? 1 : 0);
}

// --- PBDB: extinct dinosaur genera, paginated ---
async function fetchAllPbdb(conn, target) {
  const cursorKey = 'pbdb_offset';
  if (await isExhausted(conn, cursorKey)) {
    console.log('  PBDB already fully caught up (no more dinosaur genera to add) — skipping.');
    return { records: [] };
  }

  const records = [];
  let offset = await getCursor(conn, cursorKey);
  const pageSize = 500;
  let exhausted = false;
  while (records.length < target) {
    const url = `https://paleobiodb.org/data1.2/taxa/list.json?base_name=Dinosauria&rank=genus&status=valid&limit=${pageSize}&offset=${offset}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      console.error(`PBDB page at offset ${offset} failed: ${err.message}`);
      break;
    }
    const page = data.records || [];
    for (const rec of page) {
      records.push({
        common_name: rec.nam,
        scientific_name: rec.nam,
        status: 'extinct',
        habitat: 'land',
        clade: rec.phl || rec.odl || 'Dinosauria',
        period: rec.tei || rec.tli || null,
        source: 'pbdb',
        source_id: String(rec.oid || rec.tid || rec.nam),
      });
    }
    offset += page.length;
    if (page.length < pageSize) {
      exhausted = true;
      break;
    }
    await sleep(300);
  }
  await setCursor(conn, cursorKey, offset);
  await setExhausted(conn, cursorKey, exhausted);
  return { records };
}

// --- GBIF: extant animal species ---
// A single broad Animalia query turned out to return long monotonous runs of
// one class at a time (an early run landed 1224 records in a row that were
// ALL sea squirts) rather than anything resembling a diverse batch. Pulling
// from several distinct, verified taxonomic groups instead gives real
// breadth. Small groups exhaust for real (e.g. ~238 crocodilian species
// total); once a group is exhausted this skips it and gives its unused share
// to whichever groups still have room, so a big target actually gets hit
// instead of falling short because a few small groups ran dry.
const GBIF_GROUPS = [
  { name: 'Mammalia', key: 359 },
  { name: 'Aves', key: 212 },
  { name: 'Squamata', key: 11592253 }, // lizards & snakes
  { name: 'Testudines', key: 11418114 }, // turtles
  { name: 'Crocodylia', key: 11493978 },
  { name: 'Amphibia', key: 131 },
  { name: 'Insecta', key: 216 },
  { name: 'Arachnida', key: 367 },
  { name: 'Mollusca', key: 52 }, // phylum: snails, bivalves, cephalopods (mixed land/water)
  { name: 'Malacostraca', key: 229 }, // crabs, shrimp, lobsters (mostly water)
];

function guessHabitat(rec, groupName) {
  const cls = (rec.class || '').toLowerCase();
  if (cls === 'aves') return 'air';
  if (['actinopterygii', 'chondrichthyes', 'elasmobranchii', 'sarcopterygii', 'myxini'].includes(cls)) return 'water';
  if (cls === 'amphibia') return 'multiple';
  if (groupName === 'Malacostraca') return 'water';
  if (groupName === 'Mollusca' && ['bivalvia', 'cephalopoda', 'polyplacophora', 'scaphopoda'].includes(cls)) {
    return 'water';
  }
  return 'land';
}

// Pulls up to `want` records from one group, paginating. Returns fewer than
// `want` (and marks the group exhausted) if the group runs out first.
async function fetchGbifGroupChunk(conn, group, want) {
  const cursorKey = `gbif_offset_${group.key}`;
  let offset = await getCursor(conn, cursorKey);
  const records = [];
  const pageSize = 300;
  let exhausted = false;
  while (records.length < want) {
    const limit = Math.min(pageSize, want - records.length);
    const url = `https://api.gbif.org/v1/species/search?rank=SPECIES&highertaxon_key=${group.key}&status=ACCEPTED&limit=${limit}&offset=${offset}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      console.error(`GBIF ${group.name} page at offset ${offset} failed after retries: ${err.message}`);
      break;
    }
    const page = data.results || [];
    for (const rec of page) {
      if (!rec.canonicalName) continue;
      records.push({
        common_name: rec.vernacularName || rec.canonicalName,
        scientific_name: rec.canonicalName,
        status: 'extant',
        habitat: guessHabitat(rec, group.name),
        clade: rec.class || rec.phylum || group.name,
        period: null,
        source: 'gbif',
        source_id: String(rec.key),
      });
    }
    offset += page.length;
    if (page.length < limit) {
      exhausted = true;
      break;
    }
    // Bumped from 400ms after GBIF started timing out every request in a
    // row under sustained load — this is now a genuinely long run (~1.4M
    // remaining records to fully exhaust every group), so pacing gently
    // enough to avoid triggering rate limiting matters more than raw speed.
    await sleep(1200);
  }
  await setCursor(conn, cursorKey, offset);
  if (exhausted) await setExhausted(conn, cursorKey, true);
  return { records, exhausted };
}

// Round-robins across all non-exhausted groups, requesting a chunk from each
// pass, until the overall GBIF target is met or every group is exhausted.
async function fetchGbifDiverse(conn, target) {
  const allGroupsExhausted = await Promise.all(GBIF_GROUPS.map((g) => isExhausted(conn, `gbif_offset_${g.key}`)));
  const active = new Set(GBIF_GROUPS.filter((_, i) => !allGroupsExhausted[i]));
  const perGroupSummary = new Map();
  let total = 0;
  const allRecords = [];

  while (total < target && active.size > 0) {
    const remaining = target - total;
    const chunkPerGroup = Math.max(300, Math.ceil(remaining / active.size));

    for (const group of [...active]) {
      if (total >= target) break;
      const { records, exhausted } = await fetchGbifGroupChunk(conn, group, Math.min(chunkPerGroup, target - total));
      allRecords.push(...records);
      total += records.length;
      perGroupSummary.set(group.name, (perGroupSummary.get(group.name) || 0) + records.length);
      if (exhausted) {
        active.delete(group);
        console.log(`  GBIF ${group.name}: fully caught up, no more species to add from this group.`);
      }
    }
  }

  for (const [name, count] of perGroupSummary) {
    console.log(`  GBIF ${name}: +${count}`);
  }
  return allRecords;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database found at ${DB_PATH}. Run the app at least once first.`);
    process.exit(1);
  }

  console.log(`Target: ${TARGET_COUNT} new animals (~${PBDB_SHARE} extinct via PBDB, ~${GBIF_SHARE} extant via GBIF)...`);

  const db = new duckdb.Database(DB_PATH);
  const conn = db.connect();

  console.log('Fetching PBDB...');
  const pbdb = await fetchAllPbdb(conn, PBDB_SHARE);
  console.log(`  got ${pbdb.records.length} extinct records`);

  // Whatever PBDB couldn't supply (already exhausted, or ran out mid-way)
  // gets handed to GBIF so the overall count still aims for the full target.
  const gbifTarget = GBIF_SHARE + (PBDB_SHARE - pbdb.records.length);
  console.log(`Fetching GBIF (target ${gbifTarget})...`);
  const gbifRecords = await fetchGbifDiverse(conn, gbifTarget);

  const now = new Date().toISOString();
  const allRecords = [...pbdb.records, ...gbifRecords];

  let inserted = 0;
  for (const item of allRecords) {
    const before = await dbGet(conn, 'SELECT id FROM animals WHERE source = ? AND source_id = ?', [item.source, item.source_id]);
    if (before) continue;
    await dbRun(
      conn,
      `INSERT OR IGNORE INTO animals
         (common_name, scientific_name, status, habitat, clade, period, conservation_status,
          description, image_url, local_image_path, image_attribution, source, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      [item.common_name, item.scientific_name, item.status, item.habitat, item.clade, item.period, item.source, item.source_id, now, now]
    );
    inserted += 1;
  }

  console.log(`Inserted ${inserted} new animals (skipped ${allRecords.length - inserted} already-present duplicates).`);

  await dbExec(conn, 'CHECKPOINT').catch(() => {});
  db.close(() => process.exit(0));
}

main().catch((err) => {
  console.error('Bulk import failed:', err);
  process.exit(1);
});
