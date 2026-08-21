import { escapeHtml } from '../util.js';
import { openModal } from '../components/modal.js';

export async function renderMaps(root) {
  const maps = await window.api.maps.list();
  const official = maps.filter((m) => m.category === 'official');
  const fan = maps.filter((m) => m.category === 'fan');

  root.innerHTML = `
    <div id="maps-container">
      <h2 class="section-heading">Official In-Universe Maps</h2>
      <div class="card-grid" id="official-grid">${official.map(renderCard).join('') || emptyState()}</div>
      <h2 class="section-heading">Fan-Made Maps</h2>
      <div class="card-grid" id="fan-grid">${fan.map(renderCard).join('') || emptyState()}</div>
    </div>
  `;

  root.querySelector('#maps-container').addEventListener('click', (e) => {
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

function renderCard(map) {
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

function emptyState() {
  return `<div class="status-banner">No entries yet.</div>`;
}
