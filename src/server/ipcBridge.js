// Lets the web server reuse the Electron IPC handlers verbatim. Each
// registerXxxIpc(ipcMain, db, deps) call in the main process just registers
// (channel -> async handler) pairs; here we hand it a stand-in `ipcMain` that
// records those pairs into a Map, then expose `invoke(channel, args)` so an
// HTTP route can call the exact same code the desktop app runs.
//
// The desktop-only bits (`shell.openExternal`, `dialog.showOpenDialog`,
// spawning a native video player) target the machine the process runs on —
// which on the web host is the wrong machine, since the browser is elsewhere.
// Those are stubbed so the URL / intent travels back to the client instead.

const registerLibraryIpc = require('../main/ipc/library.ipc');
const registerChecklistIpc = require('../main/ipc/checklist.ipc');
const registerMapsIpc = require('../main/ipc/maps.ipc');
const registerBooksIpc = require('../main/ipc/books.ipc');
const registerAnimalsIpc = require('../main/ipc/animals.ipc');
const registerNewsIpc = require('../main/ipc/news.ipc');
const registerChatIpc = require('../main/ipc/chat.ipc');
const registerSettingsIpc = require('../main/ipc/settings.ipc');

function createFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
}

// openExternal just returns the URL — the client shim opens it in the phone's
// browser. dialog has no web equivalent; the client prompts for a path and
// calls settings:setLibraryPath directly, so this stub is only a safety net.
const fakeShell = { openExternal: async (url) => url };
const fakeDialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };

function buildBridge(db) {
  const ipcMain = createFakeIpcMain();

  registerLibraryIpc(ipcMain, db);
  registerChecklistIpc(ipcMain, db, { shell: fakeShell });
  registerMapsIpc(ipcMain, db, { shell: fakeShell });
  registerBooksIpc(ipcMain, db, { shell: fakeShell });
  registerAnimalsIpc(ipcMain, db, { shell: fakeShell });
  registerNewsIpc(ipcMain, db, { shell: fakeShell });
  registerChatIpc(ipcMain, db);
  registerSettingsIpc(ipcMain, db, { dialog: fakeDialog });

  // library:play shells out to `xdg-open` on the host — never what a remote
  // client wants. Replace it so a stray call can't launch a player on the
  // laptop; real playback goes through the /media/:id streaming route.
  ipcMain.handlers.set('library:play', async (_e, id) => ({ streamUrl: `/media/${Number(id)}` }));

  return {
    channels: [...ipcMain.handlers.keys()],
    async invoke(channel, args = []) {
      const fn = ipcMain.handlers.get(channel);
      if (!fn) throw new Error(`Unknown channel: ${channel}`);
      return fn({}, ...args); // Electron passes an event first; handlers ignore it
    },
  };
}

module.exports = { buildBridge };
