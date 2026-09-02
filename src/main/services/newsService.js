const Parser = require('rss-parser');

const parser = new Parser({ timeout: 15000 });

// Google News RSS search — a long-standing, widely used, no-API-key public
// endpoint (https://news.google.com/rss/search?q=...). This app could not
// live-verify the feed from the sandboxed environment it was built in (no
// outbound network there); it must be confirmed on first real run via the
// News tab's "Refresh" button or `news:refresh` IPC call.
//
// The dashboard covers two subjects — the Jurassic franchise AND a real
// extinct/living-animal encyclopedia — so the News tab pulls one feed per
// topic and merges the results (deduped by link via ON CONFLICT). Each stored
// row is tagged with its `topic` so the tab can group the headlines.
const NEWS_FEEDS = [
  {
    topic: 'franchise',
    query: '("Jurassic World" OR "Jurassic Park") (movie OR film OR series OR "Universal Studios" OR Amblin)',
  },
  {
    topic: 'paleo',
    query:
      '(dinosaur OR fossil OR paleontology OR "prehistoric animal" OR "de-extinction") (discovery OR species OR research OR excavation)',
  },
  {
    topic: 'wildlife',
    query:
      '("endangered species" OR "wildlife conservation" OR "extinct in the wild" OR "newly discovered species" OR rewilding) animal',
  },
];

// Kept for backwards compatibility with anything importing the single query.
const NEWS_QUERY = NEWS_FEEDS[0].query;

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
  const now = new Date().toISOString();
  let stored = 0;

  for (const { topic, query } of NEWS_FEEDS) {
    let feed;
    try {
      feed = await parser.parseURL(feedUrl(query));
    } catch (err) {
      // One topic's feed failing (rate limit, transient network) shouldn't
      // wipe out the other topics' headlines — log it and carry on.
      console.error(`[news] feed "${topic}" failed: ${err.message}`);
      continue;
    }

    const items = (feed.items || []).filter((i) => i.link);
    await db.transaction(async () => {
      for (const item of items) {
        await db.run(
          `INSERT INTO news_items (title, link, published_at, source, summary, fetched_at, topic)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(link) DO UPDATE SET
             title = excluded.title,
             published_at = excluded.published_at,
             summary = excluded.summary,
             fetched_at = excluded.fetched_at,
             topic = excluded.topic`,
          [
            item.title || '(untitled)',
            item.link,
            item.isoDate || item.pubDate || null,
            item.creator || item?.source?.title || null,
            item.contentSnippet || null,
            now,
            topic,
          ]
        );
      }
    });
    stored += items.length;
  }

  await db.run(
    `INSERT INTO settings (key, value) VALUES ('last_news_refresh', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [now]
  );

  return stored;
}

module.exports = { fetchAndStoreNews, feedUrl, NEWS_QUERY, NEWS_FEEDS };
