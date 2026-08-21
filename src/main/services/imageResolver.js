const fs = require('node:fs');
const path = require('node:path');
const { IMAGES_DIR } = require('../constants');

// Resolves a preview image for a MediaWiki page (Wikipedia or a Fandom wiki)
// via the standard MediaWiki Action API's pageimages module, downloads it,
// and caches it locally. This avoids hardcoding guessed image URLs: it asks
// the wiki itself what its lead image is, at the time the app actually runs
// (with real network access), rather than baking in a URL now.
function mediaWikiApiBase(pageUrl) {
  const url = new URL(pageUrl);
  if (url.hostname.endsWith('wikipedia.org')) {
    return `${url.protocol}//${url.hostname}/w/api.php`;
  }
  // Fandom wikis serve the Action API at the site root.
  return `${url.protocol}//${url.hostname}/api.php`;
}

function pageTitleFromUrl(pageUrl) {
  const url = new URL(pageUrl);
  const parts = url.pathname.split('/wiki/');
  if (parts.length < 2) return null;
  return decodeURIComponent(parts[1]);
}

async function fetchLeadImageUrl(pageUrl) {
  const title = pageTitleFromUrl(pageUrl);
  if (!title) return null;

  const apiBase = mediaWikiApiBase(pageUrl);
  const query = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'pageimages',
    pithumbsize: '900',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${apiBase}?${query.toString()}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  return page?.thumbnail?.source || null;
}

async function downloadTo(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

// category: 'maps' | 'books'. Returns a local file path, or null if no image
// could be resolved/downloaded (e.g. offline, or the page has no lead image).
async function resolveAndCacheImage({ id, category, sourceUrl, directImageUrl }) {
  const ext = '.jpg';
  const destPath = path.join(IMAGES_DIR, category, `${id}${ext}`);

  if (fs.existsSync(destPath)) return destPath;

  try {
    const remoteUrl = directImageUrl || (await fetchLeadImageUrl(sourceUrl));
    if (!remoteUrl) return null;
    await downloadTo(remoteUrl, destPath);
    return destPath;
  } catch (err) {
    console.error(`[imageResolver] failed to resolve image for ${category}#${id}:`, err.message);
    return null;
  }
}

module.exports = { resolveAndCacheImage };
