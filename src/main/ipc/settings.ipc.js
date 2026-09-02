module.exports = function registerSettingsIpc(ipcMain, db) {
  // The local-media-library feature was removed; nothing user-configurable
  // remains, but the channel is kept so the Settings page has a stable place
  // to read future preferences from.
  ipcMain.handle('settings:get', async () => {
    const rows = await db.all('SELECT key, value FROM settings');
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  });
};
