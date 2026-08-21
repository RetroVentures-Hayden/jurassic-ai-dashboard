const path = require('node:path');
const { execFile } = require('node:child_process');

const { scanLibrary } = require('../services/libraryScanner');

async function getLibraryPath(db) {
  const { DEFAULT_LIBRARY_PATH } = require('../constants');
  const row = await db.get('SELECT value FROM settings WHERE key = ?', ['library_path']);
  return row?.value || DEFAULT_LIBRARY_PATH;
}

async function rescan(db) {
  const libraryPath = await getLibraryPath(db);
  const files = scanLibrary(libraryPath);

  await db.transaction(async () => {
    for (const item of files) {
      await db.run(
        `INSERT INTO media_items (file_path, file_name, title, year, kind, size_bytes, last_scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           file_name = excluded.file_name,
           title = excluded.title,
           year = excluded.year,
           size_bytes = excluded.size_bytes,
           last_scanned_at = excluded.last_scanned_at`,
        [item.file_path, item.file_name, item.title, item.year, item.kind, item.size_bytes, item.last_scanned_at]
      );
      if (item.checklistTitle) {
        const mediaRow = await db.get('SELECT id FROM media_items WHERE file_path = ?', [item.file_path]);
        if (mediaRow) {
          await db.run(
            'UPDATE checklist_items SET media_item_id = ? WHERE title = ? AND media_item_id IS NULL',
            [mediaRow.id, item.checklistTitle]
          );
        }
      }
    }
  });

  return files.length;
}

module.exports = function registerLibraryIpc(ipcMain, db) {
  ipcMain.handle('library:list', () => {
    return db.all('SELECT * FROM media_items ORDER BY year ASC, title ASC');
  });

  ipcMain.handle('library:rescan', () => {
    return rescan(db);
  });

  ipcMain.handle('library:play', async (_event, mediaItemId) => {
    const row = await db.get('SELECT file_path FROM media_items WHERE id = ?', [mediaItemId]);
    if (!row) throw new Error('Media item not found');

    const libraryPath = path.resolve(await getLibraryPath(db));
    const resolved = path.resolve(row.file_path);
    if (!resolved.startsWith(libraryPath + path.sep) && resolved !== libraryPath) {
      throw new Error('Refusing to open a path outside the configured library folder');
    }

    return new Promise((resolve, reject) => {
      execFile('xdg-open', [resolved], { detached: true }, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  });
};

module.exports.rescan = rescan;
