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

// The PBDB/GBIF fetch + upsert + cursor logic lives in the main-process module
// so the in-app "Sync Now" button and this standalone timer script share one
// implementation. This script only adds the standalone-runner concerns:
// opening its own connection, NY-time gating, the sync_log row, the last-sync
// marker, and the final CHECKPOINT/close. (ESM default-imports the CJS module's
// module.exports object.)
import animalSyncCore from '../src/main/services/animalSync.js';

const { runAnimalSync } = animalSyncCore;

const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const STATE_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), APP_SLUG);
const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');
const LAST_SYNC_MARKER = path.join(STATE_DIR, 'last-sync-date');
const SYNC_LOG_FILE = path.join(STATE_DIR, 'sync.log');

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

// --- Minimal promisified DuckDB helpers (standalone script, no dependency
// on src/main/db/duckdbClient.js's CJS module to keep this fully portable).
// Wrapped into an { all, get, run } shim below and handed to the shared
// runAnimalSync core; also used directly here for the sync_log row + CHECKPOINT.
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

  // Adapt the raw callback connection to the { all, get, run } interface the
  // shared core expects (the same shape as src/main/db/duckdbClient.js).
  const dbShim = {
    all: (sql, params = []) => dbAll(conn, sql, params),
    get: (sql, params = []) => dbGet(conn, sql, params),
    run: (sql, params = []) => dbRun(conn, sql, params),
  };

  let result = { inserted: 0, updated: 0 };
  let status = 'ok';
  let errorMessage = null;

  try {
    result = await runAnimalSync({
      db: dbShim,
      now: SIMULATED_NOW || new Date(),
      dryRun: DRY_RUN,
      log,
    });
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
