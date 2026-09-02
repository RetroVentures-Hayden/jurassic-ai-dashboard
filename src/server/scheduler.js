// While the web host is running it holds DuckDB's single writer lock, so the
// standalone `scripts/sync-animal-db.mjs` (and its systemd timer) can't open
// the database. This takes over that job in-process: every 30 minutes it checks
// whether it's ~3 AM America/New_York and today's sync hasn't run yet, and if so
// runs the same shared sync core the "Sync Now" button uses.

const fs = require('node:fs');
const path = require('node:path');
const { LAST_SYNC_MARKER } = require('../main/constants');
const { runAnimalSync } = require('../main/services/animalSync');

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function newYorkParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: parseInt(get('hour'), 10) % 24 };
}

function alreadySyncedToday(nyDate) {
  try {
    return fs.readFileSync(LAST_SYNC_MARKER, 'utf8').trim() === nyDate;
  } catch {
    return false;
  }
}

function writeMarker(nyDate) {
  try {
    fs.mkdirSync(path.dirname(LAST_SYNC_MARKER), { recursive: true });
    fs.writeFileSync(LAST_SYNC_MARKER, nyDate);
  } catch (err) {
    console.error('[web:scheduler] could not write last-sync marker:', err.message);
  }
}

async function tick(db) {
  const { date, hour } = newYorkParts();
  if (hour < 3 || hour > 5) return; // 3 AM primary, small catch-up window
  if (alreadySyncedToday(date)) return;

  console.log(`[web:scheduler] running nightly animal sync (NY ${date} ${hour}:00)`);
  let status = 'ok';
  let errorMessage = null;
  let result = { inserted: 0, updated: 0 };
  try {
    result = await runAnimalSync({ db, now: new Date(), log: (m) => console.log(`[web:scheduler] ${m}`) });
  } catch (err) {
    status = 'error';
    errorMessage = err.message;
    console.error('[web:scheduler] sync failed:', err.message);
  }

  try {
    await db.run(
      `INSERT INTO sync_log (run_at, ny_date, trigger_type, inserted_count, updated_count, status, error_message)
       VALUES (?, ?, 'scheduled', ?, ?, ?, ?)`,
      [new Date().toISOString(), date, result.inserted, result.updated, status, errorMessage]
    );
  } catch (err) {
    console.error('[web:scheduler] could not write sync_log row:', err.message);
  }

  if (status === 'ok') writeMarker(date);
}

function startScheduler(db) {
  const run = () => tick(db).catch((err) => console.error('[web:scheduler] tick error:', err.message));
  run();
  const handle = setInterval(run, CHECK_INTERVAL_MS);
  handle.unref?.();
  return handle;
}

module.exports = { startScheduler };
