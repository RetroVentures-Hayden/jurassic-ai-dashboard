// Thin promise-based wrapper around the duckdb Node bindings, which are
// callback-only. Everything in this app's DB layer is async now (unlike the
// old better-sqlite3 layer, which was synchronous) — Electron's
// ipcMain.handle already supports async handlers, so this doesn't change
// anything on the renderer side, which always awaited window.api.* calls
// via ipcRenderer.invoke regardless.
const duckdb = require('duckdb');

// DuckDB returns BIGINT-typed columns (e.g. media_items.size_bytes) and
// COUNT(*)/aggregate results as native JS BigInt, not Number. BigInt can't
// be mixed with Number in arithmetic (throws "Cannot mix BigInt and other
// types"), which the renderer does freely (e.g. `bytes / 1024 ** 3`) and
// IPC/JSON serialization doesn't handle either. Every value this app deals
// with (file sizes, row counts, ids) is comfortably within
// Number.MAX_SAFE_INTEGER, so converting at the source here — once, for
// every query result — is safe and avoids this surfacing repeatedly all
// over the ipc layer.
function sanitizeRow(row) {
  for (const key of Object.keys(row)) {
    if (typeof row[key] === 'bigint') row[key] = Number(row[key]);
  }
  return row;
}

class DuckDBClient {
  constructor(dbPath) {
    this.db = new duckdb.Database(dbPath);
    this.conn = this.db.connect();
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.conn.all(sql, ...params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(sanitizeRow));
      });
    });
  }

  async get(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] ?? null;
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.conn.run(sql, ...params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.conn.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async transaction(fn) {
    await this.exec('BEGIN TRANSACTION');
    try {
      const result = await fn();
      await this.exec('COMMIT');
      return result;
    } catch (err) {
      await this.exec('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = { DuckDBClient };
