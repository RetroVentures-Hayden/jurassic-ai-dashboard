// Core of the animal-encyclopedia sync: fetch new taxa from PBDB (extinct) and
// GBIF (extant), upsert them, and advance each source's pagination cursor.
//
// Deliberately DB-agnostic: it takes a `db` with async `all(sql, params)` /
// `get(sql, params)` / `run(sql, params)` methods. That lets it run two ways
// against the same code:
//   - in the Electron main process, using the app's own open connection
//     (src/main/db/duckdbClient.js) — this is what the "Sync Now" button uses,
//     so it no longer needs a second process fighting DuckDB's single-writer
//     lock; and
//   - from scripts/sync-animal-db.mjs, wrapped around a standalone connection,
//     for the nightly systemd timer that runs while the app is closed.
//
// No `require('duckdb')` here on purpose — only SQL through the injected `db`.

const USER_AGENT = 'JurassicAiDashboard/1.0 (https://github.com/RetroVentures-Hayden/jurassic-ai-dashboard)';
const TARGET_PER_SOURCE_PER_NIGHT = 2000;
const EXHAUSTED_CHECK_SIZE = 50; // once exhausted, how much to poll for newly-appeared records

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function getCursor(db, key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? parseInt(row.value, 10) : 0;
}

async function setCursor(db, key, value) {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}

async function isExhausted(db, key) {
  return (await getCursor(db, `${key}__exhausted`)) === 1;
}

async function setExhausted(db, key, value) {
  await setCursor(db, `${key}__exhausted`, value ? 1 : 0);
}

// --- Paleobiology Database (extinct taxa) ---
async function fetchPbdb(db, log) {
  const cursorKey = 'pbdb_offset';
  let offset = await getCursor(db, cursorKey);
  const wasExhausted = await isExhausted(db, cursorKey);
  const target = wasExhausted ? EXHAUSTED_CHECK_SIZE : TARGET_PER_SOURCE_PER_NIGHT;
  const pageSize = 500;

  const records = [];
  let exhausted = false;
  while (records.length < target) {
    const remaining = target - records.length;
    const limit = Math.min(pageSize, remaining);
    const url =
      `https://paleobiodb.org/data1.2/taxa/list.json?base_name=Dinosauria&rank=genus` +
      `&status=valid&limit=${limit}&offset=${offset}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      log(`PBDB page at offset ${offset} failed: ${err.message}`);
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
    if (page.length < limit) {
      exhausted = true; // fewer than asked for -> ran out
      break;
    }
    await sleep(300);
  }

  return { records, cursorKey, offset, exhausted, wasExhausted };
}

// --- GBIF (extant taxa) ---
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

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

function guessHabitat(gbifRecord, groupName) {
  const cls = (gbifRecord.class || '').toLowerCase();
  if (cls === 'aves') return 'air';
  if (['actinopterygii', 'chondrichthyes', 'elasmobranchii', 'sarcopterygii', 'myxini'].includes(cls)) return 'water';
  if (cls === 'amphibia') return 'multiple';
  if (groupName === 'Malacostraca') return 'water';
  if (groupName === 'Mollusca' && ['bivalvia', 'cephalopoda', 'polyplacophora', 'scaphopoda'].includes(cls)) {
    return 'water';
  }
  return 'land';
}

async function fetchGbif(db, now, log) {
  const group = GBIF_GROUPS[dayOfYear(now) % GBIF_GROUPS.length];
  const cursorKey = `gbif_offset_${group.key}`;
  let offset = await getCursor(db, cursorKey);
  const wasExhausted = await isExhausted(db, cursorKey);
  const target = wasExhausted ? EXHAUSTED_CHECK_SIZE : TARGET_PER_SOURCE_PER_NIGHT;
  const pageSize = 300;

  const records = [];
  let exhausted = false;
  while (records.length < target) {
    const remaining = target - records.length;
    const limit = Math.min(pageSize, remaining);
    const url =
      `https://api.gbif.org/v1/species/search?rank=SPECIES&highertaxon_key=${group.key}` +
      `&status=ACCEPTED&limit=${limit}&offset=${offset}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      log(`GBIF ${group.name} page at offset ${offset} failed: ${err.message}`);
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
    await sleep(300);
  }

  return { records, cursorKey, offset, exhausted, wasExhausted, groupName: group.name };
}

async function upsertAnimal(db, animal) {
  const now = new Date().toISOString();
  const existing = await db.get('SELECT id FROM animals WHERE source = ? AND source_id = ?', [
    animal.source,
    animal.source_id,
  ]);

  if (existing) {
    await db.run(
      `UPDATE animals SET
         common_name = ?, scientific_name = ?, status = ?,
         habitat = ?, clade = ?, period = ?, updated_at = ?
       WHERE source = ? AND source_id = ?`,
      [animal.common_name, animal.scientific_name, animal.status, animal.habitat, animal.clade, animal.period, now, animal.source, animal.source_id]
    );
    return 'updated';
  }

  await db.run(
    `INSERT INTO animals
       (common_name, scientific_name, status, habitat, clade, period, conservation_status,
        description, image_url, local_image_path, image_attribution, source, source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
    [animal.common_name, animal.scientific_name, animal.status, animal.habitat, animal.clade, animal.period, animal.source, animal.source_id, now, now]
  );
  return 'inserted';
}

/**
 * Run one sync pass. Returns { inserted, updated, summaryLines }.
 *
 * opts:
 *   db      - required; async all(sql,params) / get(sql,params) / run(sql,params)
 *   now     - Date to base the GBIF group rotation on (default: new Date())
 *   dryRun  - if true, fetch and report but write nothing (no upserts, no cursor moves)
 *   log     - message sink (default: console.log)
 */
async function runAnimalSync({ db, now = new Date(), dryRun = false, log = console.log } = {}) {
  if (!db) throw new Error('runAnimalSync requires a db');

  let inserted = 0;
  let updated = 0;
  const summaryLines = [];

  const pbdb = await fetchPbdb(db, log).catch((err) => {
    log(`PBDB fetch failed: ${err.message}`);
    return null;
  });
  const gbif = await fetchGbif(db, now, log).catch((err) => {
    log(`GBIF fetch failed: ${err.message}`);
    return null;
  });

  const allRecords = [...(pbdb?.records || []), ...(gbif?.records || [])];

  if (!dryRun) {
    for (const animal of allRecords) {
      const result = await upsertAnimal(db, animal);
      if (result === 'inserted') inserted += 1;
      else updated += 1;
    }
  } else {
    for (const animal of allRecords) {
      log(`[dry-run] would upsert ${animal.source}#${animal.source_id} (${animal.common_name})`);
    }
  }

  if (!dryRun && pbdb) {
    await setCursor(db, pbdb.cursorKey, pbdb.offset);
    await setExhausted(db, pbdb.cursorKey, pbdb.exhausted);
  }
  if (pbdb) {
    if (pbdb.exhausted && !pbdb.wasExhausted) {
      summaryLines.push(`PBDB dinosaur genera fully caught up (${pbdb.records.length} added this run) — will now just watch for newly described genera.`);
    } else if (pbdb.wasExhausted && pbdb.records.length > 0) {
      summaryLines.push(`PBDB had ${pbdb.records.length} newly announced genera since last check.`);
    } else if (pbdb.wasExhausted) {
      summaryLines.push(`PBDB: no newly announced genera yet.`);
    } else {
      summaryLines.push(`PBDB: +${pbdb.records.length} (offset now ${pbdb.offset}${pbdb.exhausted ? ', now caught up' : ''}).`);
    }
  }

  if (!dryRun && gbif) {
    await setCursor(db, gbif.cursorKey, gbif.offset);
    await setExhausted(db, gbif.cursorKey, gbif.exhausted);
  }
  if (gbif) {
    if (gbif.exhausted && !gbif.wasExhausted) {
      summaryLines.push(`GBIF ${gbif.groupName} fully caught up (${gbif.records.length} added this run) — will now just watch for newly added species.`);
    } else if (gbif.wasExhausted && gbif.records.length > 0) {
      summaryLines.push(`GBIF ${gbif.groupName} had ${gbif.records.length} newly added species since last check.`);
    } else if (gbif.wasExhausted) {
      summaryLines.push(`GBIF ${gbif.groupName}: no newly added species yet.`);
    } else {
      summaryLines.push(`GBIF ${gbif.groupName}: +${gbif.records.length} (offset now ${gbif.offset}${gbif.exhausted ? ', now caught up' : ''}).`);
    }
  }

  for (const line of summaryLines) log(line);

  return { inserted, updated, summaryLines };
}

module.exports = {
  runAnimalSync,
  // exported for the standalone script / tests
  GBIF_GROUPS,
  TARGET_PER_SOURCE_PER_NIGHT,
};
