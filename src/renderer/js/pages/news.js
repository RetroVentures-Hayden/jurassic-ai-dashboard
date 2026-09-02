import { escapeHtml } from '../util.js';

// Sections are rendered in this order. Headlines with no topic (rows stored
// before the multi-feed split) fall back to 'franchise'.
const TOPIC_SECTIONS = [
  ['franchise', 'Jurassic Franchise'],
  ['paleo', 'Prehistoric & Fossil Discoveries'],
  ['wildlife', 'Wildlife & Conservation'],
];

export async function renderNews(root) {
  root.innerHTML = `
    <div class="btn-row" style="margin-bottom:16px;">
      <button class="btn btn-primary" id="refresh-news-btn">Refresh News</button>
    </div>
    <div id="news-list"></div>
  `;

  await loadAndRenderCached(root);

  // Attached once here (to the #news-list node freshly created by the
  // innerHTML assignment above) rather than inside loadAndRenderCached,
  // which runs again on every refresh and would otherwise stack up a new
  // listener on the same node each time.
  root.querySelector('#news-list').addEventListener('click', (e) => {
    const link = e.target.dataset.link;
    if (!link) return;
    e.preventDefault();
    window.api.news.openLink(link);
  });

  root.querySelector('#refresh-news-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Refreshing…';
    try {
      await window.api.news.refresh();
    } catch (err) {
      root.querySelector('#news-list').innerHTML = `<div class="status-banner error">Could not fetch news right now (${err.message}). Showing cached headlines.</div>`;
    }
    await loadAndRenderCached(root);
    e.target.disabled = false;
    e.target.textContent = 'Refresh News';
  });
}

async function loadAndRenderCached(root) {
  const items = await window.api.news.list();
  const list = root.querySelector('#news-list');
  if (!items.length) {
    list.innerHTML = `<div class="status-banner">No news fetched yet. Click "Refresh News" (requires an internet connection).</div>`;
    return;
  }

  const byTopic = {};
  for (const item of items) {
    const topic = item.topic || 'franchise';
    (byTopic[topic] = byTopic[topic] || []).push(item);
  }

  list.innerHTML = TOPIC_SECTIONS.map(([key, label]) => {
    const rows = byTopic[key] || [];
    if (!rows.length) return '';
    return `
      <h2 class="section-heading">${label}</h2>
      ${rows.map(renderItem).join('')}
    `;
  }).join('');
}

function renderItem(item) {
  return `
    <div class="news-item">
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">${escapeHtml(item.source || '')} ${item.published_at ? '· ' + new Date(item.published_at).toLocaleDateString() : ''}</div>
      <p>${escapeHtml(item.summary || '')}</p>
      <a class="btn" href="#" data-link="${escapeHtml(item.link)}">Read More ↗</a>
    </div>`;
}
