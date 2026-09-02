const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel) {
  return (...args) => ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('api', {
  checklist: {
    list: invoke('checklist:list'),
    toggleOwned: invoke('checklist:toggleOwned'),
    visit: invoke('checklist:visit'),
  },
  maps: {
    list: invoke('maps:list'),
    visit: invoke('maps:visit'),
    getImage: invoke('maps:getImage'),
  },
  books: {
    list: invoke('books:list'),
    toggleOwned: invoke('books:toggleOwned'),
    visit: invoke('books:visit'),
    getImage: invoke('books:getImage'),
  },
  animals: {
    list: invoke('animals:list'),
    search: invoke('animals:search'),
    syncNow: invoke('animals:syncNow'),
    lastSync: invoke('animals:lastSync'),
    visitWiki: invoke('animals:visitWiki'),
    loadInfo: invoke('animals:loadInfo'),
  },
  news: {
    list: invoke('news:list'),
    refresh: invoke('news:refresh'),
    openLink: invoke('news:openLink'),
  },
  chat: {
    send: invoke('chat:send'),
    status: invoke('chat:status'),
  },
  settings: {
    get: invoke('settings:get'),
  },
});
