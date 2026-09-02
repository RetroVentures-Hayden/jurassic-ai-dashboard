import { escapeHtml } from '../util.js';

export async function renderChecklist(root) {
  const items = await window.api.checklist.list();
  const movies = items.filter((i) => i.type === 'movie');
  const series = items.filter((i) => i.type === 'series');

  root.innerHTML = `
    <div id="checklist-container">
      <p class="status-banner">Track which Jurassic movies and series you own a physical copy of.</p>
      <h2 class="section-heading">Films</h2>
      <div class="card-grid" id="movies-grid">${items.length ? movies.map(renderItem).join('') : ''}</div>
      <h2 class="section-heading">Series</h2>
      <div class="card-grid" id="series-grid">${series.map(renderItem).join('')}</div>
    </div>
  `;

  // Listener is attached to the freshly-created container above (not the
  // long-lived `root`/tab-content element), so it doesn't pile up on every
  // re-render — a stale accumulated listener was causing each toggle click
  // to fire multiple times and cancel itself back out.
  root.querySelector('#checklist-container').addEventListener('click', async (e) => {
    if (e.target.dataset.toggle) {
      await window.api.checklist.toggleOwned(Number(e.target.dataset.toggle));
      renderChecklist(root);
    }
    if (e.target.dataset.visit) {
      try {
        await window.api.checklist.visit(Number(e.target.dataset.visit));
      } catch (err) {
        alert(err.message);
      }
    }
  });
}

function renderItem(item) {
  const owned = !!item.owns_physical_copy;
  return `
    <div class="card">
      <h3>${escapeHtml(item.title)}</h3>
      <div class="btn-row">
        <button class="btn" data-visit="${item.id}">🛒 View on Amazon ↗</button>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" data-toggle="${item.id}" ${owned ? 'checked' : ''} />
        Own physical copy
      </label>
      ${owned ? '<span class="owned-badge">Owned</span>' : ''}
    </div>
  `;
}
