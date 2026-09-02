// Web build only. The Electron build gets window.api from preload.js over IPC;
// here it's rebuilt on top of the web server's POST /api/invoke. Same shape and
// channel names, so every page module in js/ runs unchanged. Loaded as a
// classic script before the deferred js/app.js module, so window.api exists
// before any page renders.
(function () {
  async function invoke(channel, args) {
    const res = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args: args || [] }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server error (${res.status})`);
    }
    if (!data.ok) throw new Error(data.error || 'Request failed');
    return data.result;
  }

  const call = (channel) => (...args) => invoke(channel, args);

  // Handlers that returned shell.openExternal(url) hand the URL back here; the
  // desktop opens it in the OS browser, the web build opens a new tab.
  const openExternal = (channel) => async (...args) => {
    const r = await invoke(channel, args);
    if (typeof r === 'string' && /^https?:\/\//i.test(r)) window.open(r, '_blank', 'noopener');
    return r;
  };

  // getImage handlers return an absolute path under the images cache dir;
  // rewrite it to the route that serves that dir. (null / http URLs pass through.)
  const imagePath = (channel) => async (...args) => {
    const r = await invoke(channel, args);
    if (typeof r === 'string' && r && !/^https?:/i.test(r)) {
      return '/local-file?p=' + encodeURIComponent(r);
    }
    return r;
  };

  window.api = {
    checklist: {
      list: call('checklist:list'),
      toggleOwned: call('checklist:toggleOwned'),
      visit: openExternal('checklist:visit'),
    },
    maps: {
      list: call('maps:list'),
      visit: openExternal('maps:visit'),
      getImage: imagePath('maps:getImage'),
    },
    books: {
      list: call('books:list'),
      toggleOwned: call('books:toggleOwned'),
      visit: openExternal('books:visit'),
      getImage: imagePath('books:getImage'),
    },
    animals: {
      list: call('animals:list'),
      search: call('animals:search'),
      syncNow: call('animals:syncNow'),
      lastSync: call('animals:lastSync'),
      visitWiki: openExternal('animals:visitWiki'),
      loadInfo: call('animals:loadInfo'),
    },
    news: {
      list: call('news:list'),
      refresh: call('news:refresh'),
      openLink: openExternal('news:openLink'),
    },
    chat: {
      send: call('chat:send'),
      status: call('chat:status'),
    },
    settings: {
      get: call('settings:get'),
    },
  };
})();
