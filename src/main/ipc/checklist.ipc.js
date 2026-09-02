module.exports = function registerChecklistIpc(ipcMain, db, { shell }) {
  ipcMain.handle('checklist:list', () => {
    return db.all('SELECT * FROM checklist_items ORDER BY sort_order ASC');
  });

  ipcMain.handle('checklist:toggleOwned', async (_event, id) => {
    await db.run('UPDATE checklist_items SET owns_physical_copy = 1 - owns_physical_copy WHERE id = ?', [id]);
    return db.get('SELECT * FROM checklist_items WHERE id = ?', [id]);
  });

  ipcMain.handle('checklist:visit', async (_event, id) => {
    const row = await db.get('SELECT source_url FROM checklist_items WHERE id = ?', [id]);
    if (!row || !row.source_url) throw new Error('No Amazon link on file for this item');
    return shell.openExternal(row.source_url);
  });
};
