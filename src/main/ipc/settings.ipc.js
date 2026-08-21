const { DEFAULT_LIBRARY_PATH } = require('../constants');
const { rescan } = require('./library.ipc');

async function setLibraryPath(db, newPath) {
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('library_path', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [newPath]
  );
  await rescan(db);
}

module.exports = function registerSettingsIpc(ipcMain, db, { dialog }) {
  ipcMain.handle('settings:get', async () => {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', ['library_path']);
    return { library_path: row?.value || DEFAULT_LIBRARY_PATH };
  });

  ipcMain.handle('settings:setLibraryPath', async (_event, newPath) => {
    await setLibraryPath(db, newPath);
    return newPath;
  });

  ipcMain.handle('settings:pickLibraryFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    await setLibraryPath(db, result.filePaths[0]);
    return result.filePaths[0];
  });
};
