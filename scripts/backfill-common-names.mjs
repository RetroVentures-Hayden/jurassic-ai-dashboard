#!/usr/bin/env node
// Replaces placeholder common names with real English vernacular names.
//
// Why this exists: the backbone import wrote `common_name = scientific_name`
// for all ~1.8M species, because the compact simple.txt.gz dump carries no
// vernacular names. That made cards read "Rana temporaria" instead of
// "Common Frog". The full backbone archive DOES ship a VernacularName.tsv,
// so this pulls real English names from it.
//
// Only rows whose common_name is still identical to their scientific_name
// are touched, so hand-curated names (e.g. "Woolly Mammoth") are never
// overwritten.
//
// Getting the source file (only ~14.5MB — fetched as a byte range out of the
// 971MB archive rather than downloading the whole thing) is documented in
// docs/RESEARCH_NOTES.md; pass --file= if it lives elsewhere.
//
// Usage: node scripts/backfill-common-names.mjs [--file=/tmp/gbif_bulk/VernacularName.tsv]
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import duckdb from 'duckdb';

const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const VERN_PATH = fileArg ? fileArg.split('=')[1] : '/tmp/gbif_bulk/VernacularName.tsv';

const q = (conn, sql) => new Promise((r, j) => conn.all(sql, (e, x) => (e ? j(e) : r(x))));
const exec = (conn, sql) => new Promise((r, j) => conn.exec(sql, (e) => (e ? j(e) : r())));

async function main() {
  if (!fs.existsSync(VERN_PATH)) {
    console.error(`VernacularName.tsv not found at ${VERN_PATH}. See docs/RESEARCH_NOTES.md for how to fetch it.`);
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

  const V = `read_csv('${VERN_PATH}', delim='\t', header=true, quote='', escape='',
    nullstr='', all_varchar=true, ignore_errors=true)`;

  const before = Number(
    (await q(conn, "SELECT count(*) n FROM animals WHERE source='gbif' AND common_name = scientific_name"))[0].n
  );
  console.log(`${before.toLocaleString()} gbif animals still show their scientific name as the common name.`);

  // One English name per taxon. Where a taxon has several, prefer the one
  // used by the most sources (a good proxy for the name people actually
  // use), then shortest, then alphabetical — so the result is deterministic
  // rather than whichever row happened to come first.
  console.log('Selecting the best English name per taxon...');
  await exec(
    conn,
    `CREATE OR REPLACE TEMP TABLE best_name AS
     WITH ranked AS (
       SELECT taxonID, vernacularName, count(*) AS uses,
              row_number() OVER (
                PARTITION BY taxonID
                ORDER BY count(*) DESC, length(vernacularName) ASC, vernacularName ASC
              ) AS rn
       FROM ${V}
       WHERE lower(language) = 'en'
         AND vernacularName IS NOT NULL
         AND trim(vernacularName) <> ''
       GROUP BY taxonID, vernacularName
     )
     SELECT taxonID, vernacularName FROM ranked WHERE rn = 1`
  );
  const mapped = Number((await q(conn, 'SELECT count(*) n FROM best_name'))[0].n);
  console.log(`  ${mapped.toLocaleString()} taxa have an English common name`);

  console.log('Updating animals...');
  const t0 = Date.now();
  // Title-cases the name for display consistency: the source mixes
  // "Common Frog" and "common frog" styles.
  await exec(
    conn,
    `UPDATE animals SET common_name = (
        SELECT string_agg(upper(substr(w,1,1)) || lower(substr(w,2)), ' ')
        FROM unnest(string_split(b.vernacularName, ' ')) AS t(w)
     )
     FROM best_name b
     WHERE animals.source='gbif'
       AND animals.common_name = animals.scientific_name
       AND animals.source_id = b.taxonID`
  );

  const after = Number(
    (await q(conn, "SELECT count(*) n FROM animals WHERE source='gbif' AND common_name = scientific_name"))[0].n
  );
  console.log(`  renamed ${(before - after).toLocaleString()} animals in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${after.toLocaleString()} still show a scientific name (GBIF has no English vernacular name for them —`);
  console.log('   true for most obscure insects/mites, which simply have no common name in any language)');

  console.log('\nSamples:');
  for (const r of await q(
    conn,
    `SELECT common_name, scientific_name, clade FROM animals
     WHERE source='gbif' AND common_name <> scientific_name
       AND clade IN ('Mammalia','Aves','Squamata','Amphibia') LIMIT 10`
  )) {
    console.log(`  ${String(r.common_name).padEnd(28)} (${r.scientific_name}) [${r.clade}]`);
  }

  await exec(conn, 'CHECKPOINT');
  db.close(() => process.exit(0));
}

main().catch((err) => {
  console.error('Common-name backfill failed:', err);
  process.exit(1);
});
