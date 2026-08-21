#!/usr/bin/env node
// One-time migration: copies all data from the old better-sqlite3 database
// into a fresh DuckDB database, using DuckDB's own sqlite scanner extension
// to read the old file directly (no better-sqlite3 dependency needed here).
// Safe to re-run: it wipes and recreates the DuckDB file each time so it
// always reflects a fresh copy of whatever's currently in the SQLite file.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import duckdb from 'duckdb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_SLUG = 'jurassic-ai-dashboard';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_SLUG);
const SQLITE_PATH = path.join(CONFIG_DIR, 'jurassic.sqlite3');
const DUCKDB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'main', 'db', 'duckdb_migrations');

function run(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.run(sql, ...params, (err) => (err ? reject(err) : resolve()));
  });
}
function all(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.all(sql, ...params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function exec(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

const TABLES_WITH_SEQUENCES = [
  { table: 'media_items', seq: 'seq_media_items' },
  { table: 'checklist_items', seq: 'seq_checklist_items' },
  { table: 'maps', seq: 'seq_maps' },
  { table: 'books', seq: 'seq_books' },
  { table: 'animals', seq: 'seq_animals' },
  { table: 'news_items', seq: 'seq_news_items' },
  { table: 'sync_log', seq: 'seq_sync_log' },
];

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`No SQLite database found at ${SQLITE_PATH} — nothing to migrate.`);
    process.exit(1);
  }

  if (fs.existsSync(DUCKDB_PATH)) {
    fs.rmSync(DUCKDB_PATH);
    for (const ext of ['.wal']) {
      if (fs.existsSync(DUCKDB_PATH + ext)) fs.rmSync(DUCKDB_PATH + ext);
    }
  }

  const db = new duckdb.Database(DUCKDB_PATH);
  const conn = db.connect();

  console.log('Applying DuckDB schema...');
  await exec(conn, 'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)');
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await exec(conn, sql);
    // Record each migration as applied so the app's own migration runner
    // (src/main/db/index.js) sees this schema as already up to date instead
    // of trying to re-run 001_init.sql against tables that already exist.
    const version = parseInt(file.split('_')[0], 10);
    await run(conn, 'INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    console.log(`  applied ${file}`);
  }

  console.log('Attaching old SQLite database via the sqlite extension...');
  await exec(conn, 'INSTALL sqlite; LOAD sqlite;');
  await run(conn, `ATTACH '${SQLITE_PATH.replace(/'/g, "''")}' AS src (TYPE sqlite);`);

  console.log('Copying settings...');
  await run(conn, 'INSERT INTO settings SELECT * FROM src.settings');

  for (const { table, seq } of TABLES_WITH_SEQUENCES) {
    const countRow = (await all(conn, `SELECT count(*) AS n FROM src.${table}`))[0];
    if (!countRow || countRow.n === 0n || countRow.n === 0) {
      console.log(`  ${table}: nothing to copy`);
      continue;
    }
    await run(conn, `INSERT INTO ${table} SELECT * FROM src.${table}`);
    const maxRow = (await all(conn, `SELECT max(id) AS m FROM ${table}`))[0];
    const maxId = Number(maxRow.m);
    // This DuckDB version supports neither ALTER SEQUENCE ... RESTART WITH
    // nor setval(); CREATE OR REPLACE SEQUENCE fails too, since the table's
    // id column DEFAULT depends on the sequence. Burning `maxId` values via
    // nextval() in one query is fast (~12000 values in under 10ms) and gets
    // future inserts past every id already copied in.
    await all(conn, `SELECT nextval('${seq}') FROM range(${maxId})`);
    console.log(`  ${table}: copied ${countRow.n} rows, sequence ${seq} advanced past id ${maxId}`);
  }

  await run(conn, 'DETACH src');

  // Force everything out of the WAL into the main file. Without this,
  // reopening the database later can hit a real DuckDB internal error
  // ("Failure while replaying WAL file ... GetDefaultDatabase with no
  // default database set") when replaying certain statements from an
  // unflushed WAL — checkpointing here avoids ever hitting that path.
  await exec(conn, 'CHECKPOINT');
  console.log('Migration complete.');
  console.log(`DuckDB database at: ${DUCKDB_PATH}`);

  db.close(() => process.exit(0));
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
