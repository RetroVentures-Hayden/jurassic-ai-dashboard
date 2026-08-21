const Parser = require('rss-parser');

const parser = new Parser({ timeout: 15000 });

// Google News RSS search — a long-standing, widely used, no-API-key public
// endpoint (https://news.google.com/rss/search?q=...). This app could not
// live-verify the feed from the sandboxed environment it was built in (no
// outbound network there); it must be confirmed on first real run via the
// News tab's "Refresh" button or `news:refresh` IPC call.
const NEWS_QUERY =
  '("Jurassic World" OR "Jurassic Park") (movie OR film OR Universal Studios OR Amblin)';

function feedUrl(query) {
  const params = new URLSearchParams({
    q: query,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function fetchAndStoreNews(db) {
  const feed = await parser.parseURL(feedUrl(NEWS_QUERY));

  const now = new Date().toISOString();
  const items = (feed.items || []).filter((i) => i.link);

  await db.transaction(async () => {
    for (const item of items) {
      await db.run(
        `INSERT INTO news_items (title, link, published_at, source, summary, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(link) DO UPDATE SET
           title = excluded.title,
           published_at = excluded.published_at,
           summary = excluded.summary,
           fetched_at = excluded.fetched_at`,
        [
          item.title || '(untitled)',
          item.link,
          item.isoDate || item.pubDate || null,
          item.creator || item?.source?.title || null,
          item.contentSnippet || null,
          now,
        ]
      );
    }
    await db.run(
      `INSERT INTO settings (key, value) VALUES ('last_news_refresh', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [now]
    );
  });

  return feed.items?.length || 0;
}

module.exports = { fetchAndStoreNews, feedUrl, NEWS_QUERY };
