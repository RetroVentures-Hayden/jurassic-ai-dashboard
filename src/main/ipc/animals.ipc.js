const path = require('node:path');
const { execFile } = require('node:child_process');
const { LAST_SYNC_MARKER } = require('../constants');
const fs = require('node:fs');
const { resolveAnimalWiki } = require('../services/wikiResolver');

module.exports = function registerAnimalsIpc(ipcMain, db, { shell }) {
  // The animals table holds ~1.8M rows after the GBIF backbone import, so
  // these MUST stay paged — returning everything would ship millions of rows
  // over IPC and then build millions of DOM nodes, freezing the renderer.
  // Both handlers return {items, total} so the UI can honestly say how many
  // matches exist beyond the page it's showing.
  const PAGE_SIZE = 300;

  ipcMain.handle('animals:list', async (_event, filters = {}) => {
    const clauses = [];
    const params = [];
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters.habitat) {
      clauses.push('habitat = ?');
      params.push(filters.habitat);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = Number(filters.offset) || 0;

    const totalRow = await db.get(`SELECT count(*) AS n FROM animals ${where}`, params);
    const items = await db.all(
      `SELECT * FROM animals ${where} ORDER BY common_name ASC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params
    );
    return { items, total: Number(totalRow.n), offset, pageSize: PAGE_SIZE };
  });

  ipcMain.handle('animals:search', async (_event, query, offset = 0) => {
    const exact = query;
    const prefix = `${query}%`;
    const word = `% ${query}%`; // the term starting a later word, e.g. "White Shark"
    const like = `%${query}%`;
    const off = Number(offset) || 0;

    const where = `WHERE common_name ILIKE ? OR scientific_name ILIKE ? OR clade ILIKE ?`;
    const whereParams = [like, like, like];

    // Plain substring matching alone ranks badly on a 1.8M-row table:
    // searching "shark" otherwise surfaces wasps named after a scientist
    // called Sharkey ("Alabagrus karensharkeyae") ahead of actual sharks,
    // because results were ordered purely alphabetically. Rank exact
    // matches first, then names starting with the term, then names where
    // the term starts a later word, and only then bare substrings.
    const rank = `
      CASE
        WHEN common_name ILIKE ? OR scientific_name ILIKE ? THEN 0
        WHEN common_name ILIKE ? OR scientific_name ILIKE ? THEN 1
        WHEN common_name ILIKE ? OR scientific_name ILIKE ? THEN 2
        ELSE 3
      END`;
    const rankParams = [exact, exact, prefix, prefix, word, word];

    const totalRow = await db.get(`SELECT count(*) AS n FROM animals ${where}`, whereParams);
    const items = await db.all(
      `SELECT * FROM animals ${where}
       ORDER BY ${rank} ASC, common_name ASC
       LIMIT ${PAGE_SIZE} OFFSET ${off}`,
      [...whereParams, ...rankParams]
    );
    return { items, total: Number(totalRow.n), offset: off, pageSize: PAGE_SIZE };
  });

  ipcMain.handle('animals:lastSync', () => {
    if (!fs.existsSync(LAST_SYNC_MARKER)) return null;
    return fs.readFileSync(LAST_SYNC_MARKER, 'utf8').trim();
  });

  // Resolves an animal's Wikipedia page and caches BOTH the URL and the
  // article's lead paragraph. Shared by loadInfo and visitWiki so a lookup
  // done for either purpose fills in the description permanently.
  async function ensureWikiData(row) {
    // Nothing left to fetch.
    if (row.image_attribution && row.description) {
      return { wikiUrl: row.image_attribution, description: row.description };
    }

    let resolved = null;
    try {
      resolved = await resolveAnimalWiki({
        commonName: row.common_name,
        scientificName: row.scientific_name,
      });
    } catch (err) {
      console.error(`[animals] wiki lookup failed for ${row.common_name}:`, err.message);
    }

    if (resolved) {
      await db.run(
        `UPDATE animals SET
           image_attribution = COALESCE(image_attribution, ?),
           image_url         = COALESCE(image_url, ?),
           description       = COALESCE(description, ?),
           updated_at        = ?
         WHERE id = ?`,
        [resolved.wikiUrl, resolved.imageUrl, resolved.description, new Date().toISOString(), row.id]
      );
    }

    // Always fall back to whatever is already cached. A failed or empty
    // lookup must not discard a URL we already hold — otherwise an animal
    // with a known-good cached page would start reporting "no article found"
    // the moment the network hiccupped.
    const wikiUrl = row.image_attribution || resolved?.wikiUrl || null;
    const description = row.description || resolved?.description || null;
    if (!wikiUrl && !description) return null;
    return { wikiUrl, description };
  }

  // Fetches (and permanently caches) an animal's description without leaving
  // the app — most of the ~1.8M imported species arrive from GBIF with no
  // description at all, so this is how a card gets filled in on demand.
  ipcMain.handle('animals:loadInfo', async (_event, id) => {
    const row = await db.get('SELECT * FROM animals WHERE id = ?', [id]);
    if (!row) throw new Error('Animal not found');
    const data = await ensureWikiData(row);
    if (!data || !data.description) {
      return { description: null, wikiUrl: data?.wikiUrl || null };
    }
    return data;
  });

  ipcMain.handle('animals:visitWiki', async (_event, id) => {
    const row = await db.get('SELECT * FROM animals WHERE id = ?', [id]);
    if (!row) throw new Error('Animal not found');
    const data = await ensureWikiData(row);
    if (!data || !data.wikiUrl) throw new Error(`No Wikipedia article found for ${row.common_name}`);
    return shell.openExternal(data.wikiUrl);
  });

  ipcMain.handle('animals:syncNow', () => {
    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'sync-animal-db.mjs');
    return new Promise((resolve, reject) => {
      execFile(process.execPath, [scriptPath, '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  });
};
