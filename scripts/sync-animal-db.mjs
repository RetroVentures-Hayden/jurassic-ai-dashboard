#!/usr/bin/env node
// Standalone daily animal-encyclopedia sync. Deliberately NOT part of the
// Electron process tree: invoked by a systemd --user timer so it runs
// whether or not the app's window is open. See docs/RESEARCH_NOTES.md and
// the plan for why it self-gates on America/New_York time instead of
// trusting the timer/system clock's timezone.
//
// Each night this tries to add up to TARGET_PER_SOURCE_PER_NIGHT new animals
// from each of PBDB (extinct) and GBIF (extant), paging through real records
// until either that target is hit or the source runs out of new records to
// give ("exhausted"). PBDB's dinosaur genera are a small, mostly-fixed list
// and WILL exhaust for real within a run or two. GBIF's living-species
// catalog runs into the millions overall, but individual groups (e.g. the
// ~26 living crocodilian species) exhaust quickly too — once a source/group
// is exhausted, subsequent nights fall back to a small "is anything new
// here yet" check at the same cursor position instead of repeating a large
// request, which is how newly-described/announced species get picked up
// automatically once they appear in PBDB/GBIF without re-scanning everything.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import duckdb from 'duckdb';

const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const STATE_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), APP_SLUG);
const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');
const LAST_SYNC_MARKER = path.join(STATE_DIR, 'last-sync-date');
const SYNC_LOG_FILE = path.join(STATE_DIR, 'sync.log');

const USER_AGENT = 'JurassicAiDashboard/1.0 (https://github.com/hayhayman219-boop/jurassic-ai-dashboard)';
const TARGET_PER_SOURCE_PER_NIGHT = 2000;
const EXHAUSTED_CHECK_SIZE = 50; // once exhausted, how much to poll for newly-appeared records

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const simulateArg = args.find((a) => a.startsWith('--simulate-ny-time='));
const SIMULATED_NOW = simulateArg ? new Date(simulateArg.split('=')[1]) : null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(SYNC_LOG_FILE, line + '\n');
  } catch {
    // Logging failures shouldn't abort the sync itself.
  }
}

function nowInNewYork() {
  const now = SIMULATED_NOW || new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10) % 24,
  };
}

function alreadySyncedToday(nyDate) {
  if (!fs.existsSync(LAST_SYNC_MARKER)) return false;
  return fs.readFileSync(LAST_SYNC_MARKER, 'utf8').trim() === nyDate;
}

function writeMarkerAtomic(nyDate) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${LAST_SYNC_MARKER}.tmp`;
  fs.writeFileSync(tmp, nyDate);
  fs.renameSync(tmp, LAST_SYNC_MARKER);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

// --- Minimal promisified DuckDB helpers (standalone script, no dependency
// on src/main/db/duckdbClient.js's CJS module to keep this fully portable) ---
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
async function dbExec(conn, sql) {
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

// --- Paleobiology Database (extinct taxa) ---
// Pages through PBDB starting at the stored cursor until it hits
// TARGET_PER_SOURCE_PER_NIGHT new records or the API runs dry. If the
// source was already marked exhausted from a previous run, only polls a
// small page first — enough to notice if PBDB has newly added genera
// (new discoveries get formally described and entered over time) without
// re-requesting thousands of records every night for nothing.
async function fetchPbdb(conn) {
  const cursorKey = 'pbdb_offset';
  let offset = await getCursor(conn, cursorKey);
  const wasExhausted = await isExhausted(conn, cursorKey);
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
// A single broad Animalia query (highertaxon_key=44) turned out to return
// long monotonous runs of one class at a time — an early pull landed 1200+
// records in a row that were ALL sea squirts. Instead, each day's batch
// comes from one of several distinct, verified taxonomic groups (keys
// confirmed live against the GBIF API, not guessed), rotating by day of
// year so the database diversifies across mammals/birds/reptiles/amphibians/
// insects/arachnids/mollusks/crustaceans over time. Small groups (e.g. the
// ~26 living crocodilian species) will exhaust for real within a run or two;
// huge groups (insects, arachnids, mollusks) effectively won't for a very
// long time. Each group keeps its own pagination cursor + exhausted flag.
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

async function fetchGbif(conn, now) {
  const group = GBIF_GROUPS[dayOfYear(now) % GBIF_GROUPS.length];
  const cursorKey = `gbif_offset_${group.key}`;
  let offset = await getCursor(conn, cursorKey);
  const wasExhausted = await isExhausted(conn, cursorKey);
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

async function upsertAnimal(conn, animal) {
  const now = new Date().toISOString();
  const existing = await dbGet(conn, 'SELECT id FROM animals WHERE source = ? AND source_id = ?', [
    animal.source,
    animal.source_id,
  ]);

  if (existing) {
    await dbRun(
      conn,
      `UPDATE animals SET
         common_name = ?, scientific_name = ?, status = ?,
         habitat = ?, clade = ?, period = ?, updated_at = ?
       WHERE source = ? AND source_id = ?`,
      [animal.common_name, animal.scientific_name, animal.status, animal.habitat, animal.clade, animal.period, now, animal.source, animal.source_id]
    );
    return 'updated';
  }

  await dbRun(
    conn,
    `INSERT INTO animals
       (common_name, scientific_name, status, habitat, clade, period, conservation_status,
        description, image_url, local_image_path, image_attribution, source, source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
    [animal.common_name, animal.scientific_name, animal.status, animal.habitat, animal.clade, animal.period, animal.source, animal.source_id, now, now]
  );
  return 'inserted';
}

async function runSync(conn, now) {
  let inserted = 0;
  let updated = 0;
  const summaryLines = [];

  const pbdb = await fetchPbdb(conn).catch((err) => {
    log(`PBDB fetch failed: ${err.message}`);
    return null;
  });
  const gbif = await fetchGbif(conn, now).catch((err) => {
    log(`GBIF fetch failed: ${err.message}`);
    return null;
  });

  const allRecords = [...(pbdb?.records || []), ...(gbif?.records || [])];

  if (!DRY_RUN) {
    for (const animal of allRecords) {
      const result = await upsertAnimal(conn, animal);
      if (result === 'inserted') inserted += 1;
      else updated += 1;
    }
  } else {
    for (const animal of allRecords) {
      log(`[dry-run] would upsert ${animal.source}#${animal.source_id} (${animal.common_name})`);
    }
  }

  if (!DRY_RUN && pbdb) {
    await setCursor(conn, pbdb.cursorKey, pbdb.offset);
    await setExhausted(conn, pbdb.cursorKey, pbdb.exhausted);
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

  if (!DRY_RUN && gbif) {
    await setCursor(conn, gbif.cursorKey, gbif.offset);
    await setExhausted(conn, gbif.cursorKey, gbif.exhausted);
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

  return { inserted, updated };
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    log(`No database found at ${DB_PATH} yet (run the app at least once first). Exiting.`);
    process.exit(0);
  }

  const { date: nyDate, hour: nyHour } = nowInNewYork();

  if (!FORCE) {
    if (alreadySyncedToday(nyDate)) {
      log(`Already synced today (NY date ${nyDate}). No-op.`);
      process.exit(0);
    }
    const inPrimaryWindow = nyHour === 3;
    const inCatchupWindow = nyHour >= 4;
    if (!inPrimaryWindow && !inCatchupWindow) {
      log(`Outside sync window (NY hour ${nyHour}). No-op.`);
      process.exit(0);
    }
  }

  const triggerType = FORCE ? 'force' : nyHour === 3 ? 'scheduled' : 'catchup';
  const db = new duckdb.Database(DB_PATH);
  const conn = db.connect();

  let result = { inserted: 0, updated: 0 };
  let status = 'ok';
  let errorMessage = null;

  try {
    result = await runSync(conn, SIMULATED_NOW || new Date());
  } catch (err) {
    status = 'error';
    errorMessage = err.message;
    log(`Sync failed: ${err.message}`);
  }

  if (!DRY_RUN) {
    await dbRun(
      conn,
      `INSERT INTO sync_log (run_at, ny_date, trigger_type, inserted_count, updated_count, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [new Date().toISOString(), nyDate, triggerType, result.inserted, result.updated, status, errorMessage]
    );

    if (status === 'ok') writeMarkerAtomic(nyDate);
  }

  log(`Sync (${triggerType}) complete: +${result.inserted} inserted, ${result.updated} updated, status=${status}`);

  // Flush the WAL into the main file before exiting — an unflushed WAL can
  // trigger a real DuckDB internal error when the file is reopened later.
  await dbExec(conn, 'CHECKPOINT').catch(() => {});
  db.close(() => process.exit(status === 'ok' ? 0 : 1));
}

main().catch((err) => {
  log(`Fatal error: ${err.stack || err.message}`);
  process.exit(1);
});
