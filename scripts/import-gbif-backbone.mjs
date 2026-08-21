#!/usr/bin/env node
// Bulk-imports EVERY accepted animal species from GBIF's official backbone
// taxonomy dump (simple.txt.gz) into the animals table.
//
// Why a bulk dump instead of the paginated API the nightly sync uses:
// GBIF's /species/search endpoint is genuinely slow at depth — measured
// directly, limit=300 at offset=10200 took 49 SECONDS, and every page size
// yielded only ~6 records/sec. At that rate the ~1.8M animal species would
// take roughly 65 hours of continuous requests. The official bulk dump is
// ~488MB gzipped and loads in minutes, so it's the only practical route to
// "every animal". DuckDB reads the gzipped TSV directly and does the whole
// insert as one set-based query — no row-by-row JS loop.
//
// TRADEOFF (important, stated plainly): the bulk backbone is a periodic
// snapshot (the current published one is dated 2023-08-28), so it is not
// live. That's fine here because the nightly sync (scripts/sync-animal-db.mjs)
// keeps hitting the live API afterwards and will pick up anything newer —
// bulk gets the mass, nightly keeps it current.
//
// Usage:
//   node scripts/import-gbif-backbone.mjs [--file=/path/simple.txt.gz] [--dry-run]
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import duckdb from 'duckdb';

const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fileArg = args.find((a) => a.startsWith('--file='));
const DUMP_PATH = fileArg ? fileArg.split('=')[1] : '/tmp/gbif_bulk/simple.txt.gz';

// Column layout verified empirically against a known species (Panthera leo:
// kingdomKey=1 Animalia, classKey=359 Mammalia — the same class key the live
// GBIF API returns), not guessed from documentation.
const COLUMNS = `{'taxonID':'VARCHAR','parentKey':'VARCHAR','acceptedKey':'VARCHAR','isSynonym':'VARCHAR',
  'status':'VARCHAR','rank':'VARCHAR','nomStatus':'VARCHAR','datasetKey':'VARCHAR','origin':'VARCHAR',
  'srcKey':'VARCHAR','kingdomKey':'VARCHAR','phylumKey':'VARCHAR','classKey':'VARCHAR','orderKey':'VARCHAR',
  'familyKey':'VARCHAR','genusKey':'VARCHAR','speciesKey':'VARCHAR','nameID':'VARCHAR','sciName':'VARCHAR',
  'canonical':'VARCHAR','genus':'VARCHAR','epithet':'VARCHAR','infraEpithet':'VARCHAR','c24':'VARCHAR',
  'c25':'VARCHAR','c26':'VARCHAR','author':'VARCHAR','year':'VARCHAR','citation':'VARCHAR','issues':'VARCHAR'}`;

// --- Habitat mapping ---
// Built from the ACTUAL 104 animal classes present in the dump (resolved to
// real names by self-joining the file), not assumed. The habitat column has a
// CHECK constraint of land/water/air/multiple, so everything must land in one.
const WATER_CLASSES = [
  229, 137, 206, 136, 11545536, 256, 353, 226, 252, 199, 210, 9273948, 221, 205, 121, 356, 203,
  214, 350, 222, 215, 281, 146, 346, 354, 308, 276, 11146120, 10482560, 209, 9981053, 278, 352,
  120, 8365233, 11186032, 347, 11198974, 351, 365, 159, 8355438, 11500725, 11733052, 8066236,
  7920181, 5964034, 277, 11221465, 7194193, 139, 207, 355, 119, 158, 11881065, 309, 176, 11699831,
  7375758, 11210652, 236, 224, 235, 9312928, 213, 11117838, 307, 341, 254, 140, 253, 7188530,
  175, 10772917, 12217645, 12249321, 7496922,
];
const LAND_CLASSES = [216, 367, 359, 361, 11592253, 10713444, 360, 143, 11377931, 11374670, 7742773, 11569602, 134, 247];
const AIR_CLASSES = [212]; // Aves
const MULTIPLE_CLASSES = [225, 131, 255, 11133537, 345, 7774442, 144, 11418114, 11493978, 133];

// Phylum-level fallback for species whose class isn't mapped above.
const WATER_PHYLA = [105, 43, 50, 53, 110, 63, 75, 91, 22, 7190138, 64];
const MULTIPLE_PHYLA = [67, 108, 5967481, 42, 14, 52];
const LAND_PHYLA = [54]; // Arthropoda — overwhelmingly insects/arachnids

// Classes that are entirely extinct (no living members). GBIF's backbone has
// no general "is extinct" flag, so only groups that are unambiguously wholly
// extinct are marked here; see the caveat printed at the end of a run.
const EXTINCT_CLASSES = [9273948 /* Trilobita */, 11186032 /* Rostroconchia */, 11210652 /* Cricoconarida */];

const list = (arr) => arr.join(',');

// Chordata (phylum 44) with a NULL class is overwhelmingly ray-finned fish:
// this GBIF backbone assigns no class to them (verified — Salmo salar and
// Thunnus thynnus both come through with classKey NULL under phylum 44), so
// without this branch every bony fish would fall through to the default and
// be mislabelled.
const HABITAT_SQL = `
  CASE
    WHEN TRY_CAST(classKey AS BIGINT) IN (${list(WATER_CLASSES)}) THEN 'water'
    WHEN TRY_CAST(classKey AS BIGINT) IN (${list(LAND_CLASSES)}) THEN 'land'
    WHEN TRY_CAST(classKey AS BIGINT) IN (${list(AIR_CLASSES)}) THEN 'air'
    WHEN TRY_CAST(classKey AS BIGINT) IN (${list(MULTIPLE_CLASSES)}) THEN 'multiple'
    WHEN classKey IS NULL AND TRY_CAST(phylumKey AS BIGINT) = 44 THEN 'water'
    WHEN TRY_CAST(phylumKey AS BIGINT) IN (${list(WATER_PHYLA)}) THEN 'water'
    WHEN TRY_CAST(phylumKey AS BIGINT) IN (${list(MULTIPLE_PHYLA)}) THEN 'multiple'
    WHEN TRY_CAST(phylumKey AS BIGINT) IN (${list(LAND_PHYLA)}) THEN 'land'
    ELSE 'multiple'
  END`;

const STATUS_SQL = `CASE WHEN TRY_CAST(classKey AS BIGINT) IN (${list(EXTINCT_CLASSES)}) THEN 'extinct' ELSE 'extant' END`;

function q(conn, sql) {
  return new Promise((res, rej) => conn.all(sql, (e, r) => (e ? rej(e) : res(r))));
}
function exec(conn, sql) {
  return new Promise((res, rej) => conn.exec(sql, (e) => (e ? rej(e) : res())));
}

async function main() {
  if (!fs.existsSync(DUMP_PATH)) {
    console.error(`Backbone dump not found at ${DUMP_PATH}.`);
    console.error('Download it with:');
    console.error('  mkdir -p /tmp/gbif_bulk && curl -C - --http1.1 --retry 10 --retry-all-errors \\');
    console.error('    -o /tmp/gbif_bulk/simple.txt.gz https://hosted-datasets.gbif.org/datasets/backbone/current/simple.txt.gz');
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}. Run the app at least once first.`);
    process.exit(1);
  }

  const db = new duckdb.Database(DB_PATH);
  const conn = db.connect();

  const SRC = `read_csv('${DUMP_PATH}', delim='\t', header=false, quote='', escape='',
    nullstr='\\N', all_varchar=true, ignore_errors=true, columns=${COLUMNS})`;

  console.log('Reading backbone dump and staging accepted animal species...');
  await exec(
    conn,
    `CREATE OR REPLACE TEMP TABLE staged AS
     SELECT
       canonical                      AS common_name,
       canonical                      AS scientific_name,
       ${STATUS_SQL}                  AS status,
       ${HABITAT_SQL}                 AS habitat,
       taxonID                        AS source_id
     FROM ${SRC}
     WHERE kingdomKey = '1'
       AND rank = 'SPECIES'
       AND status = 'ACCEPTED'
       AND canonical IS NOT NULL
       AND taxonID IS NOT NULL`
  );

  const staged = Number((await q(conn, 'SELECT count(*) AS n FROM staged'))[0].n);
  console.log(`  staged ${staged.toLocaleString()} accepted animal species`);

  console.log('\nHabitat distribution of staged rows:');
  for (const r of await q(conn, 'SELECT habitat, count(*) AS n FROM staged GROUP BY habitat ORDER BY n DESC')) {
    console.log(`  ${r.habitat.padEnd(9)} ${Number(r.n).toLocaleString()}`);
  }
  console.log('Status distribution of staged rows:');
  for (const r of await q(conn, 'SELECT status, count(*) AS n FROM staged GROUP BY status ORDER BY n DESC')) {
    console.log(`  ${r.status.padEnd(9)} ${Number(r.n).toLocaleString()}`);
  }

  const before = Number((await q(conn, 'SELECT count(*) AS n FROM animals'))[0].n);
  const newRows = Number(
    (await q(conn, `SELECT count(*) AS n FROM staged s
       WHERE NOT EXISTS (SELECT 1 FROM animals a WHERE a.source='gbif' AND a.source_id = s.source_id)`))[0].n
  );
  console.log(`\nanimals table currently holds ${before.toLocaleString()} rows; ${newRows.toLocaleString()} staged rows are new.`);

  if (DRY_RUN) {
    console.log('\n--dry-run: no rows written.');
    await exec(conn, 'CHECKPOINT').catch(() => {});
    db.close(() => process.exit(0));
    return;
  }

  console.log('\nInserting (single set-based query)...');
  const t0 = Date.now();
  // Dedupes against rows already pulled by the paginated API sync, which
  // stored the same GBIF taxon key in source_id.
  await exec(
    conn,
    `INSERT INTO animals
       (common_name, scientific_name, status, habitat, clade, period, conservation_status,
        description, image_url, local_image_path, image_attribution, source, source_id, created_at, updated_at)
     SELECT s.common_name, s.scientific_name, s.status, s.habitat, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, 'gbif', s.source_id,
            now()::VARCHAR, now()::VARCHAR
     FROM staged s
     WHERE NOT EXISTS (SELECT 1 FROM animals a WHERE a.source='gbif' AND a.source_id = s.source_id)`
  );

  const after = Number((await q(conn, 'SELECT count(*) AS n FROM animals'))[0].n);
  console.log(`  inserted ${(after - before).toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  animals table now holds ${after.toLocaleString()} rows`);

  // Flush the WAL so reopening the DB later can't hit DuckDB's WAL-replay bug.
  console.log('\nCheckpointing...');
  await exec(conn, 'CHECKPOINT');

  console.log('\nCaveats worth knowing:');
  console.log('  - Source is the GBIF backbone snapshot (published 2023-08-28), not live data;');
  console.log('    the nightly sync keeps pulling the live API for anything newer.');
  console.log("  - GBIF's backbone carries no general extinct flag, so only wholly-extinct");
  console.log('    classes (e.g. Trilobita) are marked extinct; some fossil taxa in otherwise');
  console.log('    living groups will be labelled extant.');
  console.log('  - Habitat is inferred from taxonomic class/phylum, so it is accurate at the');
  console.log('    group level but not per-species (e.g. aquatic insects are grouped as land).');

  db.close(() => process.exit(0));
}

main().catch((err) => {
  console.error('Backbone import failed:', err);
  process.exit(1);
});
