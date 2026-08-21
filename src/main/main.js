const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { CONFIG_DIR, IMAGES_DIR, STATE_DIR } = require('./constants');
const { openDatabase } = require('./db');
const registerLibraryIpc = require('./ipc/library.ipc');
const registerChecklistIpc = require('./ipc/checklist.ipc');
const registerMapsIpc = require('./ipc/maps.ipc');
const registerBooksIpc = require('./ipc/books.ipc');
const registerAnimalsIpc = require('./ipc/animals.ipc');
const registerNewsIpc = require('./ipc/news.ipc');
const registerChatIpc = require('./ipc/chat.ipc');
const registerSettingsIpc = require('./ipc/settings.ipc');
const { rescan } = require('./ipc/library.ipc');
const { installTimer } = require('./services/systemdInstaller');

// The app name controls Electron's userData path (~/.config/<name>) — it must
// stay in sync with constants.js / scripts/sync-animal-db.mjs, which compute
// the same DB path independently since the sync script runs outside Electron.
app.setName('jurassic-ai-dashboard');

let mainWindow = null;

function ensureDirs() {
  for (const dir of [CONFIG_DIR, IMAGES_DIR, STATE_DIR, path.join(IMAGES_DIR, 'maps'), path.join(IMAGES_DIR, 'books'), path.join(IMAGES_DIR, 'animals')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Jurassic AI Dashboard',
    icon: path.join(__dirname, '..', '..', 'packaging', 'linux', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(async () => {
  ensureDirs();
  const db = await openDatabase();

  registerLibraryIpc(ipcMain, db);
  registerChecklistIpc(ipcMain, db, { shell });
  registerMapsIpc(ipcMain, db, { shell });
  registerBooksIpc(ipcMain, db, { shell });
  registerAnimalsIpc(ipcMain, db, { shell });
  registerNewsIpc(ipcMain, db, { shell });
  registerChatIpc(ipcMain, db);
  registerSettingsIpc(ipcMain, db, { dialog });

  // Populate media_items on first ready (previously done inside
  // library.ipc.js itself, moved here now that rescan is async and needs
  // to be awaited rather than fired-and-forgotten during registration).
  rescan(db).catch((err) => console.error('[library] initial rescan failed:', err.message));

  createWindow();

  installTimer().catch((err) => {
    console.error('[systemd] failed to install/enable animal-sync timer:', err.message);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
