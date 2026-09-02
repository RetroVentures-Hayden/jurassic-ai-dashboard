#!/usr/bin/env node
// Backfills animal descriptions from Wikipedia's REST summary API.
//
// Scope, stated honestly: the animals table holds ~1.8M species after the
// GBIF backbone import, and the overwhelming majority are obscure insects,
// mites and molluscs that have NO English Wikipedia article at all. Trying
// to enrich all of them would mean ~1.8M requests (tens of hours) with most
// returning 404. So this targets the animals a person actually looks up —
// by default the vertebrate classes plus anything already hand-curated —
// and records misses so they aren't retried forever.
//
// Usage:
//   node scripts/enrich-descriptions.mjs                # vertebrates (default)
//   node scripts/enrich-descriptions.mjs --limit=5000   # cap this run
//   node scripts/enrich-descriptions.mjs --all          # every animal (very long)
//   node scripts/enrich-descriptions.mjs --concurrency=8
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import duckdb from 'duckdb';

const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');
const USER_AGENT = 'JurassicAiDashboard/1.0 (https://github.com/RetroVentures-Hayden/jurassic-ai-dashboard)';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const limitArg = args.find((a) => a.startsWith('--limit='));
const concArg = args.find((a) => a.startsWith('--concurrency='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20000;
// Measured the hard way: at concurrency 8 with no pacing, Wikipedia served
// ~130 requests and then refused everything with connection-level "fetch
// failed" errors — a burst rate-limit, not an HTTP status we could read.
// Modest concurrency plus a per-request delay keeps a long run stable.
const CONCURRENCY = concArg ? parseInt(concArg.split('=')[1], 10) : 4;
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const REQUEST_DELAY_MS = delayArg ? parseInt(delayArg.split('=')[1], 10) : 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vertebrate + notable classes, by the GBIF class names stored in `clade`.
const NOTABLE_CLADES = [
  'Mammalia', 'Aves', 'Squamata', 'Testudines', 'Crocodylia', 'Amphibia',
  'Elasmobranchii', 'Holocephali', 'Dipneusti', 'Coelacanthi', 'Myxini',
  'Petromyzonti', 'Cephalopoda', 'Sphenodontia',
];

function dbAll(conn, sql, params = []) {
  return new Promise((res, rej) => conn.all(sql, ...params, (e, r) => (e ? rej(e) : res(r))));
}
function dbRun(conn, sql, params = []) {
  return new Promise((res, rej) => conn.run(sql, ...params, (e) => (e ? rej(e) : res())));
}
function dbExec(conn, sql) {
  return new Promise((res, rej) => conn.exec(sql, (e) => (e ? rej(e) : res())));
}

// Retries connection-level failures with exponential backoff, so a brief
// throttle from Wikipedia doesn't permanently skip an animal.
async function fetchSummary(title, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return null; // genuinely no article — not an error
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.type === 'disambiguation') return null;
    if (!data.extract) return null;
    return {
      description: data.extract,
      imageUrl: data.thumbnail?.source || null,
      wikiUrl: data.content_urls?.desktop?.page || null,
    };
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s
    return fetchSummary(title, attempt + 1);
  }
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}. Run the app at least once first.`);
    process.exit(1);
  }

  const db = await new Promise((res, rej) => {
    const d = new duckdb.Database(DB_PATH, (e) => (e ? rej(e) : res(d)));
  }).catch((e) => {
    console.error(`Could not open the database: ${e.message}`);
    console.error('If the app is open, close it first — DuckDB allows a single writer.');
    process.exit(1);
  });
  const conn = db.connect();

  // `period` is unused for extant GBIF rows, so it doubles as a "we looked
  // and Wikipedia has nothing" marker to stop re-querying known misses.
  const scope = ALL ? '' : `AND clade IN (${NOTABLE_CLADES.map((c) => `'${c}'`).join(',')})`;
  const rows = await dbAll(
    conn,
    `SELECT id, common_name, scientific_name FROM animals
     WHERE description IS NULL
       AND (period IS NULL OR period <> 'NO_WIKI')
       ${scope}
     ORDER BY id
     LIMIT ${LIMIT}`
  );

  console.log(`${rows.length.toLocaleString()} animals queued for enrichment (${ALL ? 'ALL animals' : 'notable/vertebrate clades'}), concurrency ${CONCURRENCY}.`);
  if (!rows.length) {
    console.log('Nothing to do.');
    db.close(() => process.exit(0));
    return;
  }

  let done = 0, filled = 0, missing = 0, failed = 0;
  const started = Date.now();
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const titles = [...new Set([row.scientific_name, row.common_name].filter(Boolean))];
      let hit = null;
      try {
        for (const t of titles) {
          hit = await fetchSummary(t);
          if (hit) break;
        }
        if (hit) {
          await dbRun(
            conn,
            `UPDATE animals SET description = ?, image_url = COALESCE(image_url, ?),
               image_attribution = COALESCE(image_attribution, ?), updated_at = ? WHERE id = ?`,
            [hit.description, hit.imageUrl, hit.wikiUrl, new Date().toISOString(), row.id]
          );
          filled += 1;
        } else {
          await dbRun(conn, `UPDATE animals SET period = 'NO_WIKI' WHERE id = ? AND period IS NULL`, [row.id]);
          missing += 1;
        }
      } catch (err) {
        failed += 1; // transient (network/5xx) — left unmarked so a later run retries
        // Surface the first few real reasons instead of swallowing them; a
        // silent catch here once hid the fact that every single write was
        // failing, which looked like "Wikipedia rate-limited us" when it
        // wasn't.
        if (failed <= 5) console.error(`  [error] ${row.scientific_name}: ${err.message}`);
      }
      done += 1;
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS); // pace to stay under the burst limit
      if (done % 250 === 0 || done === rows.length) {
        const rate = done / ((Date.now() - started) / 1000);
        const left = Math.round((rows.length - done) / Math.max(rate, 0.01));
        console.log(`  ${done.toLocaleString()}/${rows.length.toLocaleString()} — ${filled.toLocaleString()} filled, ${missing.toLocaleString()} no-article, ${failed} transient — ${rate.toFixed(1)}/s, ~${Math.floor(left / 60)}m left`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nDone in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min.`);
  console.log(`  descriptions added : ${filled.toLocaleString()}`);
  console.log(`  no Wikipedia article: ${missing.toLocaleString()} (marked so they aren't retried)`);
  console.log(`  transient failures  : ${failed.toLocaleString()} (will retry on a future run)`);

  await dbExec(conn, 'CHECKPOINT').catch(() => {});
  db.close(() => process.exit(0));
}

main().catch((err) => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
