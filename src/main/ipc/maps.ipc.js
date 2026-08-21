const { resolveAndCacheImage } = require('../services/imageResolver');

module.exports = function registerMapsIpc(ipcMain, db, { shell }) {
  ipcMain.handle('maps:list', () => {
    return db.all('SELECT * FROM maps ORDER BY category ASC, sort_order ASC');
  });

  ipcMain.handle('maps:visit', async (_event, id) => {
    const row = await db.get('SELECT source_url FROM maps WHERE id = ?', [id]);
    if (!row) throw new Error('Map entry not found');
    return shell.openExternal(row.source_url);
  });

  ipcMain.handle('maps:getImage', async (_event, id) => {
    const row = await db.get('SELECT * FROM maps WHERE id = ?', [id]);
    if (!row) throw new Error('Map entry not found');
    if (row.local_image_path) return row.local_image_path;

    const localPath = await resolveAndCacheImage({
      id: row.id,
      category: 'maps',
      sourceUrl: row.source_url,
      directImageUrl: row.image_url,
    });
    if (localPath) {
      await db.run('UPDATE maps SET local_image_path = ? WHERE id = ?', [localPath, id]);
    }
    return localPath;
  });
};
