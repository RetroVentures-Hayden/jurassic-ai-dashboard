// Resolves the specific Wikipedia page for one animal via Wikipedia's REST
// summary API, rather than guessing a /wiki/Title URL by hand — the API
// returns the real canonical URL (handling disambiguation, redirects, etc.)
// for whichever title actually matches, so the link is guaranteed to point
// at that exact animal's own article, not a guessed or generic page.
const USER_AGENT = 'JurassicAiDashboard/1.0 (https://github.com/hayhayman219-boop/jurassic-ai-dashboard)';

async function fetchSummary(title) {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  // Reject disambiguation pages — they're not a specific animal's article.
  if (data.type === 'disambiguation') return null;
  const pageUrl = data.content_urls?.desktop?.page;
  if (!pageUrl) return null;
  return {
    wikiUrl: pageUrl,
    imageUrl: data.thumbnail?.source || null,
    // The summary endpoint hands back the article's lead paragraph in
    // `extract`. This used to be discarded, which is why cards kept showing
    // "No description yet." even after their Wikipedia page had been
    // resolved — the URL was cached but the text was thrown away.
    description: data.extract || null,
  };
}

async function resolveAnimalWiki({ commonName, scientificName }) {
  const candidates = [...new Set([scientificName, commonName].filter(Boolean))];
  for (const title of candidates) {
    try {
      const result = await fetchSummary(title);
      if (result) return result;
    } catch (err) {
      console.error(`[wikiResolver] lookup failed for "${title}":`, err.message);
    }
  }
  return null;
}

module.exports = { resolveAnimalWiki };
