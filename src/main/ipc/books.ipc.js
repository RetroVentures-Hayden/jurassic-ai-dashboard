const { resolveAndCacheImage } = require('../services/imageResolver');

module.exports = function registerBooksIpc(ipcMain, db, { shell }) {
  ipcMain.handle('books:list', () => {
    return db.all('SELECT * FROM books ORDER BY category ASC, sort_order ASC');
  });

  ipcMain.handle('books:getImage', async (_event, id) => {
    const row = await db.get('SELECT * FROM books WHERE id = ?', [id]);
    if (!row) throw new Error('Book entry not found');
    if (row.local_image_path) return row.local_image_path;

    const localPath = await resolveAndCacheImage({
      id: row.id,
      category: 'books',
      sourceUrl: row.source_url,
      directImageUrl: row.image_url,
    });
    if (localPath) {
      await db.run('UPDATE books SET local_image_path = ? WHERE id = ?', [localPath, id]);
    }
    return localPath;
  });

  ipcMain.handle('books:toggleOwned', async (_event, id) => {
    await db.run('UPDATE books SET owns_physical_copy = 1 - owns_physical_copy WHERE id = ?', [id]);
    return db.get('SELECT * FROM books WHERE id = ?', [id]);
  });

  ipcMain.handle('books:visit', async (_event, id) => {
    const row = await db.get('SELECT source_url FROM books WHERE id = ?', [id]);
    if (!row) throw new Error('Book entry not found');
    return shell.openExternal(row.source_url);
  });
};
