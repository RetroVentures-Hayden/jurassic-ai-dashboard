#!/usr/bin/env node
// Backfills the `clade` (taxonomic class) column for animals imported from
// the GBIF backbone dump.
//
// Why this exists: the initial backbone import wrote clade = NULL for all
// ~1.8M rows even though the dump carries a classKey for each species. That
// left clade populated only for the few thousand rows pulled earlier via the
// paginated API, which broke clade-based filtering/search and made the
// description-enrichment script (which targets vertebrate classes by name)
// see only a tiny slice of the data.
//
// The class NAME isn't stored inline on each row — the dump gives a classKey,
// and the name lives on the row whose taxonID equals that key — so this joins
// the dump to itself to resolve names, then updates by source_id.
//
// Usage: node scripts/backfill-clade.mjs [--file=/tmp/gbif_bulk/simple.txt.gz]
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import duckdb from 'duckdb';

const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const DUMP_PATH = fileArg ? fileArg.split('=')[1] : '/tmp/gbif_bulk/simple.txt.gz';

const COLUMNS = `{'taxonID':'VARCHAR','parentKey':'VARCHAR','acceptedKey':'VARCHAR','isSynonym':'VARCHAR',
  'status':'VARCHAR','rank':'VARCHAR','nomStatus':'VARCHAR','datasetKey':'VARCHAR','origin':'VARCHAR',
  'srcKey':'VARCHAR','kingdomKey':'VARCHAR','phylumKey':'VARCHAR','classKey':'VARCHAR','orderKey':'VARCHAR',
  'familyKey':'VARCHAR','genusKey':'VARCHAR','speciesKey':'VARCHAR','nameID':'VARCHAR','sciName':'VARCHAR',
  'canonical':'VARCHAR','genus':'VARCHAR','epithet':'VARCHAR','infraEpithet':'VARCHAR','c24':'VARCHAR',
  'c25':'VARCHAR','c26':'VARCHAR','author':'VARCHAR','year':'VARCHAR','citation':'VARCHAR','issues':'VARCHAR'}`;

const q = (conn, sql) => new Promise((r, j) => conn.all(sql, (e, x) => (e ? j(e) : r(x))));
const exec = (conn, sql) => new Promise((r, j) => conn.exec(sql, (e) => (e ? j(e) : r())));

async function main() {
  if (!fs.existsSync(DUMP_PATH)) {
    console.error(`Backbone dump not found at ${DUMP_PATH}.`);
    console.error('Re-download with:');
    console.error('  mkdir -p /tmp/gbif_bulk && curl -C - --http1.1 --retry 10 --retry-all-errors \\');
    console.error('    -o /tmp/gbif_bulk/simple.txt.gz https://hosted-datasets.gbif.org/datasets/backbone/current/simple.txt.gz');
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
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

  const SRC = `read_csv('${DUMP_PATH}', delim='\t', header=false, quote='', escape='',
    nullstr='\\N', all_varchar=true, ignore_errors=true, columns=${COLUMNS})`;

  const before = Number((await q(conn, "SELECT count(*) n FROM animals WHERE source='gbif' AND clade IS NULL"))[0].n);
  console.log(`${before.toLocaleString()} gbif animals currently have no clade.`);

  console.log('Building taxonID -> class-name map from the dump...');
  await exec(conn, `CREATE OR REPLACE TEMP TABLE class_of AS
    SELECT s.taxonID AS taxon_id, any_value(t.canonical) AS class_name
    FROM ${SRC} s
    JOIN ${SRC} t ON t.taxonID = s.classKey
    WHERE s.kingdomKey='1' AND s.rank='SPECIES' AND s.status='ACCEPTED' AND s.classKey IS NOT NULL
    GROUP BY s.taxonID`);
  const mapped = Number((await q(conn, 'SELECT count(*) n FROM class_of'))[0].n);
  console.log(`  resolved class names for ${mapped.toLocaleString()} species`);

  console.log('Updating animals...');
  const t0 = Date.now();
  await exec(conn, `UPDATE animals SET clade = c.class_name
    FROM class_of c
    WHERE animals.source='gbif' AND animals.clade IS NULL AND animals.source_id = c.taxon_id`);

  const after = Number((await q(conn, "SELECT count(*) n FROM animals WHERE source='gbif' AND clade IS NULL"))[0].n);
  console.log(`  filled ${(before - after).toLocaleString()} clades in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${after.toLocaleString()} still without a clade (the dump assigns no class to these — notably ray-finned fish)`);

  console.log('\nTop clades now:');
  for (const r of await q(conn, `SELECT clade, count(*) n FROM animals WHERE clade IS NOT NULL
      GROUP BY clade ORDER BY n DESC LIMIT 12`)) {
    console.log(`  ${String(r.clade).padEnd(16)} ${Number(r.n).toLocaleString()}`);
  }

  await exec(conn, 'CHECKPOINT');
  db.close(() => process.exit(0));
}

main().catch((err) => {
  console.error('Clade backfill failed:', err);
  process.exit(1);
});
