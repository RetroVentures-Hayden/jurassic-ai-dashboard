import { escapeHtml } from '../util.js';
import { openModal } from '../components/modal.js';

export async function renderMaps(root) {
  const maps = await window.api.maps.list();
  const wikis = maps.filter((m) => m.category === 'wiki');
  const official = maps.filter((m) => m.category === 'official');
  const fan = maps.filter((m) => m.category === 'fan');

  root.innerHTML = `
    <div id="maps-container">
      <h2 class="section-heading">Jurassic Franchise Wikis</h2>
      <div class="card-grid" id="wiki-grid">${wikis.map(renderWikiCard).join('') || emptyState()}</div>
      <h2 class="section-heading">Official In-Universe Maps</h2>
      <div class="card-grid" id="official-grid">${official.map(renderMapCard).join('') || emptyState()}</div>
      <h2 class="section-heading">Fan-Made Maps</h2>
      <div class="card-grid" id="fan-grid">${fan.map(renderMapCard).join('') || emptyState()}</div>
    </div>
  `;

  root.querySelector('#maps-container').addEventListener('click', (e) => {
    // Wiki entries open their site directly — there's no in-app image preview
    // for them, so skip the modal and just hand off to the browser.
    const visitId = e.target.dataset.visit;
    if (visitId) {
      window.api.maps.visit(Number(visitId));
      return;
    }

    const id = e.target.dataset.open;
    if (!id) return;
    const map = maps.find((m) => m.id === Number(id));
    if (!map) return;
    openModal({
      title: map.title,
      description: map.description,
      onVisit: () => window.api.maps.visit(map.id),
      loadImage: () => window.api.maps.getImage(map.id),
    });
  });
}

function renderMapCard(map) {
  return `
    <div class="card">
      <h3>${escapeHtml(map.title)}</h3>
      <div class="desc">${escapeHtml(map.description || '')}</div>
      <div class="btn-row">
        <button class="btn btn-primary" data-open="${map.id}">View Map</button>
      </div>
    </div>
  `;
}

function renderWikiCard(map) {
  return `
    <div class="card">
      <h3>${escapeHtml(map.title)}</h3>
      <div class="desc">${escapeHtml(map.description || '')}</div>
      <div class="btn-row">
        <button class="btn btn-primary" data-visit="${map.id}">Open Wiki ↗</button>
      </div>
    </div>
  `;
}

function emptyState() {
  return `<div class="status-banner">No entries yet.</div>`;
}
