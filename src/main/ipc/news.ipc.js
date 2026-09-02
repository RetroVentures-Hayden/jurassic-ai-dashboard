const { fetchAndStoreNews } = require('../services/newsService');

module.exports = function registerNewsIpc(ipcMain, db, { shell }) {
  ipcMain.handle('news:list', () => {
    return db.all('SELECT * FROM news_items ORDER BY published_at DESC LIMIT 150');
  });

  ipcMain.handle('news:refresh', async () => {
    return fetchAndStoreNews(db);
  });

  ipcMain.handle('news:openLink', (_event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Refusing to open a non-http(s) link');
    }
    return shell.openExternal(url);
  });
};
