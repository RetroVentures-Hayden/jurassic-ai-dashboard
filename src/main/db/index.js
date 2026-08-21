const path = require('node:path');
const fs = require('node:fs');
const { DuckDBClient } = require('./duckdbClient');
const { DB_PATH } = require('../constants');

const MIGRATIONS_DIR = path.join(__dirname, 'duckdb_migrations');

async function runMigrations(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');

  const appliedRows = await db.all('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => Number(r.version)));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.transaction(async () => {
      await db.exec(sql);
      await db.run('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    });
    console.log(`[db] applied migration ${file}`);
  }
}

// Unlike the other seed tables, books.seed.json is expected to be updated
// over time (e.g. to match what's currently purchasable), so this runs on
// every startup: it adds any titles not already present, AND refreshes the
// non-user-editable fields (source_url, image_url, etc.) on already-present
// rows in case the seed data for them changed. owns_physical_copy is always
// left untouched either way. local_image_path is cleared on refresh so a
// changed image_url gets re-fetched instead of showing a stale cached cover.
async function syncBooksFromSeed(db) {
  const booksPath = path.join(__dirname, 'seed', 'books.seed.json');
  if (!fs.existsSync(booksPath)) return;

  const seedBooks = JSON.parse(fs.readFileSync(booksPath, 'utf8'));
  const existingTitles = new Set((await db.all('SELECT title FROM books')).map((r) => r.title));
  const maxSortOrderRow = await db.get('SELECT COALESCE(MAX(sort_order), -1) AS m FROM books');
  const maxSortOrder = Number(maxSortOrderRow.m);

  const toInsert = seedBooks.filter((item) => !existingTitles.has(item.title));
  const toUpdate = seedBooks.filter((item) => existingTitles.has(item.title));

  await db.transaction(async () => {
    let i = 0;
    for (const item of toInsert) {
      await db.run(
        `INSERT INTO books (title, author, category, source_url, image_url, local_image_path, description, owns_physical_copy, publish_year, sort_order)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)`,
        [item.title, item.author ?? null, item.category, item.source_url, item.image_url ?? null, item.description ?? null, item.publish_year ?? null, maxSortOrder + 1 + i]
      );
      i += 1;
    }
    for (const item of toUpdate) {
      await db.run(
        `UPDATE books SET author = ?, category = ?, source_url = ?,
           image_url = ?, local_image_path = NULL, description = ?, publish_year = ?
         WHERE title = ?`,
        [item.author ?? null, item.category, item.source_url, item.image_url ?? null, item.description ?? null, item.publish_year ?? null, item.title]
      );
    }
  });

  if (toInsert.length) console.log(`[db] synced ${toInsert.length} new book entries from seed`);
  if (toUpdate.length) console.log(`[db] refreshed ${toUpdate.length} existing book entries from seed`);
}

// Same rationale as syncBooksFromSeed: checklist.seed.js is expected to grow
// as the franchise adds new official releases, so this runs on every startup
// and only adds titles not already present, leaving existing rows (and their
// owns_physical_copy state) untouched.
async function replaceSupersededChecklistTitles(db, supersededTitles) {
  if (!supersededTitles) return new Map();

  const carriedOwnership = new Map(); // new title -> owns_physical_copy to apply on insert
  for (const [oldTitle, newTitles] of Object.entries(supersededTitles)) {
    const oldRow = await db.get('SELECT owns_physical_copy FROM checklist_items WHERE title = ?', [oldTitle]);
    if (!oldRow) continue;
    if (oldRow.owns_physical_copy) {
      for (const newTitle of newTitles) carriedOwnership.set(newTitle, 1);
    }
    await db.run('DELETE FROM checklist_items WHERE title = ?', [oldTitle]);
    console.log(`[db] replaced checklist entry "${oldTitle}" with per-season entries`);
  }
  return carriedOwnership;
}

async function syncChecklistFromSeed(db) {
  const seedChecklist = require('./seed/checklist.seed');
  const carriedOwnership = await replaceSupersededChecklistTitles(db, seedChecklist.supersededTitles);

  const existingTitles = new Set((await db.all('SELECT title FROM checklist_items')).map((r) => r.title));
  const toInsert = seedChecklist.filter((item) => !existingTitles.has(item.title));
  const toUpdate = seedChecklist.filter((item) => existingTitles.has(item.title));

  await db.transaction(async () => {
    for (const item of toInsert) {
      await db.run(
        `INSERT INTO checklist_items (type, title, media_item_id, owns_physical_copy, sort_order, source_url)
         VALUES (?, ?, NULL, ?, ?, ?)`,
        [item.type, item.title, carriedOwnership.get(item.title) ? 1 : 0, item.sort_order, item.source_url]
      );
    }
    // source_url is refreshed on every startup (like books/maps), same
    // rationale: the correct Amazon link for a title can change or get
    // corrected without the row itself needing to be re-created.
    for (const item of toUpdate) {
      await db.run('UPDATE checklist_items SET source_url = ? WHERE title = ?', [item.source_url, item.title]);
    }
    // Renumber every row to match the seed's intended order, so newly
    // inserted rows (e.g. per-season entries replacing an old umbrella
    // entry) land in the right position instead of just at the end.
    let i = 0;
    for (const item of seedChecklist) {
      await db.run('UPDATE checklist_items SET sort_order = ? WHERE title = ?', [i, item.title]);
      i += 1;
    }
  });

  if (toInsert.length) console.log(`[db] synced ${toInsert.length} new checklist entries from seed`);
  if (toUpdate.length) console.log(`[db] refreshed source_url for ${toUpdate.length} existing checklist entries`);
}

// Same rationale as syncBooksFromSeed/syncChecklistFromSeed: the curated
// animal set is expected to keep growing, so this adds any common_name not
// already present rather than only seeding once. Matches by common_name
// since curated entries don't have a source_id (unlike PBDB/GBIF-sourced
// rows, which are deduped by the animals.source+source_id UNIQUE index).
async function syncAnimalsFromSeed(db) {
  const animalsPath = path.join(__dirname, 'seed', 'animals.seed.json');
  if (!fs.existsSync(animalsPath)) return;

  const seedAnimals = JSON.parse(fs.readFileSync(animalsPath, 'utf8'));
  const existingNames = new Set(
    (await db.all("SELECT common_name FROM animals WHERE source = 'curated'")).map((r) => r.common_name)
  );
  const toInsert = seedAnimals.filter((item) => !existingNames.has(item.common_name));
  if (!toInsert.length) return;

  const now = new Date().toISOString();
  await db.transaction(async () => {
    for (const item of toInsert) {
      await db.run(
        `INSERT OR IGNORE INTO animals
           (common_name, scientific_name, status, habitat, clade, period, conservation_status,
            description, image_url, local_image_path, image_attribution, source, source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          item.common_name,
          item.scientific_name ?? null,
          item.status,
          item.habitat,
          item.clade ?? null,
          item.period ?? null,
          item.conservation_status ?? null,
          item.description ?? null,
          item.image_url ?? null,
          item.image_attribution ?? null,
          item.source,
          item.source_id ?? null,
          now,
          now,
        ]
      );
    }
  });
  console.log(`[db] synced ${toInsert.length} new animal entries from seed`);
}

async function seedIfEmpty(db) {
  await syncChecklistFromSeed(db);

  const mapsCountRow = await db.get('SELECT COUNT(*) AS n FROM maps');
  if (Number(mapsCountRow.n) === 0) {
    const mapsPath = path.join(__dirname, 'seed', 'maps.seed.json');
    if (fs.existsSync(mapsPath)) {
      const seedMaps = JSON.parse(fs.readFileSync(mapsPath, 'utf8'));
      await db.transaction(async () => {
        let i = 0;
        for (const item of seedMaps) {
          await db.run(
            `INSERT INTO maps (title, category, source_url, image_url, local_image_path, description, verified_at, sort_order)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
            [item.title, item.category, item.source_url, item.image_url ?? null, item.description ?? null, item.verified_at ?? null, i]
          );
          i += 1;
        }
      });
      console.log(`[db] seeded ${seedMaps.length} map entries`);
    }
  }

  await syncBooksFromSeed(db);
  await syncAnimalsFromSeed(db);
}

async function openDatabase() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DuckDBClient(DB_PATH);
  await runMigrations(db);
  await seedIfEmpty(db);
  return db;
}

module.exports = { openDatabase, DB_PATH };
