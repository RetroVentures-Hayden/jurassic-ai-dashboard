// Lets the web server reuse the Electron IPC handlers verbatim. Each
// registerXxxIpc(ipcMain, db, deps) call in the main process just registers
// (channel -> async handler) pairs; here we hand it a stand-in `ipcMain` that
// records those pairs into a Map, then expose `invoke(channel, args)` so an
// HTTP route can call the exact same code the desktop app runs.
//
// `shell.openExternal` targets the machine the process runs on — the wrong
// machine on the web host, since the browser is elsewhere — so it's stubbed to
// just return the URL, which the client shim then opens in the phone's browser.

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

const fakeShell = { openExternal: async (url) => url };

function buildBridge(db) {
  const ipcMain = createFakeIpcMain();

  registerChecklistIpc(ipcMain, db, { shell: fakeShell });
  registerMapsIpc(ipcMain, db, { shell: fakeShell });
  registerBooksIpc(ipcMain, db, { shell: fakeShell });
  registerAnimalsIpc(ipcMain, db, { shell: fakeShell });
  registerNewsIpc(ipcMain, db, { shell: fakeShell });
  registerChatIpc(ipcMain, db);
  registerSettingsIpc(ipcMain, db);

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
